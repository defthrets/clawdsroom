// Clawd HUD: the homelab, the Starlink dish and every connection in and out, on one screen.
// Same state and stream as the room (and the same demo fallback); nothing here writes back.

import { Store } from '/js/state.js';
import { connect } from '/js/net.js';
import { fmtUptime, fmtAgo, clamp } from '/js/util.js';
import { initComms } from '/hud/comms.js';
import { initSystems } from '/hud/systems.js';

const STAGE_W = 1133, STAGE_H = 744;
const STALE_MS = 120000;           // Starlink counts as stale after 2 minutes without a push
const LIVE_EVERY = 2000, LIVE_MAX = 300; // live buffer: one sample per 2s, 10 minutes

const C = {
  glow: '#22e5ff', text: '#d8f6ff', muted: '#6f93a6', dim: '#3b5566', line: 'rgba(34,229,255,0.22)',
  down: '#0aa3bb', up: '#e0601a', ram: '#8b5cf6', good: '#34d399', warn: '#facc15', bad: '#f43f5e',
};

const params = new URLSearchParams(location.search);
const store = new Store();
const $ = (id) => document.getElementById(id);
const stage = $('stage');

// ------------------------------------------------------------------ formatting
function rate(bps) {
  const b = Number(bps || 0);
  if (b >= 1e9) return [(b / 1e9).toFixed(2), 'Gb/s'];
  if (b >= 1e6) return [(b / 1e6).toFixed(b >= 1e8 ? 0 : 1), 'Mb/s'];
  if (b >= 1e3) return [(b / 1e3).toFixed(0), 'kb/s'];
  return [String(Math.round(b)), 'b/s'];
}
const rateHtml = (bps) => { const [v, u] = rate(bps); return `${v}<small>${u}</small>`; };
function bytes(n) {
  n = Number(n || 0);
  for (const [d, u] of [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'kB']]) if (n >= d) return `${(n / d).toFixed(1)} ${u}`;
  return `${n} B`;
}
const watts = (w) => { w = Number(w || 0); return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`; };
const kfmt = (n) => { n = Number(n || 0); return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n); };
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const level = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'warn' : '');
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };

// ------------------------------------------------------------------ sizing
let k = 1;
const dpr = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
const canvases = new Map(); // canvas -> {ctx, w, h}
function fitCanvas(cv) {
  const w = cv.clientWidth, h = cv.clientHeight;
  const s = k * dpr();
  cv.width = Math.max(1, Math.round(w * s));
  cv.height = Math.max(1, Math.round(h * s));
  const ctx = cv.getContext('2d');
  ctx.setTransform(s, 0, 0, s, 0, 0);
  canvases.set(cv, { ctx, w, h });
}
function resize() {
  k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.setProperty('--k', k);
  for (const cv of document.querySelectorAll('canvas')) fitCanvas(cv);
  drawCharts();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));

// ------------------------------------------------------------------ ring gauges
function makeRing(el, label, color = C.glow) {
  const r = 40, c = 2 * Math.PI * r, arc = c * 0.75;
  el.innerHTML = `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="47" fill="none" stroke="${C.line}" stroke-width="1" stroke-dasharray="1 5"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(34,229,255,0.12)" stroke-width="7" stroke-dasharray="${arc} ${c}" transform="rotate(135 50 50)"/>
    <circle cx="50" cy="50" r="${r - 6}" fill="none" stroke="${C.line}" stroke-width="1" stroke-dasharray="${arc} ${c}" transform="rotate(135 50 50)"/>
    <circle class="val" cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="7"
      stroke-dasharray="0 ${c}" transform="rotate(135 50 50)" style="transition: stroke-dasharray .8s ease, stroke .4s;"/>
  </svg><div class="rv"><b>—</b><span>${label}</span></div>`;
  return {
    set(value, max, unit, { warn = Infinity, bad = Infinity, invert = false } = {}) {
      const v = Number(value ?? 0);
      const f = clamp(v / max, 0, 1);
      const lv = invert ? (v <= bad ? 'bad' : v <= warn ? 'warn' : '') : level(v, warn, bad);
      const col = lv === 'bad' ? C.bad : lv === 'warn' ? C.warn : color;
      const val = el.querySelector('.val');
      val.setAttribute('stroke-dasharray', `${arc * f} ${c}`);
      val.setAttribute('stroke', col);
      val.style.filter = `drop-shadow(0 0 3px ${col})`;
      el.querySelector('b').innerHTML = `${Math.round(v)}<small>${unit}</small>`;
    },
  };
}
const rings = {
  cpu: makeRing($('r-cpu'), 'CPU'),
  ram: makeRing($('r-ram'), 'RAM'),
  temp: makeRing($('r-temp'), 'TEMP'),
  bat: makeRing($('r-bat'), 'BATTERY', C.good),
};

function setBar(id, pct, text, warn = 85, bad = 93) {
  const el = $(id);
  el.querySelector('i').style.width = `${clamp(Number(pct || 0), 0, 100)}%`;
  el.querySelector('.bv').textContent = text;
  el.classList.remove('warn', 'bad');
  const lv = level(Number(pct || 0), warn, bad);
  if (lv) el.classList.add(lv);
}

// ------------------------------------------------------------------ live buffer
const live = [];
let lastLive = 0;
function slFresh(s) { const sl = s.starlink || {}; return sl.online && Date.now() - Number(sl.updated || 0) < STALE_MS; }
function sampleLive() {
  const now = Date.now();
  if (now - lastLive < LIVE_EVERY) return;
  lastLive = now;
  const s = store.state, sl = s.starlink || {}, net = s.network || {};
  const ok = slFresh(s);
  live.push({ t: now, sl_down: ok ? sl.down_bps : null, sl_up: ok ? sl.up_bps : null, sl_ms: ok ? sl.latency_ms : null, sl_drop: ok ? sl.drop_rate : null, rx_bps: net.rx_bps, tx_bps: net.tx_bps });
  if (live.length > LIVE_MAX) live.shift();
}

// ------------------------------------------------------------------ charts
let range = params.get('range') === '6h' ? '6h' : 'live';
const cross = new Map(); // canvas -> {x, until}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// One y-axis, shared unit. series: [{key, color, label, fill}]
function drawChart(cv, data, series, { fmt = (v) => String(Math.round(v)), max = null, scale = 1, marks = null } = {}) {
  const c = canvases.get(cv);
  if (!c) return;
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  const padL = 2, padR = 34, padT = 7, padB = 12;
  const pw = w - padL - padR, ph = h - padT - padB;
  const pts = data.filter((d) => series.some((s) => d[s.key] != null));
  let top = max;
  if (top == null) top = niceMax(Math.max(0, ...pts.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0) / scale))) * 1.1);
  // grid: three recessive lines + labels on the right
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 2; i++) {
    const y = padT + ph - (ph * i) / 2;
    ctx.strokeStyle = i === 0 ? 'rgba(34,229,255,0.25)' : 'rgba(34,229,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(padL + pw, Math.round(y) + 0.5); ctx.stroke();
    ctx.fillStyle = C.muted;
    if (pts.length >= 2) ctx.fillText(fmt((top * i) / 2), padL + pw + 5, y);
  }
  if (pts.length < 2) {
    ctx.fillStyle = C.dim; ctx.textAlign = 'center';
    ctx.fillText('AWAITING TELEMETRY', padL + pw / 2, padT + ph / 2);
    ctx.textAlign = 'left';
    return;
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const Y = (v) => padT + ph - clamp(v / scale / top, 0, 1) * ph;
  // time labels
  ctx.fillStyle = C.dim; ctx.textBaseline = 'alphabetic';
  const span = (t1 - t0) / 60000;
  ctx.fillText(span >= 90 ? `-${Math.round(span / 60)}h` : `-${Math.round(span)}m`, padL, h - 1);
  ctx.textAlign = 'right'; ctx.fillText('NOW', padL + pw, h - 1); ctx.textAlign = 'left';

  for (const s of series) {
    const seg = pts.filter((d) => d[s.key] != null);
    if (seg.length < 2) continue;
    if (s.fill) {
      const g = ctx.createLinearGradient(0, padT, 0, padT + ph);
      g.addColorStop(0, s.color + '55'); g.addColorStop(1, s.color + '00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(X(seg[0].t), padT + ph);
      for (const d of seg) ctx.lineTo(X(d.t), Y(d[s.key]));
      ctx.lineTo(X(seg[seg.length - 1].t), padT + ph);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.shadowColor = s.color; ctx.shadowBlur = 6;
    ctx.beginPath();
    seg.forEach((d, i) => (i ? ctx.lineTo(X(d.t), Y(d[s.key])) : ctx.moveTo(X(d.t), Y(d[s.key]))));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // head dot
    const last = seg[seg.length - 1];
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(X(last.t), Y(last[s.key]), 3, 0, Math.PI * 2); ctx.fill();
  }
  // presence marks along the baseline (ping drops)
  if (marks) {
    ctx.fillStyle = C.bad;
    for (const d of pts) if (Number(d[marks] || 0) > 0) ctx.fillRect(Math.round(X(d.t)) - 1, padT + ph - 7, 2, 7);
  }
  // crosshair + readout
  const cr = cross.get(cv);
  if (cr && performance.now() < cr.until) {
    const tx = clamp(cr.x, padL, padL + pw);
    const tt = t0 + ((tx - padL) / pw) * (t1 - t0);
    let near = pts[0];
    for (const d of pts) if (Math.abs(d.t - tt) < Math.abs(near.t - tt)) near = d;
    const x = X(near.t);
    ctx.strokeStyle = 'rgba(216,246,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, padT + ph); ctx.stroke();
    const d = new Date(near.t);
    const lines = [`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, ...series.map((s) => `${s.label} ${near[s.key] == null ? '—' : fmt(near[s.key] / scale)}`)];
    if (marks && near[marks] != null) lines.push(`DROP ${(near[marks] * 100).toFixed(1)}%`);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12, bh = lines.length * 12 + 6;
    const bx = x + bw + 8 > w ? x - bw - 6 : x + 6;
    ctx.fillStyle = 'rgba(2,5,11,0.92)'; ctx.strokeStyle = C.glow;
    ctx.fillRect(bx, padT, bw, bh); ctx.strokeRect(bx + 0.5, padT + 0.5, bw - 1, bh - 1);
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? C.muted : C.text; ctx.fillText(l, bx + 6, padT + 4 + i * 12); });
    for (const s of series) {
      if (near[s.key] == null) continue;
      ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(x, Y(near[s.key]), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, Y(near[s.key]), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawCharts() {
  const hist = store.history || [];
  const src = range === '6h' ? hist : [...hist.filter((d) => d.t > Date.now() - LIVE_EVERY * LIVE_MAX && (!live.length || d.t < live[0].t)), ...live];
  drawChart($('c-core'), hist.slice(-720), [
    { key: 'cpu', color: C.down, label: 'CPU', fill: true },
    { key: 'ram', color: C.ram, label: 'RAM' },
  ], { max: 100, fmt: (v) => `${Math.round(v)}%` });
  drawChart($('c-tp'), src, [
    { key: 'sl_down', color: C.down, label: 'DOWN', fill: true },
    { key: 'sl_up', color: C.up, label: 'UP', fill: true },
  ], { scale: 1e6, fmt: (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) });
  drawChart($('c-ms'), src, [{ key: 'sl_ms', color: C.glow, label: 'PING' }], { fmt: (v) => `${Math.round(v)}`, marks: 'sl_drop' });
}

for (const id of ['c-core', 'c-tp', 'c-ms']) {
  const cv = $(id);
  const at = (ev) => { const r = cv.getBoundingClientRect(); cross.set(cv, { x: (ev.clientX - r.left) / k, until: performance.now() + 6000 }); drawCharts(); };
  cv.addEventListener('pointerdown', at);
  cv.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) at(ev); });
}
$('range').addEventListener('click', () => {
  range = range === 'live' ? '6h' : 'live';
  $('range').textContent = range === 'live' ? 'LIVE' : '6H';
  drawCharts();
});

