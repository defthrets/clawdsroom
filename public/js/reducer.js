// Pure helpers shared by server + browser: deep merge, dotted keys, and "what an event does to state".

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Expand {"clawd.activity": "x"} into {clawd: {activity: "x"}} (recursively).
export function expandDots(obj) {
  if (!isObj(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const val = isObj(v) ? expandDots(v) : v;
    if (k.includes('.')) {
      const parts = k.split('.');
      let cur = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!isObj(cur[parts[i]])) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const last = parts[parts.length - 1];
      cur[last] = isObj(cur[last]) && isObj(val) ? deepMerge(cur[last], val) : val;
    } else {
      out[k] = isObj(out[k]) && isObj(val) ? deepMerge(out[k], val) : val;
    }
  }
  return out;
}

// Deep merge: objects merge recursively, arrays and scalars replace, null deletes.
export function deepMerge(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  if (!isObj(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = isObj(v) ? deepMerge({}, v) : v;
  }
  return out;
}

// Coerce "12" -> 12, "true" -> true for query-string pushes.
export function coerce(v) {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

const MAX_EVENTS = 60;

// Apply an event to the state. Returns a NEW state object (does not mutate).
// The browser runs this too (for demo mode), so keep it dependency-free.
export function applyEvent(state, ev) {
  const s = clone(state);
  const at = ev.at || Date.now();
  const e = { ...ev, at };
  const touch = () => { s.clawd.last_active = at; };

  switch (e.type) {
    case 'bird':
      s.chirpa.detections_today = (s.chirpa.detections_today || 0) + 1;
      if (e.species && e.new_species) s.chirpa.species_today = (s.chirpa.species_today || 0) + 1;
      s.chirpa.last = { species: e.species || 'bird', confidence: e.confidence ?? null, at };
      break;
    case 'bark':
      s.watchdog.last_bark = at;
      s.watchdog.state = e.level === 'alert' ? 'alert' : (s.watchdog.state === 'alert' ? 'alert' : 'warning');
      if (e.reason) {
        s.watchdog.alerts = [...new Set([...(s.watchdog.alerts || []), e.reason])].slice(-5);
      }
      break;
    case 'telegram':
      s.telegram.unread = (s.telegram.unread || 0) + 1;
      s.telegram.last = { from: e.from || 'you', text: e.text || '', at };
      break;
    case 'bus':
      s.bus.messages_today = (s.bus.messages_today || 0) + 1;
      s.bus.last = { from: e.from || 'crew', text: e.text || '', at };
      if (e.from && s.crew && s.crew[e.from]) s.crew[e.from].online = true;
      break;
    case 'cam':
      s.cams.events_today = (s.cams.events_today || 0) + 1;
      s.cams.last = { camera: e.camera || 'cam', label: e.label || 'motion', at };
      break;
    case 'photo':
      s.immich.photos = (s.immich.photos || 0) + (e.count || 1);
      s.immich.last_upload = at;
      break;
    case 'plane':
      s.sdr.last_plane = { callsign: e.callsign || '', alt: e.alt ?? null, at };
      if (!s.sdr.planes) s.sdr.planes = 1;
      break;
    case 'sensor':
      s.sdr.sensors = Math.max(s.sdr.sensors || 0, 1);
      break;
    case 'subagent':
      if (e.action === 'done') {
        s.subagents.active = Math.max(0, (s.subagents.active || 0) - 1);
        s.subagents.names = (s.subagents.names || []).filter((n) => n !== e.name);
      } else {
        s.subagents.active = (s.subagents.active || 0) + 1;
        if (e.name) s.subagents.names = [...(s.subagents.names || []), e.name].slice(-8);
        s.clawd.activity = 'delegating';
      }
      touch();
      break;
    case 'say':
      s.clawd.status = e.text || s.clawd.status;
      touch();
      break;
    case 'look':
      touch();
      break;
    case 'dream':
      s.clawd.dream = e.text || s.clawd.dream;
      break;
    case 'diary':
      s.memory.last_diary = at;
      s.memory.notes = (s.memory.notes || 0) + 1;
      touch();
      break;
    case 'cron':
    case 'solar':
    case 'note':
    default:
      break;
  }

  const events = Array.isArray(s.events) ? s.events : [];
  s.events = [...events, e].slice(-MAX_EVENTS);
  s.meta.updated = at;
  return s;
}
