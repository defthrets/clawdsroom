// Client-side store: holds the state, applies patches/events, and exposes derived helpers
// (time of day, which rooms are lit, what Clawd is effectively doing).

import { DEFAULT_STATE, ACTIVITIES } from './defaults.js';
import { applyEvent, clone, deepMerge, expandDots } from './reducer.js';
import { parseHHMM, clamp } from './util.js';

export class Store {
  constructor() {
    this.state = clone(DEFAULT_STATE);
    this.listeners = { event: new Set(), state: new Set() };
    this.mode = 'connecting'; // connecting | live | demo | lost
    this.lastSeen = 0;
    this.hourOverride = null; // ?hour=23 for testing the day/night cycle
    this.history = [];        // [{t, cpu, ram, temp, battery, solar_w, load_w, disk_root, disk_mnt}] for the trend charts
    this.historyMax = 720;
    this.historyInterval = 30000;
    this.activityLog = [];    // [{activity, at}] what Clawd has been up to (client-side)
  }

  setHistory(list) {
    if (Array.isArray(list)) this.history = list.slice(-this.historyMax);
    this.sample(true);
  }

  // Keep one sample per 30s of the headline numbers so taps can show a trend.
  sample(force = false) {
    const now = Date.now();
    const last = this.history[this.history.length - 1];
    if (!force && last && now - last.t < this.historyInterval) return;
    const sys = this.state.system || {}, pw = this.state.power || {};
    this.history.push({ t: now, cpu: sys.cpu ?? null, ram: sys.ram ?? null, temp: sys.temp ?? null, disk_root: sys.disk_root ?? null, disk_mnt: sys.disk_mnt ?? null, battery: pw.battery ?? null, solar_w: pw.solar_w ?? null, load_w: pw.load_w ?? null });
    if (this.history.length > this.historyMax) this.history.splice(0, this.history.length - this.historyMax);
  }

  logActivity(activity) {
    const last = this.activityLog[this.activityLog.length - 1];
    if (last && last.activity === activity) return;
    this.activityLog.push({ activity, at: Date.now() });
    if (this.activityLog.length > 80) this.activityLog.shift();
  }

  on(kind, fn) { this.listeners[kind].add(fn); return () => this.listeners[kind].delete(fn); }
  emitState() { for (const fn of this.listeners.state) fn(this.state); }

  // Replace with a full state from the server.
  set(state) {
    this.state = deepMerge(clone(DEFAULT_STATE), state || {});
    this.lastSeen = Date.now();
    this.sample();
    this.emitState();
  }

  patch(patch) {
    this.state = deepMerge(this.state, expandDots(patch));
    this.state.meta.updated = Date.now();
    this.lastSeen = Date.now();
    this.sample();
    this.emitState();
  }

  // Apply an event locally (demo mode) or announce one received from the server.
  event(ev, { apply = true } = {}) {
    const e = { ...ev, at: ev.at || Date.now() };
    if (apply) this.state = applyEvent(this.state, e);
    this.lastSeen = Date.now();
    for (const fn of this.listeners.event) fn(e, this.state);
    this.emitState();
    return e;
  }

  // ------------------------------------------------------------ derived
  // Hours as a float in local time, with the optional test offset.
  hourNow(now = new Date()) {
    if (this.hourOverride != null) return ((this.hourOverride + now.getSeconds() / 3600) % 24 + 24) % 24;
    const off = Number(this.state.settings?.theme_hour_offset || 0);
    return ((now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600 + off) % 24 + 24) % 24;
  }

  sunTimes() {
    const w = this.state.weather || {};
    const rise = parseHHMM(w.sunrise) ?? 6.5;
    const set = parseHHMM(w.sunset) ?? 18.5;
    return { rise, set };
  }

  // 0 = deep night, 1 = full day, with ~1h twilight either side of sunrise/sunset.
  dayFactor() {
    const h = this.hourNow();
    const { rise, set } = this.sunTimes();
    const tw = 0.9;
    if (h < rise - tw || h > set + tw) return 0;
    if (h < rise + tw) return clamp((h - (rise - tw)) / (2 * tw), 0, 1);
    if (h > set - tw) return clamp(((set + tw) - h) / (2 * tw), 0, 1);
    return 1;
  }

  // 0..1 progress of the sun across the sky (or the moon at night).
  sunProgress() {
    const h = this.hourNow();
    const { rise, set } = this.sunTimes();
    if (h >= rise && h <= set) return { body: 'sun', t: (h - rise) / (set - rise) };
    const nightLen = 24 - (set - rise);
    const since = h > set ? h - set : h + 24 - set;
    return { body: 'moon', t: since / nightLen };
  }

  isNightHours() {
    const h = this.hourNow();
    return h >= 23 || h < 6.5;
  }

  batteryLow() {
    const p = this.state.power || {};
    return Number(p.battery ?? 100) <= Number(p.low_at ?? 15);
  }

  // What the room shows Clawd doing: the declared activity, except that a stale "idle"
  // at night or after settings.sleep_after_min becomes "sleeping".
  effectiveActivity(now = Date.now()) {
    const c = this.state.clawd || {};
    let a = ACTIVITIES.includes(c.activity) ? c.activity : 'idle';
    if (a === 'idle') {
      const after = Number(this.state.settings?.sleep_after_min || 0);
      const stale = after > 0 && c.last_active && now - c.last_active > after * 60000;
      if (stale || this.isNightHours()) a = 'sleeping';
    }
    return a;
  }

  // Minutes until the next cron entry fires, plus its name.
  nextCron(now = new Date()) {
    const list = Array.isArray(this.state.cron) ? this.state.cron : [];
    const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    let best = null;
    for (const c of list) {
      let mins = null;
      if (c.at) {
        const t = parseHHMM(c.at);
        if (t == null) continue;
        let d = t - h; if (d < 0) d += 24;
        mins = d * 60;
      } else if (c.every) {
        const every = Number(c.every);
        if (!every) continue;
        const m = now.getMinutes() + now.getSeconds() / 60;
        mins = every - (m % every);
      }
      if (mins != null && (best == null || mins < best.mins)) best = { name: c.name, mins };
    }
    return best;
  }
}
