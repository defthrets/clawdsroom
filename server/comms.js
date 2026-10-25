// Comms: talk to Clawd from the HUD. You hold to talk (or leave a voice note); the server keeps the
// audio, transcribes it if it can, hands it to the agent and puts the reply back in the thread,
// spoken aloud on the HUD.
//
// Clawd runs on Hermes Agent, so the default link is Hermes Agent's API server. Agents are
// configured in data/agents.json (AGENTS_FILE), re-read whenever it changes:
//
//   { "clawd": { "type": "hermes", "url": "http://127.0.0.1:8642", "key": "$HERMES_API_SERVER_KEY" } }
//
// Types: hermes (Hermes Agent's /v1/chat/completions with X-Hermes-Session-Id, so Hermes keeps the
// conversation; streamed, so tool progress shows on the HUD), openai (any other chat-completions
// endpoint; we send the history), webhook (our JSON payload; a {reply} in the response counts),
// command (a shell command; its stdout counts as the reply). "$NAME" strings are read from the
// environment. Optional speech: STT_URL (OpenAI-style /v1/audio/transcriptions) and TTS_URL
// (OpenAI-style /v1/audio/speech). Hermes Agent's API takes text only, so voice needs a transcript.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Hermes, hermesBase, hermesChat, parseSseBlock, progressLabel } from './hermes.js';

export { hermesBase, hermesChat, parseSseBlock, progressLabel }; // for the tests and older imports

const LOG_MAX = 60;
const TRACE_KEEP = 6;      // full traces (with reasoning) kept on the newest messages; older ones keep their steps
const REASON_MAX = 6000;  // characters of reasoning kept per turn
const AUDIO_KEEP = 300;
const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const MIME = { m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
const DEFAULT_AGENTS = { clawd: { label: 'Clawd' } };

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// "$NAME" → process.env.NAME, recursively.
export function interpolate(v, env = process.env) {
  if (typeof v === 'string') return v.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, n) => env[n] ?? '');
  if (Array.isArray(v)) return v.map((x) => interpolate(x, env));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interpolate(x, env)]));
  return v;
}

// What the agent is told, for one message from the HUD.
export function compose(entry, { replyHint = '' } = {}) {
  const text = (entry.text || '').trim();
  let msg;
  if (entry.kind === 'note') msg = `[Voice message from the HUD] ${text || '(no transcript)'}`;
  else msg = text || '[Voice clip from the HUD, no transcript]';
  if (entry.audio_url && (entry.kind === 'note' || !text)) msg += `\nAudio: ${entry.audio_url}`;
  if (replyHint) msg += `\n\n${replyHint}`;
  return msg;
}

// The thread with one agent as chat messages, oldest first.
export function chatHistory(log, agent, turns) {
  if (!turns) return [];
  return log
    .filter((e) => (e.from === 'you' && e.to === agent) || (e.from === agent && e.to === 'you'))
    .filter((e) => e.text)
    .slice(-turns * 2)
    .map((e) => ({ role: e.from === 'you' ? 'user' : 'assistant', content: e.text }));
}

