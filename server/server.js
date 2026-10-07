#!/usr/bin/env node
// Clawd's Room server. Zero dependencies.
//
//   GET  /                  the room (open this on the iPad)
//   GET  /api/state         full state JSON
//   POST /api/state         deep-merge a patch into the state (JSON body, or ?dotted.keys=values)
//   PUT  /api/state         replace the whole state (merged over defaults)
//   POST /api/event         push an event {type, ...}; also updates counters, see docs/STATE.md
//   GET  /api/events        recent events
//   GET  /api/history       recent samples of cpu/ram/temp/battery/solar (for the trend charts)
//   GET  /api/stream        Server-Sent Events: "state" and "event" messages
//   GET  /api/health        {ok: true}
//
// Env: PORT (8787), HOST (0.0.0.0), CLAWDSROOM_TOKEN (optional bearer token for writes),
//      DATA_DIR (./data), COLLECT_SYSTEM (1 on Linux), DISK_ROOT (/), DISK_MNT (/mnt),
//      SYSTEM_INTERVAL_MS (10000)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE } from '../public/js/defaults.js';
import { applyEvent, clone, coerce, deepMerge, expandDots, isObj } from '../public/js/reducer.js';
import { collectSystem } from './system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_MAX = 720;            // samples kept (6h at one per 30s)
const HISTORY_INTERVAL_MS = 30000;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.CLAWDSROOM_TOKEN || '';
const COLLECT_SYSTEM = (process.env.COLLECT_SYSTEM ?? (process.platform === 'linux' ? '1' : '0')) === '1';
const SYSTEM_INTERVAL_MS = Number(process.env.SYSTEM_INTERVAL_MS || 10000);
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------------------------------------------------------------- state
let state = clone(DEFAULT_STATE);
let history = [];
const clients = new Set();
let saveTimer = null;

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    state = deepMerge(clone(DEFAULT_STATE), saved);
    console.log(`[room] loaded state from ${STATE_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[room] could not load ${STATE_FILE}: ${e.message}`);
  }
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (Array.isArray(h)) history = h.slice(-HISTORY_MAX);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[room] could not load ${HISTORY_FILE}: ${e.message}`);
  }
}

// One sample every HISTORY_INTERVAL_MS at most, taken whenever the state changes.
function sampleHistory() {
  const now = Date.now();
  const last = history[history.length - 1];
  if (last && now - last.t < HISTORY_INTERVAL_MS) return;
  const sys = state.system || {}, pw = state.power || {};
  history.push({ t: now, cpu: sys.cpu ?? null, ram: sys.ram ?? null, temp: sys.temp ?? null, disk_root: sys.disk_root ?? null, disk_mnt: sys.disk_mnt ?? null, battery: pw.battery ?? null, solar_w: pw.solar_w ?? null, load_w: pw.load_w ?? null });
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${STATE_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
      await fsp.rename(tmp, STATE_FILE);
      await fsp.writeFile(`${HISTORY_FILE}.tmp`, JSON.stringify(history));
      await fsp.rename(`${HISTORY_FILE}.tmp`, HISTORY_FILE);
    } catch (e) {
      console.warn(`[room] could not save state: ${e.message}`);
    }
  }, 2000);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function patchState(patch, { quiet = false } = {}) {
  const expanded = expandDots(patch);
  state = deepMerge(state, expanded);
  state.meta.updated = Date.now();
  sampleHistory();
  scheduleSave();
  if (!quiet) broadcast('state', state);
  return state;
}

function pushEvent(ev) {
  const event = { ...ev, at: ev.at || Date.now() };
  state = applyEvent(state, event);
  sampleHistory();
  scheduleSave();
  broadcast('event', event);
  broadcast('state', state);
  return event;
}

// Midnight rollover: the "today" counters reset.
function resetDailyCounters() {
  patchState({
    cams: { events_today: 0 },
    bus: { messages_today: 0 },
    chirpa: { species_today: 0, detections_today: 0 },
  });
  console.log('[room] daily counters reset');
}
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { resetDailyCounters(); scheduleMidnight(); }, next - now);
}

// ---------------------------------------------------------------- http helpers
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : (headers['Content-Type'] || 'text/plain; charset=utf-8'),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType = '') {
  if (!raw || !raw.trim()) return {};
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const out = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = coerce(v);
    return out;
  }
  return JSON.parse(raw);
}

function queryPatch(url) {
  const out = {};
  for (const [k, v] of url.searchParams) {
    if (k === 'token') continue;
    out[k] = coerce(v);
  }
  return out;
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  if (h === `Bearer ${TOKEN}`) return true;
  if (url.searchParams.get('token') === TOKEN) return true;
  return false;
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) return send(res, 403, 'forbidden');
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'not found'); }
  if (stat.isDirectory()) return serveStatic(req, res, path.posix.join(rel, 'index.html'));
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- routes
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  try {
    if (p === '/api/health') return send(res, 200, { ok: true, clients: clients.size, updated: state.meta.updated });

    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 3000\n\n`);
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state);
    if (p === '/api/events' && req.method === 'GET') return send(res, 200, state.events || []);
    if (p === '/api/history' && req.method === 'GET') return send(res, 200, history);

    const writing = req.method === 'POST' || req.method === 'PUT';
    if (writing && !authorized(req, url)) return send(res, 401, { error: 'unauthorized' });

    if (p === '/api/state' && req.method === 'POST') {
      const body = parseBody(await readBody(req), req.headers['content-type'] || '');
      if (!isObj(body)) return send(res, 400, { error: 'patch must be an object' });
      const patch = { ...queryPatch(url), ...body };
      patchState(patch);
      return send(res, 200, { ok: true, updated: state.meta.updated });
    }

    if (p === '/api/state' && req.method === 'PUT') {
      const body = parseBody(await readBody(req), req.headers['content-type'] || '');
      if (!isObj(body)) return send(res, 400, { error: 'state must be an object' });
      state = deepMerge(clone(DEFAULT_STATE), expandDots(body));
      state.meta.updated = Date.now();
      scheduleSave();
      broadcast('state', state);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/event' && req.method === 'POST') {
      const body = parseBody(await readBody(req), req.headers['content-type'] || '');
      const ev = { ...queryPatch(url), ...(isObj(body) ? body : {}) };
      if (!ev.type) return send(res, 400, { error: 'event needs a "type"' });
      const event = pushEvent(ev);
      return send(res, 200, { ok: true, event });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    const status = e instanceof SyntaxError ? 400 : 500;
    return send(res, status, { error: e.message });
  }
}

// ---------------------------------------------------------------- boot
loadState();
scheduleMidnight();

if (COLLECT_SYSTEM) {
  const opts = { diskRoot: process.env.DISK_ROOT || '/', diskMnt: process.env.DISK_MNT || '/mnt' };
  const tick = async () => {
    try {
      const patch = await collectSystem(opts);
      patchState(patch);
    } catch (e) {
      console.warn(`[room] system collector: ${e.message}`);
    }
  };
  tick();
  setInterval(tick, SYSTEM_INTERVAL_MS).unref();
  console.log(`[room] system collector on (every ${SYSTEM_INTERVAL_MS / 1000}s; disks ${opts.diskRoot} and ${opts.diskMnt})`);
}

// SSE heartbeat so proxies and the iPad keep the stream open.
setInterval(() => {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch { clients.delete(res); }
  }
}, 25000).unref();

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[room] unhandled', e);
    try { send(res, 500, { error: 'internal error' }); } catch { /* already sent */ }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[room] Clawd's Room is open at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  if (TOKEN) console.log('[room] writes require the bearer token');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[room] ${sig}, closing`);
    server.close();
    for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
    process.exit(0);
  });
}
