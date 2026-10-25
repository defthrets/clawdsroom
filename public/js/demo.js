// Demo mode: a little simulation of the homelab so the room is alive before anything is wired up.

import { BIRD_SPECIES } from './defaults.js';
import { pick, chance, rand, randInt, clamp } from './util.js';

const CREW = ['hermes', 'wormer', 'ruban', 'opus', 'jenkins', 'vinny'];
const SAYINGS = [
  'Frigate is back up, mate.', 'Fan script tuned. Cupboard is quieter.', "Yard's clear. Just the cat again.",
  'Morning brief is out.', 'Backing up /mnt tonight.', 'Three planes overhead right now.', 'Gateway restarted. All good.',
  "Battery's at 40%, easing off the heavy jobs.", 'Found the photo you asked about.',
];
const DREAMS = ['…sorting 4900 cartridges by colour…', '…a blackbird teaching the watchdog to sing…', '…the yard, but it is all solar panels…', '…every log line is a tiny fish…'];
const BUS_LINES = ['anyone seen the shed cam?', 'pushing a fix now', 'brew?', 'ping', 'nightly build green', 'who touched the fan script'];
const CAM_LABELS = ['person', 'cat', 'car', 'dog', 'bird'];
const CALLSIGNS = ['BAW123', 'RYR9UK', 'EZY45T', 'SHT2A', 'DLH4PR', 'UAE12', 'TOM7HE', 'VIR20'];
const AGENTS = ['researcher', 'fixer', 'summariser', 'scout'];
// Who the homelab might be talking to (for the HUD's connections panel).
const PEERS = [
  { ip: '192.168.1.40', port: 8787, dir: 'in', svc: 'clawd', scope: 'lan' },
  { ip: '192.168.1.41', port: 8787, dir: 'in', svc: 'clawd', scope: 'lan' },
  { ip: '192.168.1.22', port: 22, dir: 'in', svc: 'ssh', scope: 'lan' },
  { ip: '192.168.1.60', port: 5000, dir: 'in', svc: 'frigate', scope: 'lan' },
  { ip: '192.168.1.71', port: 554, dir: 'out', svc: 'rtsp', scope: 'lan' },
  { ip: '192.168.1.72', port: 554, dir: 'out', svc: 'rtsp', scope: 'lan' },
  { ip: '192.168.1.73', port: 554, dir: 'out', svc: 'rtsp', scope: 'lan' },
  { ip: '100.101.7.12', port: 2283, dir: 'in', svc: 'immich', scope: 'lan' },
  { ip: '149.154.167.220', port: 443, dir: 'out', svc: 'https', scope: 'wan', host: 'api.telegram.org' },
  { ip: '160.79.104.10', port: 443, dir: 'out', svc: 'https', scope: 'wan', host: 'api.anthropic.com' },
  { ip: '140.82.113.5', port: 443, dir: 'out', svc: 'https', scope: 'wan', host: 'lb-140-82-113-5-iad.github.com' },
  { ip: '104.16.11.34', port: 443, dir: 'out', svc: 'https', scope: 'wan', host: 'cloudflare' },
  { ip: '52.28.4.190', port: 443, dir: 'out', svc: 'https', scope: 'wan', host: 'foxesscloud.com' },
  { ip: '185.125.190.58', port: 123, dir: 'out', svc: 'ntp', scope: 'wan', host: 'ntp.ubuntu.com' },
  { ip: '81.2.69.160', port: 22, dir: 'in', svc: 'ssh', scope: 'wan' },
];
const PORTS = [22, 53, 80, 443, 554, 1883, 2283, 5000, 8123, 8787, 9090].map((port) => ({ port, svc: { 22: 'ssh', 53: 'dns', 80: 'http', 443: 'https', 554: 'rtsp', 1883: 'mqtt', 2283: 'immich', 5000: 'frigate', 8123: 'home-asst', 8787: 'clawd', 9090: 'prom' }[port] }));

