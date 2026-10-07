// DOM overlays: the top bar, stat tiles, event ticker, toasts and the tap-to-inspect card.

import { fmtUptime, fmtDuration, hhmm, clamp } from './util.js';
import { ITEMS } from './scene.js';
import { MOOD_EMOJI } from './actors.js';

const ICONS = {
  bird: '🐦', bark: '🐕', telegram: '✉️', bus: '🚌', cam: '📷', photo: '🖼️', plane: '✈️', sensor: '📻', cron: '⏰',
  subagent: '🤖', say: '🗣️', look: '👁️', dream: '💭', diary: '📓', solar: '⚡', note: '📝',
};

export function describeEvent(ev) {
  const i = ICONS[ev.type] || '•';
  switch (ev.type) {
    case 'bird': return `${i} ${ev.species || 'bird'}${ev.confidence ? ` (${Math.round(ev.confidence * 100)}%)` : ''}`;
    case 'bark': return `${i} ${ev.reason || 'woof'}`;
    case 'telegram': return `${i} DM from ${ev.from || 'you'}${ev.text ? `: ${ev.text}` : ''}`;
    case 'bus': return `${i} ${ev.from || 'crew'}${ev.text ? `: ${ev.text}` : ''}`;
    case 'cam': return `${i} ${ev.label || 'motion'} @ ${ev.camera || 'cam'}`;
    case 'photo': return `${i} +${ev.count || 1} photo${(ev.count || 1) > 1 ? 's' : ''}`;
    case 'plane': return `${i} ${ev.callsign || 'aircraft'}${ev.alt ? ` ${Math.round(ev.alt / 1000)}k ft` : ''}`;
    case 'sensor': return `${i} ${ev.name || '433MHz'}${ev.value != null ? ` ${ev.value}` : ''}`;
    case 'cron': return `${i} ${ev.name || 'cron'}`;
    case 'subagent': return `${i} ${ev.action === 'done' ? 'back:' : 'sent:'} ${ev.name || 'helper'}`;
    case 'say': return `${i} ${ev.text || ''}`;
    case 'look': return `${i} looked at ${ev.what || 'something'}`;
    case 'dream': return `${i} ${ev.text || 'dreaming'}`;
    case 'diary': return `${i} diary written`;
    case 'solar': return `${i} ${ev.note || 'battery'}`;
    default: return `${i} ${ev.text || ev.type}`;
  }
}

// Tiles along the bottom. `item` is which tap card the tile opens.
const TILES = [
  { id: 'cpu', k: 'CPU', v: (s) => [`${Math.round(s.system.cpu || 0)}`, '%'], bar: (s) => s.system.cpu, warn: 80, bad: 95, item: 'cupboard' },
  { id: 'ram', k: 'RAM', v: (s) => [`${Math.round(s.system.ram || 0)}`, '%'], bar: (s) => s.system.ram, warn: 85, bad: 95, item: 'cupboard' },
  { id: 'temp', k: 'CPU temp', v: (s) => [`${Math.round(s.system.temp || 0)}`, '°C'], bar: (s) => s.system.temp, warn: 70, bad: 85, item: 'thermo' },
  { id: 'disk', k: 'disk /', v: (s) => [`${Math.round(s.system.disk_root || 0)}`, '%'], bar: (s) => s.system.disk_root, warn: 85, bad: 93, item: 'desk' },
  { id: 'mnt', k: '/mnt', v: (s) => [`${Math.round(s.system.disk_mnt || 0)}`, '%'], bar: (s) => s.system.disk_mnt, warn: 85, bad: 93, item: 'shelf' },
  { id: 'bat', k: (s) => `battery ${s.power.charging ? '⚡' : ''}`, v: (s) => [`${Math.round(s.power.battery ?? 0)}`, `% · ${fmtW(s.power.solar_w)}`], bar: (s) => s.power.battery, low: true, warn: 40, bad: (s) => Number(s.power.low_at ?? 15), item: 'battery' },
  { id: 'cams', k: 'cams', v: (s) => [`${s.cams.online ?? 0}/${(s.cams.names || []).length || 4}`, `· ${s.cams.events_today || 0} today`], accent: true, item: 'tv' },
  { id: 'bus', k: 'crew bus', v: (s) => [`${(s.bus.online || []).length}`, `on · ${s.bus.messages_today || 0} msgs`], accent: true, item: 'door' },
  { id: 'birds', k: 'birds', v: (s) => [`${s.chirpa.species_today || 0}`, `sp · ${s.chirpa.detections_today || 0}`], accent: true, item: 'bird' },
  { id: 'sky', k: 'planes · 433', v: (s) => [`${s.sdr.planes || 0}`, `· ${s.sdr.sensors || 0}`], accent: true, item: 'radio' },
  { id: 'photos', k: 'photos', v: (s) => [fmtK(s.immich.photos), ''], accent: true, item: 'photos' },
  { id: 'up', k: 'uptime', v: (s) => [fmtUptime(s.system.uptime), ''], accent: true, item: 'house' },
];

