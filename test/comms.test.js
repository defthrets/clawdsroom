import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compose, chatHistory, interpolate, hermesBase, parseSseBlock, progressLabel, Trace } from '../server/comms.js';

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
  // A stand-in for Hermes Agent's API server: /health, and /v1/chat/completions that streams a tool
  // progress event and the reply in chunks. Non-streaming requests (the generic openai link) get JSON.
  fake = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('{"status":"ok"}'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, auth: req.headers.authorization, session: req.headers['x-hermes-session-id'], sessionKey: req.headers['x-hermes-session-key'], ...j });
      const said = j.messages.at(-1).content;
      if (!j.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `heard: ${said}` } }] }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': keepalive\n\n');
      res.write(`event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: 'terminal', label: 'checking the dish' })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'The user wants the status. ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'Dish looks fine.' } }] })}\n\n`);
      setTimeout(() => {
        for (const part of ['heard', ': ', said]) res.write(`data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: part } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        res.end();
      }, 900);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdsroom-comms-'));
  fs.writeFileSync(path.join(dataDir, 'agents.json'), JSON.stringify({
    clawd: { type: 'hermes', url: fakeUrl, key: '$HERMES_KEY' },
    scout: { type: 'openai', url: `${fakeUrl}/v1/chat/completions`, model: 'other', history: 5 },
    idle: { label: 'Idle' },
  }));
  proc = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, COLLECT_SYSTEM: '0', HERMES_KEY: 'sekrit', CLAWDSROOM_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok);
});

after(() => { proc.kill(); fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('compose, history, $ENV, hermes urls and SSE parsing', () => {
  assert.equal(compose({ kind: 'talk', text: 'hi' }), 'hi');
  assert.equal(compose({ kind: 'note', text: 'milk', audio_url: 'http://x/a.m4a' }), '[Voice message from the HUD] milk\nAudio: http://x/a.m4a');
  assert.match(compose({ kind: 'talk', text: '', audio_url: 'http://x/a.m4a' }), /no transcript\]\nAudio: http/);
  const log = [{ from: 'you', to: 'scout', text: 'a' }, { from: 'scout', to: 'you', text: 'b' }, { from: 'you', to: 'clawd', text: 'c' }];
  assert.deepEqual(chatHistory(log, 'scout', 5), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
  assert.deepEqual(chatHistory(log, 'scout', 0), []);
  assert.deepEqual(interpolate({ key: '$K', h: ['x${K}y'] }, { K: '1' }), { key: '1', h: ['x1y'] });
  assert.equal(hermesBase({}), 'http://127.0.0.1:8642');
  assert.equal(hermesBase({ url: 'http://box:8642/v1/' }), 'http://box:8642');
  assert.equal(hermesBase({ url: 'http://box:8642/v1/chat/completions', profile: 'clawd' }), 'http://box:8642/p/clawd');
  assert.deepEqual(parseSseBlock('event: hermes.tool.progress\ndata: {"tool":"web"}'), { event: 'hermes.tool.progress', data: { tool: 'web' }, raw: '{"tool":"web"}' });
  assert.equal(parseSseBlock(': keepalive'), null);
  assert.equal(progressLabel({ tool: 'terminal', label: 'ls' }), 'terminal: ls');
  assert.equal(progressLabel({ progress: { name: 'web_search' } }), 'web_search');
});

test('a trace throttles flushes but always flushes a new step', async () => {
  const snaps = [];
  const tr = new Trace((s) => snaps.push(s));
  tr.step('rx', 'IN');
  for (let i = 0; i < 20; i++) tr.think('x');
  assert.equal(snaps.length, 2, 'the step and the first reasoning step flush at once, the deltas wait');
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(snaps.at(-1).reasoning, 'x'.repeat(20));
  tr.step('tool', 'web');
  tr.step('tool', 'web');
  assert.equal(snaps.at(-1).steps.filter((s) => s.kind === 'tool').length, 1, 'repeats are folded');
  tr.close('done', 'OK');
  assert.equal(tr.snapshot(true).steps.at(-1).kind, 'done');
});

test('lists agents without leaking their config, with Hermes health', async () => {
  const list = await (await fetch(`${BASE}/api/comms/agents`)).json();
  assert.deepEqual(list.find((a) => a.id === 'clawd'), { id: 'clawd', label: 'Clawd', ready: true, type: 'hermes', voice: null, online: true });
  assert.equal(list.find((a) => a.id === 'idle').ready, false);
  assert.ok(!list.some((a) => a.id === 'hermes'), 'no separate hermes channel by default');
  assert.ok(!JSON.stringify(list).includes('sekrit') && !JSON.stringify(list).includes('127.0.0.1'));
});

test('talking to Clawd goes through Hermes Agent with a session, and the streamed reply lands', async () => {
  const r = await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'clawd', text: 'status?' }) });
  assert.equal(r.status, 200);
  const progress = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=clawd`)).json()).find((e) => e.progress));
  assert.equal(progress.progress, 'terminal: checking the dish');
  const reply = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=clawd`)).json()).find((e) => e.kind === 'reply'));
  assert.equal(reply.text, 'heard: status?');
  const call = seen.find((c) => c.url === '/v1/chat/completions' && c.stream);
  assert.equal(call.auth, 'Bearer sekrit');
  assert.equal(call.session, 'clawd-hud');
  assert.equal(call.sessionKey, 'clawd-hud');
  assert.deepEqual(call.messages, [{ role: 'user', content: 'status?' }], 'Hermes keeps the history itself');
  const sent = (await (await fetch(`${BASE}/api/comms/log?agent=clawd`)).json()).find((e) => e.from === 'you');
  assert.equal(sent.status, 'delivered');
  assert.equal(sent.progress, null);
  // the trace of the turn: what he did, what he thought, in order
  assert.deepEqual(sent.trace.steps.map((s) => s.kind), ['rx', 'link', 'tool', 'reason', 'compose', 'done']);
  assert.equal(sent.trace.steps[2].text, 'terminal: checking the dish');
  assert.equal(sent.trace.reasoning, 'The user wants the status. Dish looks fine.');
  assert.equal(sent.trace.partial, '');
  assert.equal(sent.trace.done, true);
  assert.ok(sent.trace.steps.every((s) => typeof s.at === 'number' && s.end >= s.at));
  const s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.clawd.status, 'heard: status?'); // his speech bubble in the room
});

test('a voice note is stored, served with ranges and sent with history on an openai link', async () => {
  await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'scout', text: 'first' }) });
  await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=scout`)).json()).find((e) => e.kind === 'reply'));
  const audio = Buffer.alloc(4096, 7);
  const r = await fetch(`${BASE}/api/comms/voice?to=scout&kind=note&text=buy%20milk`, { method: 'POST', headers: { 'content-type': 'audio/mp4' }, body: audio });
  assert.equal(r.status, 200);
  const { entry } = await r.json();
  assert.match(entry.audio, /\.m4a$/);
  const call = await waitFor(() => seen.filter((c) => c.model === 'other')[1]);
  assert.deepEqual(call.messages.slice(0, 2).map((m) => m.role), ['user', 'assistant']); // the earlier exchange
  assert.match(call.messages.at(-1).content, /^\[Voice message from the HUD\] buy milk\nAudio: http:\/\/127\.0\.0\.1:\d+\/api\/comms\/audio\/.+\.m4a$/);
  const part = await fetch(`${BASE}/api/comms/audio/${entry.audio}`, { headers: { range: 'bytes=0-1' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 0-1/4096');
  assert.equal((await part.arrayBuffer()).byteLength, 2);
  assert.equal((await fetch(`${BASE}/api/comms/audio/..%2Fstate.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/comms/voice?to=scout`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
});

test('an agent can reply later, unknown agents are refused, unlinked ones queue', async () => {
  let r = await fetch(`${BASE}/api/comms/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'clawd', text: 'done, mate' }) });
  assert.equal(r.status, 200);
  const s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.comms.log.at(-1).text, 'done, mate');
  r = await fetch(`${BASE}/api/comms/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'nobody', text: 'x' }) });
  assert.equal(r.status, 400);
  r = await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'nobody', text: 'x' }) });
  assert.equal(r.status, 400);
  await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'idle', text: 'you there?' }) });
  const q = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=idle`)).json()).find((e) => e.text === 'you there?' && e.status === 'queued'));
  assert.ok(q);
});
