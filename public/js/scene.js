// The house: layout constants, static furniture, sky, lighting, and the item registry.
// Everything is drawn in a 480x360 logical pixel space. Actors (Clawd, dog, bird, bots) live in actors.js.

import { rect, box, outline, hline, vline, disc, px, line, text, textCentered, mix, lerp, clamp, drawSprite, makeCanvas } from './util.js';
import { BOOK, PLANE, CREW } from './sprites.js';
import { fmtAgo, fmtUptime, fmtDuration } from './util.js';

export const W = 480;
export const H = 360;

export const L = {
  groundY: 300,
  road: { y: 304, h: 18 },
  feet: { upper: 190, lower: 300, outside: 304 },
  house: { x: 70, w: 320 },
  roof: { eaveY: 100, ridgeY: 68, ridgeX1: 120, ridgeX2: 340, eaveX1: 62, eaveX2: 398 },
  rooms: {
    bedroom: { x: 72, y: 102, w: 156, h: 88, floor: 'upper' },
    library: { x: 232, y: 102, w: 156, h: 88, floor: 'upper' },
    living: { x: 72, y: 196, w: 156, h: 104, floor: 'lower' },
    office: { x: 232, y: 196, w: 156, h: 104, floor: 'lower' },
    garage: { x: 390, y: 198, w: 70, h: 102, floor: 'lower' },
  },
  stairs: { x: 234, w: 52, bottomY: 300, topY: 190, steps: 13 },
  frontDoor: { x: 72, y: 270, w: 12, h: 30 },
  garageDoor: { x: 458, y: 268, w: 4, h: 32 },
  mailbox: { x: 8, y: 270 },
  tree: { x: 34, canopyY: 240, r: 17 },
  perch: { x: 42, y: 252 },
  dogBed: { x: 262, y: 292, w: 22, h: 8 },
  window: { x: 80, y: 210, w: 32, h: 30 },
  radio: { x: 122, y: 206, w: 22, h: 10, shelfY: 216 },
  tv: { x: 118, y: 244, w: 48, h: 36 },
  tvStand: { x: 118, y: 282, w: 48, h: 18 },
  couch: { x: 176, y: 268, w: 50, h: 32, seatY: 282 },
  crewPhoto: { x: 180, y: 212, w: 44, h: 26 },
  bed: { x: 80, y: 152, w: 72 },
  nightstand: { x: 156, y: 172, w: 18, h: 18 },
  clock: { cx: 202, cy: 124, r: 9 },
  bedWindow: { x: 186, y: 142, w: 28, h: 24 },
  photoWall: { x: 240, y: 112, cols: 3, rows: 2, fw: 12, fh: 10, gap: 4 },
  bookshelf: { x: 296, y: 118, w: 42, h: 72, shelves: 5 },
  cabinet: { x: 344, y: 150, w: 18, h: 40 },
  plant: { x: 368, y: 166 },
  chair: { x: 292, y: 268 },
  desk: { x: 306, y: 272, w: 62, h: 28 },
  monitor: { x: 312, y: 240, w: 36, h: 28 },
  keyboard: { x: 310, y: 273, w: 24, h: 3 },
  laptop: { x: 352, y: 264, w: 14, h: 8 },
  cupboard: { x: 370, y: 232, w: 18, h: 68 },
  speaker: { x: 374, y: 220, w: 10, h: 12 },
  thermo: { x: 300, y: 206, h: 26 },
  garageShelf: { x: 394, y: 204, w: 62, h: 30 },
  battery: { x: 396, y: 240, w: 18, h: 34 },
  pegboard: { x: 424, y: 244, w: 32, h: 26 },
  workbench: { x: 424, y: 276, w: 32, h: 24 },
  botDock: { x: 398, y: 290 },
  signpost: { x: 470, y: 268 },
  panels: { x: 132, y: 60, n: 4, w: 22, h: 8, gap: 3 },
  chimney: { x: 300, y: 46, w: 12, h: 24 },
};

// Where Clawd goes for each activity (feet x, floor, facing).
export const SPOTS = {
  idle: { x: 100, floor: 'lower', face: 1, wander: [92, 112] },
  sleeping: { x: 100, floor: 'upper', face: 1, bed: true },
  terminal: { x: 300, floor: 'lower', face: 1, sit: 'chair' },
  remote: { x: 300, floor: 'lower', face: 1, sit: 'chair' },
  watching: { x: 190, floor: 'lower', face: -1, sit: 'couch' },
  reading: { x: 276, floor: 'upper', face: 1 },
  writing: { x: 136, floor: 'upper', face: 1 },
  tinkering: { x: 406, floor: 'lower', face: 1 },
  browsing: { x: 466, floor: 'outside', face: 1 },
  delegating: { x: 402, floor: 'lower', face: 1 },
};

const C = {
  outline: '#1a1216',
  wallBedroom: '#5c4a86', wallBedroomDk: '#4e3d73',
  wallLibrary: '#7a5240', wallLibraryDk: '#684536',
  wallLiving: '#4c6b7c', wallLivingDk: '#3f5a69',
  wallOffice: '#4f5b6e', wallOfficeDk: '#44505f',
  wallGarage: '#55555e', wallGarageDk: '#48484f',
  floorWood: '#8a5a3c', floorWoodDk: '#6e4730', floorWoodLt: '#a06a46',
  floorTile: '#6b7280', floorTileDk: '#5a6170',
  floorGarage: '#3f3f46',
  slab: '#4a2e1f', slabEdge: '#2e1b12',
  roof: '#8b3a2a', roofDk: '#6e2d20', roofLt: '#a5493a',
  brick: '#b8846a', brickDk: '#9a6b54',
  wood: '#9a6b3f', woodDk: '#6b4727', woodLt: '#b8865a',
  metal: '#a3a8b4', metalDk: '#6b7280', metalLt: '#d1d5db',
  screenOff: '#0f172a', screenOn: '#0b2b1a', screenText: '#86efac',
  white: '#f8fafc', cream: '#fef3c7', black: '#0b0b10',
  grass: '#4f8f3a', grassDk: '#3d7030', road: '#2f3038', roadLine: '#d6c35e', dirt: '#2a1b12', dirtDk: '#1b110b',
  glassDay: '#9fd4ff', glassNight: '#16213f',
};

// ----------------------------------------------------------------- sky
let stars = null;
function makeStars() {
  stars = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 70; i++) stars.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 95), p: rnd() * 6.28, b: rnd() });
}

export function skyColors(day) {
  // day: 0 night .. 1 day. Twilight is a warm band around 0.5.
  const tw = 1 - Math.abs(day - 0.5) * 2; // 1 at twilight
  const top = mix(mix('#070a22', '#4aa3ff', day), '#8b5a9e', tw * 0.6);
  const bot = mix(mix('#1b2244', '#c6e8ff', day), '#ff9d6a', tw * 0.75);
  return { top, bot };
}

export function drawSky(ctx, store, t, clouds, planes) {
  const day = store.dayFactor();
  const { top, bot } = skyColors(day);
  // banded gradient (pixel look)
  const bands = 10;
  for (let i = 0; i < bands; i++) {
    rect(ctx, 0, i * 30, W, 30, mix(top, bot, i / (bands - 1)));
  }
  if (!stars) makeStars();
  if (day < 0.6) {
    const a = 1 - day / 0.6;
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 1.5 + s.p);
      if (tw * a > 0.35) px(ctx, s.x, s.y, s.b > 0.7 ? '#ffffff' : '#c7d2fe');
    }
  }
  const { body, t: p } = store.sunProgress();
  const sx = Math.round(14 + p * (W - 28));
  const sy = Math.round(92 - Math.sin(Math.PI * p) * 78);
  if (body === 'sun') {
    disc(ctx, sx, sy, 7, '#ffd84a');
    disc(ctx, sx, sy, 5, '#fff3a0');
    for (let a = 0; a < 6.28; a += 0.785) px(ctx, sx + Math.round(Math.cos(a + t * 0.3) * 10), sy + Math.round(Math.sin(a + t * 0.3) * 10), '#ffe066');
  } else {
    disc(ctx, sx, sy, 6, '#f1f5f9');
    disc(ctx, sx + 3, sy - 2, 5, mix(top, bot, 0.1));
    px(ctx, sx - 2, sy + 1, '#cbd5e1'); px(ctx, sx - 3, sy - 2, '#cbd5e1');
  }
  // clouds
  for (const c of clouds) {
    const col = day > 0.5 ? '#ffffff' : mix('#334155', '#ffffff', day * 1.2);
    const col2 = day > 0.5 ? '#e2e8f0' : mix('#1e293b', '#cbd5e1', day * 1.2);
    disc(ctx, c.x, c.y, 5, col); disc(ctx, c.x + 7, c.y - 2, 6, col); disc(ctx, c.x + 15, c.y, 5, col);
    rect(ctx, c.x - 4, c.y + 1, 24, 4, col); rect(ctx, c.x - 4, c.y + 4, 24, 2, col2);
  }
  for (const p of planes) {
    drawSprite(ctx, PLANE, p.x, p.y, { flip: p.dir < 0 });
    for (let i = 1; i < 6; i++) px(ctx, p.x + (p.dir < 0 ? 12 + i * 3 : -i * 3), p.y + 2, i % 2 ? '#e2e8f0' : '#cbd5e1');
    if (p.label) text(ctx, p.label, p.x - 2, p.y - 7, '#e2e8f0');
  }
  return { sunX: sx, sunY: sy, day };
}