// ------------------------------------------------------------------ the sky (Starlink)
const sky = {
  stars: Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.8, p: Math.random() * 6.28, s: Math.random() < 0.15 ? 1.5 : 1 })),
  sats: Array.from({ length: 11 }, (_, i) => ({ u: Math.random(), shell: 0.62 + Math.random() * 0.36, speed: 0.018 + Math.random() * 0.03, tilt: (Math.random() - 0.5) * 0.5, id: i })),
  link: null, handoverAt: 0, packets: [], spawnAcc: 0,
};
function satPos(sat, cx, by, rx, ry) {
  const th = Math.PI * sat.u;
  return { x: cx - Math.cos(th) * rx * sat.shell, y: by - Math.sin(th) * ry * sat.shell + sat.tilt * Math.cos(th) * ry * 0.5, alt: Math.sin(th) };
}
function drawSky(dt, t) {
  const c = canvases.get($('c-sky'));
  if (!c) return;
  const { ctx, w, h } = c;
  const s = store.state, sl = s.starlink || {};
  const ok = slFresh(s);
  const cx = w / 2, by = h - 22, rx = w * 0.47, ry = h * 0.86;
  ctx.clearRect(0, 0, w, h);

  for (const st of sky.stars) {
    ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + st.p));
    ctx.fillStyle = '#bfefff';
    ctx.fillRect(st.x * w, st.y * h, st.s, st.s);
  }
  ctx.globalAlpha = 1;

  // elevation shells
  ctx.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) {
    ctx.strokeStyle = 'rgba(34,229,255,0.16)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.ellipse(cx, by, rx * (f === 1 ? 1 : 0.4 + f * 0.6), ry * (f === 1 ? 1 : 0.4 + f * 0.6), 0, Math.PI, 0); ctx.stroke();
    ctx.setLineDash([]);
  }
  // horizon + azimuth ticks
  ctx.strokeStyle = 'rgba(34,229,255,0.45)';
  ctx.beginPath(); ctx.moveTo(10, by + 0.5); ctx.lineTo(w - 10, by + 0.5); ctx.stroke();
  for (let i = 0; i <= 36; i++) {
    const x = 10 + ((w - 20) * i) / 36;
    ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + (i % 6 === 0 ? 6 : 3)); ctx.stroke();
  }
  // zenith line
  ctx.strokeStyle = 'rgba(34,229,255,0.08)';
  ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx, by - ry); ctx.stroke();

  // satellites
  for (const sat of sky.sats) {
    sat.u += sat.speed * dt * 0.25;
    if (sat.u > 1) { sat.u = 0; sat.shell = 0.62 + Math.random() * 0.36; sat.tilt = (Math.random() - 0.5) * 0.5; }
  }
  const pos = sky.sats.map((sat) => ({ sat, ...satPos(sat, cx, by, rx, ry) }));
  if (ok) {
    const cur = pos.find((p) => p.sat === sky.link);
    if (!cur || cur.alt < 0.42) {
      const best = pos.filter((p) => p.sat.u < 0.6).sort((a, b) => b.alt - a.alt)[0] || pos.sort((a, b) => b.alt - a.alt)[0];
      if (best && best.sat !== sky.link) { sky.link = best.sat; sky.handoverAt = t; sky.packets = []; }
    }
  } else sky.link = null;

  for (const p of pos) {
    const linked = p.sat === sky.link;
    const a = clamp(p.alt * 1.6, 0.15, 1);
    // short trail
    ctx.strokeStyle = `rgba(34,229,255,${0.18 * a})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const q = satPos({ ...p.sat, u: p.sat.u - i * 0.008 }, cx, by, rx, ry);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.fillStyle = !ok ? C.dim : linked ? '#ffffff' : `rgba(216,246,255,${a})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    ctx.fillRect(p.x - 5, p.y - 0.5, 3, 1); ctx.fillRect(p.x + 2, p.y - 0.5, 3, 1); // panels
    if (linked) {
      ctx.strokeStyle = C.glow; ctx.lineWidth = 1;
      const r = 7 + 2 * Math.sin(t * 6);
      ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.fillStyle = C.glow; ctx.font = '8px ui-monospace, Menlo, monospace';
      ctx.fillText(`SL-${4000 + p.sat.id * 37}`, p.x + r + 3, p.y - r + 6);
    }
  }

  // the dish
  const dx = cx, dy = by - 4;
  const el = clamp(Number(sl.elevation || 65), 10, 90) * Math.PI / 180;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(-(Math.PI / 2 - el) * (Number(sl.azimuth || 0) > 180 ? -1 : 1));
  ctx.fillStyle = ok ? C.text : C.dim;
  ctx.fillRect(-11, -3, 22, 3);
  ctx.restore();
  ctx.fillStyle = ok ? C.muted : C.dim;
  ctx.fillRect(dx - 1, dy, 2, 6);
  ctx.fillRect(dx - 5, dy + 5, 10, 2);

  // beam + packets
  const link = pos.find((p) => p.sat === sky.link);
  if (ok && link) {
    const flick = t - sky.handoverAt < 0.6 ? (Math.sin(t * 60) > 0 ? 1 : 0.2) : 1;
    const obst = !!sl.obstructed;
    const g = ctx.createLinearGradient(dx, dy, link.x, link.y);
    g.addColorStop(0, `rgba(34,229,255,${0.5 * flick})`); g.addColorStop(1, `rgba(34,229,255,${0.08 * flick})`);
    ctx.strokeStyle = obst ? `rgba(244,63,94,${0.6 * flick})` : g;
    ctx.lineWidth = 6; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(dx, dy - 2); ctx.lineTo(link.x, link.y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(dx, dy - 2); ctx.lineTo(link.x, link.y); ctx.stroke();

    // packet rate follows throughput on a log scale
    const lg = (b) => clamp(Math.log10(Math.max(1, Number(b || 0))) - 4, 0, 5); // 10 kb/s .. 1 Gb/s → 0..5
    sky.spawnAcc += dt;
    const downRate = lg(sl.down_bps) * 5, upRate = lg(sl.up_bps) * 5;
    if (Math.random() < downRate * dt) sky.packets.push({ p: 1, dir: -1, v: 0.7 + Math.random() * 0.6 });
    if (Math.random() < upRate * dt) sky.packets.push({ p: 0, dir: 1, v: 0.6 + Math.random() * 0.5 });
    for (const pk of sky.packets) pk.p += pk.dir * pk.v * dt;
    sky.packets = sky.packets.filter((pk) => pk.p >= 0 && pk.p <= 1).slice(-120);
    for (const pk of sky.packets) {
      const x = dx + (link.x - dx) * pk.p + (pk.dir > 0 ? 3 : -3), y = dy - 2 + (link.y - dy + 2) * pk.p;
      ctx.fillStyle = pk.dir < 0 ? C.down : C.up;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.shadowBlur = 0;
  }

  // obstruction wedge, scaled from the fraction obstructed
  const fo = Number(sl.fraction_obstructed || 0);
  if (ok && fo > 0) {
    const span = clamp(fo * 40, 0.03, 0.6);
    const az = (Number(sl.azimuth || 0) % 360) / 360;
    ctx.fillStyle = sl.obstructed ? 'rgba(244,63,94,0.28)' : 'rgba(244,63,94,0.12)';
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.ellipse(cx, by, rx * 0.98, ry * 0.25, 0, Math.PI * (1 + az * 0.5), Math.PI * (1 + az * 0.5 + span));
    ctx.closePath(); ctx.fill();
  }
}

// ------------------------------------------------------------------ the radar (connections)
const radar = { sweep: 0, seen: new Map() };
function drawRadar(dt, t) {
  const c = canvases.get($('c-radar'));
  if (!c) return;
  const { ctx, w, h } = c;
  const net = store.state.network || {};
  const cx = w / 2, cy = h / 2, R = h / 2 - 6;
  ctx.clearRect(0, 0, w, h);

  // rings
  for (const [f, lab] of [[0.3, ''], [0.6, 'LAN'], [0.97, 'WAN']]) {
    ctx.strokeStyle = 'rgba(34,229,255,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke();
    if (lab) { ctx.fillStyle = C.dim; ctx.font = '8px ui-monospace, Menlo, monospace'; ctx.fillText(lab, cx + 3, cy - R * f + 9); }
  }
  ctx.strokeStyle = 'rgba(34,229,255,0.08)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
  }
  // outer bezel ticks
  ctx.strokeStyle = 'rgba(34,229,255,0.35)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, l = i % 6 === 0 ? 5 : 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R + 1), cy + Math.sin(a) * (R + 1)); ctx.lineTo(cx + Math.cos(a) * (R + 1 + l), cy + Math.sin(a) * (R + 1 + l)); ctx.stroke();
  }

  // sweep
  radar.sweep = (radar.sweep + dt * Math.PI * 0.5) % (Math.PI * 2);
  for (let i = 0; i < 24; i++) {
    const a0 = radar.sweep - (i + 1) * 0.04, a1 = radar.sweep - i * 0.04;
    ctx.fillStyle = `rgba(34,229,255,${0.16 * (1 - i / 24)})`;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(34,229,255,0.7)';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(radar.sweep) * R, cy + Math.sin(radar.sweep) * R); ctx.stroke();

  // peers
  const peers = Array.isArray(net.peers) ? net.peers : [];
  const maxN = Math.max(1, ...peers.map((p) => Number(p.n || 1)));
  const now = performance.now();
  const labels = [];
  peers.forEach((p, i) => {
    const key = `${p.dir}|${p.ip}|${p.port}`;
    if (!radar.seen.has(key)) radar.seen.set(key, now);
    const born = radar.seen.get(key);
    const fade = clamp((now - born) / 800, 0, 1);
    const hA = hash(p.ip), hB = hash(key);
    const ang = hA * Math.PI * 2;
    const rr = R * (p.scope === 'wan' ? 0.78 + hB * 0.17 : 0.38 + hB * 0.18);
    const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
    const col = p.dir === 'in' ? C.down : C.up;
    // time since the sweep passed this bearing → blip glow
    let since = (radar.sweep - ang) % (Math.PI * 2); if (since < 0) since += Math.PI * 2;
    const glow = 1 - since / (Math.PI * 2);
    // link
    ctx.strokeStyle = col; ctx.globalAlpha = (0.18 + 0.2 * glow) * fade; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    // packets along the link: inbound flows to the centre, outbound flows out
    ctx.globalAlpha = fade;
    const npk = 1 + Math.round((Number(p.n || 1) / maxN) * 2);
    for (let j = 0; j < npk; j++) {
      let f = (t * (0.35 + hB * 0.3) + j / npk + hB) % 1;
      if (p.dir === 'in') f = 1 - f;
      ctx.fillStyle = col;
      ctx.fillRect(cx + (x - cx) * f - 1, cy + (y - cy) * f - 1, 2, 2);
    }
    // blip
    const size = 2.5 + (Number(p.n || 1) / maxN) * 3;
    ctx.globalAlpha = (0.45 + 0.55 * glow) * fade;
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8 * glow;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (i < 6) labels.push({ x, y, size, text: shortName(p), col });
  });
  ctx.globalAlpha = 1;
  // forget peers that went away, so they fade in again if they come back
  for (const key of radar.seen.keys()) if (!peers.some((p) => `${p.dir}|${p.ip}|${p.port}` === key)) radar.seen.delete(key);

  // labels for the busiest peers, skipping any that would overlap one already drawn
  ctx.font = '8.5px ui-monospace, Menlo, monospace';
  const boxes = [];
  for (const l of labels) {
    const right = l.x < cx;
    const tw = ctx.measureText(l.text).width;
    const x0 = right ? l.x - l.size - 3 - tw : l.x + l.size + 3;
    const box = [x0 - 2, l.y - 6, x0 + tw + 2, l.y + 5];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.fillText(l.text, x0, l.y + 3);
  }
  ctx.textAlign = 'left';

  // home node
  ctx.fillStyle = 'rgba(2,5,11,0.9)'; ctx.strokeStyle = C.glow; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i / 6) * Math.PI * 2; const px = cx + Math.cos(a) * 13, py = cy + Math.sin(a) * 13; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.glow; ctx.textAlign = 'center'; ctx.font = 'bold 7.5px ui-monospace, Menlo, monospace';
  ctx.fillText('HOME', cx, cy + 3); ctx.textAlign = 'left';

  if (!peers.length) { ctx.fillStyle = C.dim; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillText('NO ACTIVE PEERS', 8, h - 6); }
}

