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
let proc, dataDir, fake, fakeUrl, runsFake;
const runCalls = [];
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
    if (req.method === 'GET') { res.writeHead(404); return res.end('{}'); } // an older Hermes: no runs, chat only
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

  // A Hermes Agent with the Runs API: tools, a sub-agent, an approval it waits on, and its system endpoints.
  let approved = null, pendingApproval = false;
  runsFake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      runCalls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      if (req.url === '/health') return json(200, { status: 'ok' });
      if (req.url === '/v1/capabilities') return json(200, { object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent', features: { run_submission: true, run_events_sse: true, run_approval: true, run_stop: true } });
      if (req.url === '/health/detailed') return json(200, { status: 'ok', readiness: { checks: { config: 'ok', disk: 'ok' } } });
      if (req.url === '/v1/skills') return json(200, [{ name: 'github-pr-workflow', description: 'PRs', category: 'dev' }]);
      if (req.url === '/v1/toolsets') return json(200, [{ name: 'core', label: 'Core', enabled: true, configured: true, tools: ['read_file', 'terminal'] }]);
      if (req.url === '/api/jobs') return json(200, { jobs: [{ id: 'j1', name: 'morning brief', schedule: '40 7 * * *' }] });
      if (req.url.startsWith('/api/sessions')) return json(200, [{ id: 's1', title: 'HUD' }]);
      if (req.url === '/api/model/options') return json(200, { providers: [] });
      if (req.url === '/api/jobs/j1/run' && req.method === 'POST') return json(200, { ok: true });
      if (req.url === '/v1/runs' && req.method === 'POST') return json(200, { run_id: 'run_1', status: 'started' });
      if (req.url === '/v1/runs/run_1' && req.method === 'GET') {
        return json(200, { status: 'running', pending_controls: pendingApproval ? [{ prompt_id: 'p9', execution_generation: 2, kind: 'approval', command: 'rm -rf /tmp/cache', description: 'Delete the cache' }] : [] });
      }
      if (req.url === '/v1/runs/run_1/approval' && req.method === 'POST') { approved = JSON.parse(body); pendingApproval = false; return json(200, { ok: true }); }
      if (req.url === '/v1/runs/run_1/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('tool.started', { tool: 'terminal', preview: 'du -sh /tmp/cache' });
        send('tool.completed', { tool: 'terminal', duration: 0.42, error: null, preview: '2.1G /tmp/cache' });
        send('subagent.start', { name: 'janitor' });
        send('subagent.complete', { name: 'janitor', status: 'ok', duration: 1.5 });
        pendingApproval = true;
        send('approval.request', {});
        const wait = setInterval(() => {
          if (!approved) return;
          clearInterval(wait);
          send('message.delta', { delta: 'Cache ' });
          send('message.delta', { delta: 'cleared.' });
          send('run.completed', { output: 'Cache cleared, 2.1G freed.', usage: {} });
          res.end();
        }, 50);
        return;
      }
      json(404, { error: 'nope' });
    });
  });
  await new Promise((r) => runsFake.listen(0, '127.0.0.1', r));
  runsFake.approved = () => approved;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdsroom-comms-'));
  fs.writeFileSync(path.join(dataDir, 'agents.json'), JSON.stringify({
    clawd: { type: 'hermes', url: fakeUrl, key: '$HERMES_KEY' },
    scout: { type: 'openai', url: `${fakeUrl}/v1/chat/completions`, model: 'other', history: 5 },
    idle: { label: 'Idle' },
    ops: { type: 'hermes', url: `http://127.0.0.1:${runsFake.address().port}`, key: 'k2' },
  }));
  proc = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, COLLECT_SYSTEM: '0', HERMES_KEY: 'sekrit', CLAWDSROOM_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok);
});

after(() => { proc.kill(); fake.close(); runsFake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

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

test('runs: tools, sub-agents and an approval answered from the HUD, then the reply', async () => {
  const r = await fetch(`${BASE}/api/comms/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'ops', text: 'clear the cache' }) });
  assert.equal(r.status, 200);
  const waiting = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=ops`)).json()).find((e) => e.control));
  assert.equal(waiting.control.type, 'approval');
  assert.equal(waiting.control.detail, 'rm -rf /tmp/cache');
  assert.equal(waiting.run, 'run_1');
  const steps = waiting.trace.steps;
  const tool = steps.find((s) => s.kind === 'tool');
  assert.equal(tool.text, 'terminal');
  assert.equal(tool.detail, '2.1G /tmp/cache');
  assert.equal(tool.ms, 420);
  assert.ok(steps.some((s) => s.kind === 'agent' && s.text === 'janitor' && s.detail === 'ok · 1.5s'));
  assert.ok(steps.some((s) => s.kind === 'auth'));
  // a wrong id, then the real approval
  assert.equal((await fetch(`${BASE}/api/comms/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'nope', choice: 'once' }) })).status, 409);
  const ok = await fetch(`${BASE}/api/comms/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: waiting.id, choice: 'once' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(runsFake.approved(), { request_id: 'p9', execution_generation: 2, choice: 'once' });
  const reply = await waitFor(async () => (await (await fetch(`${BASE}/api/comms/log?agent=ops`)).json()).find((e) => e.kind === 'reply'));
  assert.equal(reply.text, 'Cache cleared, 2.1G freed.');
  const sent = (await (await fetch(`${BASE}/api/comms/log?agent=ops`)).json()).find((e) => e.from === 'you');
  assert.equal(sent.control, null);
  assert.ok(sent.trace.steps.some((s) => s.kind === 'auth' && /APPROVED/.test(s.text)));
  const start = runCalls.find((c) => c.url === '/v1/runs');
  assert.equal(start.body.input, 'clear the cache');
  assert.equal(start.body.session_id, 'ops-hud');
  assert.equal(start.auth, 'Bearer k2');
});

test('the Hermes overview and job controls go through the server', async () => {
  const o = await (await fetch(`${BASE}/api/hermes/overview?agent=ops`)).json();
  assert.equal(o.online, true);
  assert.equal(o.capabilities.platform, 'hermes-agent');
  assert.equal(o.skills[0].name, 'github-pr-workflow');
  assert.deepEqual(o.toolsets[0].tools, ['read_file', 'terminal']);
  assert.equal(o.jobs[0].name, 'morning brief');
  assert.equal(o.sessions[0].title, 'HUD');
  assert.ok(!JSON.stringify(o).includes('k2'));
  const run = await fetch(`${BASE}/api/hermes/jobs/j1/run?agent=ops`, { method: 'POST' });
  assert.equal(run.status, 200);
  assert.ok(runCalls.some((c) => c.url === '/api/jobs/j1/run' && c.method === 'POST'));
  assert.equal((await fetch(`${BASE}/api/hermes/jobs/j1/explode?agent=ops`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${BASE}/api/hermes/overview?agent=idle`)).status, 400);
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