async function fetchJson(url, opts, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const body = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 160)}`);
    try { return JSON.parse(body); } catch { return { text: body }; }
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : e.message);
  } finally { clearTimeout(timer); }
}

// The steps of one turn as the HUD shows them: what Clawd did, what he was thinking, what he is writing.
// Changes are flushed at most every 300ms (always at once for a new step).
export class Trace {
  constructor(flush = () => {}) {
    this.t0 = Date.now(); this.steps = []; this.reasoning = ''; this.partial = ''; this.tool = '';
    this.flush = flush; this.last = 0; this.timer = null;
  }
  step(kind, text, extra = {}) {
    const s = { kind, text: String(text || '').slice(0, 160), at: Date.now() - this.t0, ...extra };
    const prev = this.steps[this.steps.length - 1];
    if (prev && prev.kind === kind && prev.text === s.text) return;
    if (prev && prev.end == null) prev.end = s.at;
    this.steps.push(s);
    if (this.steps.length > 40) this.steps.splice(1, 1);
    if (kind === 'tool') this.tool = s.text;
    this.kick(true);
  }
  // A step that started earlier has finished (a tool or a sub-agent): note how long and whether it failed.
  finish(kind, text, fields = {}) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i];
      if (s.kind === kind && s.text === String(text).slice(0, 160) && !s.finished) {
        Object.assign(s, fields, { finished: true });
        if (fields.ms != null) s.end = s.at + fields.ms;
        this.kick(true);
        return;
      }
    }
    this.step(kind, text, { ...fields, finished: true });
  }
  think(delta) {
    if (this.steps[this.steps.length - 1]?.kind !== 'reason') this.step('reason', 'REASONING');
    this.reasoning = (this.reasoning + delta).slice(-REASON_MAX);
    this.kick();
  }
  write(delta) {
    if (this.steps[this.steps.length - 1]?.kind !== 'compose') this.step('compose', 'COMPOSING RESPONSE');
    this.partial += delta;
    this.kick();
  }
  kick(now = false) {
    const wait = 300 - (Date.now() - this.last);
    if (now || wait <= 0) { clearTimeout(this.timer); this.timer = null; this.last = Date.now(); this.flush(this.snapshot()); }
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.last = Date.now(); this.flush(this.snapshot()); }, wait);
  }
  close(kind, text) {
    clearTimeout(this.timer); this.timer = null;
    this.step(kind, text);
    const last = this.steps[this.steps.length - 1];
    if (last) last.end = last.at;
  }
  snapshot(final = false) {
    return { t0: this.t0, ms: Date.now() - this.t0, done: final, steps: this.steps.map((s) => ({ ...s })), reasoning: this.reasoning, partial: final ? '' : this.partial.slice(-1500) };
  }
}

export class Comms {
  // hooks: getState(), patch(patch), event(ev)
  constructor({ dataDir, agentsFile, hooks, env = process.env }) {
    this.dir = path.join(dataDir, 'voice');
    this.agentsFile = agentsFile || path.join(dataDir, 'agents.json');
    this.hooks = hooks;
    this.env = env;
    this.cache = { mtime: -1, agents: DEFAULT_AGENTS };
    this.health = new Map(); // agent id → {at, online}
    this.clients = new Map(); // agent id → {key, client: Hermes}
    this.active = new Map(); // entry id → {ac, client, runId} while a turn is running
  }

  // One Hermes client per agent, rebuilt when its config changes.
  hermesFor(id, cfg) {
    const key = JSON.stringify(cfg);
    const hit = this.clients.get(id);
    if (hit && hit.key === key) return hit.client;
    const client = new Hermes(cfg);
    this.clients.set(id, { key, client });
    return client;
  }

  hermesAgent(id) {
    const raw = this.agents()[id];
    if (!raw || raw.type !== 'hermes') throw Object.assign(new Error(`"${id}" is not a Hermes Agent link`), { status: 400 });
    return this.hermesFor(id, interpolate(raw, this.env));
  }

  overview(id, opts) { return this.hermesAgent(id).overview(opts); }
  jobAction(id, job, action) { return this.hermesAgent(id).jobAction(job, action); }

  // Stop a turn that is still running (the run on Hermes too, when it is one).
  async stop(entryId) {
    const act = this.active.get(entryId);
    if (!act) throw Object.assign(new Error('nothing running for that message'), { status: 409 });
    if (act.runId) await act.client.stop(act.runId).catch((e) => console.warn(`[comms] stop: ${e.message}`));
    act.ac.abort();
    return { ok: true };
  }

  // Answer an approval or a clarifying question that Hermes is waiting on.
  async control(entryId, { choice, answer }) {
    const entry = this.log().find((e) => e.id === entryId);
    const act = this.active.get(entryId);
    if (!entry?.control || !act?.runId) throw Object.assign(new Error('nothing is waiting on you for that message'), { status: 409 });
    const c = entry.control;
    if (c.type === 'clarify') {
      if (!String(answer ?? '').trim()) throw Object.assign(new Error('needs an "answer"'), { status: 400 });
      await act.client.clarify(act.runId, c, String(answer).slice(0, 2000));
      act.trace?.step('ask', `ANSWERED: ${String(answer).slice(0, 80)}`);
    } else {
      const ch = String(choice || 'deny');
      await act.client.approve(act.runId, c, ch);
      act.trace?.step('auth', ch === 'deny' ? 'DENIED FROM THE HUD' : `APPROVED (${ch.toUpperCase()}) FROM THE HUD`);
    }
    this.update(entryId, { control: null });
    return { ok: true };
  }

  // ------------------------------------------------------------ config
  agents() {
    let mtime = 0;
    try { mtime = fs.statSync(this.agentsFile).mtimeMs; } catch { /* no file: defaults */ }
    if (mtime !== this.cache.mtime) {
      let file = {};
      if (mtime) {
        try { file = JSON.parse(fs.readFileSync(this.agentsFile, 'utf8')); } catch (e) { console.warn(`[comms] bad ${this.agentsFile}: ${e.message}`); }
      }
      const merged = {};
      for (const [id, cfg] of Object.entries({ ...DEFAULT_AGENTS, ...file })) {
        if (!cfg || cfg.enabled === false) continue;
        merged[id] = { label: id[0].toUpperCase() + id.slice(1), ...DEFAULT_AGENTS[id], ...cfg };
      }
      this.cache = { mtime, agents: merged };
    }
    return this.cache.agents;
  }

  // Safe to show the HUD: no urls or keys. For Hermes links, whether its API server answers /health.
  async publicAgents() {
    return Promise.all(Object.entries(this.agents()).map(async ([id, a]) => ({
      id, label: a.label, ready: !!a.type, type: a.type || null, voice: a.voice || null,
      online: a.type === 'hermes' ? await this.isOnline(id, a) : null,
    })));
  }

  async isOnline(id, raw) {
    const hit = this.health.get(id);
    if (hit && Date.now() - hit.at < 20000) return hit.online;
    let online = false;
    try {
      const r = await fetch(`${hermesBase(interpolate(raw, this.env))}/health`, { signal: AbortSignal.timeout(2000) });
      online = r.ok;
    } catch { /* down */ }
    this.health.set(id, { at: Date.now(), online });
    return online;
  }

  // ------------------------------------------------------------ the thread
  log() { return (this.hooks.getState().comms?.log || []).slice(); }

  upsert(entry) {
    const log = this.log().filter((e) => e.id !== entry.id);
    log.push(entry);
    log.sort((a, b) => a.at - b.at);
    // keep the whole trace on the newest few turns only; older ones keep a short list of steps
    const keep = new Set(log.filter((e) => e.trace).slice(-TRACE_KEEP).map((e) => e.id));
    for (let i = 0; i < log.length; i++) {
      const tr = log[i].trace;
      if (tr && !keep.has(log[i].id) && (tr.reasoning || tr.partial || tr.steps?.length > 12)) {
        log[i] = { ...log[i], trace: { t0: tr.t0, ms: tr.ms, done: true, steps: (tr.steps || []).slice(-12) } };
      }
    }
    this.hooks.patch({ comms: { log: log.slice(-LOG_MAX) } });
    return entry;
  }

  update(id, fields) {
    const cur = this.log().find((e) => e.id === id);
    return cur ? this.upsert({ ...cur, ...fields }) : null;
  }

  // ------------------------------------------------------------ audio files
  async saveAudio(buf, mime = 'audio/mp4') {
    const base = String(mime).split(';')[0].trim().toLowerCase();
    const ext = EXT[base] || 'm4a';
    await fsp.mkdir(this.dir, { recursive: true });
    const name = `${newId()}.${ext}`;
    await fsp.writeFile(path.join(this.dir, name), buf);
    this.prune().catch(() => {});
    return name;
  }

  async prune() {
    const files = (await fsp.readdir(this.dir)).sort(); // ids start with the time, so this is oldest first
    for (const f of files.slice(0, Math.max(0, files.length - AUDIO_KEEP))) await fsp.unlink(path.join(this.dir, f)).catch(() => {});
  }

  audioFile(name) {
    if (!/^[a-z0-9]+\.(m4a|webm|ogg|mp3|wav)$/.test(name || '')) return null;
    return { file: path.join(this.dir, name), mime: MIME[name.split('.').pop()] };
  }

  // GET /api/comms/audio/<name>, with byte ranges (Safari will not play audio without them).
  async serveAudio(req, res, name) {
    const a = this.audioFile(name);
    let stat;
    try { if (!a) throw new Error(); stat = await fsp.stat(a.file); } catch { res.writeHead(404); return res.end('not found'); }
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const headers = { 'Content-Type': a.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start); end = Math.min(end, stat.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(a.file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(a.file).pipe(res);
  }

  // ------------------------------------------------------------ speech
  async transcribe(name) {
    const url = this.env.STT_URL;
    const a = this.audioFile(name);
    if (!url || !a) return '';
    const buf = await fsp.readFile(a.file);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: a.mime }), name);
    form.append('model', this.env.STT_MODEL || 'whisper-1');
    if (this.env.STT_LANGUAGE) form.append('language', this.env.STT_LANGUAGE);
    const key = this.env.STT_KEY || this.env.OPENAI_API_KEY;
    const out = await fetchJson(url, { method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form }, 60000);
    return String(out.text || '').trim();
  }

  async synthesize(text, voice) {
    const url = this.env.TTS_URL;
    if (!url || !text) return null;
    const key = this.env.TTS_KEY || this.env.OPENAI_API_KEY;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: this.env.TTS_MODEL || 'tts-1', voice: voice || this.env.TTS_VOICE || 'alloy', input: text.slice(0, 4000), response_format: 'mp3' }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return this.saveAudio(Buffer.from(await r.arrayBuffer()), 'audio/mpeg');
    } finally { clearTimeout(timer); }
  }

  // ------------------------------------------------------------ in and out
  // A message from the HUD. Returns the entry at once; delivery carries on in the background.
  send({ to, kind = 'talk', text = '', audio = null, baseUrl = '' }) {
    const agents = this.agents();
    if (!agents[to]) throw Object.assign(new Error(`unknown agent "${to}"`), { status: 400 });
    const entry = {
      id: newId(), at: Date.now(), from: 'you', to, kind: kind === 'note' ? 'note' : 'talk',
      text: String(text || '').slice(0, 4000), audio, status: 'sending',
    };
    this.upsert(entry);
    this.hooks.event({ type: 'comms', from: 'you', to, kind: entry.kind, text: entry.text || (audio ? '(voice)' : '') });
    this.deliver(entry, agents[to], baseUrl).catch((e) => {
      console.warn(`[comms] ${to}: ${e.message}`);
      this.update(entry.id, { status: 'failed', error: e.message.slice(0, 200) });
    });
    return entry;
  }

  async deliver(entry, rawCfg, baseUrl) {
    const trace = new Trace((snap) => this.update(entry.id, { trace: snap, progress: trace.tool || null }));
    try {
      await this.deliverTraced(entry, rawCfg, baseUrl, trace);
    } catch (e) {
      trace.close('fail', e.message.slice(0, 120));
      this.update(entry.id, { control: null, trace: trace.snapshot(true) });
      throw e;
    }
  }

  async deliverTraced(entry, rawCfg, baseUrl, trace) {
    const cfg = interpolate(rawCfg, this.env);
    trace.step('rx', entry.audio ? (entry.kind === 'note' ? 'VOICE NOTE RECEIVED' : 'VOICE PACKET RECEIVED') : 'TEXT PACKET RECEIVED');
    if (entry.audio && !entry.text && this.env.STT_URL) {
      this.update(entry.id, { status: 'transcribing' });
      trace.step('stt', 'TRANSCRIBING VOICE');
      const text = await this.transcribe(entry.audio).catch((e) => { console.warn(`[comms] stt: ${e.message}`); return ''; });
      if (text) { entry.text = text; this.update(entry.id, { text }); trace.step('stt', 'TRANSCRIPT LOCKED'); } else trace.step('stt', 'NO TRANSCRIPT');
    }
    const pub = (this.env.PUBLIC_URL || baseUrl || '').replace(/\/$/, '');
    if (entry.audio) entry.audio_url = `${pub}/api/comms/audio/${entry.audio}`;
    if (!cfg.type) { trace.close('queue', 'NO UPLINK · QUEUED'); this.update(entry.id, { status: 'queued', trace: trace.snapshot(true) }); return; } // agents can read GET /api/comms/log

    const replyCmd = `room reply ${entry.to} "your reply"`;
    const hint = cfg.reply_hint ?? `(Sent from the wall HUD. To answer out loud there, run: ${replyCmd})`;
    const timeout = Number(cfg.timeout_s || 300) * 1000;
    this.update(entry.id, { status: 'thinking' });
    trace.step('link', `UPLINK → ${cfg.type === 'hermes' ? 'HERMES AGENT' : String(cfg.type).toUpperCase()}`);

    let reply = '';
    if (cfg.type === 'hermes') {
      const client = this.hermesFor(entry.to, cfg);
      const session = cfg.session || `${entry.to}-hud`;
      const act = { ac: new AbortController(), client, runId: null, trace };
      this.active.set(entry.id, act);
      const onEvent = (ev) => {
        if (ev.type === 'run') { act.runId = ev.id; this.update(entry.id, { run: ev.id }); }
        else if (ev.type === 'tool' && ev.label) trace.step('tool', ev.label, ev.detail ? { detail: ev.detail } : {});
        else if (ev.type === 'tool_call') trace.step('tool', ev.name);
        else if (ev.type === 'tool_done') trace.finish('tool', ev.label, { ms: ev.ms, error: ev.error || null, ...(ev.detail ? { detail: ev.detail } : {}) });
        else if (ev.type === 'agent') trace.step('agent', ev.label);
        else if (ev.type === 'agent_done') trace.finish('agent', ev.label, { detail: ev.detail });
        else if (ev.type === 'interim') trace.step('interim', ev.text);
        else if (ev.type === 'reasoning') trace.think(ev.delta);
        else if (ev.type === 'content') trace.write(ev.delta);
        else if (ev.type === 'control') {
          trace.step(ev.control.type === 'clarify' ? 'ask' : 'auth', ev.control.type === 'clarify' ? `QUESTION: ${ev.control.title}` : `AUTHORIZATION: ${ev.control.detail || ev.control.title}`);
          this.update(entry.id, { control: ev.control, status: 'thinking' });
          this.hooks.event({ type: 'comms', from: entry.to, to: 'you', kind: ev.control.type, text: ev.control.title });
        } else if (ev.type === 'control_clear') this.update(entry.id, { control: null });
      };
      try {
        if (await client.useRuns()) {
          reply = await client.runTurn({ input: compose(entry), session, instructions: cfg.system }, { idleMs: timeout, onEvent, signal: act.ac.signal });
        } else {
          const messages = [];
          if (cfg.system) messages.push({ role: 'system', content: cfg.system });
          messages.push({ role: 'user', content: compose(entry) });
          reply = await hermesChat(`${hermesBase(cfg)}/v1/chat/completions`, {
            key: cfg.key, model: cfg.model, messages, session, sessionKey: cfg.session_key || session,
          }, { idleMs: timeout, onEvent, signal: act.ac.signal });
        }
      } finally {
        this.active.delete(entry.id);
      }
    } else if (cfg.type === 'openai') {
      const messages = [];
      if (cfg.system) messages.push({ role: 'system', content: cfg.system });
      messages.push(...chatHistory(this.log().filter((e) => e.id !== entry.id), entry.to, Number(cfg.history || 0)));
      messages.push({ role: 'user', content: compose(entry) });
      const out = await fetchJson(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), ...(cfg.headers || {}) },
        body: JSON.stringify({ model: cfg.model || 'default', messages, user: cfg.user || 'clawd-hud', stream: false, ...(cfg.extra || {}) }),
      }, timeout);
      reply = out.choices?.[0]?.message?.content ?? out.text ?? '';
    } else if (cfg.type === 'webhook') {
      const out = await fetchJson(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), ...(cfg.headers || {}) },
        body: JSON.stringify({ id: entry.id, from: 'you', to: entry.to, kind: entry.kind, text: entry.text, message: compose(entry), audio_url: entry.audio_url || null, reply_url: `${pub}/api/comms/reply`, at: entry.at }),
      }, timeout);
      reply = out.reply ?? out.text ?? '';
    } else if (cfg.type === 'command') {
      const a = entry.audio ? this.audioFile(entry.audio) : null;
      reply = await new Promise((resolve, reject) => {
        const child = execFile('/bin/sh', ['-c', cfg.command], {
          timeout, maxBuffer: 1 << 20,
          env: { ...process.env, COMMS_ID: entry.id, COMMS_TO: entry.to, COMMS_KIND: entry.kind, COMMS_TEXT: entry.text || '', COMMS_MESSAGE: compose(entry, { replyHint: hint }), COMMS_AUDIO: a ? a.file : '', COMMS_AUDIO_URL: entry.audio_url || '', COMMS_REPLY_URL: `${pub}/api/comms/reply` },
        }, (err, stdout) => (err ? reject(new Error(err.killed ? 'command timed out' : err.message)) : resolve(stdout)));
        child.stdin.end(compose(entry, { replyHint: hint }));
      });
    } else {
      throw new Error(`unknown type "${cfg.type}"`);
    }
    trace.close('done', 'RESPONSE RECEIVED');
    this.update(entry.id, { status: 'delivered', progress: null, control: null, trace: trace.snapshot(true) });
    reply = String(reply || '').trim();
    if (reply) await this.reply({ from: entry.to, text: reply, replyTo: entry.id });
  }

  // A reply from an agent (straight back from delivery, or later via POST /api/comms/reply).
  async reply({ from, text = '', audio = null, audioUrl = null, replyTo = null }) {
    const agents = this.agents();
    if (!agents[from]) throw Object.assign(new Error(`unknown agent "${from}"`), { status: 400 });
    const entry = { id: newId(), at: Date.now(), from, to: 'you', kind: 'reply', text: String(text).slice(0, 8000), audio, status: 'received' };
    if (audioUrl) entry.audio_src = audioUrl;
    if (replyTo) entry.reply_to = replyTo;
    if (!audio && !audioUrl && entry.text && this.env.TTS_URL) {
      entry.audio = await this.synthesize(entry.text, agents[from].tts_voice).catch((e) => { console.warn(`[comms] tts: ${e.message}`); return null; });
    }
    this.upsert(entry);
    this.hooks.event({ type: 'comms', from, to: 'you', kind: 'reply', text: entry.text });
    if (from === 'clawd' && entry.text) this.hooks.event({ type: 'say', text: entry.text.slice(0, 140) }); // his speech bubble in the room
    return entry;
  }
}