// ----------------------------------------------------------------- ground + outside
export function drawGround(ctx, day) {
  rect(ctx, 0, L.groundY, W, 4, C.grass);
  for (let x = 0; x < W; x += 5) px(ctx, x + (x % 3), L.groundY, C.grassDk);
  rect(ctx, 0, L.road.y, W, L.road.h, C.road);
  for (let x = 4; x < W; x += 16) rect(ctx, x, L.road.y + 9, 8, 1, C.roadLine);
  rect(ctx, 0, L.road.y + L.road.h, W, H - L.road.y - L.road.h, C.dirt);
  for (let x = 3; x < W; x += 11) px(ctx, x, 330 + (x * 7) % 25, C.dirtDk);
  // path from the front door to the road
  rect(ctx, 58, L.groundY, 14, 4, '#b8a98a');
}

export function drawTree(ctx, day, t) {
  const { x, canopyY, r } = L.tree;
  rect(ctx, x - 2, canopyY, 4, L.groundY - canopyY, C.woodDk);
  rect(ctx, x - 1, canopyY, 1, L.groundY - canopyY, C.wood);
  // branch for the bird
  line(ctx, x + 1, 257, L.perch.x + 8, L.perch.y + 1, C.woodDk);
  line(ctx, x + 1, 256, L.perch.x + 8, L.perch.y, C.wood);
  const g1 = day > 0.4 ? '#3f8f3a' : '#2b5a2d', g2 = day > 0.4 ? '#56a84a' : '#36703a';
  disc(ctx, x, canopyY - 2, r, g1);
  disc(ctx, x - 6, canopyY + 2, r - 6, g1);
  disc(ctx, x + 7, canopyY + 3, r - 7, g1);
  disc(ctx, x - 3, canopyY - 6, r - 8, g2);
  disc(ctx, x + 5, canopyY - 3, r - 10, g2);
  const sway = Math.round(Math.sin(t * 0.8) * 1);
  px(ctx, x - 9 + sway, canopyY - 10, g2); px(ctx, x + 10 + sway, canopyY - 7, g2);
}

export function drawMailbox(ctx, unread, flagUp) {
  const { x, y } = L.mailbox;
  rect(ctx, x + 4, y + 8, 2, L.groundY - y - 8, C.woodDk);
  box(ctx, x, y, 12, 8, '#3b82f6', C.outline, '#93c5fd');
  px(ctx, x + 10, y + 4, '#1e3a8a');
  if (flagUp) { rect(ctx, x + 12, y - 2, 1, 8, '#ef4444'); rect(ctx, x + 12, y - 2, 4, 3, '#ef4444'); }
  if (unread > 0) textCentered(ctx, String(Math.min(unread, 99)), x + 6, y - 7, '#fde68a');
}

export function drawSignpost(ctx, wan, day) {
  const { x, y } = L.signpost;
  rect(ctx, x, y + 6, 2, L.groundY - y - 6, C.woodDk);
  box(ctx, x - 7, y, 16, 8, wan ? '#2563eb' : '#7f1d1d', C.outline);
  text(ctx, 'WWW', x - 5, y + 2, wan ? '#fff' : '#fca5a5');
  px(ctx, x + 8, y + 3, '#fff'); px(ctx, x + 9, y + 3, '#fff'); px(ctx, x + 8, y + 2, '#fff'); px(ctx, x + 8, y + 4, '#fff');
  // street lamp
  rect(ctx, x + 6, 262, 1, 38, C.metalDk);
  rect(ctx, x + 4, 260, 5, 3, C.metalDk);
  if (day < 0.5) { rect(ctx, x + 5, 263, 3, 1, '#fde68a'); }
}

export function drawFrontDoor(ctx, open) {
  const d = L.frontDoor;
  box(ctx, d.x, d.y, d.w, d.h, open ? '#1a1216' : C.wood, C.outline, open ? null : C.woodLt, open ? null : C.woodDk);
  if (!open) { px(ctx, d.x + 9, d.y + 16, '#fde68a'); rect(ctx, d.x + 3, d.y + 4, 6, 8, C.woodDk); }
}

// ----------------------------------------------------------------- house shell
export function drawHouseShell(ctx, day, t, cpu) {
  const r = L.rooms;
  // room backgrounds (wallpaper)
  wallpaper(ctx, r.bedroom, C.wallBedroom, C.wallBedroomDk, 'dots');
  wallpaper(ctx, r.library, C.wallLibrary, C.wallLibraryDk, 'stripes');
  wallpaper(ctx, r.living, C.wallLiving, C.wallLivingDk, 'dots');
  wallpaper(ctx, r.office, C.wallOffice, C.wallOfficeDk, 'plain');
  wallpaper(ctx, r.garage, C.wallGarage, C.wallGarageDk, 'blocks');
  // floors
  floorWood(ctx, r.bedroom.x, L.feet.upper - 4, r.bedroom.w, 4);
  floorWood(ctx, r.library.x, L.feet.upper - 4, r.library.w, 4);
  floorWood(ctx, r.living.x, L.feet.lower - 4, r.living.w, 4);
  rect(ctx, r.office.x, L.feet.lower - 4, r.office.w, 4, C.floorTile);
  for (let x = r.office.x; x < r.office.x + r.office.w; x += 6) rect(ctx, x, L.feet.lower - 4, 1, 4, C.floorTileDk);
  rect(ctx, r.garage.x, L.feet.lower - 4, r.garage.w, 4, C.floorGarage);
  // slab between floors (with the stairwell opening)
  rect(ctx, L.house.x, 190, L.house.w, 6, C.slab);
  hline(ctx, L.house.x, L.house.x + L.house.w - 1, 190, C.slabEdge);
  hline(ctx, L.house.x, L.house.x + L.house.w - 1, 195, C.slabEdge);
  rect(ctx, L.stairs.x, 190, L.stairs.w + 2, 6, C.wallOffice); // opening
  // bottom slab / foundation
  rect(ctx, L.house.x, L.groundY, L.house.w, 4, C.slabEdge);
  // outer walls + divider
  rect(ctx, L.house.x, 102, 2, 198, C.brick);
  rect(ctx, L.house.x + L.house.w - 2, 102, 2, 198, C.brick);
  rect(ctx, 228, 102, 4, 88, C.brick);
  rect(ctx, 228, 196, 4, 104, C.brick);
  for (let y = 104; y < 300; y += 6) { px(ctx, L.house.x, y, C.brickDk); px(ctx, L.house.x + L.house.w - 1, y + 3, C.brickDk); px(ctx, 229 + (y % 12 === 0 ? 1 : 0), y, C.brickDk); }
  // internal door to the garage
  rect(ctx, 386, 270, 6, 30, '#2a2024');
  // garage
  const g = r.garage;
  rect(ctx, g.x, 192, g.w + 2, 6, C.slab);
  hline(ctx, g.x, g.x + g.w + 1, 192, C.slabEdge);
  rect(ctx, g.x + g.w, 198, 2, 102, C.brick);
  for (let y = 200; y < 300; y += 6) px(ctx, g.x + g.w + 1, y, C.brickDk);
  rect(ctx, g.x + g.w - 1, L.garageDoor.y, 4, L.garageDoor.h, '#1a1216'); // doorway
  rect(ctx, g.x + g.w - 2, L.garageDoor.y - 4, 6, 4, C.metalDk); // rolled-up door
  // roof
  roof(ctx);
  // chimney + smoke handled by effects; draw the stack
  const ch = L.chimney;
  box(ctx, ch.x, ch.y, ch.w, ch.h, C.brick, C.outline, null, C.brickDk);
  rect(ctx, ch.x - 1, ch.y, ch.w + 2, 2, C.brickDk);
  // solar panels on the ridge
  const p = L.panels;
  for (let i = 0; i < p.n; i++) {
    const x = p.x + i * (p.w + p.gap);
    box(ctx, x, p.y, p.w, p.h, '#1e3a8a', C.outline, '#3b82f6');
    for (let yy = p.y + 2; yy < p.y + p.h - 1; yy += 2) hline(ctx, x + 1, x + p.w - 2, yy, '#2b4fb0');
    for (let xx = x + 3; xx < x + p.w - 1; xx += 4) vline(ctx, xx, p.y + 1, p.y + p.h - 2, '#2b4fb0');
    if (day > 0.3) { px(ctx, x + 2 + ((Math.floor(t * 2) + i) % (p.w - 4)), p.y + 1, '#dbeafe'); }
    rect(ctx, x + 2, p.y + p.h, 2, 2, C.metalDk); rect(ctx, x + p.w - 4, p.y + p.h, 2, 2, C.metalDk);
  }
}

