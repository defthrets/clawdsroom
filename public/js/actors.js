// The living things: Clawd, the watchdog, Chirpa, the helper bots, the crew bus, envelopes,
// planes and clouds. Also the `anim` flags the scene reads (typing, TV mode, flashes...).

import { L, stairY, roomAt, drawBedBlanket, bedSleepPos } from './scene.js';
// Clawd and the dog are drawn at 2x: the house and its furniture are built at that scale.
export const CLAWD_SCALE = 2;
import { CLAWD_BODY, CLAWD_WALK_A, CLAWD_WALK_B, CLAWD_SIT, CLAW, DOG_STAND, DOG_SIT, DOG_SLEEP, DOG_BARK, BIRD, BIRD_SING, BOT, BOT_WALK, BOOK, ENVELOPE, EYE_ICON, CREW, WATERING_CAN, HATS, PHONE, MINI_GUITAR } from './sprites.js';
import { drawSprite, rect, px, disc, text, textCentered, textWidth, bubble, rand, randInt, pick, chance, clamp, lerp, box, outline, fmtDuration } from './util.js';
import { drawBroom } from './scene.js';

const WALK_SPEED = 34;
const CLIMB_SPEED = 30;
const TERM_LINES = ['$ ssh wormer', '$ df -h /mnt', '$ htop', '$ ./fan-adjust.sh', '$ docker ps', '$ tail -f gw.log', '$ git pull', '$ systemctl restart frigate', '$ journalctl -f', '$ ping 1.1.1.1', '$ uptime', '$ cat memory.md', 'ok', 'done.', 'restarting', 'nice.'];
const CODE_LINES = ['const x =', 'if (ok) {', 'return y;', 'await db.', 'fetch(url', '} else {', 'map(f =>', 'npm test', 'git push', '// todo', 'let n = 0', 'for (;;) {', 'try {', 'catch (e)', 'export fn', 'import x'];
const HAT_NAMES = ['cap', 'beanie', 'party', 'tophat', 'crown'];

export const PHRASES = {
  idle: 'pottering about',
  sleeping: 'asleep, consolidating memory',
  terminal: 'at the terminal',
  coding: 'coding at the desk',
  watching: 'watching the yard',
  monitoring: 'watching the dashboards',
  remote: 'reaching out over SSH',
  reading: 'reading his memory',
  searching: 'looking something up on the shelves',
  researching: 'researching at the bookshelf',
  tinkering: 'tinkering at the workbench',
  browsing: 'out on the internet',
  delegating: 'sending helpers out',
  writing: 'writing the diary',
  planning: 'planning at the whiteboard',
  chatting: 'chatting to you',
  deploying: 'deploying to the homelab',
  playing: 'playing on the console',
  speaking: 'talking',
  looking: 'looking at something',
  thinking: 'thinking',
};

// Where each homelab activity puts him. Aliases share a spot but can differ in what he does there.
const ACTIVITY_SPOTS = {
  terminal: { x: 300, floor: 'lower', face: 1, sit: 'chair' },
  coding: { x: 300, floor: 'lower', face: 1, sit: 'chair' },
  remote: { x: 300, floor: 'lower', face: 1, sit: 'chair' },
  watching: { x: 190, floor: 'lower', face: -1, sit: 'couch' },
  monitoring: { x: 190, floor: 'lower', face: -1, sit: 'couch' },
  chatting: { x: 190, floor: 'lower', face: -1, sit: 'couch' },
  reading: { x: 276, floor: 'upper', face: 1 },
  searching: { x: 276, floor: 'upper', face: 1 },
  researching: { x: 276, floor: 'upper', face: 1 },
  writing: { x: 136, floor: 'upper', face: 1 },
  sleeping: { x: 100, floor: 'upper', face: 1, bed: true },
  tinkering: { x: 406, floor: 'lower', face: 1 },
  browsing: { x: 466, floor: 'outside', face: 1 },
  delegating: { x: 402, floor: 'lower', face: 1 },
  planning: { x: 300, floor: 'lower', face: 1 },
  deploying: { x: 358, floor: 'lower', face: 1 },
  playing: { x: 198, floor: 'loft', face: -1, sit: 'beanbag' },
};
const IDLE_HOME = { x: 100, floor: 'lower' };

// Moods Clawd can show on his face. The homelab can set clawd.mood to any of these; the room
// also works some out on its own (worried when the battery is low, bored when nothing happens...).
export const MOODS = ['happy', 'calm', 'focused', 'excited', 'surprised', 'alert', 'worried', 'sad', 'angry', 'bored', 'sleepy'];
export const MOOD_EMOJI = { happy: '😊', calm: '😌', focused: '🧐', excited: '🤩', surprised: '😮', alert: '👀', worried: '😟', sad: '😢', angry: '😠', bored: '😑', sleepy: '😴' };
const MOOD_COLOR = { happy: '#4ade80', calm: '#a5f3fc', focused: '#93c5fd', excited: '#f472b6', surprised: '#fde047', alert: '#fde047', worried: '#fbbf24', sad: '#60a5fa', angry: '#f87171', bored: '#94a3b8', sleepy: '#c4b5fd' };

