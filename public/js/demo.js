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
    network: { wan: true, latency_ms: 11, devices: 34 },
    crew: { hermes: { online: true }, wormer: { online: true }, opus: { online: false }, jenkins: { online: true }, vinny: { online: false } },
  });

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
    store.patch({
      system: {
        cpu: Math.round(cpu),
        ram: clamp(Math.round(s.system.ram + rand(-1, 1)), 30, 92),
        temp: Math.round(38 + cpu * 0.35 + rand(-1, 1)),
        fan: Math.round(clamp(20 + cpu * 0.7, 20, 100)),
        uptime: s.system.uptime + 2,
      },
      power: { battery: Math.round(battery), solar_w: solar, load_w: load, grid_w: Math.max(0, load - solar - (battery > 10 ? 500 : 0)), charging: solar > load },
      network: { latency_ms: randInt(8, 24) },
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
    const a = night ? (chance(0.85) ? 'sleeping' : pick(['writing', 'terminal'])) : pick(activities);
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
  every(randInt(28, 40) * 1000, changeActivity);

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