function shortName(p) {
  if (p.host) {
    const parts = p.host.split('.').filter(Boolean);
    return parts.length > 2 ? parts.slice(-2).join('.') : p.host;
  }
  return p.ip.length > 15 ? `${p.ip.slice(0, 12)}…` : p.ip;
}

// ------------------------------------------------------------------ DOM panels
const TAGS = {
  bird: 'BIRD', bark: 'ALERT', telegram: 'DM', bus: 'BUS', cam: 'CAM', photo: 'PHOTO', plane: 'ADS-B', sensor: '433',
  cron: 'CRON', subagent: 'AGENT', say: 'SAY', comms: 'COMMS', look: 'VISION', dream: 'DREAM', diary: 'DIARY', solar: 'POWER', note: 'NOTE',
};
function eventText(e) {
  switch (e.type) {
    case 'bird': return `${e.species || 'bird'}${e.confidence ? ` ${Math.round(e.confidence * 100)}%` : ''}`;
    case 'bark': return e.reason || 'watchdog';
    case 'telegram': case 'bus': return `${e.from || ''}${e.text ? `: ${e.text}` : ''}`;
    case 'cam': return `${e.label || 'motion'} @ ${e.camera || 'cam'}`;
    case 'photo': return `+${e.count || 1} uploaded`;
    case 'plane': return `${e.callsign || 'aircraft'}${e.alt ? ` FL${Math.round(e.alt / 100)}` : ''}`;
    case 'sensor': return `${e.name || 'sensor'} ${e.value ?? ''}`;
    case 'cron': return e.name || 'job';
    case 'subagent': return `${e.action === 'done' ? 'returned' : 'deployed'} ${e.name || 'helper'}`;
    case 'say': return e.text || '';
    case 'comms': return `${String(e.from || '').toUpperCase()}→${String(e.to || '').toUpperCase()} ${e.text || ''}`;
    case 'look': return e.what || 'looking';
    case 'dream': return e.text || '';
    case 'diary': return e.excerpt || 'written';
    case 'solar': return e.note || '';
    default: return e.text || e.type;
  }
}
const TILE_FOR = { cam: 'cams', bird: 'birds', bus: 'bus', telegram: 'dm', bark: 'dog', plane: 'sdr', sensor: 'sdr', photo: 'photos', diary: 'memory', cron: 'cron' };