// Little things Clawd does on his own when the homelab hasn't given him a job.
//   x/floor: where to go (omit for "right here"); face: which way to look; sit: couch|chair|bed|beanbag|hammock
//   act: the mini-animation while there; dur: seconds there; when: times of day it is likelier
//   lines: things he might say on arrival ('NEXT' = the next cron job, 'MAIL' = the mailbox state)
export const PASTIMES = [
  // living room
  { id: 'plantchat', phrase: 'talking to the plant', go: 'off to see the plant', x: 122, floor: 'lower', face: -1, act: 'check', dur: [5, 10], when: ['morning', 'day'], lines: ['Looking good, mate.', 'Growing nicely.', 'Nearly time for a drink.'] },
  { id: 'tvcheck', phrase: 'checking the cams', go: 'off to check the cams', x: 176, floor: 'lower', face: -1, act: 'lookup', dur: [6, 14], when: ['day', 'evening'], lines: ['Quiet yard.', 'Was that the cat?', 'Bins are out.'] },
  { id: 'couch', phrase: 'chilling on the couch', go: 'off to the couch', x: 200, floor: 'lower', face: -1, sit: 'couch', dur: [18, 45], when: ['day', 'evening'], lines: ['Telly time.', 'Just chilling.', 'Feet up.'] },
  { id: 'nap', phrase: 'napping on the couch', go: 'off for a nap', x: 194, floor: 'lower', face: -1, sit: 'couch', act: 'nap', dur: [25, 60], when: ['day', 'evening'], lines: ['Five minutes.'] },
  { id: 'channel', phrase: 'channel hopping', go: 'off to the couch', x: 190, floor: 'lower', face: -1, sit: 'couch', act: 'channel', dur: [10, 20], when: ['evening'], lines: ['Nothing on.', 'Cams, dash, cams, dash.'] },
  { id: 'cushions', phrase: 'plumping the cushions', go: 'off to tidy the couch', x: 168, floor: 'lower', face: 1, act: 'tidy', dur: [4, 7], when: ['morning', 'day'], lines: ['There we go.'] },
  { id: 'dust', phrase: 'dusting the crew photo', go: 'off to dust the crew photo', x: 150, floor: 'lower', face: 1, act: 'tidyup', dur: [4, 8], when: ['day', 'evening'], lines: ['Good crew, that.', 'Miss you lot.'] },
  { id: 'crew', phrase: 'looking at the crew photo', go: 'off to see the crew', x: 168, floor: 'lower', face: 1, act: 'lookup', dur: [4, 8], when: ['evening'], lines: ['Look at us.'] },
  { id: 'radio', phrase: 'listening to the radio', go: 'off to the radio', x: 178, floor: 'lower', face: 1, act: 'radio', dur: [6, 12], when: ['morning', 'evening'], lines: ['...static...', 'Planes up tonight.', 'Shed sensor again.'] },
  { id: 'dog', phrase: 'petting the dog', go: 'off to see the dog', x: 252, floor: 'lower', face: 1, act: 'pet', dur: [5, 10], when: ['morning', 'day', 'evening'], lines: ['Good dog.', "Who's a good watchdog?", 'Anything to report?'] },
  { id: 'feed', phrase: 'feeding the dog', go: 'off to feed the dog', x: 300, floor: 'lower', face: -1, act: 'feed', dur: [8, 12], when: ['morning', 'evening'], lines: ['Dinner time.', 'Here you go, boy.'] },
  { id: 'door', phrase: 'answering the door', go: 'off to the door', x: 94, floor: 'lower', face: -1, act: 'check', dur: [5, 9], when: [], lines: [], forcedOnly: true },
  // office
  { id: 'cupboard', phrase: 'checking the cupboard', go: 'off to check the cupboard', x: 358, floor: 'lower', face: 1, act: 'check', dur: [5, 10], when: ['day'], lines: ['Fans sound fine.', "That's my body, that.", 'Warm in there.'] },
  { id: 'peek', phrase: 'peeking at the stats', go: 'off to the desk', x: 300, floor: 'lower', face: 1, sit: 'chair', dur: [6, 12], when: ['morning', 'day'], lines: ['All quiet.', 'Load is fine.'] },
  { id: 'whiteboard', phrase: 'doodling on the whiteboard', go: 'off to the whiteboard', x: 300, floor: 'lower', face: 1, act: 'draw', dur: [10, 18], when: ['day'], lines: ['Right, so...', 'Boxes and arrows.'] },
  { id: 'tidydesk', phrase: 'tidying the desk', go: 'off to tidy the desk', x: 300, floor: 'lower', face: 1, act: 'tidy', dur: [5, 9], when: ['morning', 'evening'], lines: ['Where does this go.', 'Cables everywhere.'] },
  // garage
  { id: 'garage', phrase: 'checking the battery', go: 'off to the garage', x: 408, floor: 'lower', face: -1, act: 'lookup', dur: [5, 10], when: ['morning', 'evening'], lines: ['Battery looks alright.', 'Plenty of room on /mnt.', 'Panels are earning.'] },
  { id: 'botcheck', phrase: 'checking on the bots', go: 'off to see the bots', x: 402, floor: 'lower', face: 1, act: 'check', dur: [4, 8], when: ['day'], lines: ['Stay charged, lads.', 'Who needs an oil change?'] },
  { id: 'sweep', phrase: 'sweeping the garage', go: 'off to sweep the garage', x: 404, floor: 'lower', face: 1, act: 'sweep', dur: [14, 22], when: ['morning', 'day'], lines: ['Dusty in here.'] },
  // bedroom
  { id: 'clock', phrase: 'checking the clock', go: 'off to check the clock', x: 206, floor: 'upper', face: 1, act: 'lookup', dur: [3, 6], when: ['morning', 'day', 'evening'], lines: ['NEXT'] },
  { id: 'bedsit', phrase: 'sitting on the bed', go: 'off to sit down a minute', x: 126, floor: 'upper', face: 1, sit: 'bed', dur: [8, 20], when: ['morning', 'night'], lines: ['Five more minutes.'] },
  { id: 'makebed', phrase: 'making the bed', go: 'off to make the bed', x: 118, floor: 'upper', face: -1, act: 'tidy', dur: [6, 10], when: ['morning'], lines: ['Hospital corners.', 'Made the bed.'] },
  { id: 'hats', phrase: 'trying on hats', go: 'off to the wardrobe', x: 174, floor: 'upper', face: 1, act: 'hat', dur: [6, 10], when: ['morning', 'day', 'evening'], lines: ['Suits me.', 'Hmm, maybe the other one.', 'Classy.'] },
  { id: 'mirror', phrase: 'checking the mirror', go: 'off to the mirror', x: 174, floor: 'upper', face: 1, act: 'mirror', dur: [4, 7], when: ['morning', 'evening'], lines: ['Looking sharp.', 'Alright, handsome.'] },
  // library
  { id: 'photos', phrase: 'looking at the photo wall', go: 'off to the photo wall', x: 270, floor: 'upper', face: 1, act: 'lookup', dur: [5, 12], when: ['day', 'evening'], lines: ['Good times.', 'Remember that?', 'Nice one of you.'] },
  { id: 'books', phrase: 'browsing the bookshelf', go: 'off to the bookshelf', x: 282, floor: 'upper', face: 1, act: 'browse', dur: [6, 12], when: ['day', 'evening'], lines: ['Where did I put that...', 'Ah, there it is.'] },
  // loft
  { id: 'retro', phrase: 'playing retro games', go: 'off up to the loft for a game', x: 198, floor: 'loft', face: -1, sit: 'beanbag', act: 'game', dur: [20, 45], when: ['day', 'evening', 'night'], lines: ['One more level.', '4900 games and nothing to play.', 'High score!'] },
  { id: 'guitar', phrase: 'strumming the guitar', go: 'off to get the guitar', x: 126, floor: 'upper', face: 1, sit: 'bed', act: 'guitar', dur: [10, 20], when: ['evening', 'night'], lines: ['♪ ♪', 'Still learning this one.'] },
  { id: 'hammock', phrase: 'swinging in the hammock', go: 'off up to the hammock', x: 328, floor: 'loft', face: 1, sit: 'hammock', act: 'swing', dur: [20, 50], when: ['day', 'evening'], lines: ['Bliss.', 'Just five minutes.'] },
  { id: 'telescope', phrase: 'at the telescope', go: 'off up to the telescope', x: 148, floor: 'loft', face: -1, act: 'scope', dur: [8, 16], when: ['evening', 'night', 'day'], lines: ['SKY'] },
  { id: 'punchbag', phrase: 'letting off steam', go: 'off up to the punchbag', x: 280, floor: 'loft', face: -1, act: 'punch', dur: [6, 12], when: ['day', 'evening'], lines: ['Take that, gateway.', 'Hyah!'] },
  { id: 'records', phrase: 'playing a record', go: 'off up to put a record on', x: 198, floor: 'loft', face: 1, sit: 'beanbag', act: 'record', dur: [12, 24], when: ['evening', 'night'], lines: ['Tune.', 'Side B.'] },
  { id: 'boxes', phrase: 'rummaging through the downloads', go: 'off to the garage shelves', x: 404, floor: 'lower', face: 1, act: 'rummage', dur: [6, 12], when: ['day'], lines: ['What is all this?', 'Old downloads.', 'Ooh, forgot about this.'] },
  // outside
  { id: 'mailbox', phrase: 'checking the post', go: 'off to check the post', x: 26, floor: 'outside', face: -1, act: 'mail', dur: [4, 8], when: ['morning', 'day'], lines: ['MAIL'] },
  { id: 'tree', phrase: 'chatting to Chirpa', go: 'off out to see Chirpa', x: 40, floor: 'outside', face: 1, act: 'lookup', dur: [5, 12], when: ['morning', 'day'], lines: ['Alright, Chirpa?', 'Sing us one.', 'Any good ones today?'] },
  // anywhere
  { id: 'dance', phrase: 'having a little dance', act: 'dance', dur: [4, 7], when: ['day', 'evening'], lines: ['Tune!', '♪ ♪'] },
  { id: 'stretch', phrase: 'stretching', act: 'stretch', dur: [2, 4], when: ['morning', 'day', 'evening', 'night'], lines: [] },
  { id: 'wander', phrase: 'pottering about', dur: [2, 5], when: ['morning', 'day', 'evening', 'night'], wander: true },
];
const PASTIME_BY_ID = Object.fromEntries(PASTIMES.map((p) => [p.id, p]));

function feetY(floor) { return L.feet[floor] ?? L.feet.lower; }