function wallpaper(ctx, r, c1, c2, pattern) {
  rect(ctx, r.x, r.y, r.w, r.h, c1);
  if (pattern === 'dots') for (let y = r.y + 4; y < r.y + r.h - 6; y += 8) for (let x = r.x + 4 + ((y / 8) % 2) * 4; x < r.x + r.w - 2; x += 8) px(ctx, x, y, c2);
  if (pattern === 'stripes') for (let x = r.x + 3; x < r.x + r.w - 2; x += 8) rect(ctx, x, r.y, 2, r.h - 4, c2);
  if (pattern === 'blocks') for (let y = r.y + 2; y < r.y + r.h - 6; y += 7) for (let x = r.x + ((y / 7) % 2) * 6; x < r.x + r.w; x += 12) rect(ctx, x, y, 11, 1, c2);
  // skirting
  rect(ctx, r.x, r.y + r.h - 6, r.w, 2, c2);
}

function floorWood(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, C.floorWood);
  for (let xx = x; xx < x + w; xx += 9) rect(ctx, xx, y, 1, h, C.floorWoodDk);
  rect(ctx, x, y, w, 1, C.floorWoodLt);
}

function roof(ctx) {
  const r = L.roof;
  // trapezoid roof
  ctx.fillStyle = C.roof;
  ctx.beginPath();
  ctx.moveTo(r.eaveX1, r.eaveY); ctx.lineTo(r.ridgeX1, r.ridgeY); ctx.lineTo(r.ridgeX2, r.ridgeY); ctx.lineTo(r.eaveX2, r.eaveY); ctx.closePath();
  ctx.fill();
  // tile rows
  for (let y = r.ridgeY + 4; y < r.eaveY; y += 5) {
    const tt = (y - r.ridgeY) / (r.eaveY - r.ridgeY);
    const x1 = Math.round(lerp(r.ridgeX1, r.eaveX1, tt)), x2 = Math.round(lerp(r.ridgeX2, r.eaveX2, tt));
    hline(ctx, x1, x2, y, C.roofDk);
    for (let x = x1 + ((y / 5) % 2) * 4; x < x2; x += 8) px(ctx, x, y - 2, C.roofLt);
  }
  hline(ctx, r.ridgeX1, r.ridgeX2, r.ridgeY, C.roofLt);
  line(ctx, r.eaveX1, r.eaveY, r.ridgeX1, r.ridgeY, C.outline);
  line(ctx, r.eaveX2, r.eaveY, r.ridgeX2, r.ridgeY, C.outline);
  hline(ctx, r.eaveX1, r.eaveX2, r.eaveY, C.outline);
  hline(ctx, r.eaveX1 + 1, r.eaveX2 - 1, r.eaveY + 1, C.slab);
}

export function drawStairs(ctx) {
  const s = L.stairs;
  const rise = (s.bottomY - s.topY) / s.steps;
  const run = s.w / s.steps;
  // underside (a stringer) so the staircase is open underneath
  for (let i = 0; i < s.steps; i++) {
    const x = Math.round(s.x + i * run);
    const top = Math.round(s.bottomY - (i + 1) * rise);
    rect(ctx, x, top + 3, Math.round(run), Math.round(rise) - 1, C.woodDk);
  }
  for (let i = 0; i < s.steps; i++) {
    const x = Math.round(s.x + i * run);
    const top = Math.round(s.bottomY - (i + 1) * rise);
    rect(ctx, x, top, Math.round(run) + 1, 3, C.wood);
    hline(ctx, x, x + Math.round(run), top, C.woodLt);
    rect(ctx, x + Math.round(run), top + 3, 1, Math.round(rise) - 3, C.woodDk);
  }
  // banister
  line(ctx, s.x + 2, s.bottomY - 14, s.x + s.w + 2, s.topY - 14, C.woodDk);
  line(ctx, s.x + 2, s.bottomY - 13, s.x + s.w + 2, s.topY - 13, C.wood);
  for (let i = 0; i < s.steps; i += 3) {
    const x = Math.round(s.x + i * run + 2);
    const top = Math.round(s.bottomY - (i + 1) * rise);
    const by = Math.round(s.bottomY - 13 - (x - s.x - 2) * ((s.bottomY - s.topY) / s.w));
    vline(ctx, x, by, top, C.woodDk);
  }
}

export function stairY(x) {
  const s = L.stairs;
  const k = clamp((x - s.x) / s.w, 0, 1);
  return s.bottomY - k * (s.bottomY - s.topY);
}

// ----------------------------------------------------------------- bedroom
export function drawBedroom(ctx, store, t, anim) {
  const s = store.state;
  const b = L.bed;
  // rug
  rect(ctx, 100, 186, 60, 4, '#b45309'); for (let x = 102; x < 160; x += 6) rect(ctx, x, 187, 3, 2, '#d97706');
  // bed
  rect(ctx, b.x, b.y, 4, L.feet.upper - b.y, C.woodDk); rect(ctx, b.x + 1, b.y + 1, 2, 36, C.wood);
  rect(ctx, b.x + 4, 182, b.w - 4, 8, C.wood); hline(ctx, b.x + 4, b.x + b.w - 1, 182, C.woodLt);
  rect(ctx, b.x + 4, 170, b.w - 4, 12, C.white); hline(ctx, b.x + 4, b.x + b.w - 1, 181, '#cbd5e1');
  rect(ctx, b.x + 6, 165, 14, 6, '#fef9c3'); outline(ctx, b.x + 6, 165, 14, 6, '#e5d9a0'); // pillow
  rect(ctx, b.x + b.w, 184, 2, 6, C.woodDk);
  // nightstand + lamp + journal
  const n = L.nightstand;
  box(ctx, n.x, n.y, n.w, n.h, C.wood, C.outline, C.woodLt, C.woodDk);
  rect(ctx, n.x + 2, n.y + 8, n.w - 4, 1, C.woodDk); px(ctx, n.x + 8, n.y + 4, '#fde68a'); px(ctx, n.x + 8, n.y + 12, '#fde68a');
  const lampOn = anim.lampOn;
  rect(ctx, n.x + 12, n.y - 7, 2, 7, C.metalDk);
  rect(ctx, n.x + 9, n.y - 13, 8, 6, lampOn ? '#fde68a' : '#d6b35a'); outline(ctx, n.x + 9, n.y - 13, 8, 6, C.woodDk);
  if (lampOn) { ctx.globalAlpha = 0.22; rect(ctx, n.x + 6, n.y - 7, 14, 4, '#fde68a'); rect(ctx, n.x + 4, n.y - 3, 18, 3, '#fde68a'); ctx.globalAlpha = 1; }
  drawSprite(ctx, BOOK, n.x + 2, n.y - 5);
  if (anim.journalGlow > 0) { outline(ctx, n.x + 1, n.y - 6, 8, 7, '#fde68a'); }
  // wall clock with cron ticks
  drawClock(ctx, store, t, anim.clockShake);
  // small window with the sky
  const w = L.bedWindow;
  const day = store.dayFactor();
  const { top, bot } = skyColors(day);
  rect(ctx, w.x, w.y, w.w, w.h, mix(top, bot, 0.5));
  if (day < 0.5) { px(ctx, w.x + 6, w.y + 5, '#fff'); px(ctx, w.x + 18, w.y + 9, '#fff'); px(ctx, w.x + 12, w.y + 15, '#e0e7ff'); }
  outline(ctx, w.x - 1, w.y - 1, w.w + 2, w.h + 2, C.white);
  vline(ctx, w.x + Math.floor(w.w / 2), w.y, w.y + w.h - 1, C.white);
  hline(ctx, w.x, w.x + w.w - 1, w.y + Math.floor(w.h / 2), C.white);
  rect(ctx, w.x - 4, w.y - 3, 4, w.h + 6, '#b45309'); rect(ctx, w.x + w.w, w.y - 3, 4, w.h + 6, '#b45309');
  // poster
  box(ctx, 118, 112, 18, 22, '#1e1b4b', C.white);
  disc(ctx, 127, 121, 4, '#b196ff'); px(ctx, 125, 120, '#fff'); px(ctx, 129, 120, '#fff');
  text(ctx, 'HOME', 119, 128, '#c4b5fd');
}