function logLine(e) {
  const d = new Date(e.at || Date.now());
  const div = document.createElement('div');
  div.className = `ll${e.type === 'bark' ? ' bad' : ''}`;
  div.innerHTML = `<span class="lt">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span><span class="lk">${esc(TAGS[e.type] || String(e.type).toUpperCase().slice(0, 6))}</span><span class="lx">${esc(eventText(e))}</span>`;
  return div;
}
function addLog(e) {
  const box = $('log');
  box.querySelector('.idle')?.remove();
  box.prepend(logLine(e));
  while (box.children.length > 7) box.lastChild.remove();
}
let logSeeded = false;
function seedLog() {
  if (logSeeded) return;
  const evs = (store.state.events || []).slice(-7);
  if (!evs.length) { $('log').innerHTML = '<div class="ll idle"><span class="lt">--:--:--</span><span class="lk">IDLE</span><span class="lx">no events yet</span></div>'; return; }
  logSeeded = true;
  const box = $('log'); box.innerHTML = '';
  for (const e of evs) box.prepend(logLine(e));
}

function tile(id, k, v, sub = '', lv = '') {
  return `<div class="tile ${lv}" id="t-${id}"><span class="tk">${k}</span><span class="tv">${v}${sub ? `<small>${sub}</small>` : ''}</span></div>`;
}