function dayBucket(h) {
  if (h >= 6 && h < 10) return 'morning';
  if (h >= 10 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

// Waypoints from one place to another: stairs between the two floors, the ladder up to the loft,
// the front door or the garage door to get outside.
function planPath(from, to) {
  const pts = [];
  let cur = { ...from };
  if (cur.floor === to.floor) return [to];
  if (cur.floor === 'loft') {
    pts.push({ x: L.ladder.x, floor: 'loft' }, { x: L.ladder.x, floor: 'upper', ladder: true });
    cur = { x: L.ladder.x, floor: 'upper' };
    if (to.floor === 'upper') { pts.push(to); return pts; }
  }
  if (cur.floor === 'upper') {
    if (to.floor === 'loft') { pts.push({ x: L.ladder.x, floor: 'upper' }, { x: L.ladder.x, floor: 'loft', ladder: true }, to); return pts; }
    pts.push({ x: L.stairs.x + L.stairs.w + 2, floor: 'upper' }, { x: L.stairs.x, floor: 'lower', stairs: true });
    cur = { x: L.stairs.x, floor: 'lower' };
  } else if (cur.floor === 'outside') {
    if (cur.x > 400) pts.push({ x: 462, floor: 'outside' }, { x: 454, floor: 'lower' });
    else pts.push({ x: 64, floor: 'outside' }, { x: 88, floor: 'lower' });
    cur = { x: cur.x > 400 ? 454 : 88, floor: 'lower' };
  }
  if (to.floor === 'lower') pts.push(to);
  else if (to.floor === 'upper') pts.push({ x: L.stairs.x, floor: 'lower' }, { x: L.stairs.x + L.stairs.w + 2, floor: 'upper', stairs: true }, to);
  else if (to.floor === 'loft') pts.push({ x: L.stairs.x, floor: 'lower' }, { x: L.stairs.x + L.stairs.w + 2, floor: 'upper', stairs: true }, { x: L.ladder.x, floor: 'upper' }, { x: L.ladder.x, floor: 'loft', ladder: true }, to);
  else if (to.floor === 'outside') {
    if (to.x > 400) pts.push({ x: 454, floor: 'lower' }, { x: 462, floor: 'outside' }, to);
    else pts.push({ x: 80, floor: 'lower' }, { x: 64, floor: 'outside' }, to);
  }
  return pts;
}

export class Actors {
  constructor(store, effects) {
    this.store = store;
    this.fx = effects;
    this.t = 0;
    this.anim = {
      typing: false, laptopOpen: false, laptopText: '', tvMode: 'cams', monitorMode: 'stats', termLines: [], codeLines: [],
      camFlash: 0, camLabel: '', camText: '', camHit: -1, clockShake: 0, photoFlash: 0, photoFlashIndex: 0, photoSeed: 3,
      bookOut: 0, journalGlow: 0, lampOn: false, solarPulse: 0, speaking: 0, tinkering: false, radioPing: 0,
      canInHand: false, plantSparkle: 0, retroOn: false, recordOn: false, punch: 0, scopeOn: false, wardrobeOpen: false,
      broomInHand: false, bowlFill: 0, board: [], boardTitle: '', deploy: 0, guitarAway: false,
    };
    this.clawd = {
      x: IDLE_HOME.x, floor: 'lower', y: feetY('lower'), face: 1, path: [], moving: false, climbing: false, pose: 'stand', dest: null,
      activity: null, arrived: true, walkT: 0, blink: 0, nextBlink: 3, eyesWide: 0, bubble: null, thought: null,
      lastStatus: '', termT: 0, actionT: 0, happy: 0, alert: 0,
      pastime: null, recent: [], pauseT: 2, fidgetT: 25, stretch: 0, dance: 0, glance: 0, lookUp: 0, napping: false, petting: false, watering: false,
      chore: null, moodBadge: null, hat: null, hatUntil: 0, headphones: false, phone: false, guitar: false, punching: 0, drawing: false, rect: [0, 0, 0, 0],
    };
    this.moodOverride = null;
    this.lastMood = null;
    this.bowl = { fill: 0, decayT: 0 };
    this.dog = { state: 'sleep', barkT: 0, alertT: 0, zT: 3, frame: 0, eating: 0 };
    this.bird = { singT: 0, hopT: 0, noteT: 0, nextHop: rand(3, 8), face: 1 };
    this.bots = { walkers: [], bob: 0 };
    this.bus = null;
    this.envelopes = [];
    this.planes = [];
    this.nextPlane = rand(8, 20);
    this.clouds = [];
    this.smokeT = 0;
    this.tvT = 0;
    this.late = [];
    this.reseedClouds();

    store.on('event', (ev) => this.onEvent(ev));
    store.on('state', () => this.onState());
  }

  // ------------------------------------------------------------ events
  onEvent(ev) {
    const c = this.clawd;
    const idle = this.store.effectiveActivity() === 'idle';
    switch (ev.type) {
      case 'bird':
        this.bird.singT = 4.5;
        this.fx.label(L.perch.x + 2, L.perch.y - 22, String(ev.species || 'bird').toUpperCase(), { life: 6, rise: 3, bg: '#1e3a8a' });
        if (idle && c.floor === 'outside') c.lookUp = 4;
        if (ev.new_species) this.setMood('excited', 6);
        break;
      case 'bark':
        this.dog.state = 'bark'; this.dog.barkT = 6; this.dog.reason = ev.reason || '';
        if (c.pose === 'bed') c.alert = 3;
        this.setMood(ev.level === 'alert' ? 'angry' : 'worried', ev.level === 'alert' ? 10 : 8);
        if (idle) this.forcePastime('dog', 'What is it, boy?');
        break;
      case 'telegram':
        this.envelopes.push({ t: 0, from: ev.from || 'you' }); this.dog.alertT = 5;
        this.say(`DM FROM ${String(ev.from || 'you').toUpperCase()}`, 6);
        if ((ev.from || 'you') === 'you') { c.happy = 2.5; this.setMood('excited', 8); } else this.setMood('happy', 5);
        if (idle) this.forcePastime('mailbox');
        break;
      case 'bus':
        this.spawnBus(ev);
        this.setMood('happy', 6);
        if (idle) this.forcePastime('door', `Alright, ${String(ev.from || 'mate')}?`);
        break;
      case 'cam': {
        const label = String(ev.label || 'motion'), cam = String(ev.camera || 'cam');
        this.anim.camFlash = 1.5; this.anim.camLabel = label; this.anim.camT = 6;
        this.anim.camText = `${label.toUpperCase().slice(0, 6)}@${cam.toUpperCase().slice(0, 4)}`;
        const names = this.store.state.cams.names || [];
        this.anim.camHit = Math.max(0, names.indexOf(ev.camera));
        this.anim.tvForce = 8; this.anim.tvMode = 'cams';
        c.eyesWide = 2.5;
        this.setMood('alert', 5);
        this.say(`${label.toUpperCase()} AT ${cam.toUpperCase()}`, 5);
        if (idle) this.forcePastime('tvcheck', null);
        break;
      }
      case 'photo': this.anim.photoFlash = 1.4; this.anim.photoFlashIndex = randInt(0, 5); this.anim.photoSeed += 1; this.setMood('happy', 4); if (idle && chance(0.5)) this.forcePastime('photos', 'New one!'); break;
      case 'plane': this.planes.push({ x: 492, y: randInt(8, 30), dir: -1, label: ev.callsign ? String(ev.callsign).toUpperCase() : '', speed: rand(18, 26) }); if (idle && (c.floor === 'outside' || c.floor === 'loft')) c.lookUp = 5; break;
      case 'sensor': this.anim.radioPing = 3; this.fx.label(L.radio.x + 11, L.radio.y - 20, (ev.name ? String(ev.name) : '433MHZ').toUpperCase().slice(0, 12), { life: 4, rise: 2, bg: '#14532d' }); break;
      case 'cron': this.anim.clockShake = 2; this.fx.label(L.clock.cx, L.clock.cy - 20, String(ev.name || 'cron').toUpperCase(), { life: 5, rise: 2, bg: '#7f1d1d' }); break;
      case 'subagent':
        if (ev.action === 'done') { this.bots.walkers.push({ x: 500, dir: -1, dock: this.bots.walkers.length % 3, t: 0 }); this.setMood('happy', 5); }
        else this.bots.walkers.push({ x: L.botDock.x + 10, dir: 1, t: 0 });
        break;
      case 'say': this.say(String(ev.text || ''), 8); this.anim.speaking = 3.5; break;
      case 'look': c.eyesWide = 3; this.anim.eyeIcon = 2.5; this.setMood('alert', 3); break;
      case 'dream': c.thought = { text: String(ev.text || ''), t: 12 }; break;
      case 'diary': this.anim.journalGlow = 5; this.fx.spark(L.nightstand.x + 6, L.nightstand.y - 6); this.say('DIARY DONE', 4); this.setMood('calm', 8); break;
      case 'solar': this.anim.solarPulse = 3; this.fx.label(L.battery.x + 9, L.battery.y - 20, String(ev.note || 'ESS').toUpperCase().slice(0, 12), { life: 4, rise: 2, bg: '#78350f' }); this.setMood('worried', 10); if (idle) this.forcePastime('garage', null); break;
      case 'note': if (ev.text) this.say(String(ev.text), 6); break;
      default: break;
    }
  }

  onState() {
    const s = this.store.state;
    const c = this.clawd;
    const st = String(s.clawd.status || '');
    if (st && st !== c.lastStatus) { c.lastStatus = st; if (!c.bubble || c.bubble.t < 2) this.say(st, 7); }
  }

  say(textStr, life = 6) {
    if (!textStr) return;
    this.clawd.bubble = { text: textStr, t: life };
  }

  spawnBus(ev) {
    const from = String(ev.from || 'crew').toLowerCase();
    const msg = String(ev.text || '');
    if (this.bus && this.bus.state !== 'out') { this.bus.from = from; this.bus.msg = msg; this.bus.waitT = Math.max(this.bus.waitT, 6); return; }
    this.bus = { x: -80, state: 'in', waitT: 6.5, from, msg };
  }

  reseedClouds() {
    const cond = this.store.state.weather?.condition || 'clear';
    const n = cond === 'rain' ? 7 : cond === 'cloudy' ? 5 : 3;
    while (this.clouds.length < n) this.clouds.push({ x: rand(-20, 480), y: rand(8, 36), v: rand(1.5, 4) });
    while (this.clouds.length > n) this.clouds.pop();
  }

  // ------------------------------------------------------------ mood
  setMood(mood, seconds) {
    if (!MOODS.includes(mood)) return;
    this.moodOverride = { mood, until: this.t + seconds };
  }

  // What his face shows right now. Short event moods win, then real trouble on the homelab,
  // then whatever clawd.mood says, then a sensible default for the activity.
  mood() {
    if (this.moodOverride && this.moodOverride.until > this.t) return this.moodOverride.mood;
    const s = this.store.state;
    const act = this.store.effectiveActivity();
    if (act === 'sleeping' || this.clawd.napping) return 'sleepy';
    const sys = s.system || {};
    const wd = s.watchdog?.state;
    if (wd === 'alert' || this.store.batteryLow()) return 'worried';
    if (Number(sys.cpu) > 92 || Number(sys.temp) > 82 || Number(sys.ram) > 95 || Number(sys.disk_root) > 95) return 'worried';
    if (wd === 'warning') return 'worried';
    const explicit = MOODS.includes(s.clawd.mood) ? s.clawd.mood : null;
    if (explicit && explicit !== 'happy') return explicit;
    if (this.clawd.chore) return 'calm';
    const pa = this.clawd.pastime && this.clawd.pastime.def;
    if (pa && (pa.act === 'dance' || pa.act === 'game')) return 'excited';
    if (pa && (pa.act === 'swing' || pa.act === 'record' || pa.act === 'scope')) return 'calm';
    if (pa && pa.act === 'punch') return 'focused';
    if (act === 'delegating' || act === 'playing') return 'excited';
    if (['terminal', 'coding', 'tinkering', 'reading', 'searching', 'researching', 'writing', 'remote', 'planning', 'deploying'].includes(act)) return 'focused';
    if (act === 'idle') {
      const lastEv = (s.events || []).slice(-1)[0];
      const quiet = !lastEv || Date.now() - lastEv.at > 30 * 60000;
      const sinceActive = s.clawd.last_active ? Date.now() - s.clawd.last_active : Infinity;
      if (quiet && sinceActive > 20 * 60000) return 'bored';
    }
    return explicit || 'happy';
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.t += dt;
    const s = this.store.state;
    this.updateClawd(dt, s);
    this.updateDog(dt, s);
    this.updateBird(dt);
    this.updateBots(dt, s);
    this.updateBus(dt);
    this.updateSky(dt, s);
    const a = this.anim;
    for (const k of ['camFlash', 'camT', 'clockShake', 'photoFlash', 'bookOut', 'journalGlow', 'solarPulse', 'speaking', 'radioPing', 'tvForce', 'eyeIcon', 'plantSparkle', 'punch']) if (a[k] > 0) a[k] = Math.max(0, a[k] - dt);
    if (a.camT <= 0) { a.camLabel = ''; a.camText = ''; a.camHit = -1; }
    if (a.speaking > 0 && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this.fx.wave(L.speaker.x + 11, L.speaker.y + 5, '#a5f3fc', 1);
    const cpu = Number(s.system.cpu || 0);
    this.smokeT -= dt;
    if (cpu > 15 && this.smokeT <= 0) { this.fx.smoke(L.chimney.x + 6, L.chimney.y - 2, 0.6 + cpu / 100); this.smokeT = 2.2 - cpu / 70; }
    // the dog's bowl empties as he eats
    if (this.bowl.fill > 0 && this.bowl.decayT > 0) { this.bowl.decayT -= dt; if (this.bowl.decayT <= 0) this.bowl.fill = Math.max(0, this.bowl.fill - 0.25), this.bowl.decayT = this.bowl.fill > 0 ? 8 : 0; }
    a.bowlFill = this.bowl.fill;
    // mood badge when the face changes
    const m = this.mood();
    if (this.lastMood && m !== this.lastMood) this.clawd.moodBadge = { text: m.toUpperCase(), color: MOOD_COLOR[m] || '#fff', t: 3 };
    this.lastMood = m;
    if (this.clawd.moodBadge) { this.clawd.moodBadge.t -= dt; if (this.clawd.moodBadge.t <= 0) this.clawd.moodBadge = null; }
    // hats wear off
    if (this.clawd.hat && this.t > this.clawd.hatUntil) this.clawd.hat = null;
  }

  updateClawd(dt, s) {
    const c = this.clawd;
    const a = this.anim;
    const act = this.store.effectiveActivity();
    if (act !== c.activity) this.setActivity(act, s);

    // movement along the planned path
    c.climbing = false;
    if (c.path.length) {
      const wp = c.path[0];
      if (wp.ladder) {
        const target = feetY(wp.floor);
        const dy = target - c.y;
        const step = CLIMB_SPEED * dt;
        c.x = wp.x; c.climbing = true;
        if (Math.abs(dy) <= step) { c.y = target; c.floor = wp.floor; c.path.shift(); }
        else c.y += Math.sign(dy) * step;
      } else {
        const dx = wp.x - c.x;
        const step = WALK_SPEED * dt;
        if (Math.abs(dx) <= step) {
          c.x = wp.x; c.floor = wp.floor; c.y = feetY(wp.floor); c.path.shift();
        } else {
          c.x += Math.sign(dx) * step;
          c.face = Math.sign(dx) || c.face;
          if (wp.stairs) c.y = stairY(c.x);
          else if (wp.floor !== c.floor) {
            const from = feetY(c.floor), to = feetY(wp.floor);
            c.y = lerp(from, to, clamp(1 - Math.abs(dx) / 8, 0, 1));
          } else c.y = feetY(c.floor);
          if (a.broomInHand && Math.floor(c.walkT * 6) !== Math.floor((c.walkT + dt) * 6)) this.fx.add({ x: c.x - c.face * 18 + randInt(-3, 3), y: c.y - 1, life: 0.6, vx: -c.face * 6, vy: -5, draw: (g, q) => px(g, q.x, q.y, '#a8a29e') });
        }
      }
      c.moving = true;
      c.walkT += dt;
      if (!c.path.length) { c.moving = false; c.arrived = true; this.onArrive(); }
    } else c.moving = false;

    // timers
    c.nextBlink -= dt;
    if (c.nextBlink <= 0) { c.blink = 0.14; c.nextBlink = rand(2.5, 6); }
    for (const k of ['blink', 'eyesWide', 'happy', 'alert', 'stretch', 'dance', 'glance', 'lookUp', 'punching']) if (c[k] > 0) c[k] = Math.max(0, c[k] - dt);
    if (c.bubble) { c.bubble.t -= dt; if (c.bubble.t <= 0) c.bubble = null; }
    if (c.thought) { c.thought.t -= dt; if (c.thought.t <= 0) c.thought = null; }
    c.napping = false; c.petting = false; c.watering = false; c.headphones = false; c.phone = false; c.guitar = false; c.drawing = false; c.tidying = false;
    a.typing = false; a.tinkering = false; a.retroOn = false; a.recordOn = false; a.scopeOn = false; a.wardrobeOpen = false; a.guitarAway = false;

    if (act === 'idle') {
      this.updateChore(dt, s);
      if (!c.chore) this.updateIdle(dt, s);
    } else if (c.arrived && !c.moving) {
      c.actionT += dt;
      switch (act) {
        case 'terminal':
          a.typing = true;
          c.termT -= dt;
          if (c.termT <= 0) { c.termT = rand(1, 2.4); a.termLines = [...a.termLines, pick(TERM_LINES)].slice(-8); }
          break;
        case 'coding':
          a.typing = true;
          c.termT -= dt;
          if (c.termT <= 0) { c.termT = rand(0.8, 2); a.codeLines = [...a.codeLines, pick(CODE_LINES)].slice(-8); }
          break;
        case 'sleeping':
          if (Math.floor(c.actionT / 2.2) !== Math.floor((c.actionT - dt) / 2.2)) this.fx.zzz(L.bed.x + 34, L.bed.y + 2);
          break;
        case 'tinkering':
          a.tinkering = true;
          if (Math.floor(c.actionT / 1.1) !== Math.floor((c.actionT - dt) / 1.1)) this.fx.spark(L.workbench.x + 14, L.workbench.y - 2);
          break;
        case 'writing':
          a.journalGlow = Math.max(a.journalGlow, 0.5);
          if (Math.floor(c.actionT / 0.9) !== Math.floor((c.actionT - dt) / 0.9)) this.fx.add({ x: L.nightstand.x + 4, y: L.nightstand.y - 7, life: 0.8, vy: -6, draw: (g, p) => px(g, p.x + (Math.floor(p.t * 20) % 3), p.y, '#1e1b4b') });
          break;
        case 'reading': case 'searching': case 'researching': a.bookOut = 1; break;
        case 'thinking': if (!c.thought || c.thought.t < 0.2) c.thought = { text: '...', t: 2, dots: true }; break;
        case 'planning': this.drawOnBoard(dt, c.actionT, 'PLAN'); break;
        case 'chatting': c.phone = true; if (Math.floor(c.actionT / 3) !== Math.floor((c.actionT - dt) / 3) && !c.bubble) c.thought = { text: '...', t: 1.5, dots: true }; break;
        case 'deploying':
          a.deploy = (c.actionT % 24) / 20;
          if (Math.floor(c.actionT / 0.5) !== Math.floor((c.actionT - dt) / 0.5)) this.fx.add({ x: L.cupboard.x + randInt(2, 14), y: L.cupboard.y + randInt(4, 60), life: 0.4, draw: (g, p) => px(g, p.x, p.y, '#22c55e') });
          if (a.deploy > 1) { a.deploy = 0; if (chance(0.5)) this.say('Shipped.', 3); }
          break;
        case 'monitoring': break;
        case 'playing': a.retroOn = true; break;
        default: break;
      }
      // small fidgets while busy, so he never looks frozen
      if (act !== 'sleeping') {
        c.fidgetT -= dt;
        if (c.fidgetT <= 0) {
          c.fidgetT = rand(18, 40);
          if (c.pose === 'stand') c.stretch = 2.2; else c.glance = 1.6;
        }
      }
    }
    if (act !== 'deploying') a.deploy = 0;
    a.lampOn = (act === 'writing' || ['reading', 'searching', 'researching'].includes(act) || (c.pastime && (c.pastime.def.floor === 'upper' || c.pastime.def.floor === 'loft')) || (c.chore && c.chore.step === 1)) && this.store.dayFactor() < 0.6;
    a.laptopOpen = act === 'remote';
    if (a.laptopOpen) { const st = String(s.clawd.status || '').toLowerCase(); a.laptopText = st.includes('telegram') || st.includes('reply') ? 'TG' : st.includes('ssh') ? 'SSH' : 'NET'; }
    a.monitorMode = act === 'terminal' ? 'terminal' : act === 'coding' ? 'code' : act === 'sleeping' ? 'off' : 'stats';
    this.tvT += dt;
    if (a.tvForce > 0) a.tvMode = 'cams';
    else if (a.tvChannel) a.tvMode = a.tvChannel;
    else if (act === 'monitoring') a.tvMode = 'dash';
    else if (act === 'watching' || (c.pastime && (c.pastime.def.id === 'couch'))) a.tvMode = (this.tvT % 16) < 10 ? 'cams' : 'dash';
    else a.tvMode = 'cams';
  }

  drawOnBoard(dt, elapsed, title) {
    const a = this.anim;
    const c = this.clawd;
    c.drawing = true;
    a.boardTitle = title;
    if (Math.floor(elapsed / 1.3) !== Math.floor((elapsed - dt) / 1.3)) {
      if (a.board.length >= 9) a.board = [];
      const cols = ['#2563eb', '#dc2626', '#16a34a', '#1e3a8a'];
      const kind = pick(['box', 'box', 'arrow', 'line', 'dot']);
      const x = randInt(5, 26), y = randInt(7, 16);
      if (kind === 'box') a.board = [...a.board, { type: 'box', x, y, w: randInt(6, 12), h: randInt(4, 6), color: pick(cols) }];
      else if (kind === 'arrow') a.board = [...a.board, { type: 'arrow', x, y: y + 2, w: randInt(6, 12), color: pick(cols) }];
      else if (kind === 'line') a.board = [...a.board, { type: 'line', x, y: y + 4, w: randInt(6, 14), color: pick(cols) }];
      else a.board = [...a.board, { type: 'dot', x: x + 2, y: y + 2, color: '#dc2626' }];
    }
  }

  // ---- the watering round: both plants, at sunrise and at sunset
  updateChore(dt, s) {
    const c = this.clawd;
    if (!c.chore) {
      const due = this.store.wateringDue();
      if (!due || c.pose === 'bed') return;
      c.chore = { key: due.key, which: due.which, step: 0, phase: 'go', t: 0 };
      c.pastime = null;
      this.walkTo(L.bigPlant.x + L.bigPlant.w + 8, 'lower', { face: -1 });
      this.say(due.which === 'sunrise' ? 'Morning, plants.' : 'Evening drink, plants.', 5);
      return;
    }
    const ch = c.chore;
    if (!c.arrived || c.moving) return;
    if (ch.phase === 'go') { ch.phase = 'water'; ch.t = 5; this.anim.canInHand = true; }
    ch.t -= dt;
    c.watering = true;
    const target = ch.step === 0 ? { x: L.bigPlant.x + L.bigPlant.w / 2, y: L.bigPlant.y - 56 } : { x: L.plant.x + 15, y: L.feet.upper - 30 };
    if (Math.floor(ch.t / 0.2) !== Math.floor((ch.t + dt) / 0.2)) this.fx.add({ x: target.x + randInt(-6, 6), y: target.y, life: 0.45, vy: 34, draw: (g, q) => px(g, q.x, q.y, '#60a5fa') });
    if (ch.t > 0) return;
    this.anim.plantSparkle = 3;
    if (ch.step === 0) {
      ch.step = 1; ch.phase = 'go';
      this.walkTo(L.plant.x - 10, 'upper', { face: 1 });
    } else {
      this.store.markWatered(ch.key);
      c.chore = null;
      this.anim.canInHand = false;
      this.say('Drink up.', 4);
      c.pauseT = rand(2, 4);
    }
  }

  // ---- idle pastimes
  updateIdle(dt, s) {
    const c = this.clawd;
    const p = c.pastime;
    if (!p) {
      if (c.moving) return;
      c.pauseT -= dt;
      if (c.pauseT <= 0) this.pickPastime();
      return;
    }
    if (!c.arrived || c.moving) { if (p.def.act === 'sweep') this.anim.broomInHand = true; return; }
    if (p.phase === 'go') {
      p.phase = 'do';
      const lines = p.def.lines || [];
      const line = p.forcedLine !== undefined ? p.forcedLine : (lines.length && chance(0.6) ? pick(lines) : null);
      if (line === 'NEXT') { const n = this.store.nextCron(); if (n) this.say(`${n.name} in ${fmtDuration(n.mins)}`, 5); }
      else if (line === 'MAIL') { const u = Number(s.telegram.unread || 0); this.say(u > 0 ? `POST! ${u} WAITING` : 'Nothing yet.', 5); }
      else if (line === 'SKY') { const night = this.store.dayFactor() < 0.5; const n = Number(s.sdr.planes || 0); this.say(night ? pick(['Stars are out.', 'Clear night.', 'Is that a satellite?']) : (n > 0 ? `${n} plane${n > 1 ? 's' : ''} up there.` : 'Empty sky.'), 5); }
      else if (line) this.say(line, 5);
      if (p.def.act === 'check' || p.def.act === 'rummage') c.eyesWide = 1.2;
      if (p.def.act === 'hat') { this.anim.wardrobeOpen = true; p.hatT = 2.5; }
      if (p.def.act === 'feed') { p.pourT = 2.2; }
      if (p.def.act === 'sweep') { p.nextSweep = 0.5; }
    }
    p.t -= dt;
    this.runPastime(p, dt, s);
    if (p.t <= 0) this.endPastime();
  }

  endPastime() {
    const c = this.clawd;
    const p = c.pastime;
    if (p && p.def.act === 'sweep') this.anim.broomInHand = false;
    c.pastime = null;
    c.pauseT = rand(1, 4);
    if (['bedsit', 'beanbag', 'hammock'].includes(c.pose)) c.pose = 'stand';
    this.anim.tvChannel = null;
  }

  pickPastime() {
    const c = this.clawd;
    const bucket = dayBucket(this.store.hourNow());
    const dark = this.store.dayFactor() < 0.5;
    const mood = this.mood();
    const pool = [];
    for (const def of PASTIMES) {
      if (def.forcedOnly) continue;
      if (c.recent.includes(def.id)) continue;
      if (def.dark && !dark) continue;
      if (def.id === 'nap' && bucket === 'morning') continue;
      let w = 1 + (def.when.includes(bucket) ? 2 : 0);
      if (mood === 'bored' && ['nap', 'couch', 'wander', 'retro', 'channel'].includes(def.id)) w += 2;
      if (mood === 'excited' && ['dance', 'tree', 'retro', 'guitar'].includes(def.id)) w += 3;
      if ((mood === 'worried' || mood === 'angry') && ['cupboard', 'garage', 'peek', 'punchbag'].includes(def.id)) w += 4;
      if (mood === 'calm' && ['hammock', 'records', 'telescope'].includes(def.id)) w += 2;
      for (let i = 0; i < w; i++) pool.push(def);
    }
    const def = pick(pool);
    let target = def;
    if (def.wander) {
      const places = PASTIMES.filter((d) => d.x != null && !d.forcedOnly && d.id !== 'mailbox' && d.id !== 'tree');
      target = pick(places);
    }
    this.startPastime(def, target);
  }

  forcePastime(id, line) {
    const def = PASTIME_BY_ID[id];
    if (!def || this.clawd.chore) return;
    this.startPastime(def, def, line);
  }

  startPastime(def, target, forcedLine) {
    const c = this.clawd;
    if (c.pastime) this.endPastime();
    c.pastime = { def, t: rand(def.dur[0], def.dur[1]), phase: 'go', forcedLine };
    c.recent = [...c.recent, def.id].slice(-6);
    if (target.x != null) this.walkTo(target.x, target.floor, { face: target.face, sit: def.wander ? null : target.sit });
    else { c.dest = { face: c.face }; c.arrived = true; if (c.pose === 'bedsit') c.pose = 'stand'; }
    if (def.act === 'dance') c.dance = c.pastime.t;
    if (def.act === 'stretch') c.stretch = c.pastime.t;
  }

  runPastime(p, dt, s) {
    const c = this.clawd;
    const a = this.anim;
    const tick = (every) => Math.floor(p.t / every) !== Math.floor((p.t + dt) / every);
    switch (p.def.act) {
      case 'lookup': c.lookUp = 0.5; break;
      case 'nap': c.napping = true; if (tick(2.5)) this.fx.zzz(c.x + 6, c.y - 38); break;
      case 'swing': if (chance(0.002)) c.napping = true; if (tick(4)) this.fx.add({ x: c.x - 10, y: c.y - 36, life: 1.2, vx: 8, vy: -6, draw: (g, q) => text(g, '~', q.x, q.y, '#fde68a') }); break;
      case 'pet': c.petting = true; this.dog.alertT = 0.6; if (tick(0.8)) this.fx.heart(L.dogBed.x + randInt(2, 16), L.dogBed.y - 8); break;
      case 'feed':
        if (p.pourT > 0) { p.pourT -= dt; c.watering = true; this.bowl.fill = Math.min(1, this.bowl.fill + dt / 2); if (tick(0.15)) this.fx.add({ x: L.dogBowl.x + randInt(1, 6), y: L.dogBowl.y - 10, life: 0.3, vy: 36, draw: (g, q) => px(g, q.x, q.y, '#a16207') }); }
        else { this.dog.alertT = 0.6; this.dog.eating = 0.6; this.bowl.decayT = this.bowl.decayT || 6; }
        break;
      case 'browse': a.bookOut = 1; break;
      case 'radio': a.radioPing = 1; if (tick(0.6)) this.fx.note(L.radio.x + randInt(0, 18), L.radio.y - 4); break;
      case 'dance': c.dance = Math.max(c.dance, 0.2); if (tick(0.5)) this.fx.note(c.x + randInt(-6, 10), c.y - 36); break;
      case 'stretch': c.stretch = Math.max(c.stretch, 0.2); break;
      case 'game': a.retroOn = true; c.phone = false; if (tick(6) && chance(0.4)) this.fx.label(L.crt.x + L.crt.w / 2, L.crt.y - 16, pick(['NICE', 'OOF', '1UP', 'GG']), { life: 1.5, rise: 4, bg: '#1e1b4b' }); break;
      case 'guitar': c.guitar = true; a.guitarAway = true; if (tick(0.7)) this.fx.note(c.x + randInt(-8, 8), c.y - 36); break;
      case 'record': a.recordOn = true; c.headphones = true; if (tick(0.8)) this.fx.note(L.recordPlayer.x + randInt(2, 16), L.recordPlayer.y - 12); break;
      case 'punch':
        if (tick(0.55)) { c.punching = 0.25; a.punch = 0.5; this.fx.add({ x: L.punchbag.x + 14, y: L.punchbag.y + randInt(6, 18), life: 0.35, draw: (g, q, k) => { if (k < 0.7) text(g, 'POW', q.x - 8, q.y - 2 - k * 4, '#fde047'); } }); }
        break;
      case 'scope': a.scopeOn = true; c.lookUp = 0.5; break;
      case 'rummage': c.lookUp = 0.5; if (tick(0.9)) this.fx.add({ x: L.garageShelf.x + randInt(4, 56), y: L.garageShelf.y + 14, life: 0.7, vx: rand(-10, 10), vy: -20, draw: (g, q) => px(g, q.x, q.y, pick(['#fde68a', '#a16207', '#e5e7eb'])) }); break;
      case 'hat':
        if (p.hatT > 0) { p.hatT -= dt; a.wardrobeOpen = true; if (p.hatT <= 0) { c.hat = chance(0.2) ? null : pick(HAT_NAMES); c.hatUntil = this.t + rand(600, 2400); } }
        break;
      case 'mirror': if (tick(1.5)) c.glance = 0.6; break;
      case 'tidy': c.tidying = true; if (tick(0.6)) this.fx.add({ x: c.x + c.face * 12 + randInt(-4, 4), y: c.y - randInt(4, 14), life: 0.5, draw: (g, q, k) => px(g, q.x, q.y, k < 0.5 ? '#ffffff' : '#cbd5e1') }); break;
      case 'tidyup': c.tidying = true; c.lookUp = 0.5; if (tick(0.6)) this.fx.add({ x: L.crewPhoto.x + randInt(0, 44), y: L.crewPhoto.y + randInt(0, 26), life: 0.5, draw: (g, q, k) => px(g, q.x, q.y, k < 0.5 ? '#ffffff' : '#cbd5e1') }); break;
      case 'draw': this.drawOnBoard(dt, p.def.dur[1] - p.t, 'TODO'); break;
      case 'channel': if (tick(2.5)) a.tvChannel = a.tvChannel === 'dash' ? 'cams' : 'dash'; break;
      case 'sweep':
        a.broomInHand = true;
        p.nextSweep -= dt;
        if (p.nextSweep <= 0) { p.nextSweep = rand(2, 3.5); this.walkTo(randInt(402, 444), 'lower', { face: c.face }); }
        break;
      default: break;
    }
  }

  setActivity(act, s) {
    const c = this.clawd;
    const prev = c.activity;
    c.activity = act;
    c.actionT = 0;
    if (c.pastime) this.endPastime();
    c.chore = null;
    this.anim.canInHand = false;
    this.anim.broomInHand = false;
    c.pauseT = rand(0.5, 2);
    this.anim.bookOut = 0;
    if (prev === 'terminal') this.anim.termLines = [];
    if (prev === 'coding') this.anim.codeLines = [];
    this.store.logActivity(act);
    const spot = ACTIVITY_SPOTS[act];
    if (!spot) {
      if (c.pose === 'bed') { this.walkTo(IDLE_HOME.x, 'lower', { face: 1 }); }
      else if (act === 'idle' && ['beanbag', 'hammock', 'chair', 'couch', 'bedsit'].includes(c.pose)) { c.pose = 'stand'; }
      c.arrived = true;
      return;
    }
    this.walkTo(spot.x, spot.floor, { face: spot.face, sit: spot.sit, bed: spot.bed });
  }

  walkTo(x, floor, dest = {}) {
    const c = this.clawd;
    let from = { x: c.x, floor: c.floor };
    if (c.pose === 'bed') { c.x = L.bed.x + 60; c.floor = 'upper'; c.y = feetY('upper'); from = { x: c.x, floor: 'upper' }; }
    c.pose = 'stand';
    c.dest = dest;
    c.path = planPath(from, { x, floor });
    c.arrived = false;
    if (c.path.length === 1 && Math.abs(c.path[0].x - c.x) < 1 && c.path[0].floor === c.floor) { c.path = []; c.arrived = true; this.onArrive(); }
  }

  onArrive() {
    const c = this.clawd;
    const d = c.dest || {};
    if (d.face) c.face = d.face;
    if (d.bed) c.pose = 'bed';
    else if (d.sit === 'couch') c.pose = 'couch';
    else if (d.sit === 'chair') c.pose = 'chair';
    else if (d.sit === 'bed') c.pose = 'bedsit';
    else if (d.sit === 'beanbag') c.pose = 'beanbag';
    else if (d.sit === 'hammock') c.pose = 'hammock';
    else c.pose = 'stand';
  }

  updateDog(dt, s) {
    const d = this.dog;
    const wd = s.watchdog?.state || 'ok';
    if (d.eating > 0) d.eating -= dt;
    if (d.barkT > 0) {
      d.barkT -= dt;
      if (Math.floor(d.barkT * 3) !== Math.floor((d.barkT + dt) * 3)) this.fx.bark(L.dogBed.x + 18, L.dogBed.y - 4, 1);
      if (d.barkT <= 0) d.state = wd === 'ok' ? 'sleep' : 'sit';
      return;
    }
    if (d.alertT > 0) { d.alertT -= dt; d.state = 'sit'; return; }
    d.state = wd === 'ok' ? 'sleep' : 'sit';
    if (d.state === 'sleep') { d.zT -= dt; if (d.zT <= 0) { d.zT = rand(3, 6); this.fx.zzz(L.dogBed.x + 10, L.dogBed.y - 8, { small: true }); } }
  }

  updateBird(dt) {
    const b = this.bird;
    if (b.singT > 0) {
      b.singT -= dt;
      b.noteT -= dt;
      if (b.noteT <= 0) { b.noteT = 0.4; this.fx.note(L.perch.x + (b.face > 0 ? -2 : 8), L.perch.y - 8); }
    } else {
      b.nextHop -= dt;
      if (b.nextHop <= 0) { b.nextHop = rand(3, 9); b.hopT = 0.18; if (chance(0.4)) b.face *= -1; }
    }
    if (b.hopT > 0) b.hopT -= dt;
  }

  updateBots(dt, s) {
    const bo = this.bots;
    bo.bob += dt;
    for (const w of bo.walkers) {
      w.t += dt;
      w.x += w.dir * 28 * dt;
      if (w.dir < 0 && w.x <= L.botDock.x + (w.dock || 0) * 10) w.done = true;
    }
    bo.walkers = bo.walkers.filter((w) => !w.done && w.x < 520 && w.x > -20);
  }

  updateBus(dt) {
    const b = this.bus;
    if (!b) return;
    if (b.state === 'in') { b.x += 95 * dt; if (b.x >= 4) { b.x = 4; b.state = 'wait'; } }
    else if (b.state === 'wait') { b.waitT -= dt; if (b.waitT <= 0) b.state = 'out'; }
    else { b.x += 110 * dt; if (b.x > 500) this.bus = null; }
  }

  updateSky(dt, s) {
    for (const c of this.clouds) { c.x += c.v * dt; if (c.x > 500) { c.x = -30; c.y = rand(8, 36); } }
    if (this.clouds.length !== (s.weather?.condition === 'rain' ? 7 : s.weather?.condition === 'cloudy' ? 5 : 3)) this.reseedClouds();
    for (const p of this.planes) p.x += p.dir * p.speed * dt;
    this.planes = this.planes.filter((p) => p.x > -30 && p.x < 520);
    this.nextPlane -= dt;
    if (this.nextPlane <= 0) {
      this.nextPlane = rand(20, 45);
      if (Number(s.sdr?.planes || 0) > 0 && this.planes.length < 3) {
        const lp = s.sdr.last_plane;
        this.planes.push({ x: 492, y: randInt(8, 30), dir: -1, label: lp && chance(0.5) ? String(lp.callsign || '').toUpperCase() : '', speed: rand(16, 24) });
      }
    }
    for (const e of this.envelopes) e.t += dt;
    this.envelopes = this.envelopes.filter((e) => e.t < 1.4);
  }

  // ------------------------------------------------------------ queries
  clawdRoom() {
    const c = this.clawd;
    if (c.pose === 'bed') return 'bedroom';
    return roomAt(c.x, c.floor);
  }

  // What the title bar says he is doing.
  phrase() {
    const c = this.clawd;
    const act = this.store.effectiveActivity();
    if (act === 'idle' && c.chore) return c.moving ? 'off to water the plants' : 'watering the plants';
    if (act === 'idle' && c.pastime) {
      const d = c.pastime.def;
      if (c.moving) return d.wander ? 'pottering about' : (c.climbing ? (c.floor === 'loft' ? 'climbing down from the loft' : 'climbing up to the loft') : (d.go || `off to ${d.phrase}`));
      if (d.id === 'telescope') return this.store.dayFactor() < 0.5 ? 'stargazing' : 'plane spotting';
      return d.phrase;
    }
    if (act === 'idle') return c.moving ? 'pottering about' : 'having a breather';
    if (c.moving && c.climbing) return c.floor === 'loft' ? 'climbing down from the loft' : 'climbing up to the loft';
    return PHRASES[act] || act;
  }

  // Tap target + stats for Clawd himself.
  clawdItem() {
    return {
      id: 'clawd',
      rect: this.clawd.rect,
      title: 'Clawd',
      body: 'That is me. Where I am and what I am doing comes from the homelab; the little things in between, and the face, are mine.',
      stats: (s, store) => {
        const log = store.activityLog || [];
        const last = log[log.length - 1];
        const since = last ? fmtDuration((Date.now() - last.at) / 60000) : '—';
        const counts = {};
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        for (const e of log) if (e.at >= dayStart.getTime()) counts[e.activity] = (counts[e.activity] || 0) + 1;
        const today = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ×${v}`).join(', ') || '—';
        const m = this.mood();
        const o = { doing: this.phrase(), feeling: `${MOOD_EMOJI[m] || ''} ${m}`, activity: store.effectiveActivity(), 'for': since, status: s.clawd.status || '—' };
        if (this.clawd.pastime) o.pastime = this.clawd.pastime.def.id;
        if (this.clawd.hat) o.wearing = `${this.clawd.hat} hat`;
        o.today = today;
        o['last active'] = s.clawd.last_active ? fmtDuration((Date.now() - s.clawd.last_active) / 60000) + ' ago' : '—';
        o['plants watered'] = store.plants?.lastWatered ? fmtDuration((Date.now() - store.plants.lastWatered) / 60000) + ' ago' : '—';
        return o;
      },
      spark: null,
    };
  }

  // ------------------------------------------------------------ draw
  // Bubbles are queued while drawing and rendered after the lighting pass so they stay bright at night.
  drawLate(ctx) {
    for (const fn of this.late) fn(ctx);
    this.late = [];
  }

  drawBird(ctx) {
    const b = this.bird;
    const sprite = b.singT > 0 && Math.floor(this.t * 5) % 2 === 0 ? BIRD_SING : BIRD;
    const y = L.perch.y - 7 - (b.hopT > 0 ? 1 : 0);
    drawSprite(ctx, sprite, L.perch.x - 4, y, { flip: b.face < 0 });
  }

  drawDog(ctx) {
    const d = this.dog;
    const S = CLAWD_SCALE;
    const x = L.dogBed.x + Math.round((L.dogBed.w - 16 * S) / 2);
    if (d.state === 'sleep') drawSprite(ctx, DOG_SLEEP, x, L.feet.lower - 7 * S, { scale: S });
    else if (d.state === 'sit') {
      drawSprite(ctx, DOG_SIT, x, L.feet.lower - 11 * S, { scale: S });
      if (d.eating > 0 && Math.floor(this.t * 6) % 2 === 0) px(ctx, L.dogBowl.x + 3 + (Math.floor(this.t * 6) % 3), L.dogBowl.y - 1, '#a16207');
    } else {
      const sp = Math.floor(this.t * 6) % 2 === 0 ? DOG_BARK : DOG_STAND;
      drawSprite(ctx, sp, x, L.feet.lower - 11 * S, { scale: S });
      if (d.reason) this.late.push((g) => bubble(g, `WOOF! ${d.reason}`, x + 8 * S, L.feet.lower - 12 * S, { bg: '#fef3c7', color: '#7c2d12' }));
    }
  }

  drawBots(ctx, s) {
    const active = Number(s.subagents?.active || 0);
    const lit = Math.min(active, 3);
    for (let i = 0; i < 3; i++) {
      const x = L.botDock.x + i * 10;
      if (i < lit) {
        const bob = Math.floor(this.bots.bob * 4 + i) % 2;
        drawSprite(ctx, bob ? BOT_WALK : BOT, x, L.feet.lower - 10 - bob);
        if (Math.floor(this.t * 3 + i) % 4 === 0) px(ctx, x + 3, L.feet.lower - 10, '#fde047');
      } else {
        drawSprite(ctx, BOT, x, L.feet.lower - 10, { tint: '#5b6677' });
      }
    }
    if (active > 3) text(ctx, `+${active - 3}`, L.botDock.x + 30, L.feet.lower - 9, '#a5f3fc');
    for (const w of this.bots.walkers) {
      const y = w.x > 460 ? L.feet.outside : L.feet.lower;
      const fr = Math.floor(w.t * 6) % 2 ? BOT_WALK : BOT;
      drawSprite(ctx, fr, w.x, y - 10, { flip: w.dir < 0 });
    }
  }

  drawBus(ctx) {
    const b = this.bus;
    if (!b) return;
    const x = Math.round(b.x), y = L.road.y - 18;
    rect(ctx, x, y + 2, 56, 14, '#f59e0b'); rect(ctx, x + 2, y, 52, 3, '#fbbf24');
    rect(ctx, x, y + 12, 56, 4, '#b45309');
    outline(ctx, x, y + 2, 56, 14, '#1a1216');
    for (let i = 0; i < 4; i++) box(ctx, x + 4 + i * 12, y + 4, 9, 6, '#bae6fd', '#1a1216');
    rect(ctx, x + 50, y + 6, 6, 4, '#bae6fd');
    disc(ctx, x + 10, y + 17, 3, '#1a1216'); disc(ctx, x + 46, y + 17, 3, '#1a1216'); px(ctx, x + 10, y + 17, '#9ca3af'); px(ctx, x + 46, y + 17, '#9ca3af');
    px(ctx, x + 55, y + 11, '#fef08a'); px(ctx, x, y + 11, '#ef4444');
    text(ctx, 'CREW BUS', x + 10, y + 11, '#1a1216');
    if (b.state === 'wait') {
      const col = CREW[b.from]?.color || '#94a3b8';
      disc(ctx, x + 28, y - 8, 3, col); rect(ctx, x + 26, y - 5, 5, 3, col);
      textCentered(ctx, b.from.toUpperCase(), x + 28, y - 18, '#fff');
      if (b.msg) bubble(ctx, b.msg, x + 28, y - 22, { bg: '#fef3c7', color: '#1e1b4b' });
    }
  }

  drawEnvelopes(ctx) {
    for (const e of this.envelopes) {
      const k = clamp(e.t / 1.2, 0, 1);
      const x = lerp(-12, L.mailbox.x + 1, k);
      const y = lerp(226, L.mailbox.y - 2, k) - Math.sin(k * Math.PI) * 26;
      drawSprite(ctx, ENVELOPE, x, y);
    }
  }

  drawClawd(ctx) {
    const c = this.clawd;
    const t = this.t;
    let bx, by, body;
    const face = c.face;
    if (c.pose === 'bed') {
      const sp = bedSleepPos();
      bx = sp.x; by = sp.y;
      const BX = sp.x, BY = sp.y;
      const X = (x) => BX + (x - bx) * CLAWD_SCALE, Y = (y) => BY + (y - by) * CLAWD_SCALE;
      body = CLAWD_SIT;
      this.scaled(ctx, bx, by, BX, BY, () => { drawSprite(ctx, body, bx, by); this.drawFace(ctx, bx, by, 1, true); });
      if (!drawBedBlanket(ctx)) {
        rect(ctx, L.bed.x + 22, L.bed.y + 18, L.bed.w - 22, 11, '#2563eb');
        for (let x = L.bed.x + 24; x < L.bed.x + L.bed.w - 2; x += 6) rect(ctx, x, L.bed.y + 20, 3, 1, '#60a5fa');
        rect(ctx, L.bed.x + 22, L.bed.y + 18, L.bed.w - 22, 1, '#93c5fd');
      }
      this.scaled(ctx, bx, by, BX, BY, () => { drawSprite(ctx, CLAW, bx - 2, by + 9, { flip: true }); drawSprite(ctx, CLAW, bx + 15, by + 9); });
      if (c.thought) this.late.push((g) => bubble(g, c.thought.text, X(bx + 8), Y(by - 2), { thought: true, bg: '#eef2ff' }));
      if (c.alert > 0) this.late.push((g) => text(g, '!', X(bx + 7), Y(by - 8), '#fbbf24', 2));
      c.rect = [BX - 4, BY - 6, 16 * CLAWD_SCALE + 8, 15 * CLAWD_SCALE + 6];
      return;
    }
    const bob = c.dance > 0 && !c.moving ? (Math.floor(t * 6) % 2 ? -1 : 0) : (c.pose === 'hammock' ? Math.round(Math.sin(t * 1.5)) : 0);
    if (['chair', 'couch', 'bedsit', 'beanbag', 'hammock'].includes(c.pose)) {
      const seat = c.pose === 'chair' ? L.chair.seatY : c.pose === 'couch' ? L.couch.seatY : c.pose === 'beanbag' ? L.beanbag.seatY : c.pose === 'hammock' ? L.hammock.seatY : 170;
      bx = Math.round(c.x - 8); by = seat - 14 + bob;
      body = CLAWD_SIT;
    } else {
      bx = Math.round(c.x - 8); by = Math.round(c.y - 17) + bob;
      body = c.moving ? (Math.floor(c.walkT * 7) % 2 ? CLAWD_WALK_A : CLAWD_WALK_B) : CLAWD_BODY;
    }
    // (bx, by) is the 1x sprite origin; the sprite lands at (BX, BY) drawn CLAWD_SCALE times bigger, feet still on c.y
    const S = CLAWD_SCALE;
    const BX = Math.round(c.x - 8 * S), BY = (body === CLAWD_SIT ? by - 14 * (S - 1) : by - 17 * (S - 1));
    const X = (x) => BX + (x - bx) * S, Y = (y) => BY + (y - by) * S;
    this.scaled(ctx, bx, by, BX, BY, () => {
      if (c.pose === 'stand' && !c.climbing) rect(ctx, bx + 3, by + 17, 10, 1, 'rgba(0,0,0,0.25)');
      drawSprite(ctx, body, bx, by, { flip: face < 0 });
      this.drawFace(ctx, bx, by, face, c.napping);
      this.drawHat(ctx, bx, by, face);
      this.drawClaws(ctx, bx, by, face);
      if (this.anim.eyeIcon > 0) drawSprite(ctx, EYE_ICON, bx + 4, by - 9);
      const browsing = (['reading', 'searching', 'researching'].includes(c.activity) || (c.pastime && c.pastime.def.act === 'browse')) && !c.moving;
      if (browsing) drawSprite(ctx, BOOK, face > 0 ? bx + 17 : bx - 7, by + 8 + (Math.floor(t * 2) % 2));
    });
    c.rect = [BX - 4, BY - 8, 16 * S + 8, 17 * S + 8];
    if (c.activity === 'browsing' && !c.moving) {
      const k = Math.floor(t * 2) % 3;
      text(ctx, 'WWW' + '.'.repeat(k), X(bx + 2), Y(by - 8), '#93c5fd');
    }
    if (c.thought && c.pose !== 'bed') {
      const txt = c.thought.dots ? '.'.repeat(1 + Math.floor(t * 2) % 3) : c.thought.text;
      this.late.push((g) => bubble(g, txt, X(bx + 8), Y(by - 2), { thought: true, bg: '#eef2ff' }));
    } else if (c.bubble) {
      const txt = c.bubble.text;
      this.late.push((g) => bubble(g, txt, X(bx + 8), Y(by - 2), { bg: '#ffffff' }));
    } else if (c.moodBadge) {
      const b = c.moodBadge;
      this.late.push((g) => { const w = textWidth(b.text) + 4; rect(g, X(bx + 8) - w / 2, Y(by - 9), w, 7, '#0b0d1a'); textCentered(g, b.text, X(bx + 8), Y(by - 8), b.color); });
    }
    if (c.happy > 0 && Math.floor(t * 3) !== Math.floor((t - 0.03) * 3)) this.fx.heart(X(bx + randInt(0, 12)), Y(by - 4));
  }

  // Inside scaled(): draw something at 1x (coordinates pre-multiplied by CLAWD_SCALE).
  unscaled(ctx, fn) { ctx.save(); ctx.scale(1 / CLAWD_SCALE, 1 / CLAWD_SCALE); fn(); ctx.restore(); }

  // Run fn with the canvas scaled so that 1x sprite-space coordinates around (bx, by) land CLAWD_SCALE times bigger at (BX, BY).
  scaled(ctx, bx, by, BX, BY, fn) {
    ctx.save();
    ctx.translate(BX - CLAWD_SCALE * bx, BY - CLAWD_SCALE * by);
    ctx.scale(CLAWD_SCALE, CLAWD_SCALE);
    fn();
    ctx.restore();
  }

  drawHat(ctx, bx, by, face) {
    const c = this.clawd;
    const name = c.headphones ? 'headphones' : c.hat;
    if (!name || !HATS[name]) return;
    const h = HATS[name];
    drawSprite(ctx, h, bx + h.dx, by + h.dy, { flip: face < 0 && name === 'cap' });
  }

  // Eyes, brows and mouth, per mood.
  drawFace(ctx, bx, by, face, closed) {
    const c = this.clawd;
    const mood = this.mood();
    const t = this.t;
    const D = '#4c2bb0', K = '#1e1b4b', W = '#ffffff';
    const ex = [bx + 4, bx + 10];
    if (!closed) {
      const kind = { focused: 'flat', worried: 'worried', sad: 'worried', angry: 'angry', excited: 'raised', surprised: 'raised', alert: 'raised' }[mood];
      if (kind === 'flat') { rect(ctx, bx + 3, by + 4, 3, 1, D); rect(ctx, bx + 10, by + 4, 3, 1, D); }
      if (kind === 'worried') { px(ctx, bx + 3, by + 5, D); px(ctx, bx + 4, by + 5, D); px(ctx, bx + 5, by + 4, D); px(ctx, bx + 10, by + 4, D); px(ctx, bx + 11, by + 5, D); px(ctx, bx + 12, by + 5, D); }
      if (kind === 'angry') { px(ctx, bx + 3, by + 4, D); px(ctx, bx + 4, by + 5, D); px(ctx, bx + 5, by + 5, D); px(ctx, bx + 10, by + 5, D); px(ctx, bx + 11, by + 5, D); px(ctx, bx + 12, by + 4, D); }
      if (kind === 'raised') { rect(ctx, bx + 3, by + 3, 3, 1, D); rect(ctx, bx + 10, by + 3, 3, 1, D); }
    }
    const wide = c.eyesWide > 0 || mood === 'excited' || mood === 'surprised' || mood === 'alert';
    const narrow = mood === 'bored' || mood === 'sleepy' || mood === 'angry';
    if (closed || c.blink > 0) {
      for (const x of ex) rect(ctx, x, by + 7, 2, 1, D);
    } else if (c.happy > 0) {
      for (const x of ex) { px(ctx, x, by + 7, D); px(ctx, x + 1, by + 6, D); px(ctx, x + 2, by + 7, D); }
    } else if (wide) {
      for (const [i, x] of ex.entries()) {
        rect(ctx, x - 1, by + 5, 3, 3, W);
        px(ctx, x + (face > 0 ? 1 : -1), by + 6, K);
        if (i === 1 && mood !== 'alert') px(ctx, x + 1, by + 5, '#22d3ee');
      }
    } else if (narrow) {
      for (const x of ex) {
        rect(ctx, x, by + 7, 2, 1, W);
        px(ctx, x + (face > 0 ? 1 : 0), by + 7, K);
        if (mood !== 'angry') rect(ctx, x, by + 6, 2, 1, D);
      }
    } else {
      const side = c.glance > 0 ? (face > 0 ? 0 : 1) : (face > 0 ? 1 : 0);
      const row = c.lookUp > 0 ? 6 : 7;
      for (const x of ex) { rect(ctx, x, by + 6, 2, 2, W); px(ctx, x + side, by + row, K); }
    }
    const m = by + 9;
    switch (closed ? 'sleepy' : mood) {
      case 'happy': px(ctx, bx + 5, m - 1, D); rect(ctx, bx + 6, m, 4, 1, D); px(ctx, bx + 10, m - 1, D); break;
      case 'excited': rect(ctx, bx + 6, m - 1, 4, 3, K); rect(ctx, bx + 7, m + 1, 2, 1, '#f472b6'); break;
      case 'surprised': rect(ctx, bx + 7, m - 1, 2, 2, K); break;
      case 'worried': case 'sad': case 'angry': px(ctx, bx + 5, m + 1, D); rect(ctx, bx + 6, m, 4, 1, D); px(ctx, bx + 10, m + 1, D); break;
      case 'bored': rect(ctx, bx + 6, m, 3, 1, D); break;
      case 'sleepy': rect(ctx, bx + 7, m, 2, 1, D); break;
      default: rect(ctx, bx + 6, m, 4, 1, D); break;
    }
    if (closed) return;
    if (mood === 'angry') { const ax = face > 0 ? bx + 14 : bx + 1; px(ctx, ax, by + 1, '#ef4444'); px(ctx, ax - 1, by + 2, '#ef4444'); px(ctx, ax + 1, by + 2, '#ef4444'); px(ctx, ax, by + 3, '#ef4444'); }
    if (mood === 'worried' && Math.floor(t * 2) % 3 === 0) px(ctx, face > 0 ? bx + 13 : bx + 2, by + 4 + (Math.floor(t * 6) % 3), '#7dd3fc');
    if (mood === 'sad' && Math.floor(t) % 2 === 0) px(ctx, face > 0 ? bx + 11 : bx + 4, by + 8 + (Math.floor(t * 4) % 2), '#7dd3fc');
    if (mood === 'excited' && Math.floor(t * 5) % 2 === 0) { px(ctx, bx - 1, by + 1, '#fde047'); px(ctx, bx + 16, by + 3, '#fde047'); }
    if (mood === 'bored' && Math.floor(t / 4) % 3 === 0 && Math.floor(t * 2) % 2 === 0) text(ctx, '...', bx + 14, by - 2, '#94a3b8');
  }

  drawClaws(ctx, bx, by, face) {
    const c = this.clawd;
    const t = this.t;
    const a = this.anim;
    const left = (x, y) => drawSprite(ctx, CLAW, x, y, { flip: true });
    const right = (x, y) => drawSprite(ctx, CLAW, x, y);
    const fwd = (x, y) => (face > 0 ? right(bx + 15 + x, by + y) : left(bx - 2 - x, by + y)); // the claw on the side he faces
    const back = (x, y) => (face > 0 ? left(bx - 2 - x, by + y) : right(bx + 15 + x, by + y));
    if (c.climbing) {
      const k = Math.floor(c.walkT * 6) % 2;
      left(bx - 2, by + 2 + k * 3); right(bx + 15, by + 5 - k * 3);
      if (a.canInHand) drawSprite(ctx, WATERING_CAN, bx + 17, by + 9);
      return;
    }
    if (c.moving) {
      const k = Math.floor(c.walkT * 7) % 2;
      left(bx - 2, by + 9 + k); right(bx + 15, by + 10 - k);
      if (a.canInHand) drawSprite(ctx, WATERING_CAN, face > 0 ? bx + 17 : bx - 9, by + 9, { flip: face < 0 });
      if (a.broomInHand) this.unscaled(ctx, () => drawBroom(ctx, (face > 0 ? bx + 20 : bx - 4) * CLAWD_SCALE, (by - 10) * CLAWD_SCALE, face > 0 ? 1 : -1));
      return;
    }
    if (c.watering && c.pastime && c.pastime.def.act === 'feed') { fwd(1, 6 + (Math.floor(t * 3) % 2)); back(0, 10); return; }
    if (c.watering) {
      const k = Math.floor(t * 3) % 2;
      fwd(1, 5 + k); back(0, 10);
      drawSprite(ctx, WATERING_CAN, face > 0 ? bx + 19 : bx - 11, by + 3 + k, { flip: face < 0 });
      return;
    }
    if (a.broomInHand) { fwd(0, 8); fwd(2, 12); this.unscaled(ctx, () => drawBroom(ctx, (face > 0 ? bx + 20 : bx - 4) * CLAWD_SCALE, (by - 10) * CLAWD_SCALE, face > 0 ? 1 : -1)); return; }
    if (c.stretch > 0) { left(bx - 2, by + 1); right(bx + 15, by + 1); return; }
    if (c.dance > 0) { const k = Math.floor(t * 6) % 2; left(bx - 2, by + (k ? 2 : 10)); right(bx + 15, by + (k ? 10 : 2)); return; }
    if (c.petting) { fwd(1, 13 + (Math.floor(t * 4) % 2)); back(0, 10); return; }
    if (c.punching > 0) { fwd(6, 9); back(0, 11); return; }
    if (c.pastime && c.pastime.def.act === 'punch') { const k = Math.floor(t * 4) % 2; fwd(1, 8 + k); fwd(0, 12 - k); return; }
    if (c.guitar) { drawSprite(ctx, MINI_GUITAR, face > 0 ? bx + 9 : bx - 2, by + 6, { flip: face < 0 }); fwd(-2, 7 + (Math.floor(t * 4) % 2)); back(-1, 11); return; }
    if (c.phone) { drawSprite(ctx, PHONE, face > 0 ? bx + 14 : bx - 2, by + 4); fwd(-2, 6); back(0, 10); return; }
    if (c.drawing) { const k = Math.floor(t * 3) % 2; fwd(2, 1 + k); back(0, 10); return; }
    if (c.tidying) { const k = Math.floor(t * 5) % 2; fwd(2, 6 + k * 3); fwd(0, 11 - k * 2); return; }
    if (a.typing || (c.activity === 'remote' && !c.moving) || c.pose === 'chair' || c.pose === 'beanbag') {
      const k = (c.pose === 'chair' && !a.typing && c.activity !== 'remote') || (c.pose === 'beanbag' && !a.retroOn) ? 0 : Math.floor(t * 8) % 2;
      const fx = face > 0 ? bx + 16 : bx - 3;
      if (face > 0) { right(fx, by + 10 + k); right(fx + 3, by + 11 - k); } else { left(fx, by + 10 + k); left(fx - 3, by + 11 - k); }
      return;
    }
    const busyHands = ['reading', 'searching', 'researching', 'writing', 'tinkering', 'deploying'].includes(c.activity) || (c.pastime && ['browse', 'check', 'radio', 'rummage', 'hat', 'scope'].includes(c.pastime.def.act));
    if (busyHands) { const k = Math.floor(t * 3) % 2; fwd(0, 8 + k); fwd(0, 12 - k); return; }
    if (c.activity === 'delegating') { const k = Math.floor(t * 4) % 2; left(bx - 2, by + 10); right(bx + 15, by + 2 - k * 2); return; }
    if (c.pose === 'hammock') { left(bx - 3, by + 12); right(bx + 16, by + 12); return; }
    if (this.mood() === 'angry') { left(bx - 1, by + 11); right(bx + 14, by + 11); return; }
    if (c.lookUp > 0 && c.pose === 'stand') { left(bx - 2, by + 11); right(bx + 15, by + 11); return; }
    left(bx - 2, by + 10); right(bx + 15, by + 10);
  }
}
