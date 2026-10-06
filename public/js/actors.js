// The living things: Clawd, the watchdog, Chirpa, the helper bots, the crew bus, envelopes,
// planes and clouds. Also the `anim` flags the scene reads (typing, TV mode, flashes...).

import { L, SPOTS, stairY, roomAt } from './scene.js';
import { CLAWD_BODY, CLAWD_WALK_A, CLAWD_WALK_B, CLAWD_SIT, CLAW, DOG_STAND, DOG_SIT, DOG_SLEEP, DOG_BARK, BIRD, BIRD_SING, BOT, BOT_WALK, BOOK, ENVELOPE, EYE_ICON, CREW } from './sprites.js';
import { drawSprite, rect, px, disc, text, textCentered, bubble, rand, randInt, pick, chance, clamp, lerp, box, outline } from './util.js';

const WALK_SPEED = 34;
const TERM_LINES = ['$ ssh wormer', '$ df -h /mnt', '$ htop', '$ ./fan-adjust.sh', '$ docker ps', '$ tail -f gw.log', '$ git pull', '$ systemctl restart frigate', '$ journalctl -f', '$ ping 1.1.1.1', '$ uptime', '$ cat memory.md', 'ok', 'done.', 'restarting', 'nice.'];

export const PHRASES = {
  idle: 'pottering about',
  sleeping: 'asleep, consolidating memory',
  terminal: 'at the terminal',
  watching: 'watching the yard',
  remote: 'reaching out over SSH',
  reading: 'reading his memory',
  tinkering: 'tinkering at the workbench',
  browsing: 'out on the internet',
  delegating: 'sending helpers out',
  writing: 'writing the diary',
  speaking: 'talking',
  looking: 'looking at something',
  thinking: 'thinking',
};

function feetY(floor) { return L.feet[floor] ?? L.feet.lower; }

