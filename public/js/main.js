// Boot: size the canvas to the screen (integer pixel scale), connect, run the loop, handle taps.

import { W, H, drawSky, drawGround, drawTree, drawMailbox, drawSignpost, drawFrontDoor, drawHouseShell, drawStairs, drawBedroom, drawLibrary, drawLivingRoom, drawOffice, drawGarage, drawLighting, hitTest } from './scene.js';
import { Store } from './state.js';
import { connect } from './net.js';
import { Effects } from './effects.js';
import { Actors } from './actors.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });

const store = new Store();
const effects = new Effects();
const actors = new Actors(store, effects);
const hud = new Hud(store, actors);

if (params.has('hour')) store.hourOverride = Number(params.get('hour'));

// ------------------------------------------------------------------ sizing
let scale = 1;
function resize() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const cssScale = Math.min(vw / W, vh / H);
  scale = Math.max(1, Math.floor(cssScale * dpr));
  canvas.width = W * scale;
  canvas.height = H * scale;
  const cssW = Math.floor(W * cssScale), cssH = Math.floor(H * cssScale);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const sx = Math.floor((vw - cssW) / 2), sy = Math.floor((vh - cssH) / 2);
  stage.style.setProperty('--sx', `${sx}px`);
  stage.style.setProperty('--sy', `${sy}px`);
  stage.style.setProperty('--sw', `${cssW}px`);
  stage.style.setProperty('--sh', `${cssH}px`);
  stage.style.setProperty('--u', `${cssScale}px`); // one logical pixel in CSS px
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
resize();

// ------------------------------------------------------------------ net
const forceDemo = params.get('demo') === '1';
connect(store, { onMode: (m) => hud.setMode(m), demoForced: forceDemo });

// ------------------------------------------------------------------ loop
let last = performance.now();
let hudT = 0;
let frameInterval = 1000 / 30;
let acc = 0;
let running = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - last;
  if (dtMs < frameInterval - 1) return;
  last = now;
  if (!running) return;
  const dt = Math.min(0.1, dtMs / 1000);
  acc += dt;
  actors.update(dt);
  effects.update(dt);
  draw(acc);
  hudT += dt;
  if (hudT >= 1) { hudT = 0; hud.update(); }
}

function draw(t) {
  const s = store.state;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const { day } = drawSky(ctx, store, t, actors.clouds, actors.planes);
  drawGround(ctx, day);
  drawTree(ctx, day, t);
  drawHouseShell(ctx, day, t, s.system.cpu);
  drawStairs(ctx);
  const anim = actors.anim;
  drawBedroom(ctx, store, t, anim);
  drawLibrary(ctx, store, t, anim);
  drawLivingRoom(ctx, store, t, anim);
  drawOffice(ctx, store, t, anim);
  drawGarage(ctx, store, t, anim);
  drawFrontDoor(ctx, actors.clawd.floor === 'outside' && actors.clawd.x < 90);
  drawMailbox(ctx, Number(s.telegram.unread || 0), Number(s.telegram.unread || 0) > 0 || actors.envelopes.length > 0);
  drawSignpost(ctx, s.network.wan !== false, day);
  actors.drawBird(ctx);
  actors.drawDog(ctx);
  actors.drawBots(ctx, s);
  actors.drawClawd(ctx);
  actors.drawEnvelopes(ctx);
  const sleeping = store.effectiveActivity() === 'sleeping';
  drawLighting(ctx, store, t, actors.clawdRoom(), Number(s.subagents.active || 0) > 0, sleeping);
  if ((s.weather?.condition || '') === 'rain') effects.rain(ctx, 1, t);
  // particles, labels, speech bubbles and the bus sit above the lighting so they stay bright at night
  effects.draw(ctx);
  actors.drawBus(ctx);
  actors.drawLate(ctx);
}
requestAnimationFrame(frame);
hud.update();

// ------------------------------------------------------------------ taps
function canvasPoint(ev) {
  const r = canvas.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width * W;
  const y = (ev.clientY - r.top) / r.height * H;
  return { x, y };
}
canvas.addEventListener('pointerdown', (ev) => {
  const { x, y } = canvasPoint(ev);
  const item = hitTest(x, y);
  if (item) hud.showInfo(item); else hud.hideInfo();
});
document.getElementById('info').addEventListener('pointerdown', () => hud.hideInfo());

// ------------------------------------------------------------------ housekeeping
document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); });

// Reload once a day (or whatever settings.reload_hours says) so a 24/7 tab never gets stale.
setInterval(() => {
  const hours = Number(store.state.settings?.reload_hours ?? 24);
  if (hours > 0 && performance.now() > hours * 3600 * 1000) location.reload();
}, 60000);

// Expose for poking around from the console.
window.room = { store, actors, effects, hud };