function renderTiles(s) {
  const wd = s.watchdog || {};
  const wdl = wd.state === 'alert' ? 'bad' : wd.state === 'warning' ? 'warn' : '';
  const next = store.nextCron();
  const camsTotal = (s.cams.names || []).length || 0;
  const camsLv = camsTotal && Number(s.cams.online ?? camsTotal) < camsTotal ? 'warn' : '';
  const html = [
    tile('cams', 'CAMS · FRIGATE', `${s.cams.online ?? 0}/${camsTotal}`, `${s.cams.events_today || 0} today`, camsLv),
    tile('birds', 'CHIRPA', `${s.chirpa.species_today || 0}`, `sp · ${s.chirpa.detections_today || 0} det`),
    tile('bus', 'CREW BUS', `${(s.bus.online || []).length}`, `on · ${s.bus.messages_today || 0} msg`),
    tile('dm', 'TELEGRAM', `${s.telegram.unread || 0}`, 'unread', Number(s.telegram.unread || 0) > 0 ? 'warn' : ''),
    tile('dog', 'WATCHDOG', (wd.state || 'ok').toUpperCase(), (wd.alerts || []).slice(-1)[0] || 'all clear', wdl),
    tile('sdr', 'ADS-B · 433', `${s.sdr.planes || 0}`, `planes · ${s.sdr.sensors || 0} sens`),
    tile('photos', 'IMMICH', kfmt(s.immich.photos), s.immich.last_upload ? fmtAgo(s.immich.last_upload) : ''),
    tile('memory', 'MEMORY', `${s.memory.notes || 0}`, `notes · ${s.memory.skills || 0} skills`),
    tile('cron', 'NEXT CRON', next ? esc(next.name) : '—', next ? `in ${Math.round(next.mins)}m` : ''),
    tile('lan', 'LAN · WAN', `${s.network.devices || 0}`, `dev · WAN ${s.network.wan === false ? 'DOWN' : 'UP'}`, s.network.wan === false ? 'bad' : ''),
  ].join('');
  const flashing = [...document.querySelectorAll('.tile.flash')].map((el) => el.id);
  $('tiles').innerHTML = html;
  for (const id of flashing) $(id)?.classList.add('flash');
}

