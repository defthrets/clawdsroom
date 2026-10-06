import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18787 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let dataDir;

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdsroom-'));
  proc = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, COLLECT_SYSTEM: '0', CLAWDSROOM_TOKEN: 'secret' },
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/api/health`);
});

after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('serves the room and the api', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /Clawd's Room/);
  const js = await fetch(`${BASE}/js/main.js`);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const state = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(state.meta.host, '192.168.1.253');
  const missing = await fetch(`${BASE}/nope.js`);
  assert.equal(missing.status, 404);
  const traversal = await fetch(`${BASE}/..%2Fpackage.json`);
  assert.notEqual(traversal.status, 200);
});

test('writes need the token', async () => {
  const r = await fetch(`${BASE}/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"clawd":{"activity":"terminal"}}' });
  assert.equal(r.status, 401);
});

test('patches, dotted keys, events and the stream', async () => {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer secret' };
  let r = await fetch(`${BASE}/api/state?power.battery=42&power.charging=true`, { method: 'POST', headers, body: '{"clawd":{"activity":"terminal","status":"hi"}}' });
  assert.equal(r.status, 200);
  let s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.clawd.activity, 'terminal');
  assert.equal(s.power.battery, 42);
  assert.equal(s.power.charging, true);

  // open the stream, then push an event and make sure it arrives
  const ac = new AbortController();
  const stream = await fetch(`${BASE}/api/stream`, { signal: ac.signal });
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readUntil = async (needle) => {
    for (let i = 0; i < 40; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      if (buf.includes(needle)) return true;
    }
    return false;
  };
  assert.ok(await readUntil('event: state'), 'initial state arrives');
  r = await fetch(`${BASE}/api/event`, { method: 'POST', headers, body: '{"type":"bird","species":"Wren"}' });
  assert.equal(r.status, 200);
  assert.ok(await readUntil('"species":"Wren"'), 'event arrives on the stream');
  ac.abort();

  s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.chirpa.detections_today, 1);
  const events = await (await fetch(`${BASE}/api/events`)).json();
  assert.equal(events[events.length - 1].type, 'bird');

  r = await fetch(`${BASE}/api/event`, { method: 'POST', headers, body: '{"species":"nope"}' });
  assert.equal(r.status, 400);
  r = await fetch(`${BASE}/api/state`, { method: 'POST', headers, body: 'not json' });
  assert.equal(r.status, 400);
});

test('state is persisted to disk', async () => {
  await new Promise((r) => setTimeout(r, 2600));
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.clawd.activity, 'terminal');
});
