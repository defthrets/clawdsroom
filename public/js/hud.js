// DOM overlays: the top bar, stat tiles, event ticker, toasts and the tap-to-inspect card.

import { fmtUptime, fmtDuration, hhmm, clamp } from './util.js';
import { PHRASES } from './actors.js';

const ICONS = {
  bird: '🐦', bark: '🐕', telegram: '✉️', bus: '🚌', cam: '📷', photo: '🖼️', plane: '✈️', sensor: '📻', cron: '⏰',
  subagent: '🤖', say: '🗣️', look: '👁️', dream: '💭', diary: '📓', solar: '⚡', note: '📝',
};

export function describeEvent(ev, state) {
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

const TILES = [
  { id: 'cpu', k: 'CPU', v: (s) => [`${Math.round(s.system.cpu || 0)}`, '%'], bar: (s) => s.system.cpu, warn: 80, bad: 95 },
  { id: 'ram', k: 'RAM', v: (s) => [`${Math.round(s.system.ram || 0)}`, '%'], bar: (s) => s.system.ram, warn: 85, bad: 95 },
  { id: 'temp', k: 'CPU temp', v: (s) => [`${Math.round(s.system.temp || 0)}`, '°C'], bar: (s) => s.system.temp, warn: 70, bad: 85 },
  { id: 'disk', k: 'disk /', v: (s) => [`${Math.round(s.system.disk_root || 0)}`, '%'], bar: (s) => s.system.disk_root, warn: 85, bad: 93 },
  { id: 'mnt', k: '/mnt', v: (s) => [`${Math.round(s.system.disk_mnt || 0)}`, '%'], bar: (s) => s.system.disk_mnt, warn: 85, bad: 93 },
  { id: 'bat', k: (s) => `battery ${s.power.charging ? '⚡' : ''}`, v: (s) => [`${Math.round(s.power.battery ?? 0)}`, `% · ${fmtW(s.power.solar_w)}`], bar: (s) => s.power.battery, low: true, warn: 40, bad: (s) => Number(s.power.low_at ?? 15) },
  { id: 'cams', k: 'cams', v: (s) => [`${s.cams.online ?? 0}/${(s.cams.names || []).length || 4}`, `· ${s.cams.events_today || 0} today`], accent: true },
  { id: 'bus', k: 'crew bus', v: (s) => [`${(s.bus.online || []).length}`, `on · ${s.bus.messages_today || 0} msgs`], accent: true },
  { id: 'birds', k: 'birds', v: (s) => [`${s.chirpa.species_today || 0}`, `sp · ${s.chirpa.detections_today || 0}`], accent: true },
  { id: 'sky', k: 'planes · 433', v: (s) => [`${s.sdr.planes || 0}`, `· ${s.sdr.sensors || 0}`], accent: true },
  { id: 'photos', k: 'photos', v: (s) => [fmtK(s.immich.photos), ''], accent: true },
  { id: 'up', k: 'uptime', v: (s) => [fmtUptime(s.system.uptime), ''], accent: true },
];

function fmtW(w) { w = Number(w || 0); return w >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${Math.round(w)}W`; }
function fmtK(n) { n = Number(n || 0); return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export class Hud {
  constructor(store, actors) {
    this.store = store;
    this.actors = actors;
    this.el = {
      tiles: document.getElementById('tiles'), ticker: document.getElementById('ticker'), toasts: document.getElementById('toasts'),
      now: document.getElementById('now-doing'), clock: document.getElementById('clock'), host: document.getElementById('host'),
      dot: document.getElementById('conn-dot'), info: document.getElementById('info'), infoTitle: document.getElementById('info-title'),
      infoBody: document.getElementById('info-body'), infoStats: document.getElementById('info-stats'), hint: document.getElementById('hint'),
    };
    this.tiles = new Map();
    this.lastEventKey = '';
    this.infoTimer = null;
    this.buildTiles();
    store.on('event', (ev) => this.onEvent(ev));
    setTimeout(() => this.el.hint.classList.add('show'), 4000);
    setTimeout(() => this.el.hint.classList.remove('show'), 16000);
  }

  buildTiles() {
    this.el.tiles.innerHTML = '';
    for (const t of TILES) {
      const d = document.createElement('div');
      d.className = 'tile' + (t.accent ? ' accent' : '');
      d.innerHTML = `<div class="k"></div><div class="v"></div>${t.bar ? '<div class="bar"><i></i></div>' : ''}`;
      this.el.tiles.appendChild(d);
      this.tiles.set(t.id, { el: d, k: d.querySelector('.k'), v: d.querySelector('.v'), bar: d.querySelector('.bar i') });
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
    const status = s.clawd.status ? ` — ${s.clawd.status}` : '';
    const next = this.store.nextCron();
    const nextTxt = next ? `  ·  next: ${next.name} in ${fmtDuration(next.mins)}` : '';
    this.el.now.textContent = `Clawd is ${PHRASES[act] || act}${status}${nextTxt}`;
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
      if (t.id === 'bus' && !(s.bus.online || []).length) cls = 'tile';
      tile.el.className = cls;
    }
    this.renderTicker(s);
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
      const time = new Date(e.at);
      d.innerHTML = `<span class="t">${hhmm(time)}</span><span>${escapeHtml(describeEvent(e, s))}</span>`;
      this.el.ticker.appendChild(d);
    });
  }

  onEvent(ev) {
    const important = ['bark', 'telegram', 'bus', 'cam', 'cron', 'diary', 'solar', 'say'];
    if (!important.includes(ev.type)) return;
    const cls = ev.type === 'bark' ? (ev.level === 'alert' ? 'bad' : 'warn') : ev.type === 'cam' ? 'warn' : ev.type === 'telegram' ? 'good' : '';
    this.toast(describeEvent(ev, this.store.state), cls);
  }

  toast(msg, cls = '') {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 700); }, 7000);
  }

  showInfo(item) {
    const s = this.store.state;
    this.el.infoTitle.textContent = item.title;
    this.el.infoBody.textContent = item.body;
    let stats = {};
    try { stats = item.stats(s, this.store) || {}; } catch { stats = {}; }
    this.el.infoStats.innerHTML = Object.entries(stats).map(([k, v]) => `<span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b>`).join('');
    this.el.info.classList.remove('hidden');
    clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => this.hideInfo(), 9000);
  }

  hideInfo() { this.el.info.classList.add('hidden'); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