function drawClock(ctx, store, t, shake) {
  const { cx, cy, r } = L.clock;
  const ox = shake ? Math.round(Math.sin(t * 40)) : 0;
  disc(ctx, cx + ox, cy, r + 1, C.woodDk);
  disc(ctx, cx + ox, cy, r, C.white);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    px(ctx, cx + ox + Math.round(Math.cos(a) * (r - 1)), cy + Math.round(Math.sin(a) * (r - 1)), i % 3 ? '#cbd5e1' : '#334155');
  }
  // cron markers (12h face)
  for (const c of store.state.cron || []) {
    if (!c.at) continue;
    const [hh, mm] = String(c.at).split(':').map(Number);
    const a = (((hh % 12) + mm / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    px(ctx, cx + ox + Math.round(Math.cos(a) * (r - 2)), cy + Math.round(Math.sin(a) * (r - 2)), '#ef4444');
  }
  const d = new Date();
  const h = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2;
  const m = (d.getMinutes() + d.getSeconds() / 60) / 60 * Math.PI * 2 - Math.PI / 2;
  const sec = d.getSeconds() / 60 * Math.PI * 2 - Math.PI / 2;
  line(ctx, cx + ox, cy, cx + ox + Math.cos(h) * (r - 5), cy + Math.sin(h) * (r - 5), '#0f172a');
  line(ctx, cx + ox, cy, cx + ox + Math.cos(m) * (r - 3), cy + Math.sin(m) * (r - 3), '#0f172a');
  line(ctx, cx + ox, cy, cx + ox + Math.cos(sec) * (r - 2), cy + Math.sin(sec) * (r - 2), '#ef4444');
  px(ctx, cx + ox, cy, '#0f172a');
  rect(ctx, cx + ox - 2, cy - r - 3, 4, 2, '#fbbf24'); // bell on top
}

// ----------------------------------------------------------------- library
export function drawLibrary(ctx, store, t, anim) {
  const s = store.state;
  // photo wall (Immich)
  const p = L.photoWall;
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
    const i = r * p.cols + c;
    const x = p.x + c * (p.fw + p.gap), y = p.y + r * (p.fh + p.gap);
    box(ctx, x, y, p.fw, p.fh, '#fef3c7', C.woodDk);
    const seed = (anim.photoSeed || 0) + i * 7;
    miniPhoto(ctx, x + 1, y + 1, p.fw - 2, p.fh - 2, seed);
    if (anim.photoFlash > 0 && i === anim.photoFlashIndex) { ctx.globalAlpha = Math.min(1, anim.photoFlash); rect(ctx, x, y, p.fw, p.fh, '#fff'); ctx.globalAlpha = 1; }
  }
  textCentered(ctx, `${fmtCount(s.immich.photos)} PHOTOS`, p.x + (p.cols * (p.fw + p.gap) - p.gap) / 2, p.y + p.rows * (p.fh + p.gap) + 1, '#e9d5ff');
  // bookshelf (memory)
  const b = L.bookshelf;
  box(ctx, b.x, b.y, b.w, b.h, C.wood, C.outline, C.woodLt, C.woodDk);
  rect(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, '#3d2817');
  const shelfH = Math.floor((b.h - 4) / b.shelves);
  const notes = Number(s.memory.notes || 0);
  const perBook = notes > 60 ? Math.ceil(notes / 60) : 1;
  const books = clamp(Math.ceil(notes / perBook), notes > 0 ? 1 : 0, 60);
  const cols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
  let n = 0;
  for (let sh = 0; sh < b.shelves; sh++) {
    const y = b.y + 2 + (sh + 1) * shelfH;
    rect(ctx, b.x + 2, y - 1, b.w - 4, 2, C.wood);
    for (let i = 0; i < 12; i++) {
      if (n >= books) break;
      const h = 7 + ((i * 7 + sh * 3) % 4);
      const x = b.x + 4 + i * 3;
      rect(ctx, x, y - 1 - h, 2, h, cols[(i + sh * 5) % cols.length]);
      px(ctx, x, y - 1 - h + 2, '#00000055');
      n++;
    }
  }
  if (anim.bookOut > 0) { drawSprite(ctx, BOOK, b.x - 8, b.y + 40 - Math.round(Math.sin(t * 3) * 2)); }
  textCentered(ctx, `${fmtCount(notes)} NOTES`, b.x + b.w / 2, b.y - 7, '#fcd9b6');
  // filing cabinet (skills)
  const c = L.cabinet;
  box(ctx, c.x, c.y, c.w, c.h, C.metal, C.outline, C.metalLt, C.metalDk);
  for (let i = 0; i < 3; i++) {
    const y = c.y + 2 + i * 12;
    rect(ctx, c.x + 2, y, c.w - 4, 11, '#8b919c'); outline(ctx, c.x + 2, y, c.w - 4, 11, C.metalDk);
    rect(ctx, c.x + 7, y + 4, 4, 2, C.metalLt);
    if (i === 1) textCentered(ctx, String(s.memory.skills || 0), c.x + c.w / 2, y + 3, '#111827');
  }
  textCentered(ctx, 'SKILLS', c.x + c.w / 2, c.y - 7, '#fcd9b6');
  // plant
  const pl = L.plant;
  box(ctx, pl.x, pl.y + 14, 14, 10, '#b45309', C.outline);
  rect(ctx, pl.x + 6, pl.y + 4, 2, 10, '#15803d');
  disc(ctx, pl.x + 3, pl.y + 6, 3, '#22c55e'); disc(ctx, pl.x + 11, pl.y + 5, 3, '#22c55e'); disc(ctx, pl.x + 7, pl.y + 2, 3, '#4ade80');
}

function miniPhoto(ctx, x, y, w, h, seed) {
  const pals = [['#60a5fa', '#bfdbfe', '#4ade80'], ['#fb923c', '#fde68a', '#f87171'], ['#a78bfa', '#c4b5fd', '#f0abfc'], ['#38bdf8', '#e0f2fe', '#0ea5e9'], ['#4ade80', '#166534', '#bbf7d0'], ['#f472b6', '#fbcfe8', '#fda4af']];
  const p = pals[Math.abs(seed) % pals.length];
  rect(ctx, x, y, w, h, p[0]);
  rect(ctx, x, y + Math.floor(h / 2), w, Math.ceil(h / 2), p[1]);
  const k = Math.abs(seed * 13) % (w - 2);
  rect(ctx, x + k, y + 2, 2, h - 3, p[2]);
}