function renderPeers(net) {
  const peers = Array.isArray(net.peers) ? net.peers.slice(0, 10) : [];
  const box = $('peers');
  const key = JSON.stringify(peers.map((p) => [p.dir, p.ip, p.port, p.n, p.host]));
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (!peers.length) { box.innerHTML = '<div class="empty">NO ESTABLISHED CONNECTIONS</div>'; return; }
  box.innerHTML = peers.map((p) => {
    const name = p.host ? `${esc(shortName(p))}<small>${esc(p.ip)}</small>` : `${esc(p.ip)}<small>${esc(p.scope || '')}</small>`;
    return `<div class="peer ${p.dir === 'in' ? 'in' : 'out'}"><span class="d">${p.dir === 'in' ? '▼ IN' : '▲ OUT'}</span><span class="h">${name}</span><span class="s">${esc(p.svc || 'tcp')}:${esc(p.port)}</span><span class="n">${esc(p.n)}</span></div>`;
  }).join('');
  const ports = Array.isArray(net.ports) ? net.ports : [];
  $('ports').innerHTML = ports.map((p) => `<span class="port"><b>${esc(p.port)}</b>${p.svc ? ` ${esc(p.svc)}` : ''}</span>`).join('');
}

function chip(k, v, lv = '') { return `<span class="chip ${lv}">${k}<b>${v}</b></span>`; }

