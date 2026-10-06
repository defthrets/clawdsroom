// The state contract between the homelab and the room.
// Shared by the server (Node) and the browser (ES module), so there is one source of truth.
//
// Everything here is optional on the wire: the server deep-merges whatever you POST on top of
// this. Keys with dots in them ("clawd.activity") are expanded into nested objects.
// Timestamps are milliseconds since epoch (Date.now()). See docs/STATE.md for the full guide.

export const ACTIVITIES = [
  'idle',        // pottering about the living room
  'sleeping',    // in bed, memory consolidation / dreaming
  'terminal',    // at the desk, hands on the keyboard
  'watching',    // on the couch, Frigate cams / dashboards on the TV
  'remote',      // on the laptop: SSH / Telegram, reaching outside the house
  'reading',     // at the bookshelves: memory + skills
  'tinkering',   // at the workbench: scripts
  'browsing',    // out the back door: web search / browser
  'delegating',  // in the garage: sending helper bots (subagents) out
  'writing',     // at the nightstand: diary / journal
  'speaking',    // talking (TTS) wherever he is
  'looking',     // vision: eyes wide open
  'thinking',    // thought bubble wherever he is
];

export const DEFAULT_STATE = {
  meta: {
    name: "Clawd's Room",
    host: '192.168.1.253',
    updated: 0,
  },

  clawd: {
    activity: 'idle',          // one of ACTIVITIES
    status: '',                // short free text, shown in Clawd's speech bubble + top bar
    mood: 'happy',             // happy | focused | sleepy | alert | worried
    dream: '',                 // shown in a thought bubble while sleeping
    last_active: 0,            // ms; the room will put him to bed if this goes stale (see meta.sleep_after_min)
  },

  system: {                    // the house itself (the homelab). Auto-filled by the server on Linux.
    cpu: 0,                    // percent
    ram: 0,                    // percent
    temp: 0,                   // °C (CPU)
    fan: 0,                    // percent (fan-adjust.sh)
    disk_root: 0,              // percent used on /
    disk_mnt: 0,               // percent used on /mnt
    load: '',                  // "0.42 0.37 0.30"
    uptime: 0,                 // seconds
  },

  power: {                     // FoxESS — solar + battery in the garage
    battery: 100,              // percent
    solar_w: 0,                // watts being generated now
    load_w: 0,                 // watts the house is drawing
    grid_w: 0,                 // watts to (+) / from (-) the grid
    charging: false,
    low_at: 15,                // below this % the lights dim ("ESS overload")
  },

  cams: {                      // Frigate (3 Tapo + shed)
    names: ['front', 'side', 'back', 'shed'],
    online: 4,
    events_today: 0,
    last: null,                // { camera, label, at }
  },

  bus: {                       // the crew bus
    online: [],                // e.g. ['hermes', 'wormer', 'ruban']
    messages_today: 0,
    last: null,                // { from, text, at }
  },

  telegram: {                  // your DMs — the mailbox on the front path
    unread: 0,
    last: null,                // { from, text, at }
  },

  chirpa: {                    // the bird-audio listener — the bird in the tree
    species_today: 0,
    detections_today: 0,
    last: null,                // { species, confidence, at }
  },

  watchdog: {                  // clawd-watchdog — the dog
    state: 'ok',               // ok | warning | alert
    alerts: [],                // ['disk 92%', 'gateway down']
    last_bark: 0,
  },

  memory: {                    // bookshelves + filing cabinet
    notes: 0,                  // memory files
    skills: 0,                 // installed skills
    last_diary: 0,             // ms
    last_consolidation: 0,     // ms
  },

  storage: {                   // the garage: /mnt
    mnt_used_gb: 0,
    mnt_total_gb: 915,
    games: 4900,               // RetroShelf
    movies: 0,
  },

  immich: {                    // the photo wall
    photos: 0,
    last_upload: 0,
  },

  sdr: {                       // the radio on the shelf: RTL-SDR
    planes: 0,                 // aircraft currently tracked (ADS-B)
    sensors: 0,                // 433MHz sensors heard recently
    last_plane: null,          // { callsign, alt, at }
  },

  cron: [                      // the wall clock. "at" is HH:MM local; "every" is minutes
    { name: 'morning brief', at: '07:40' },
    { name: 'nightly diary', at: '22:30' },
    { name: 'watchdog', every: 5 },
  ],

  subagents: {                 // helper bots in the garage
    active: 0,
    names: [],
  },

  network: {                   // the road out the back
    wan: true,
    latency_ms: 0,
    devices: 0,
  },

  crew: {                      // the framed crew photo — who's home
    clawd:   { emoji: '👾', online: true },
    hermes:  { emoji: '🤖', online: false },
    wormer:  { emoji: '🪖', online: false },
    opus:    { emoji: '🧠', online: false },
    jenkins: { emoji: '🗿', online: false },
    vinny:   { emoji: '👻', online: false },
    you:     { emoji: '👑', online: true },
  },

  weather: {                   // optional; drives the sky
    condition: 'clear',        // clear | cloudy | rain
    temp: null,
    sunrise: '06:30',
    sunset: '18:30',
  },

  settings: {
    sleep_after_min: 20,       // auto-sleep when clawd.last_active is older than this (0 = never)
    reload_hours: 24,          // the iPad page reloads itself this often (0 = never)
    theme_hour_offset: 0,      // shift the day/night cycle (hours), for testing
  },

  events: [],                  // ring buffer of recent events, newest last (server-managed)
};

// Event types the room understands (POST /api/event {"type": ...}).
// Anything else is shown in the ticker as plain text.
export const EVENT_TYPES = {
  bird:     'Chirpa heard a bird        { species, confidence }',
  bark:     'Watchdog alert             { reason, level: warning|alert }',
  telegram: 'DM arrived (mailbox)       { from, text }',
  bus:      'Crew bus message           { from, text }',
  cam:      'Frigate detection          { camera, label }',
  photo:    'New Immich photo(s)        { count }',
  plane:    'ADS-B aircraft overhead    { callsign, alt }',
  sensor:   '433MHz sensor chatter      { name, value }',
  cron:     'Cron job fired             { name }',
  subagent: 'Helper bot spawned/done    { action: spawn|done, name }',
  say:      'Clawd speaks (TTS)         { text }',
  look:     'Clawd uses vision          { what }',
  dream:    'Dream while sleeping       { text }',
  diary:    'Nightly diary written      { excerpt }',
  solar:    'Battery / solar moment     { note }',
  note:     'Anything else              { text }',
};

export const BIRD_SPECIES = [
  'Blackbird', 'Robin', 'Wren', 'Blue Tit', 'Great Tit', 'Magpie', 'Wood Pigeon', 'House Sparrow',
  'Starling', 'Goldfinch', 'Chaffinch', 'Dunnock', 'Jackdaw', 'Carrion Crow', 'Song Thrush', 'Collared Dove',
  'Long-tailed Tit', 'Greenfinch', 'Coal Tit', 'Herring Gull', 'Tawny Owl', 'Pied Wagtail', 'Nuthatch',
];