function demoPeers() {
  const list = PEERS.filter(() => chance(0.78)).map((p) => ({ ...p, n: p.svc === 'https' ? randInt(1, 9) : randInt(1, 3) }));
  list.sort((a, b) => b.n - a.n);
  const conns_in = list.filter((p) => p.dir === 'in').reduce((a, p) => a + p.n, 0);
  const conns_out = list.filter((p) => p.dir === 'out').reduce((a, p) => a + p.n, 0) + randInt(4, 20);
  return { peers: list, conns_in, conns_out };
}

function hourNow() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

export function startDemo(store) {
  const timers = [];
  const every = (ms, fn) => timers.push(setInterval(fn, ms));
  const seen = new Set();

  // Seed a believable house.
  store.patch({
    meta: { name: "Clawd's Room", host: '192.168.1.253' },
    clawd: { activity: 'idle', status: 'Just settling in.', mood: 'happy', last_active: Date.now() },
    system: { cpu: 18, ram: 46, temp: 52, fan: 35, disk_root: 61, disk_mnt: 67, load: '0.42 0.51 0.47', uptime: 86400 * 12 + 3600 * 5 },
    power: { battery: 76, solar_w: 0, load_w: 410, grid_w: 0, charging: false },
    cams: { names: ['front', 'side', 'back', 'shed'], online: 4, events_today: 7 },
    bus: { online: ['hermes', 'wormer'], messages_today: 23 },
    telegram: { unread: 0 },
    chirpa: { species_today: 9, detections_today: 61 },
    watchdog: { state: 'ok', alerts: [] },
    memory: { notes: 212, skills: 27, last_diary: Date.now() - 3600e3 * 9, last_consolidation: Date.now() - 3600e3 * 9 },
    storage: { mnt_used_gb: 612, mnt_total_gb: 915, games: 4900, movies: 318 },
    immich: { photos: 12840, last_upload: Date.now() - 3600e3 * 2 },
    sdr: { planes: 2, sensors: 5 },
    subagents: { active: 0, names: [] },
    network: { wan: true, latency_ms: 31, devices: 34, iface: 'eth0', rx_bps: 18e6, tx_bps: 2.4e6, rx_total: 4.1e11, tx_total: 6.2e10, listening: PORTS.length, ports: PORTS, ...demoPeers() },
    starlink: { online: true, state: 'OKAY', latency_ms: 31, drop_rate: 0.002, down_bps: 18e6, up_bps: 2.4e6, obstructed: false, fraction_obstructed: 0.0042, snr_ok: true, gps_sats: 14, azimuth: 12.4, elevation: 64.8, uptime: 86400 * 6 + 3600 * 3, software: '2026.10.14.mr48121', hardware: 'rev4_prod2', eth_mbps: 1000, alerts: [], updated: Date.now() },
    crew: { hermes: { online: true }, wormer: { online: true }, opus: { online: false }, jenkins: { online: true }, vinny: { online: false } },
  });

  // Two hours of plausible history so the trend charts have something to show.
  {
    const now = Date.now();
    const h = [];
    for (let i = 240; i >= 1; i--) {
      const t = now - i * 30000;
      const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const sun = Math.max(0, Math.sin(Math.PI * (hour - 6.5) / 12));
      const cpu = clamp(20 + 15 * Math.sin(i / 9) + rand(-6, 6), 3, 95);
      const down = Math.round((12 + 25 * Math.abs(Math.sin(i / 13)) + rand(0, 15)) * 1e6), up = Math.round(down * rand(0.08, 0.2));
      const ms = Math.round(26 + 8 * Math.sin(i / 7) + rand(0, 10));
      h.push({ t, cpu: Math.round(cpu), ram: Math.round(44 + 4 * Math.sin(i / 40)), temp: Math.round(40 + cpu * 0.3), disk_root: 61, disk_mnt: 67, battery: Math.round(clamp(76 - i * 0.03 + sun * 10, 8, 100)), solar_w: Math.round(sun * 2600 + rand(-80, 80)), load_w: Math.round(320 + cpu * 4), rx_bps: down, tx_bps: up, conns_in: randInt(4, 12), conns_out: randInt(20, 50), sl_down: down, sl_up: up, sl_ms: ms, sl_drop: chance(0.05) ? rand(0.01, 0.08) : 0 });
    }
    store.setHistory(h);
  }

  // Drift the numbers so the gauges breathe.
  every(2000, () => {
    const s = store.state;
    const h = hourNow();
    const day = store.dayFactor();
    const sunT = store.sunProgress();
    const sunHeight = sunT.body === 'sun' ? Math.sin(Math.PI * sunT.t) : 0;
    const solar = Math.round(sunHeight * 2800 * (s.weather.condition === 'rain' ? 0.25 : s.weather.condition === 'cloudy' ? 0.55 : 1));
    const load = 300 + Math.round(s.system.cpu * 4);
    let battery = Number(s.power.battery);
    battery += (solar - load) / 60000 * 2; // slow
    battery = clamp(battery, 8, 100);
    const cpu = clamp(s.system.cpu + rand(-8, 8) + (s.clawd.activity === 'terminal' ? 3 : -1), 3, 97);
    // Starlink: bursty downlink, a slow wobble on the ping, the odd dropout as a satellite hands over.
    const burst = chance(0.15) ? rand(40, 160) : rand(4, 40);
    const down = Math.round(clamp(Number(s.starlink.down_bps || 0) * 0.55 + burst * 1e6 * 0.45, 0.5e6, 220e6));
    const up = Math.round(down * rand(0.06, 0.22));
    const handover = chance(0.06);
    const ms = clamp(Number(s.starlink.latency_ms || 30) * 0.7 + rand(22, 42) * 0.3 + (handover ? rand(20, 60) : 0), 18, 140);
    const drop = handover ? Number(rand(0.02, 0.12).toFixed(3)) : 0;
    store.patch({
      system: {
        cpu: Math.round(cpu),
        ram: clamp(Math.round(s.system.ram + rand(-1, 1)), 30, 92),
        temp: Math.round(38 + cpu * 0.35 + rand(-1, 1)),
        fan: Math.round(clamp(20 + cpu * 0.7, 20, 100)),
        uptime: s.system.uptime + 2,
      },
      power: { battery: Math.round(battery), solar_w: solar, load_w: load, grid_w: Math.max(0, load - solar - (battery > 10 ? 500 : 0)), charging: solar > load },
      network: { latency_ms: Math.round(ms), rx_bps: down, tx_bps: up, ...(chance(0.25) ? demoPeers() : {}) },
      starlink: { latency_ms: Math.round(ms * 10) / 10, down_bps: down, up_bps: up, drop_rate: drop, obstructed: drop > 0.05, uptime: (s.starlink.uptime || 0) + 2, updated: Date.now() },
      sdr: { planes: chance(0.1) ? randInt(0, 5) : s.sdr.planes },
    });
    if (day === 0 && h > 1 && h < 5 && chance(0.02)) store.patch({ power: { battery: 12 } });
  });

  // Clawd changes what he's doing.
  const activities = ['idle', 'terminal', 'watching', 'remote', 'reading', 'tinkering', 'browsing', 'delegating', 'writing', 'thinking'];
  const statuses = {
    idle: ['Pottering about.', 'All quiet on the homelab.'],
    terminal: ['Restarting Frigate.', 'Poking at fan-adjust.sh', 'Tailing the gateway log.'],
    watching: ['Watching the yard.', 'Eyes on the shed cam.'],
    remote: ['SSH into Wormer.', 'Checking on Vinny.', 'Replying on Telegram.'],
    reading: ['Looking something up in memory.', 'Reading the skills shelf.'],
    tinkering: ['Tuning the fan curve.', 'Patching a cron script.'],
    browsing: ['Searching the web.', 'Reading docs.'],
    delegating: ['Sending a helper out.', 'Delegating the research.'],
    writing: ['Writing the nightly diary.', 'Journal time.'],
    thinking: ['Hmm.', 'Thinking it over.'],
  };
  const changeActivity = () => {
    const h = hourNow();
    const night = h >= 23 || h < 6.5;
    const a = night ? (chance(0.85) ? 'sleeping' : pick(['writing', 'terminal'])) : (chance(0.45) ? 'idle' : pick(activities));
    store.patch({ clawd: { activity: a, status: a === 'sleeping' ? 'Zzz' : pick(statuses[a] || ['']), last_active: Date.now() } });
    if (a === 'sleeping' && chance(0.6)) setTimeout(() => store.event({ type: 'dream', text: pick(DREAMS) }), 4000);
    if (a === 'delegating') {
      const name = pick(AGENTS);
      setTimeout(() => store.event({ type: 'subagent', action: 'spawn', name }), 1500);
      setTimeout(() => store.event({ type: 'subagent', action: 'done', name }), randInt(20, 45) * 1000);
    }
    if (a === 'writing') setTimeout(() => store.event({ type: 'diary', excerpt: 'Quiet day. Fixed the fans.' }), 12000);
  };
  setTimeout(changeActivity, 6000);
  every(randInt(45, 70) * 1000, changeActivity);

  // Random events.
  every(9000, () => {
    const r = Math.random();
    const h = hourNow();
    const night = h >= 22 || h < 5.5;
    if (r < 0.34 && !night) {
      const species = pick(BIRD_SPECIES);
      const isNew = !seen.has(species); seen.add(species);
      store.event({ type: 'bird', species, confidence: Number(rand(0.6, 0.99).toFixed(2)), new_species: isNew });
    } else if (r < 0.44) {
      store.event({ type: 'plane', callsign: pick(CALLSIGNS), alt: randInt(4, 38) * 1000 });
    } else if (r < 0.52) {
      store.event({ type: 'cam', camera: pick(['front', 'side', 'back', 'shed']), label: pick(CAM_LABELS) });
    } else if (r < 0.59) {
      store.event({ type: 'telegram', from: 'you', text: pick(['you about?', 'what was that noise?', 'nice one', 'can you check the shed cam', 'night mate']) });
      setTimeout(() => store.patch({ telegram: { unread: 0 } }), 25000);
    } else if (r < 0.69) {
      const from = pick(CREW);
      store.event({ type: 'bus', from, text: pick(BUS_LINES) });
    } else if (r < 0.75) {
      store.event({ type: 'photo', count: randInt(1, 4) });
    } else if (r < 0.82) {
      store.event({ type: 'say', text: pick(SAYINGS) });
    } else if (r < 0.86) {
      const reason = pick(['disk /mnt 91%', 'RAM 93%', 'gateway unreachable', 'cam shed offline']);
      store.event({ type: 'bark', reason, level: chance(0.3) ? 'alert' : 'warning' });
      setTimeout(() => store.patch({ watchdog: { state: 'ok', alerts: [] } }), 30000);
    } else if (r < 0.9) {
      store.event({ type: 'look', what: 'photo from you' });
    } else if (r < 0.94) {
      store.event({ type: 'sensor', name: 'shed temp', value: `${randInt(8, 22)}°C` });
    }
  });

  // His mood drifts now and then (the homelab would normally set this).
  every(47000, () => {
    if (chance(0.5)) store.patch({ clawd: { mood: pick(['happy', 'happy', 'calm', 'excited', 'bored', 'worried', 'sad', 'angry', 'surprised']) } });
    else store.patch({ clawd: { mood: 'happy' } });
  });

  // Fire the cron jobs at their real times.
  let lastMin = -1;
  every(5000, () => {
    const d = new Date();
    const key = d.getHours() * 60 + d.getMinutes();
    if (key === lastMin) return;
    lastMin = key;
    for (const c of store.state.cron || []) {
      if (c.at) {
        const [hh, mm] = c.at.split(':').map(Number);
        if (hh * 60 + mm === key) store.event({ type: 'cron', name: c.name });
      } else if (c.every && key % Number(c.every) === 0 && chance(0.5)) {
        store.event({ type: 'cron', name: c.name });
      }
    }
  });

  return { stop() { timers.forEach(clearInterval); } };
}