function render() {
  const s = store.state;
  const sys = s.system || {}, pw = s.power || {}, net = s.network || {}, sl = s.starlink || {};

  // header
  $('host').textContent = s.meta?.host || '';
  const act = store.effectiveActivity();
  $('now').innerHTML = `<b>${esc(act.toUpperCase())}</b>${esc(s.clawd?.status || '')}`;

  // core
  rings.cpu.set(sys.cpu, 100, '%', { warn: 80, bad: 95 });
  rings.ram.set(sys.ram, 100, '%', { warn: 85, bad: 95 });
  rings.temp.set(sys.temp, 100, '°', { warn: 70, bad: 85 });
  setBar('b-root', sys.disk_root, `${Math.round(sys.disk_root || 0)}%`);
  setBar('b-mnt', sys.disk_mnt, `${Math.round(sys.disk_mnt || 0)}%`);
  setBar('b-fan', sys.fan, `${Math.round(sys.fan || 0)}%`, 101, 101);
  $('uptime').textContent = `UP ${fmtUptime(sys.uptime)}`;
  $('load').textContent = sys.load || '—';
  $('mnt-gb').textContent = s.storage?.mnt_total_gb ? `${s.storage.mnt_used_gb || 0}/${s.storage.mnt_total_gb}G` : '—';
  $('agents').textContent = `${s.subagents?.active || 0}`;

  // power
  const low = Number(pw.low_at ?? 15);
  rings.bat.set(pw.battery, 100, '%', { warn: 40, bad: low, invert: true });
  $('pw-solar').textContent = watts(pw.solar_w);
  $('pw-load').textContent = watts(pw.load_w);
  const grid = Number(pw.grid_w || 0);
  $('pw-grid').textContent = grid === 0 ? '0 W' : `${grid > 0 ? 'EXPORT' : 'IMPORT'} ${watts(Math.abs(grid))}`;
  const pst = $('pw-state');
  pst.textContent = Number(pw.battery ?? 100) <= low ? 'LOW' : pw.charging ? 'CHARGING' : 'DISCHARGING';
  pst.className = Number(pw.battery ?? 100) <= low ? 'bad' : pw.charging ? 'good' : '';

  // starlink
  const fresh = slFresh(s);
  const age = Date.now() - Number(sl.updated || 0);
  const st = $('sl-state');
  if (!sl.updated) { st.textContent = 'NOT WIRED'; st.className = ''; }
  else if (!sl.online) { st.textContent = 'OFFLINE'; st.className = 'bad'; }
  else if (!fresh) { st.textContent = `STALE ${fmtAgo(sl.updated).toUpperCase()}`; st.className = 'warn'; }
  else { st.textContent = sl.state && sl.state !== 'OKAY' ? sl.state : 'CONNECTED'; st.className = sl.state && sl.state !== 'OKAY' ? 'warn' : 'good'; }
  $('sl-off').classList.toggle('hidden', fresh || !sl.updated);
  $('sl-off').textContent = sl.online ? 'TELEMETRY STALE' : 'NO SIGNAL';
  $('sl-down').innerHTML = fresh ? rateHtml(sl.down_bps) : '—';
  $('sl-up').innerHTML = fresh ? rateHtml(sl.up_bps) : '—';
  $('sl-ping').innerHTML = fresh ? `${Number(sl.latency_ms || 0).toFixed(0)}<small>ms</small>` : '—';
  $('sl-drop').innerHTML = fresh ? `${(Number(sl.drop_rate || 0) * 100).toFixed(1)}<small>%</small>` : '—';
  const fo = Number(sl.fraction_obstructed || 0) * 100;
  const alerts = Array.isArray(sl.alerts) ? sl.alerts : [];
  $('sl-chips').innerHTML = sl.updated ? [
    chip('OBSTRUCTED', sl.obstructed ? 'NOW' : `${fo.toFixed(2)}%`, sl.obstructed ? 'bad' : fo > 1 ? 'warn' : ''),
    chip('SNR', sl.snr_ok === false ? 'LOW' : 'OK', sl.snr_ok === false ? 'warn' : 'good'),
    chip('GPS', `${sl.gps_sats || 0} SATS`),
    chip('AZ/EL', `${Math.round(sl.azimuth || 0)}°/${Math.round(sl.elevation || 0)}°`),
    chip('DISH UP', fmtUptime(sl.uptime)),
    sl.eth_mbps ? chip('ETH', `${sl.eth_mbps}M`) : '',
    sl.software ? chip('FW', esc(String(sl.software).split('.').slice(0, 3).join('.'))) : '',
    ...alerts.slice(0, 3).map((a) => chip('ALERT', esc(String(a).replace(/_/g, ' ').toUpperCase()), 'warn')),
  ].join('') : chip('DISH', 'run scripts/examples/starlink.sh');

  // net
  $('iface').textContent = net.iface ? `IF ${net.iface.toUpperCase()}` : '—';
  $('n-in').textContent = net.conns_in ?? 0;
  $('n-out').textContent = net.conns_out ?? 0;
  $('n-listen').textContent = net.listening ?? 0;
  $('n-rx').innerHTML = rateHtml(net.rx_bps);
  $('n-tx').innerHTML = rateHtml(net.tx_bps);
  renderPeers(net);

  // alerts in the header
  const al = [];
  if (store.mode === 'lost') al.push(['bad', 'HOMELAB LINK LOST']);
  if (s.network?.wan === false) al.push(['bad', 'WAN DOWN']);
  if (sl.updated && !sl.online) al.push(['bad', 'STARLINK OFFLINE']);
  else if (sl.updated && age > STALE_MS) al.push(['warn', 'STARLINK STALE']);
  if (fresh && sl.obstructed) al.push(['warn', 'DISH OBSTRUCTED']);
  if (Number(pw.battery ?? 100) <= low) al.push(['bad', `BATTERY ${Math.round(pw.battery)}%`]);
  for (const a of (s.watchdog?.alerts || []).slice(-2)) al.push([s.watchdog.state === 'alert' ? 'bad' : 'warn', String(a).toUpperCase()]);
  $('alerts').innerHTML = al.slice(0, 3).map(([lv, t]) => `<span class="alert ${lv}">▲ ${esc(t)}</span>`).join('');

  renderTiles(s);
  seedLog();
}

