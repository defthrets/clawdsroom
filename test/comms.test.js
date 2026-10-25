import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compose, chatHistory, interpolate } from '../server/comms.js';

const PORT = 19787 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc, dataDir, fake, fakeUrl;
const seen = [];

async function waitFor(fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

before(async () => {
  // a stand-in for an OpenAI-style agent (OpenClaw's /v1/chat/completions, Hermes on :8642)
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push({ auth: req.headers.authorization, ...j });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `heard: ${j.messages.at(-1).content}` } }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}/v1/chat/completions`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdsroom-comms-'));
  fs.writeFileSync(path.join(dataDir, 'agents.json'), JSON.stringify({
    hermes: { type: 'openai', url: fakeUrl, key: '$HERMES_KEY', model: 'hermes-agent', history: 5 },
  }));
  proc = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, COLLECT_SYSTEM: '0', HERMES_KEY: 'sekrit', CLAWDSROOM_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok);
});

after(() => { proc.kill(); fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('compose, history and $ENV interpolation', () => {
  assert.equal(compose({ kind: 'talk', text: 'hi' }), 'hi');
  assert.equal(compose({ kind: 'note', text: 'milk', audio_url: 'http://x/a.m4a' }), '[Voice message from the HUD] milk\nAudio: http://x/a.m4a');
  assert.match(compose({ kind: 'talk', text: '', audio_url: 'http://x/a.m4a' }), /no transcript\]\nAudio: http/);
  const log = [{ from: 'you', to: 'hermes', text: 'a' }, { from: 'hermes', to: 'you', text: 'b' }, { from: 'you', to: 'clawd', text: 'c' }];
  assert.deepEqual(chatHistory(log, 'hermes', 5), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
  assert.deepEqual(chatHistory(log, 'hermes', 0), []);
  assert.deepEqual(interpolate({ key: '$K', h: ['x${K}y'] }, { K: '1' }), { key: '1', h: ['x1y'] });
});

test('lists agents without leaking their config', async () => {
  const list = await (await fetch(`${BASE}/api/comms/agents`)).json();
  const hermes = list.find((a) => a.id === 'hermes');
  const clawd = list.find((a) => a.id === 'clawd');
  assert.deepEqual(hermes, { id: 'hermes', label: 'Hermes', ready: true, type: 'openai', voice: null });
  assert.equal(clawd.ready, false);
  assert.ok(!JSON.stringify(list).includes('sekrit') && !JSON.stringify(list).includes('127.0.0.1'));
});

test('a typed message goes to the agent and the reply lands in the thread', async () => {
  const r = await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'hermes', text: 'status?' }) });
  assert.equal(r.status, 200);
  const reply = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=hermes`)).json()).find((e) => e.kind === 'reply'));
  assert.equal(reply.text, 'heard: status?');
  assert.equal(seen[0].auth, 'Bearer sekrit');
  assert.equal(seen[0].model, 'hermes-agent');
  const log = await (await fetch(`${BASE}/api/comms/log?agent=hermes`)).json();
  assert.equal(log.find((e) => e.from === 'you').status, 'delivered');
  const events = await (await fetch(`${BASE}/api/events`)).json();
  assert.ok(events.some((e) => e.type === 'comms' && e.from === 'hermes'));
});

test('a voice note is stored, served with ranges and sent with history', async () => {
  const audio = Buffer.alloc(4096, 7);
  const r = await fetch(`${BASE}/api/comms/voice?to=hermes&kind=note&text=buy%20milk`, { method: 'POST', headers: { 'content-type': 'audio/mp4' }, body: audio });
  assert.equal(r.status, 200);
  const { entry } = await r.json();
  assert.match(entry.audio, /\.m4a$/);
  await waitFor(() => seen.length >= 2);
  const msgs = seen[1].messages;
  assert.deepEqual(msgs.slice(0, 2).map((m) => m.role), ['user', 'assistant']); // the earlier exchange
  assert.match(msgs.at(-1).content, /^\[Voice message from the HUD\] buy milk\nAudio: http:\/\/127\.0\.0\.1:\d+\/api\/comms\/audio\/.+\.m4a$/);
  const part = await fetch(`${BASE}/api/comms/audio/${entry.audio}`, { headers: { range: 'bytes=0-1' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 0-1/4096');
  assert.equal((await part.arrayBuffer()).byteLength, 2);
  assert.equal((await fetch(`${BASE}/api/comms/audio/..%2Fstate.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/comms/voice?to=hermes`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
});

test('an agent can reply later, and unknown agents are refused', async () => {
  let r = await fetch(`${BASE}/api/comms/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'clawd', text: 'done, mate' }) });
  assert.equal(r.status, 200);
  const s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.comms.log.at(-1).text, 'done, mate');
  assert.equal(s.clawd.status, 'done, mate'); // his speech bubble in the room
  r = await fetch(`${BASE}/api/comms/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'nobody', text: 'x' }) });
  assert.equal(r.status, 400);
  r = await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'nobody', text: 'x' }) });
  assert.equal(r.status, 400);
  // clawd has no link configured: the message waits in the thread as queued
  await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'clawd', text: 'you there?' }) });
  const q = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=clawd`)).json()).find((e) => e.text === 'you there?' && e.status === 'queued'));
  assert.ok(q);
});