export function fmtCount(n) {
  n = Number(n || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ----------------------------------------------------------------- living room
let camNoise = null;
function makeCamNoise() {
  camNoise = [];
  let seed = 99;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let f = 0; f < 4; f++) {
    const cv = makeCanvas(21, 15);
    const g = cv.getContext('2d');
    for (let y = 0; y < 15; y++) for (let x = 0; x < 21; x++) {
      const v = rnd();
      g.fillStyle = v < 0.08 ? '#2f5f3f' : v < 0.2 ? '#1f3f2f' : '#16302a';
      g.fillRect(x, y, 1, 1);
    }
    // a fence + ground line so it reads as a yard
    g.fillStyle = '#2a4a3a'; g.fillRect(0, 11, 21, 4);
    g.fillStyle = '#3a6a4a'; for (let x = 1; x < 21; x += 3) g.fillRect(x, 7, 1, 4);
    camNoise.push(cv);
  }
}

export function drawLivingRoom(ctx, store, t, anim) {
  const s = store.state;
  const day = store.dayFactor();
  // window to the yard
  const w = L.window;
  const { top, bot } = skyColors(day);
  rect(ctx, w.x, w.y, w.w, w.h, mix(top, bot, 0.6));
  rect(ctx, w.x, w.y + 20, w.w, 10, day > 0.4 ? '#4f8f3a' : '#23432a'); // yard grass
  for (let x = w.x + 2; x < w.x + w.w; x += 4) rect(ctx, x, w.y + 16, 1, 5, day > 0.4 ? '#b8a98a' : '#5a5448'); // fence
  rect(ctx, w.x + 22, w.y + 8, 2, 12, C.woodDk); disc(ctx, w.x + 23, w.y + 7, 4, day > 0.4 ? '#3f8f3a' : '#2b5a2d');
  if (anim.camFlash > 0) { ctx.globalAlpha = Math.min(0.6, anim.camFlash); rect(ctx, w.x, w.y, w.w, w.h, '#fde68a'); ctx.globalAlpha = 1; }
  if (anim.camLabel) { rect(ctx, w.x + 1, w.y + 1, w.w - 2, 7, '#7f1d1d'); textCentered(ctx, anim.camLabel.toUpperCase().slice(0, 7), w.x + w.w / 2, w.y + 2, '#fff'); }
  outline(ctx, w.x - 1, w.y - 1, w.w + 2, w.h + 2, C.white);
  vline(ctx, w.x + Math.floor(w.w / 2), w.y, w.y + w.h - 1, C.white);
  hline(ctx, w.x, w.x + w.w - 1, w.y + Math.floor(w.h / 2), C.white);
  rect(ctx, w.x - 5, w.y - 3, 5, w.h + 6, '#7f1d1d'); rect(ctx, w.x + w.w, w.y - 3, 5, w.h + 6, '#7f1d1d');
  // a camera in the corner of the window (the Tapos)
  box(ctx, w.x + w.w + 6, w.y - 6, 6, 4, C.metalLt, C.outline); px(ctx, w.x + w.w + 8, w.y - 5, (Math.floor(t * 2) % 2) ? '#ef4444' : '#7f1d1d');
  // radio on a shelf
  const r = L.radio;
  rect(ctx, r.x - 4, r.shelfY, r.w + 8, 2, C.wood); rect(ctx, r.x - 2, r.shelfY + 2, 2, 2, C.woodDk); rect(ctx, r.x + r.w, r.shelfY + 2, 2, 2, C.woodDk);
  box(ctx, r.x, r.y, r.w, r.h, '#92400e', C.outline, '#d97706', '#78350f');
  rect(ctx, r.x + 2, r.y + 2, 10, 6, '#1f2937'); for (let x = r.x + 3; x < r.x + 11; x += 2) px(ctx, x, r.y + 5, '#6b7280');
  disc(ctx, r.x + 17, r.y + 5, 2, C.metalLt);
  rect(ctx, r.x + r.w - 3, r.y - 8, 1, 8, C.metalLt);
  const planes = Number(s.sdr.planes || 0);
  if (planes > 0 || anim.radioPing > 0) {
    const k = (t * 1.2) % 1;
    for (let i = 0; i < 2; i++) {
      const rr = 2 + ((k + i * 0.5) % 1) * 6;
      for (let a = -1.1; a <= 1.1; a += 0.25) px(ctx, r.x + r.w - 3 + Math.cos(a - Math.PI / 2) * rr, r.y - 8 + Math.sin(a - Math.PI / 2) * rr, '#86efac');
    }
  }
  // crew photo
  drawCrewPhoto(ctx, s);
  // TV + stand
  const st = L.tvStand;
  box(ctx, st.x, st.y, st.w, st.h, C.wood, C.outline, C.woodLt, C.woodDk);
  rect(ctx, st.x + 4, st.y + 4, 16, 10, C.woodDk); rect(ctx, st.x + 28, st.y + 4, 16, 10, C.woodDk);
  px(ctx, st.x + 11, st.y + 9, '#fde68a'); px(ctx, st.x + 35, st.y + 9, '#fde68a');
  drawTV(ctx, store, t, anim);
  // couch
  const c = L.couch;
  rect(ctx, c.x + 2, c.y, c.w - 4, 14, '#b91c1c'); // back
  rect(ctx, c.x, c.seatY, c.w, 10, '#dc2626'); // seat
  rect(ctx, c.x, c.seatY - 6, 6, 16, '#991b1b'); rect(ctx, c.x + c.w - 6, c.seatY - 6, 6, 16, '#991b1b'); // arms
  hline(ctx, c.x + 6, c.x + c.w - 7, c.seatY, '#f87171');
  rect(ctx, c.x + 2, c.seatY + 10, 3, 8, C.woodDk); rect(ctx, c.x + c.w - 5, c.seatY + 10, 3, 8, C.woodDk);
  outline(ctx, c.x + 2, c.y, c.w - 4, 14, '#7f1d1d');
  rect(ctx, c.x + 8, c.y + 4, 12, 8, '#fbbf24'); // cushion
  // dog bed
  const d = L.dogBed;
  box(ctx, d.x - 2, d.y, d.w + 4, d.h, '#6d28d9', C.outline, '#8b5cf6');
  rect(ctx, d.x, d.y + 2, d.w, 4, '#a78bfa');
}

function drawCrewPhoto(ctx, s) {
  const p = L.crewPhoto;
  box(ctx, p.x, p.y, p.w, p.h, '#fef3c7', C.woodDk);
  rect(ctx, p.x + 2, p.y + 2, p.w - 4, p.h - 4, '#1e293b');
  const names = Object.keys(s.crew || {});
  const n = Math.max(1, names.length);
  const step = (p.w - 6) / n;
  names.forEach((name, i) => {
    const c = s.crew[name] || {};
    const col = CREW[name]?.color || '#94a3b8';
    const x = Math.round(p.x + 3 + step * i + step / 2 - 1);
    const y = p.y + 8 + (i % 2) * 2;
    const online = c.online !== false;
    disc(ctx, x, y, 2, online ? col : '#475569');
    rect(ctx, x - 2, y + 3, 5, 5, online ? col : '#334155');
    if (!online) px(ctx, x + 2, y - 3, '#64748b');
  });
  textCentered(ctx, 'THE CREW', p.x + p.w / 2, p.y + p.h - 7, '#fde68a');
}

function drawTV(ctx, store, t, anim) {
  const tv = L.tv;
  const s = store.state;
  box(ctx, tv.x, tv.y, tv.w, tv.h, '#111827', C.outline, '#374151');
  rect(ctx, tv.x + tv.w / 2 - 4, tv.y + tv.h, 8, 2, '#374151');
  const sx = tv.x + 2, sy = tv.y + 2, sw = tv.w - 4, sh = tv.h - 4;
  if (!camNoise) makeCamNoise();
  const mode = anim.tvMode || 'cams';
  if (mode === 'cams') {
    const names = (s.cams.names || ['front', 'side', 'back', 'shed']).slice(0, 4);
    const online = Number(s.cams.online ?? names.length);
    for (let i = 0; i < 4; i++) {
      const fx = sx + (i % 2) * 23, fy = sy + Math.floor(i / 2) * 16;
      if (i < online) {
        ctx.drawImage(camNoise[i], fx, fy);
        // a wandering blob of motion
        const bx = fx + Math.floor((t * 3 + i * 7) % 19), by = fy + 8 + (i % 2);
        if (Math.floor(t / 7 + i) % 3 === 0) { rect(ctx, bx, by, 2, 3, '#9ca3af'); }
        if (anim.camHit === i && anim.camLabel) { outline(ctx, bx - 2, by - 2, 6, 7, '#fde047'); }
      } else {
        rect(ctx, fx, fy, 21, 15, '#111'); text(ctx, 'NOSIG', fx + 1, fy + 5, '#ef4444');
      }
      rect(ctx, fx, fy + 15, 21, 1, '#0b0b10');
      const nm = (names[i] || `cam${i + 1}`).toUpperCase().slice(0, 5);
      text(ctx, nm, fx + 1, fy + 1, '#d1fae5');
      if (Math.floor(t * 2) % 2 === 0 && i < online) px(ctx, fx + 19, fy + 12, '#ef4444');
    }
    rect(ctx, sx + 21, sy, 2, sh, '#0b0b10');
  } else {
    // bus / system dashboard
    rect(ctx, sx, sy, sw, sh, '#0b1020');
    text(ctx, 'HOMELAB', sx + 2, sy + 2, '#93c5fd');
    const rows = [['CPU', s.system.cpu], ['RAM', s.system.ram], ['/', s.system.disk_root], ['MNT', s.system.disk_mnt], ['BAT', s.power.battery]];
    rows.forEach(([k, v], i) => {
      const y = sy + 9 + i * 5;
      text(ctx, k, sx + 2, y, '#94a3b8');
      rect(ctx, sx + 16, y + 1, 24, 3, '#1e293b');
      const val = clamp(Number(v || 0), 0, 100);
      rect(ctx, sx + 16, y + 1, Math.round(24 * val / 100), 3, val > 90 ? '#ef4444' : val > 75 ? '#fbbf24' : '#22c55e');
    });
  }
  // screen glow line
  hline(ctx, sx, sx + sw - 1, sy, 'rgba(255,255,255,0.08)');
}

// ----------------------------------------------------------------- office
export function drawOffice(ctx, store, t, anim) {
  const s = store.state;
  // thermometer (CPU temp)
  const th = L.thermo;
  const temp = clamp(Number(s.system.temp || 0), 0, 100);
  rect(ctx, th.x, th.y, 4, th.h, '#e5e7eb'); outline(ctx, th.x - 1, th.y - 1, 6, th.h + 2, C.metalDk);
  const fill = Math.round((th.h - 2) * temp / 100);
  rect(ctx, th.x + 1, th.y + th.h - 1 - fill, 2, fill, temp > 80 ? '#ef4444' : temp > 65 ? '#f97316' : '#3b82f6');
  disc(ctx, th.x + 2, th.y + th.h + 1, 3, temp > 80 ? '#ef4444' : temp > 65 ? '#f97316' : '#3b82f6');
  text(ctx, `${Math.round(temp)}°`, th.x - 3, th.y - 8, '#e2e8f0');
  // chair
  const ch = L.chair;
  rect(ctx, ch.x, ch.y, 3, 16, '#1f2937'); rect(ctx, ch.x, ch.y + 16, 14, 3, '#1f2937');
  rect(ctx, ch.x + 6, ch.y + 19, 2, 9, '#374151'); rect(ctx, ch.x + 2, ch.y + 27, 10, 2, '#374151');
  // desk
  const d = L.desk;
  rect(ctx, d.x, d.y, d.w, 3, C.woodLt); rect(ctx, d.x, d.y + 3, d.w, 2, C.woodDk);
  rect(ctx, d.x + 2, d.y + 5, 3, d.h - 5, C.woodDk); rect(ctx, d.x + d.w - 5, d.y + 5, 3, d.h - 5, C.woodDk);
  rect(ctx, d.x + d.w - 20, d.y + 5, 15, 12, C.wood); px(ctx, d.x + d.w - 13, d.y + 10, '#fde68a');
  // keyboard
  const k = L.keyboard;
  rect(ctx, k.x, k.y, k.w, k.h, '#374151'); for (let x = k.x + 1; x < k.x + k.w - 1; x += 2) px(ctx, x, k.y + 1, anim.typing && (x + Math.floor(t * 12)) % 5 === 0 ? '#fff' : '#9ca3af');
  // monitor
  drawMonitor(ctx, store, t, anim);
  // laptop
  const lp = L.laptop;
  if (anim.laptopOpen) {
    rect(ctx, lp.x, lp.y + 6, lp.w, 2, '#6b7280');
    box(ctx, lp.x + 1, lp.y - 6, lp.w - 2, 12, '#0b1020', '#9ca3af');
    const tag = (anim.laptopText || 'SSH').toUpperCase().slice(0, 3);
    text(ctx, tag, lp.x + 1, lp.y - 3, '#86efac');
    px(ctx, lp.x + 1 + 12 * 1, lp.y + 2, Math.floor(t * 3) % 2 ? '#86efac' : '#0b1020');
    for (let i = 0; i < 3; i++) { const rr = 2 + ((t * 1.5 + i * 0.33) % 1) * 6; for (let a = -0.9; a <= 0.9; a += 0.3) px(ctx, lp.x + lp.w + 1 + Math.cos(a) * rr, lp.y - 2 + Math.sin(a) * rr, '#60a5fa'); }
  } else {
    box(ctx, lp.x, lp.y + 4, lp.w, 4, '#9ca3af', '#4b5563'); px(ctx, lp.x + 7, lp.y + 5, '#fff');
  }
  // the cupboard (the homelab itself)
  drawCupboard(ctx, store, t);
  // speaker on top
  const sp = L.speaker;
  box(ctx, sp.x, sp.y, sp.w, sp.h, '#1f2937', C.outline, '#374151');
  disc(ctx, sp.x + 5, sp.y + 4, 2, '#6b7280'); disc(ctx, sp.x + 5, sp.y + 9, 1, '#6b7280');
  if (anim.speaking) { px(ctx, sp.x + 5, sp.y + 4, '#22d3ee'); }
}

function drawMonitor(ctx, store, t, anim) {
  const m = L.monitor;
  const s = store.state;
  rect(ctx, m.x + m.w / 2 - 3, m.y + m.h, 6, 4, '#374151'); rect(ctx, m.x + m.w / 2 - 7, m.y + m.h + 3, 14, 1, '#4b5563');
  box(ctx, m.x, m.y, m.w, m.h, '#111827', C.outline, '#374151');
  const sx = m.x + 2, sy = m.y + 2, sw = m.w - 4, sh = m.h - 4;
  if (anim.monitorMode === 'off') {
    rect(ctx, sx, sy, sw, sh, C.screenOff);
    px(ctx, sx + sw - 2, sy + sh - 2, Math.floor(t) % 2 ? '#f97316' : '#7c2d12');
    return;
  }
  rect(ctx, sx, sy, sw, sh, '#07140d');
  if (anim.monitorMode === 'terminal') {
    const lines = anim.termLines || [];
    lines.slice(-3).forEach((l, i) => text(ctx, l.slice(0, 8), sx + 1, sy + 2 + i * 6, i === lines.slice(-3).length - 1 ? '#bbf7d0' : '#4ade80'));
    const last = lines.length ? Math.min(lines.length, 3) : 0;
    if (Math.floor(t * 2) % 2 === 0) rect(ctx, sx + 1 + Math.min(8, (lines[lines.length - 1] || '').length) * 4, sy + 2 + last * 6, 3, 5, '#86efac');
  } else {
    text(ctx, 'CLAWD', sx + 1, sy + 2, '#86efac');
    text(ctx, `${Math.round(s.system.cpu || 0)}% CPU`, sx + 1, sy + 8, '#4ade80');
    const n = Math.floor(sw * clamp(s.system.cpu || 0, 0, 100) / 100);
    rect(ctx, sx + 1, sy + 15, sw - 2, 3, '#14532d'); rect(ctx, sx + 1, sy + 15, Math.max(1, n - 2), 3, '#22c55e');
    px(ctx, sx + sw - 2, sy + sh - 2, Math.floor(t * 2) % 2 ? '#86efac' : '#07140d');
  }
  // glass reflection
  hline(ctx, sx, sx + sw - 1, sy, 'rgba(255,255,255,0.1)');
}

function drawCupboard(ctx, store, t) {
  const c = L.cupboard;
  const s = store.state;
  box(ctx, c.x, c.y, c.w, c.h, C.wood, C.outline, C.woodLt, C.woodDk);
  // door ajar showing the rack
  rect(ctx, c.x + 2, c.y + 2, c.w - 4, c.h - 4, '#1f2937');
  const cpu = clamp(Number(s.system.cpu || 0), 0, 100);
  const rate = 2 + cpu / 12;
  for (let i = 0; i < 5; i++) {
    const y = c.y + 6 + i * 11;
    rect(ctx, c.x + 3, y, c.w - 6, 8, '#374151'); hline(ctx, c.x + 3, c.x + c.w - 4, y, '#4b5563');
    for (let j = 0; j < 3; j++) {
      const on = Math.floor(t * rate + i * 1.7 + j * 2.3) % (3 + j) === 0;
      px(ctx, c.x + 5 + j * 2, y + 2, on ? (j === 2 ? '#fbbf24' : '#22c55e') : '#14532d');
    }
    rect(ctx, c.x + 12, y + 2, 3, 4, '#111827');
  }
  // fan at the bottom, speed from fan% or temp
  const fan = clamp(Number(s.system.fan || 0) || clamp((Number(s.system.temp || 0) - 30) * 2, 0, 100), 0, 100);
  const fx = c.x + c.w / 2, fy = c.y + c.h - 7;
  disc(ctx, fx, fy, 4, '#111827');
  const a = t * (2 + fan / 8);
  for (let i = 0; i < 3; i++) { const aa = a + i * 2.09; px(ctx, fx + Math.round(Math.cos(aa) * 2), fy + Math.round(Math.sin(aa) * 2), '#9ca3af'); px(ctx, fx + Math.round(Math.cos(aa) * 3), fy + Math.round(Math.sin(aa) * 3), '#6b7280'); }
  px(ctx, fx, fy, '#d1d5db');
  // label
  text(ctx, 'LAB', c.x + 3, c.y - 7, '#cbd5e1');
}

// ----------------------------------------------------------------- garage
export function drawGarage(ctx, store, t, anim) {
  const s = store.state;
  // storage shelf: boxes (movies/downloads) + RetroShelf cartridges
  const g = L.garageShelf;
  rect(ctx, g.x, g.y + 12, g.w, 2, C.wood); rect(ctx, g.x, g.y + g.h - 2, g.w, 2, C.wood);
  rect(ctx, g.x, g.y, 2, g.h, C.woodDk); rect(ctx, g.x + g.w - 2, g.y, 2, g.h, C.woodDk);
  const used = Number(s.storage.mnt_used_gb || 0), total = Math.max(1, Number(s.storage.mnt_total_gb || 915));
  const boxes = clamp(Math.round(6 * used / total), 0, 6);
  for (let i = 0; i < 6; i++) {
    const x = g.x + 3 + i * 10;
    if (i < boxes) { box(ctx, x, g.y + 3, 9, 9, '#b45309', C.outline, '#d97706'); px(ctx, x + 4, g.y + 6, '#fde68a'); }
    else outline(ctx, x, g.y + 3, 9, 9, '#5f5f66');
  }
  text(ctx, `${Math.round(100 * used / total)}% MNT`, g.x + 2, g.y - 6, '#e5e7eb');
  // RetroShelf: a row of cartridges
  const cols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#f472b6', '#60a5fa', '#4ade80', '#facc15'];
  for (let i = 0; i < 10; i++) { const x = g.x + 3 + i * 4; rect(ctx, x, g.y + 17, 3, 9, cols[i % cols.length]); px(ctx, x + 1, g.y + 19, '#ffffff88'); }
  text(ctx, 'RETRO', g.x + 44, g.y + 16, '#fde68a'); text(ctx, fmtCount(s.storage.games || 0), g.x + 44, g.y + 22, '#e5e7eb');
  // battery (FoxESS)
  drawBattery(ctx, store, t, anim);
  // pegboard + workbench
  const pb = L.pegboard;
  box(ctx, pb.x, pb.y, pb.w, pb.h, '#8b6b4a', C.outline);
  for (let y = pb.y + 3; y < pb.y + pb.h - 2; y += 4) for (let x = pb.x + 3; x < pb.x + pb.w - 2; x += 4) px(ctx, x, y, '#6b4f33');
  // tools: wrench, screwdriver, hammer
  rect(ctx, pb.x + 4, pb.y + 4, 2, 12, C.metalLt); rect(ctx, pb.x + 3, pb.y + 3, 4, 3, C.metalLt);
  rect(ctx, pb.x + 11, pb.y + 4, 2, 6, '#ef4444'); rect(ctx, pb.x + 11, pb.y + 10, 2, 8, C.metalLt);
  rect(ctx, pb.x + 19, pb.y + 4, 8, 4, C.metalDk); rect(ctx, pb.x + 22, pb.y + 8, 2, 10, C.wood);
  const wb = L.workbench;
  rect(ctx, wb.x, wb.y, wb.w, 4, C.woodLt); rect(ctx, wb.x, wb.y + 4, wb.w, 2, C.woodDk);
  rect(ctx, wb.x + 2, wb.y + 6, 3, wb.h - 6, C.woodDk); rect(ctx, wb.x + wb.w - 5, wb.y + 6, 3, wb.h - 6, C.woodDk);
  rect(ctx, wb.x + 6, wb.y + 10, wb.w - 12, 2, C.woodDk);
  // bits on the bench: a script page + a mug
  rect(ctx, wb.x + 4, wb.y - 6, 8, 6, '#f8fafc'); for (let i = 0; i < 3; i++) hline(ctx, wb.x + 5, wb.x + 10, wb.y - 5 + i * 2, '#94a3b8');
  box(ctx, wb.x + 20, wb.y - 6, 6, 6, '#3b82f6', C.outline); px(ctx, wb.x + 26, wb.y - 4, '#3b82f6');
  if (anim.tinkering) { if (Math.floor(t * 6) % 3 === 0) px(ctx, wb.x + 14, wb.y - 2, '#fde68a'); }
  // bot docks
  for (let i = 0; i < 3; i++) rect(ctx, L.botDock.x + i * 10 - 1, L.feet.lower - 1, 10, 1, '#22d3ee');
}

function drawBattery(ctx, store, t, anim) {
  const b = L.battery;
  const p = store.state.power || {};
  const pct = clamp(Number(p.battery ?? 0), 0, 100);
  const low = store.batteryLow();
  box(ctx, b.x, b.y, b.w, b.h, '#1f2937', C.outline, '#374151');
  rect(ctx, b.x + 6, b.y - 3, 6, 3, '#374151');
  const inner = b.h - 6;
  const fill = Math.round(inner * pct / 100);
  const col = low ? '#ef4444' : pct < 40 ? '#fbbf24' : '#22c55e';
  rect(ctx, b.x + 3, b.y + 3 + inner - fill, b.w - 6, fill, col);
  for (let y = b.y + 3; y < b.y + 3 + inner; y += 4) hline(ctx, b.x + 3, b.x + b.w - 4, y, '#111827');
  if (p.charging || anim.solarPulse > 0) {
    // lightning bolt
    const bx = b.x + b.w / 2, by = b.y + 12;
    const on = Math.floor(t * 3) % 2 === 0 || anim.solarPulse > 0;
    if (on) { px(ctx, bx + 1, by, '#fde047'); px(ctx, bx, by + 1, '#fde047'); px(ctx, bx, by + 2, '#fde047'); px(ctx, bx + 1, by + 2, '#fde047'); px(ctx, bx, by + 3, '#fde047'); px(ctx, bx - 1, by + 4, '#fde047'); }
  }
  textCentered(ctx, `${Math.round(pct)}%`, b.x + b.w / 2, b.y + b.h + 2, low ? '#fca5a5' : '#e5e7eb');
  if (low && Math.floor(t * 2) % 2 === 0) textCentered(ctx, 'LOW', b.x + b.w / 2, b.y + b.h + 9, '#fca5a5');
  // solar readout up on the roof
  const solar = Number(p.solar_w || 0);
  const pn = L.panels;
  const label = solar >= 1000 ? `${(solar / 1000).toFixed(1)}KW` : `${Math.round(solar)}W`;
  text(ctx, `SOLAR ${label}`, pn.x, pn.y - 8, solar > 0 ? '#fde68a' : '#94a3b8');
  // cable from the panels down to the garage battery
  if (solar > 0) { const k = Math.floor(t * 8) % 4; for (let y = pn.y + pn.h + 2; y < L.roof.eaveY; y += 4) if ((y / 4 + k) % 4 === 0) px(ctx, pn.x + pn.n * (pn.w + pn.gap) + 2, y, '#fde047'); }
}

// ----------------------------------------------------------------- lighting
export function drawLighting(ctx, store, t, clawdRoom, botsActive, sleeping) {
  const day = store.dayFactor();
  const night = 1 - day;
  if (night < 0.02) return;
  const rooms = Object.entries(L.rooms);
  const low = store.batteryLow();
  const flicker = low ? 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 23)) + (Math.floor(t * 7) % 5 === 0 ? 0.25 : 0) : 0;
  // outside goes dark, rooms are cut out
  ctx.fillStyle = `rgba(6, 8, 36, ${(0.62 * night).toFixed(3)})`;
  ctx.beginPath();
  ctx.rect(0, 0, W, L.road.y + L.road.h);
  for (const [, r] of rooms) ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  for (const [name, r] of rooms) {
    let lit = name === clawdRoom;
    if (name === 'garage' && botsActive) lit = true;
    if (name === 'bedroom' && sleeping) lit = false;
    let a;
    if (lit) a = 0.03 * night + flicker; else a = (0.5 + (name === 'bedroom' && sleeping ? 0.14 : 0)) * night + flicker * 0.5;
    ctx.fillStyle = `rgba(6, 8, 36, ${a.toFixed(3)})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (lit && !low) { ctx.fillStyle = `rgba(255, 200, 120, ${(0.1 * night).toFixed(3)})`; ctx.fillRect(r.x, r.y, r.w, r.h); }
  }
  // lamp glows that stay on
  if (night > 0.3) {
    ctx.fillStyle = `rgba(253, 230, 138, ${(0.18 * night).toFixed(3)})`;
    ctx.fillRect(L.signpost.x - 2, 262, 17, 40);
  }
}

// ----------------------------------------------------------------- tap targets
export const ITEMS = [
  { id: 'house', spark: ['cpu', 'ram'], rect: [L.roof.eaveX1, L.roof.ridgeY - 2, L.roof.eaveX2 - L.roof.eaveX1, L.roof.eaveY - L.roof.ridgeY + 2], title: 'The house', body: 'The homelab itself, sat in the cupboard. My body.', stats: (s) => ({ host: s.meta.host, uptime: fmtUptime(s.system.uptime), load: s.system.load || '—' }) },
  { id: 'panels', spark: ['solar_w', 'load_w'], rect: [L.panels.x - 2, L.panels.y - 10, 100, 20], title: 'Solar panels', body: 'FoxESS. The sun charges the battery in the garage; when it drains to the floor, the lights dim.', stats: (s) => ({ solar: `${s.power.solar_w} W`, load: `${s.power.load_w} W`, grid: `${s.power.grid_w} W` }) },
  { id: 'chimney', spark: ['cpu', 'temp'], rect: [L.chimney.x - 2, L.chimney.y - 14, 16, 40], title: 'Chimney', body: 'Smoke means the CPU is working hard.', stats: (s) => ({ cpu: `${s.system.cpu}%`, temp: `${s.system.temp}°C` }) },
  { id: 'mailbox', rect: [0, 258, 22, 46], title: 'Mailbox', body: 'Your Telegram DMs. The flag goes up when something is waiting for me.', stats: (s) => ({ unread: s.telegram.unread, last: s.telegram.last ? `${s.telegram.last.from}: ${s.telegram.last.text}` : '—' }) },
  { id: 'bird', rect: [L.tree.x - 22, L.tree.canopyY - 22, 50, 64], title: 'Chirpa', body: 'The bird-audio listener. Sings whenever one of the ~79 species is heard in the yard.', stats: (s) => ({ 'species today': s.chirpa.species_today, detections: s.chirpa.detections_today, last: s.chirpa.last ? s.chirpa.last.species : '—' }) },
  { id: 'door', rect: [L.frontDoor.x - 4, L.frontDoor.y - 4, 20, 36], title: 'Front door', body: 'Where the crew bus pulls up and where messages land on the doorstep.', stats: (s) => ({ 'on the bus': (s.bus.online || []).join(', ') || 'nobody', 'messages today': s.bus.messages_today }) },
  { id: 'dog', rect: [L.dogBed.x - 4, L.dogBed.y - 16, 30, 26], title: 'The watchdog', body: 'clawd-watchdog. Loyal, mostly asleep, barks the moment a disk fills, RAM runs out or the gateway dies.', stats: (s) => ({ state: s.watchdog.state, alerts: (s.watchdog.alerts || []).join(', ') || 'none', 'last bark': fmtAgo(s.watchdog.last_bark) }) },
  { id: 'window', rect: [L.window.x - 6, L.window.y - 8, 48, 44], title: 'Window to the yard', body: "The cameras' view of the actual yard. Flashes when Frigate spots something.", stats: (s) => ({ cams: `${s.cams.online}/${(s.cams.names || []).length} online`, 'events today': s.cams.events_today, last: s.cams.last ? `${s.cams.last.label} @ ${s.cams.last.camera}` : '—' }) },
  { id: 'radio', rect: [L.radio.x - 6, L.radio.y - 12, 34, 30], title: 'Radio', body: 'The RTL-SDR: ADS-B planes overhead and 433MHz sensor chatter.', stats: (s) => ({ planes: s.sdr.planes, sensors: s.sdr.sensors, last: s.sdr.last_plane ? `${s.sdr.last_plane.callsign} ${s.sdr.last_plane.alt ? s.sdr.last_plane.alt + 'ft' : ''}` : '—' }) },
  { id: 'tv', rect: [L.tv.x - 2, L.tv.y - 2, L.tv.w + 4, L.tv.h + 24], title: 'TV', body: 'Live feeds: the Frigate cams (3 Tapos + shed) on one channel, the homelab dashboard on another.', stats: (s) => ({ cams: `${s.cams.online} online`, 'events today': s.cams.events_today }) },
  { id: 'crew', rect: [L.crewPhoto.x - 2, L.crewPhoto.y - 2, L.crewPhoto.w + 4, L.crewPhoto.h + 4], title: 'The crew photo', body: 'All of us. Bright when they are online, grey when they are away.', stats: (s) => Object.fromEntries(Object.entries(s.crew || {}).map(([k, v]) => [`${v.emoji || ''} ${k}`, v.online === false ? 'away' : 'home'])) },
  { id: 'couch', rect: [L.couch.x, L.couch.y - 4, L.couch.w, 36], title: 'Couch', body: 'Where I sit to watch the yard.', stats: () => ({}) },
  { id: 'bed', rect: [L.bed.x - 2, L.bed.y - 2, L.bed.w + 4, 40], title: 'Bed', body: 'Idle means asleep means dreaming: memory consolidation and the nightly diary.', stats: (s) => ({ 'last diary': fmtAgo(s.memory.last_diary), consolidated: fmtAgo(s.memory.last_consolidation), dreaming: s.clawd.dream || '—' }) },
  { id: 'journal', rect: [L.nightstand.x - 2, L.nightstand.y - 16, L.nightstand.w + 4, L.nightstand.h + 16], title: 'Dream journal', body: 'The nightly diary on the nightstand.', stats: (s) => ({ 'last entry': fmtAgo(s.memory.last_diary) }) },
  { id: 'clock', rect: [L.clock.cx - 12, L.clock.cy - 14, 24, 26], title: 'Wall clock', body: 'My cron schedule. Red ticks are the jobs: morning brief, nightly diary, and the watchdogs ticking.', stats: (s, store) => { const n = store.nextCron(); const o = {}; for (const c of s.cron || []) o[c.name] = c.at || `every ${c.every}m`; if (n) o.next = `${n.name} in ${fmtDuration(n.mins)}`; return o; } },
  { id: 'photos', rect: [L.photoWall.x - 2, L.photoWall.y - 2, 50, 36], title: 'Photo wall', body: 'Immich. My photo memories.', stats: (s) => ({ photos: s.immich.photos, 'last upload': fmtAgo(s.immich.last_upload) }) },
  { id: 'books', rect: [L.bookshelf.x - 2, L.bookshelf.y - 10, L.bookshelf.w + 4, L.bookshelf.h + 10], title: 'Bookshelves', body: 'My memory. Everything I have learned, filed on shelves.', stats: (s) => ({ notes: s.memory.notes, consolidated: fmtAgo(s.memory.last_consolidation) }) },
  { id: 'cabinet', rect: [L.cabinet.x - 2, L.cabinet.y - 10, L.cabinet.w + 4, L.cabinet.h + 10], title: 'Filing cabinet', body: 'My skills, one per drawer.', stats: (s) => ({ skills: s.memory.skills }) },
  { id: 'thermo', spark: ['temp'], rect: [L.thermo.x - 6, L.thermo.y - 10, 16, 44], title: 'Thermometer', body: 'CPU temperature. The fan in the cupboard spins faster as it climbs (fan-adjust.sh).', stats: (s) => ({ temp: `${s.system.temp}°C`, fan: `${s.system.fan}%` }) },
  { id: 'desk', spark: ['cpu', 'ram'], rect: [L.chair.x - 2, L.monitor.y - 2, 60, 60], title: 'Computer desk', body: 'The terminal: my hands. Where I run commands, fix fan scripts and restart Frigate.', stats: (s) => ({ cpu: `${s.system.cpu}%`, ram: `${s.system.ram}%`, 'disk /': `${s.system.disk_root}%` }) },
  { id: 'laptop', rect: [L.laptop.x - 2, L.laptop.y - 8, L.laptop.w + 6, 18], title: 'Laptop', body: 'My remote reach: SSH to defthrets, Wormer and Vinny, and the link to you on Telegram.', stats: (s) => ({ wan: s.network.wan ? 'up' : 'down', latency: `${s.network.latency_ms} ms` }) },
  { id: 'cupboard', spark: ['cpu', 'temp'], rect: [L.cupboard.x - 2, L.speaker.y - 2, L.cupboard.w + 4, L.cupboard.h + 14], title: 'The cupboard', body: 'The homelab rack and the speaker (my voice, TTS) on top. LEDs blink with CPU, the fan spins with temperature.', stats: (s) => ({ cpu: `${s.system.cpu}%`, ram: `${s.system.ram}%`, temp: `${s.system.temp}°C`, fan: `${s.system.fan}%` }) },
  { id: 'shelf', spark: ['disk_mnt'], rect: [L.garageShelf.x - 2, L.garageShelf.y - 8, L.garageShelf.w + 4, L.garageShelf.h + 8], title: 'Garage shelves', body: '/mnt (915GB): movies and downloads, plus RetroShelf with ~4900 games.', stats: (s) => ({ used: `${s.storage.mnt_used_gb} / ${s.storage.mnt_total_gb} GB`, games: s.storage.games, movies: s.storage.movies }) },
  { id: 'battery', spark: ['battery', 'solar_w'], rect: [L.battery.x - 4, L.battery.y - 12, L.battery.w + 8, L.battery.h + 20], title: 'Battery', body: 'FoxESS battery. Below the low mark the lights dim: the "ESS overload" moment.', stats: (s) => ({ battery: `${s.power.battery}%`, charging: s.power.charging ? 'yes' : 'no', solar: `${s.power.solar_w} W` }) },
  { id: 'bench', rect: [L.pegboard.x - 2, L.pegboard.y - 2, L.pegboard.w + 4, 58], title: 'Workbench', body: 'Scripts and tinkering. Where I bash fan-adjust.sh into shape.', stats: (s) => ({ fan: `${s.system.fan}%` }) },
  { id: 'bots', rect: [L.botDock.x - 4, L.feet.lower - 26, 34, 28], title: 'Helper bots', body: 'Subagents. When I delegate a job, a helper trundles out of the garage.', stats: (s) => ({ active: s.subagents.active, names: (s.subagents.names || []).join(', ') || '—' }) },
  { id: 'www', rect: [L.signpost.x - 10, 256, 24, 48], title: 'The road out', body: 'The internet: web search and the browser. How I wander outside.', stats: (s) => ({ wan: s.network.wan ? 'up' : 'down', latency: `${s.network.latency_ms} ms`, devices: s.network.devices }) },
];

export function drawHighlight(ctx, rect, t) {
  if (!rect) return;
  const [x, y, w, h] = rect;
  const on = Math.floor(t * 4) % 2 === 0;
  outline(ctx, x - 1, y - 1, w + 2, h + 2, on ? '#fde047' : '#ffffff');
  px(ctx, x - 1, y - 1, '#fde047'); px(ctx, x + w, y - 1, '#fde047'); px(ctx, x - 1, y + h, '#fde047'); px(ctx, x + w, y + h, '#fde047');
}

export function hitTest(x, y, extra = []) {
  // smallest matching rect wins
  let best = null;
  for (const it of [...extra, ...ITEMS]) {
    const [rx, ry, rw, rh] = it.rect;
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
      const area = rw * rh;
      if (!best || area < best.area) best = { item: it, area };
    }
  }
  return best ? best.item : null;
}

export function roomAt(x, floor) {
  if (floor === 'outside') return null;
  for (const [name, r] of Object.entries(L.rooms)) {
    if (r.floor === floor && x >= r.x && x < r.x + r.w) return name;
  }
  return null;
}

