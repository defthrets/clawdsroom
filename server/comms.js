// Comms: talk to the agents from the HUD. You hold to talk (or leave a voice note); the server
// keeps the audio, transcribes it if it can, hands it to the agent and puts the reply back in
// the thread, spoken aloud on the HUD.
//
// Agents are configured in data/agents.json (AGENTS_FILE), re-read whenever it changes:
//
//   { "clawd":  { "type": "openai", "url": "http://127.0.0.1:18789/v1/chat/completions", "key": "$OPENCLAW_TOKEN", "model": "openclaw:main" },
//     "hermes": { "type": "openai", "url": "http://127.0.0.1:8642/v1/chat/completions", "key": "$HERMES_KEY", "model": "hermes-agent", "history": 10 } }
//
// Types: openai (chat completions; the reply comes straight back), openclaw-hook (POST /hooks/agent,
// the agent replies later with `room reply`), webhook (our JSON payload; a {reply} in the response
// counts), command (a shell command; its stdout counts as the reply). "$NAME" strings are read from
// the environment. Optional speech: STT_URL (OpenAI-style /v1/audio/transcriptions) and
// TTS_URL (OpenAI-style /v1/audio/speech).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const LOG_MAX = 60;
const AUDIO_KEEP = 300;
const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const MIME = { m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
const DEFAULT_AGENTS = { clawd: { label: 'Clawd' }, hermes: { label: 'Hermes' } };

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

export class Comms {
  // hooks: getState(), patch(patch), event(ev)
  constructor({ dataDir, agentsFile, hooks, env = process.env }) {
    this.dir = path.join(dataDir, 'voice');
    this.agentsFile = agentsFile || path.join(dataDir, 'agents.json');
    this.hooks = hooks;
    this.env = env;
    this.cache = { mtime: -1, agents: DEFAULT_AGENTS };
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

  // Safe to show the HUD: no urls or keys.
  publicAgents() {
    return Object.entries(this.agents()).map(([id, a]) => ({ id, label: a.label, ready: !!a.type, type: a.type || null, voice: a.voice || null }));
  }

  // ------------------------------------------------------------ the thread
  log() { return (this.hooks.getState().comms?.log || []).slice(); }

  upsert(entry) {
    const log = this.log().filter((e) => e.id !== entry.id);
    log.push(entry);
    log.sort((a, b) => a.at - b.at);
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
    const cfg = interpolate(rawCfg, this.env);
    if (entry.audio && !entry.text && this.env.STT_URL) {
      this.update(entry.id, { status: 'transcribing' });
      const text = await this.transcribe(entry.audio).catch((e) => { console.warn(`[comms] stt: ${e.message}`); return ''; });
      if (text) { entry.text = text; this.update(entry.id, { text }); }
    }
    const pub = (this.env.PUBLIC_URL || baseUrl || '').replace(/\/$/, '');
    if (entry.audio) entry.audio_url = `${pub}/api/comms/audio/${entry.audio}`;
    if (!cfg.type) { this.update(entry.id, { status: 'queued' }); return; } // nowhere to send it; agents can read GET /api/comms/log

    const replyCmd = `room reply ${entry.to} "your reply"`;
    const hint = cfg.reply_hint ?? `(Sent from the wall HUD. To answer out loud there, run: ${replyCmd})`;
    const timeout = Number(cfg.timeout_s || 180) * 1000;
    this.update(entry.id, { status: 'thinking' });

    let reply = '';
    if (cfg.type === 'openai') {
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
    } else if (cfg.type === 'openclaw-hook') {
      await fetchJson(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), 'Idempotency-Key': entry.id, ...(cfg.headers || {}) },
        body: JSON.stringify({ message: compose(entry, { replyHint: hint }), name: cfg.name || 'Clawd HUD', ...(cfg.agentId ? { agentId: cfg.agentId } : {}), deliver: cfg.deliver ?? false }),
      }, timeout);
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
    this.update(entry.id, { status: 'delivered' });
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