function planPath(from, to) {
  const pts = [];
  let cur = { ...from };
  if (cur.floor === to.floor) return [to];
  if (cur.floor === 'upper') {
    pts.push({ x: L.stairs.x + L.stairs.w + 2, floor: 'upper' }, { x: L.stairs.x, floor: 'lower', stairs: true });
    cur = { x: L.stairs.x, floor: 'lower' };
  } else if (cur.floor === 'outside') {
    if (cur.x > 400) pts.push({ x: 462, floor: 'outside' }, { x: 454, floor: 'lower' });
    else pts.push({ x: 64, floor: 'outside' }, { x: 80, floor: 'lower' });
    cur = { x: cur.x > 400 ? 454 : 80, floor: 'lower' };
  }
  if (to.floor === 'lower') pts.push(to);
  else if (to.floor === 'upper') pts.push({ x: L.stairs.x, floor: 'lower' }, { x: L.stairs.x + L.stairs.w + 2, floor: 'upper', stairs: true }, to);
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
      typing: false, laptopOpen: false, laptopText: '', tvMode: 'cams', monitorMode: 'stats', termLines: [],
      camFlash: 0, camLabel: '', camHit: -1, clockShake: 0, photoFlash: 0, photoFlashIndex: 0, photoSeed: 3,
      bookOut: 0, journalGlow: 0, lampOn: false, solarPulse: 0, speaking: 0, tinkering: false, radioPing: 0,
    };
    this.clawd = {
      x: SPOTS.idle.x, floor: 'lower', y: feetY('lower'), face: 1, path: [], moving: false, pose: 'stand',
      activity: null, arrived: true, walkT: 0, blink: 0, nextBlink: 3, wanderT: 6, eyesWide: 0, bubble: null, thought: null,
      lastStatus: '', termT: 0, actionT: 0, happy: 0, alert: 0,
    };
    this.dog = { state: 'sleep', barkT: 0, alertT: 0, zT: 3, frame: 0 };
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
    switch (ev.type) {
      case 'bird': this.bird.singT = 4.5; this.fx.label(L.perch.x + 2, L.perch.y - 22, String(ev.species || 'bird').toUpperCase(), { life: 6, rise: 3, bg: '#1e3a8a' }); break;
      case 'bark': this.dog.state = 'bark'; this.dog.barkT = 6; this.dog.reason = ev.reason || ''; if (c.pose === 'bed') c.alert = 3; break;
      case 'telegram': this.envelopes.push({ t: 0, from: ev.from || 'you' }); this.dog.alertT = 5; this.say(`DM FROM ${String(ev.from || 'you').toUpperCase()}`, 6); if ((ev.from || 'you') === 'you') c.happy = 2.5; break;
      case 'bus': this.spawnBus(ev); break;
      case 'cam': {
        this.anim.camFlash = 1.5; this.anim.camLabel = String(ev.label || 'motion'); this.anim.camT = 6;
        const names = this.store.state.cams.names || [];
        this.anim.camHit = Math.max(0, names.indexOf(ev.camera));
        this.anim.tvForce = 8; this.anim.tvMode = 'cams';
        c.eyesWide = 2.5;
        this.say(`${String(ev.label || 'motion').toUpperCase()} AT ${String(ev.camera || 'cam').toUpperCase()}`, 5);
        break;
      }
      case 'photo': this.anim.photoFlash = 1.4; this.anim.photoFlashIndex = randInt(0, 5); this.anim.photoSeed += 1; break;
      case 'plane': this.planes.push({ x: 492, y: randInt(18, 42), dir: -1, label: ev.callsign ? String(ev.callsign).toUpperCase() : '', speed: rand(18, 26) }); break;
      case 'sensor': this.anim.radioPing = 3; this.fx.label(L.radio.x + 11, L.radio.y - 20, (ev.name ? String(ev.name) : '433MHZ').toUpperCase().slice(0, 12), { life: 4, rise: 2, bg: '#14532d' }); break;
      case 'cron': this.anim.clockShake = 2; this.fx.label(L.clock.cx, L.clock.cy - 20, String(ev.name || 'cron').toUpperCase(), { life: 5, rise: 2, bg: '#7f1d1d' }); break;
      case 'subagent': if (ev.action === 'done') this.bots.walkers.push({ x: 500, dir: -1, dock: this.bots.walkers.length % 3, t: 0 }); else this.bots.walkers.push({ x: L.botDock.x + 10, dir: 1, t: 0 }); break;
      case 'say': this.say(String(ev.text || ''), 8); this.anim.speaking = 3.5; break;
      case 'look': c.eyesWide = 3; this.anim.eyeIcon = 2.5; break;
      case 'dream': c.thought = { text: String(ev.text || ''), t: 12 }; break;
      case 'diary': this.anim.journalGlow = 5; this.fx.spark(L.nightstand.x + 6, L.nightstand.y - 6); this.say('DIARY DONE', 4); break;
      case 'solar': this.anim.solarPulse = 3; this.fx.label(L.battery.x + 9, L.battery.y - 20, String(ev.note || 'ESS').toUpperCase().slice(0, 12), { life: 4, rise: 2, bg: '#78350f' }); break;
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
    while (this.clouds.length < n) this.clouds.push({ x: rand(-20, 480), y: rand(14, 56), v: rand(1.5, 4) });
    while (this.clouds.length > n) this.clouds.pop();
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
    for (const k of ['camFlash', 'camT', 'clockShake', 'photoFlash', 'bookOut', 'journalGlow', 'solarPulse', 'speaking', 'radioPing', 'tvForce', 'eyeIcon']) if (a[k] > 0) a[k] = Math.max(0, a[k] - dt);
    if (a.camT <= 0) { a.camLabel = ''; a.camHit = -1; }
    if (a.speaking > 0 && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this.fx.wave(L.speaker.x + 11, L.speaker.y + 5, '#a5f3fc', 1);
    // chimney smoke scales with CPU
    const cpu = Number(s.system.cpu || 0);
    this.smokeT -= dt;
    if (cpu > 15 && this.smokeT <= 0) { this.fx.smoke(L.chimney.x + 6, L.chimney.y - 2, 0.6 + cpu / 100); this.smokeT = 2.2 - cpu / 70; }
  }

  updateClawd(dt, s) {
    const c = this.clawd;
    const act = this.store.effectiveActivity();
    if (act !== c.activity) this.setActivity(act, s);
    // movement
    if (c.path.length) {
      const wp = c.path[0];
      const dx = wp.x - c.x;
      const step = WALK_SPEED * dt;
      if (Math.abs(dx) <= step) {
        c.x = wp.x; c.floor = wp.floor; c.y = feetY(wp.floor); c.path.shift();
      } else {
        c.x += Math.sign(dx) * step;
        c.face = Math.sign(dx) || c.face;
        if (wp.stairs) c.y = stairY(c.x);
        else if (wp.floor !== c.floor) {
          // short step between inside (300) and outside (304)
          const from = feetY(c.floor), to = feetY(wp.floor);
          const k = clamp(1 - Math.abs(dx) / 8, 0, 1);
          c.y = lerp(from, to, k);
        } else c.y = feetY(c.floor);
      }
      c.moving = true;
      c.walkT += dt;
      if (!c.path.length) { c.moving = false; c.arrived = true; this.onArrive(act); }
    } else c.moving = false;

    // blink
    c.nextBlink -= dt;
    if (c.nextBlink <= 0) { c.blink = 0.14; c.nextBlink = rand(2.5, 6); }
    if (c.blink > 0) c.blink -= dt;
    if (c.eyesWide > 0) c.eyesWide -= dt;
    if (c.happy > 0) c.happy -= dt;
    if (c.alert > 0) c.alert -= dt;
    if (c.bubble) { c.bubble.t -= dt; if (c.bubble.t <= 0) c.bubble = null; }
    if (c.thought) { c.thought.t -= dt; if (c.thought.t <= 0) c.thought = null; }

    // activity behaviours while arrived
    const a = this.anim;
    a.typing = false; a.tinkering = false;
    if (c.arrived && !c.moving) {
      c.actionT += dt;
      switch (act) {
        case 'idle':
          c.wanderT -= dt;
          if (c.wanderT <= 0) { c.wanderT = rand(5, 11); const [x1, x2] = SPOTS.idle.wander; this.walkTo(randInt(x1, x2), 'lower'); c.arrived = false; }
          break;
        case 'terminal':
          a.typing = true;
          c.termT -= dt;
          if (c.termT <= 0) { c.termT = rand(1, 2.4); a.termLines = [...a.termLines, pick(TERM_LINES)].slice(-8); }
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
        case 'reading':
          a.bookOut = 1;
          break;
        case 'thinking':
          if (!c.thought || c.thought.t < 0.2) c.thought = { text: '...', t: 2, dots: true };
          break;
        default: break;
      }
    }
    a.lampOn = (act === 'writing' || act === 'reading') && this.store.dayFactor() < 0.6;
    a.laptopOpen = act === 'remote';
    if (a.laptopOpen) { const st = String(s.clawd.status || '').toLowerCase(); a.laptopText = st.includes('telegram') || st.includes('reply') ? 'TG' : st.includes('ssh') ? 'SSH' : 'NET'; }
    a.monitorMode = act === 'terminal' ? 'terminal' : act === 'sleeping' ? 'off' : 'stats';
    // TV channel
    this.tvT += dt;
    if (a.tvForce > 0) a.tvMode = 'cams';
    else if (act === 'watching') { a.tvMode = (this.tvT % 16) < 10 ? 'cams' : 'dash'; }
    else a.tvMode = 'cams';
  }

  setActivity(act, s) {
    const c = this.clawd;
    const prev = c.activity;
    c.activity = act;
    c.actionT = 0;
    this.anim.bookOut = 0;
    if (prev === 'terminal') this.anim.termLines = [];
    const spot = SPOTS[act];
    if (!spot) {
      // speaking / looking / thinking happen wherever he is; if he's in bed, get up to the living room
      if (c.pose === 'bed') { this.walkTo(SPOTS.idle.x, 'lower'); c.pose = 'stand'; }
      c.arrived = true;
      return;
    }
    c.pose = 'stand';
    this.walkTo(spot.x, spot.floor);
    if (spot.wander && c.floor === 'lower' && Math.abs(c.x - spot.x) < 40) { c.path = []; c.arrived = true; }
    c.wanderT = rand(3, 7);
  }

  walkTo(x, floor) {
    const c = this.clawd;
    let from = { x: c.x, floor: c.floor };
    if (c.pose === 'bed') { c.x = L.bed.x + 60; c.floor = 'upper'; c.y = feetY('upper'); from = { x: c.x, floor: 'upper' }; }
    c.pose = 'stand';
    c.path = planPath(from, { x, floor });
    c.arrived = false;
    if (c.path.length === 1 && Math.abs(c.path[0].x - c.x) < 1 && c.path[0].floor === c.floor) { c.path = []; c.arrived = true; this.onArrive(c.activity); }
  }

  onArrive(act) {
    const c = this.clawd;
    const spot = SPOTS[act];
    if (!spot) return;
    c.face = spot.face || c.face;
    if (spot.bed) c.pose = 'bed';
    else if (spot.sit) c.pose = spot.sit === 'couch' ? 'couch' : 'chair';
    else c.pose = 'stand';
  }

  updateDog(dt, s) {
    const d = this.dog;
    const wd = s.watchdog?.state || 'ok';
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
    for (const c of this.clouds) { c.x += c.v * dt; if (c.x > 500) { c.x = -30; c.y = rand(14, 56); } }
    if (this.clouds.length !== (s.weather?.condition === 'rain' ? 7 : s.weather?.condition === 'cloudy' ? 5 : 3)) this.reseedClouds();
    for (const p of this.planes) p.x += p.dir * p.speed * dt;
    this.planes = this.planes.filter((p) => p.x > -30 && p.x < 520);
    this.nextPlane -= dt;
    if (this.nextPlane <= 0) {
      this.nextPlane = rand(20, 45);
      if (Number(s.sdr?.planes || 0) > 0 && this.planes.length < 3) {
        const lp = s.sdr.last_plane;
        this.planes.push({ x: 492, y: randInt(18, 42), dir: -1, label: lp && chance(0.5) ? String(lp.callsign || '').toUpperCase() : '', speed: rand(16, 24) });
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
    const x = L.dogBed.x - 1;
    if (d.state === 'sleep') drawSprite(ctx, DOG_SLEEP, x, L.feet.lower - 7);
    else if (d.state === 'sit') drawSprite(ctx, DOG_SIT, x, L.feet.lower - 11);
    else {
      const sp = Math.floor(this.t * 6) % 2 === 0 ? DOG_BARK : DOG_STAND;
      drawSprite(ctx, sp, x, L.feet.lower - 11);
      if (d.reason) this.late.push((g) => bubble(g, `WOOF! ${d.reason}`, x + 8, L.feet.lower - 12, { bg: '#fef3c7', color: '#7c2d12' }));
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
    // van body
    rect(ctx, x, y + 2, 56, 14, '#f59e0b'); rect(ctx, x + 2, y, 52, 3, '#fbbf24');
    rect(ctx, x, y + 12, 56, 4, '#b45309');
    outline(ctx, x, y + 2, 56, 14, '#1a1216');
    for (let i = 0; i < 4; i++) box(ctx, x + 4 + i * 12, y + 4, 9, 6, '#bae6fd', '#1a1216');
    rect(ctx, x + 50, y + 6, 6, 4, '#bae6fd'); // windscreen
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
      bx = L.bed.x + 14; by = L.bed.y + 5;
      body = CLAWD_SIT;
      drawSprite(ctx, body, bx, by);
      this.drawEyes(ctx, bx, by, 1, true);
      // blanket over him
      rect(ctx, L.bed.x + 22, L.bed.y + 18, L.bed.w - 22, 11, '#2563eb');
      for (let x = L.bed.x + 24; x < L.bed.x + L.bed.w - 2; x += 6) rect(ctx, x, L.bed.y + 20, 3, 1, '#60a5fa');
      rect(ctx, L.bed.x + 22, L.bed.y + 18, L.bed.w - 22, 1, '#93c5fd');
      drawSprite(ctx, CLAW, bx - 2, by + 9, { flip: true }); drawSprite(ctx, CLAW, bx + 15, by + 9);
      if (c.thought) this.late.push((g) => bubble(g, c.thought.text, bx + 8, by - 2, { thought: true, bg: '#eef2ff' }));
      if (c.alert > 0) this.late.push((g) => text(g, '!', bx + 7, by - 8, '#fbbf24', 2));
      return;
    }
    if (c.pose === 'chair' || c.pose === 'couch') {
      const seat = c.pose === 'chair' ? L.chair.y + 16 : L.couch.seatY;
      bx = Math.round(c.x - 8); by = seat - 14;
      body = CLAWD_SIT;
    } else {
      bx = Math.round(c.x - 8); by = Math.round(c.y - 17);
      body = c.moving ? (Math.floor(c.walkT * 7) % 2 ? CLAWD_WALK_A : CLAWD_WALK_B) : CLAWD_BODY;
    }
    // shadow
    rect(ctx, bx + 3, (c.pose === 'stand' ? Math.round(c.y) : by + 14) - 0, 10, 1, 'rgba(0,0,0,0.25)');
    drawSprite(ctx, body, bx, by, { flip: face < 0 });
    this.drawEyes(ctx, bx, by, face, false);
    this.drawClaws(ctx, bx, by, face);
    // extras above the head
    if (this.anim.eyeIcon > 0) drawSprite(ctx, EYE_ICON, bx + 4, by - 9);
    if (c.activity === 'browsing' && !c.moving) {
      const k = Math.floor(t * 2) % 3;
      text(ctx, 'WWW' + '.'.repeat(k), bx + 2, by - 8, '#93c5fd');
    }
    if (c.activity === 'reading' && !c.moving) drawSprite(ctx, BOOK, face > 0 ? bx + 17 : bx - 7, by + 8 + (Math.floor(t * 2) % 2));
    if (c.thought && c.pose !== 'bed') {
      const txt = c.thought.dots ? '.'.repeat(1 + Math.floor(t * 2) % 3) : c.thought.text;
      this.late.push((g) => bubble(g, txt, bx + 8, by - 2, { thought: true, bg: '#eef2ff' }));
    } else if (c.bubble) {
      const txt = c.bubble.text;
      this.late.push((g) => bubble(g, txt, bx + 8, by - 2, { bg: '#ffffff' }));
    }
    if (c.happy > 0 && Math.floor(t * 3) !== Math.floor((t - 0.03) * 3)) this.fx.heart(bx + randInt(0, 12), by - 4);
  }

  drawEyes(ctx, bx, by, face, closed) {
    const c = this.clawd;
    const ex = [bx + 4, bx + 10];
    if (closed || c.blink > 0) {
      for (const x of ex) rect(ctx, x, by + 7, 2, 1, '#4c2bb0');
      return;
    }
    if (c.eyesWide > 0) {
      for (const [i, x] of ex.entries()) {
        rect(ctx, x - 1, by + 5, 3, 3, '#ffffff');
        px(ctx, x + (face > 0 ? 1 : -1) + 0, by + 6, '#1e1b4b');
        if (i === 1) px(ctx, x + 1, by + 5, '#22d3ee');
      }
      return;
    }
    for (const x of ex) {
      rect(ctx, x, by + 6, 2, 2, '#ffffff');
      px(ctx, x + (face > 0 ? 1 : 0), by + 7, '#1e1b4b');
    }
    if (c.happy > 0) for (const x of ex) { px(ctx, x, by + 6, '#4c2bb0'); px(ctx, x + 1, by + 6, '#4c2bb0'); }
  }

  drawClaws(ctx, bx, by, face) {
    const c = this.clawd;
    const t = this.t;
    const a = this.anim;
    const left = (x, y) => drawSprite(ctx, CLAW, x, y, { flip: true });
    const right = (x, y) => drawSprite(ctx, CLAW, x, y);
    if (a.typing || c.activity === 'remote' && !c.moving) {
      const k = Math.floor(t * 8) % 2;
      const fx = face > 0 ? bx + 16 : bx - 3;
      if (face > 0) { right(fx, by + 10 + k); right(fx + 3, by + 11 - k); } else { left(fx, by + 10 + k); left(fx - 3, by + 11 - k); }
      return;
    }
    if ((c.activity === 'reading' || c.activity === 'writing' || c.activity === 'tinkering') && !c.moving) {
      const k = Math.floor(t * 3) % 2;
      if (face > 0) { right(bx + 15, by + 8 + k); right(bx + 15, by + 12 - k); } else { left(bx - 2, by + 8 + k); left(bx - 2, by + 12 - k); }
      return;
    }
    if (c.moving) {
      const k = Math.floor(c.walkT * 7) % 2;
      left(bx - 2, by + 9 + k); right(bx + 15, by + 10 - k);
      return;
    }
    if (c.activity === 'delegating' && !c.moving) {
      // waving the bots off
      const k = Math.floor(t * 4) % 2;
      left(bx - 2, by + 10); right(bx + 15, by + 2 - k * 2);
      return;
    }
    left(bx - 2, by + 10); right(bx + 15, by + 10);
  }
}