function tickClock() {
  const d = new Date();
  $('clock').innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<span>:${pad(d.getSeconds())}</span>`;
  $('date').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

// ------------------------------------------------------------------ wiring
let dirty = true;
store.on('state', () => { sampleLive(); dirty = true; });
store.on('event', (e) => {
  addLog(e);
  logSeeded = true;
  const t = TILE_FOR[e.type];
  if (t) {
    const el = $(`t-${t}`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); }
  }
});

connect(store, {
  demoForced: params.get('demo') === '1',
  onMode: (m) => {
    const el = $('mode');
    el.textContent = { live: 'LIVE', demo: 'DEMO', lost: 'LINK LOST', connecting: 'LINK…' }[m] || m.toUpperCase();
    el.className = `mode ${m}`;
    dirty = true;
  },
});

const comms = initComms(store, { $, params });
const systems = initSystems(store, { $, auth: comms.auth });

resize();
tickClock();
setInterval(tickClock, 1000);
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  render();
  drawCharts();
}, 1000);
// crosshairs expire on their own
setInterval(() => { for (const [, v] of cross) if (v.until && performance.now() > v.until) { v.until = 0; drawCharts(); } }, 500);

let last = performance.now(), running = true;
const frameMs = 1000 / 30;
function frame(now) {
  requestAnimationFrame(frame);
  if (!running || now - last < frameMs - 1) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  drawSky(dt, t);
  drawRadar(dt, t);
}
requestAnimationFrame(frame);

// Keep the screen awake where the browser allows it, and stay fresh on a 24/7 wall.
let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !document.hidden) wake = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  last = performance.now();
  if (!document.hidden && (!wake || wake.released)) keepAwake();
});
keepAwake();
setInterval(() => {
  const hours = Number(store.state.settings?.reload_hours ?? 24);
  if (hours > 0 && performance.now() > hours * 3600 * 1000) location.reload();
}, 60000);

window.hud = { store, live, comms, systems };