const SERIES = {
  cpu: { label: 'CPU', color: '#4ade80', unit: '%', max: 100 },
  ram: { label: 'RAM', color: '#60a5fa', unit: '%', max: 100 },
  temp: { label: 'temp', color: '#fb923c', unit: '°C', max: 100 },
  battery: { label: 'battery', color: '#fde047', unit: '%', max: 100 },
  solar_w: { label: 'solar', color: '#fbbf24', unit: 'W' },
  load_w: { label: 'load', color: '#f87171', unit: 'W' },
  disk_root: { label: '/', color: '#a78bfa', unit: '%', max: 100 },
  disk_mnt: { label: '/mnt', color: '#c084fc', unit: '%', max: 100 },
};

function fmtW(w) { w = Number(w || 0); return w >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${Math.round(w)}W`; }
function fmtK(n) { n = Number(n || 0); return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Hud {
  constructor(store, actors) {
    this.store = store;
    this.actors = actors;
    this.el = {
      stage: document.getElementById('stage'), tiles: document.getElementById('tiles'), ticker: document.getElementById('ticker'), toasts: document.getElementById('toasts'),
      now: document.getElementById('now-doing'), clock: document.getElementById('clock'), host: document.getElementById('host'),
      dot: document.getElementById('conn-dot'), info: document.getElementById('info'), infoTitle: document.getElementById('info-title'),
      infoBody: document.getElementById('info-body'), infoStats: document.getElementById('info-stats'), hint: document.getElementById('hint'),
      sparkWrap: document.getElementById('info-spark'), spark: document.getElementById('spark'), legend: document.getElementById('info-legend'),
    };
    this.tiles = new Map();
    this.lastEventKey = '';
    this.infoTimer = null;
    this.current = null;        // the item the card shows
    this.highlight = null;      // { rect, until } drawn by the scene
    this.buildTiles();
    store.on('event', (ev) => this.onEvent(ev));
    this.el.info.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.hideInfo(); });
    setTimeout(() => this.el.hint.classList.add('show'), 4000);
    setTimeout(() => this.el.hint.classList.remove('show'), 16000);
  }

  buildTiles() {
    this.el.tiles.innerHTML = '';
    for (const t of TILES) {
      const d = document.createElement('div');
      d.className = 'tile' + (t.accent ? ' accent' : '');
      d.innerHTML = `<div class="k"></div><div class="v"></div>${t.bar ? '<div class="bar"><i></i></div>' : ''}`;
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const item = ITEMS.find((i) => i.id === t.item);
        if (!item) return;
        if (this.current && this.current.id === item.id) this.hideInfo(); else this.showInfo(item);
      });
      this.el.tiles.appendChild(d);
      this.tiles.set(t.id, { el: d, k: d.querySelector('.k'), v: d.querySelector('.v'), bar: d.querySelector('.bar i'), def: t });
    }
  }

  setMode(mode) {
    this.el.dot.className = `dot ${mode === 'live' ? 'live' : mode === 'demo' ? 'demo' : mode === 'lost' ? 'lost' : ''}`;
    this.el.dot.title = mode;
  }

  update() {
    const s = this.store.state;
    this.el.clock.textContent = hhmm();
    this.el.host.textContent = `${s.meta.host || ''}${this.store.mode === 'demo' ? ' · demo' : this.store.mode === 'lost' ? ' · reconnecting' : ''}`;
    const act = this.store.effectiveActivity();
    const status = s.clawd.status && act !== 'idle' ? ` — ${s.clawd.status}` : '';
    const next = this.store.nextCron();
    const nextTxt = next ? `  ·  next: ${next.name} in ${fmtDuration(next.mins)}` : '';
    const mood = this.actors.mood();
    this.el.now.textContent = `Clawd is ${this.actors.phrase()}${status} · ${MOOD_EMOJI[mood] || ''} ${mood}${nextTxt}`;
    for (const t of TILES) {
      const tile = this.tiles.get(t.id);
      const [v, unit] = t.v(s);
      tile.k.textContent = typeof t.k === 'function' ? t.k(s) : t.k;
      tile.v.innerHTML = `${v}${unit ? `<small>${unit}</small>` : ''}`;
      let cls = 'tile' + (t.accent ? ' accent' : '');
      if (t.bar) {
        const val = clamp(Number(t.bar(s) || 0), 0, 100);
        tile.bar.style.width = `${val}%`;
        const bad = typeof t.bad === 'function' ? t.bad(s) : t.bad;
        if (t.low) { if (val <= bad) cls += ' bad'; else if (val <= t.warn) cls += ' warn'; }
        else if (val >= bad) cls += ' bad'; else if (val >= t.warn) cls += ' warn';
      }
      if (t.id === 'cams' && (s.cams.online ?? 0) < ((s.cams.names || []).length || 4)) cls = 'tile warn';
      if (this.current && this.current.id === t.item) cls += ' active';
      tile.el.className = cls;
    }
    this.renderTicker(s);
    if (this.current) this.renderStats(this.current);
  }

  renderTicker(s) {
    const evs = (s.events || []).slice(-6).reverse();
    const key = evs.map((e) => e.at).join(',');
    if (key === this.lastEventKey) return;
    this.lastEventKey = key;
    this.el.ticker.innerHTML = '';
    evs.forEach((e, i) => {
      const d = document.createElement('span');
      d.className = 'ev' + (i === 0 ? ' new' : '');
      d.innerHTML = `<span class="t">${hhmm(new Date(e.at))}</span><span>${escapeHtml(describeEvent(e))}</span>`;
      this.el.ticker.appendChild(d);
    });
  }

  onEvent(ev) {
    const important = ['bark', 'telegram', 'bus', 'cam', 'cron', 'diary', 'solar', 'say'];
    if (!important.includes(ev.type)) return;
    const cls = ev.type === 'bark' ? (ev.level === 'alert' ? 'bad' : 'warn') : ev.type === 'cam' ? 'warn' : ev.type === 'telegram' ? 'good' : '';
    this.toast(describeEvent(ev), cls);
  }

  toast(msg, cls = '') {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 700); }, 7000);
  }

  // ---- the tap card
  showInfo(item) {
    this.current = item;
    this.el.infoTitle.textContent = item.title;
    this.el.infoBody.textContent = item.body;
    this.renderStats(item);
    this.placeCard(item);
    this.el.info.classList.remove('hidden');
    this.highlight = { rect: item.rect, until: performance.now() + 2500, item };
    clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => this.hideInfo(), 14000);
    this.update();
  }

  hideInfo() {
    this.el.info.classList.add('hidden');
    this.current = null;
    this.highlight = null;
    clearTimeout(this.infoTimer);
    for (const t of this.tiles.values()) t.el.classList.remove('active');
  }

  renderStats(item) {
    const s = this.store.state;
    let stats = {};
    try { stats = item.stats(s, this.store) || {}; } catch { stats = {}; }
    this.el.infoStats.innerHTML = Object.entries(stats).map(([k, v]) => `<span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b>`).join('');
    if (item.spark && item.spark.length) {
      this.el.sparkWrap.classList.remove('hidden');
      this.drawSpark(item.spark);
    } else {
      this.el.sparkWrap.classList.add('hidden');
    }
  }

  // Put the card beside whatever was tapped (left half → card on the right, and vice versa).
  placeCard(item) {
    const st = this.el.stage.style;
    const u = parseFloat(st.getPropertyValue('--u')) || 2;
    const sx = parseFloat(st.getPropertyValue('--sx')) || 0;
    const sy = parseFloat(st.getPropertyValue('--sy')) || 0;
    const sw = parseFloat(st.getPropertyValue('--sw')) || 480 * u;
    const sh = parseFloat(st.getPropertyValue('--sh')) || 360 * u;
    const [rx, ry, rw, rh] = item.rect || [240, 180, 0, 0];
    const cardW = 150 * u;
    const cx = rx + rw / 2;
    let left = cx < 240 ? sx + (rx + rw + 8) * u : sx + (rx - 8) * u - cardW;
    left = clamp(left, sx + 3 * u, sx + sw - cardW - 3 * u);
    let top = sy + (ry - 10) * u;
    top = clamp(top, sy + 16 * u, sy + sh - 150 * u);
    this.el.info.style.left = `${Math.round(left)}px`;
    this.el.info.style.top = `${Math.round(top)}px`;
    this.el.info.style.width = `${Math.round(cardW)}px`;
  }

  drawSpark(keys) {
    const cv = this.el.spark;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = cv.clientWidth || 260, h = cv.clientHeight || 44;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, 0, w, h);
    const hist = this.store.history;
    const legend = [];
    for (const key of keys) {
      const def = SERIES[key]; if (!def) continue;
      const pts = hist.map((p) => (p[key] == null ? null : Number(p[key])));
      const vals = pts.filter((v) => v != null && Number.isFinite(v));
      const cur = vals.length ? vals[vals.length - 1] : null;
      legend.push(`<span><i style="background:${def.color}"></i>${def.label} <b>${cur == null ? '—' : Math.round(cur)}${def.unit}</b></span>`);
      if (vals.length < 2) continue;
      let min = def.max != null ? 0 : Math.min(...vals), max = def.max != null ? def.max : Math.max(...vals);
      if (max - min < 1) max = min + 1;
      g.strokeStyle = def.color; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath();
      let started = false;
      pts.forEach((v, i) => {
        if (v == null) { started = false; return; }
        const x = (i / Math.max(1, pts.length - 1)) * (w - 2) + 1;
        const y = h - 2 - ((v - min) / (max - min)) * (h - 4);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      });
      g.stroke();
    }
    const span = hist.length > 1 ? fmtDuration((hist[hist.length - 1].t - hist[0].t) / 60000) : '';
    this.el.legend.innerHTML = legend.join('') + (span ? `<span style="margin-left:auto">last ${span}</span>` : '');
  }
}
