// Small helpers: math, time, a 3x5 pixel font, and sprite rasterising.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

export function hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

export function fmtAgo(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtUptime(sec) {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

// ----------------------------------------------------------------- pixel font (3x5)
const GLYPHS = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '010', '001'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['110', '001', '010', '100', '111'], 3: ['111', '001', '011', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '110', '001', '110'],
  6: ['011', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '110'],
  ' ': ['000', '000', '000', '000', '000'], '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'], ':': ['000', '010', '000', '010', '000'],
  ';': ['000', '010', '000', '010', '100'], '!': ['010', '010', '010', '000', '010'],
  '?': ['110', '001', '010', '000', '010'], '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'], '/': ['001', '001', '010', '100', '100'],
  '%': ['101', '001', '010', '100', '101'], '(': ['010', '100', '100', '100', '010'],
  ')': ['010', '001', '001', '001', '010'], "'": ['010', '010', '000', '000', '000'],
  '"': ['101', '101', '000', '000', '000'], '<': ['001', '010', '100', '010', '001'],
  '>': ['100', '010', '001', '010', '100'], '=': ['000', '111', '000', '111', '000'],
  '_': ['000', '000', '000', '000', '111'], '#': ['101', '111', '101', '111', '101'],
  '@': ['010', '101', '111', '100', '011'], '°': ['010', '101', '010', '000', '000'],
  '·': ['000', '000', '010', '000', '000'], '[': ['110', '100', '100', '100', '110'],
  ']': ['011', '001', '001', '001', '011'], '*': ['101', '010', '111', '010', '101'],
  '|': ['010', '010', '010', '010', '010'], '~': ['000', '001', '111', '100', '000'],
  '&': ['010', '101', '010', '101', '011'], '$': ['011', '110', '010', '011', '110'],
  '♪': ['001', '001', '011', '111', '110'], '♥': ['101', '111', '111', '010', '000'],
  '→': ['000', '010', '111', '010', '000'], '↑': ['010', '111', '010', '010', '010'],
  '↓': ['010', '010', '010', '111', '010'], '…': ['000', '000', '000', '000', '101'],
  '√': ['001', '001', '101', '010', '000'],
};
const UNKNOWN = ['111', '101', '111', '101', '111'];

export function textWidth(str, scale = 1, spacing = 1) {
  const s = String(str);
  return s.length ? (s.length * (3 + spacing) - spacing) * scale : 0;
}

// Draw crisp pixel text. Lowercase is drawn as uppercase (the font has one case).
export function text(ctx, str, x, y, color = '#fff', scale = 1, spacing = 1) {
  const s = String(str).toUpperCase();
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of s) {
    const g = GLYPHS[ch] || UNKNOWN;
    for (let r = 0; r < 5; r++) {
      const row = g[r];
      for (let c = 0; c < 3; c++) {
        if (row[c] === '1') ctx.fillRect(cx + c * scale, cy + r * scale, scale, scale);
      }
    }
    cx += (3 + spacing) * scale;
  }
}

export function textCentered(ctx, str, cx, y, color, scale = 1) {
  text(ctx, str, cx - Math.floor(textWidth(str, scale) / 2), y, color, scale);
}

// ----------------------------------------------------------------- sprites
// A sprite is {pal: {char: color}, rows: [...]}; '.' and ' ' are transparent.
const spriteCache = new Map();

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function rasterize(sprite, { flip = false, tint = null } = {}) {
  const key = `${sprite.id}|${flip ? 1 : 0}|${tint || ''}`;
  let cv = spriteCache.get(key);
  if (cv) return cv;
  const rows = sprite.rows;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  cv = makeCanvas(w, h);
  const g = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = tint || sprite.pal[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  }
  spriteCache.set(key, cv);
  return cv;
}

export function drawSprite(ctx, sprite, x, y, opts = {}) {
  const cv = rasterize(sprite, opts);
  ctx.drawImage(cv, Math.round(x), Math.round(y));
  return cv;
}

export function spriteSize(sprite) {
  return { w: Math.max(...sprite.rows.map((r) => r.length)), h: sprite.rows.length };
}

// ----------------------------------------------------------------- primitives
export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function outline(ctx, x, y, w, h, color) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// Filled box with a 1px outline and a 1px highlight/shadow.
export function box(ctx, x, y, w, h, fill, line = null, hi = null, lo = null) {
  rect(ctx, x, y, w, h, fill);
  if (hi) { rect(ctx, x + 1, y + 1, w - 2, 1, hi); rect(ctx, x + 1, y + 1, 1, h - 2, hi); }
  if (lo) { rect(ctx, x + 1, y + h - 2, w - 2, 1, lo); rect(ctx, x + w - 2, y + 1, 1, h - 2, lo); }
  if (line) outline(ctx, x, y, w, h, line);
}

export function hline(ctx, x1, x2, y, color) { rect(ctx, x1, y, x2 - x1 + 1, 1, color); }
export function vline(ctx, x, y1, y2, color) { rect(ctx, x, y1, 1, y2 - y1 + 1, color); }

// Pixel circle (filled).
export function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

export function ring(ctx, cx, cy, r, color) {
  for (let a = 0; a < Math.PI * 2; a += 0.08) {
    px(ctx, cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), color);
  }
}

export function line(ctx, x1, y1, x2, y2, color) {
  // Bresenham so it stays crisp.
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x1, y1, 1, 1);
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x1 += sx; }
    if (e2 <= dx) { err += dx; y1 += sy; }
  }
}

// Dither a translucent overlay (checkerboard) to keep the pixel look.
export function dither(ctx, x, y, w, h, color, density = 2) {
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x + ((yy % density) ? 1 : 0); xx < x + w; xx += density) ctx.fillRect(xx, yy, 1, 1);
  }
}

export function mix(a, b, t) {
  // "#rrggbb" mix
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp(pa >> 16, pb >> 16, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

// Speech / thought bubble with a tail pointing down to (tx, ty).
export function bubble(ctx, str, tx, ty, { thought = false, color = '#1e1b4b', bg = '#ffffff', maxChars = 26, above = true } = {}) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, maxChars - 1) + '…'; }
  const w = Math.max(...lines.map((l) => textWidth(l))) + 6;
  const h = lines.length * 6 + 4;
  let x = Math.round(tx - w / 2);
  x = clamp(x, 2, 480 - w - 2);
  const y = above ? Math.round(ty - h - 7) : Math.round(ty + 7);
  rect(ctx, x + 1, y, w - 2, h, bg);
  rect(ctx, x, y + 1, w, h - 2, bg);
  outline(ctx, x + 1, y, w - 2, 1, color); outline(ctx, x + 1, y + h - 1, w - 2, 1, color);
  outline(ctx, x, y + 1, 1, h - 2, color); outline(ctx, x + w - 1, y + 1, 1, h - 2, color);
  if (thought) {
    px(ctx, tx, above ? y + h + 2 : y - 3, bg); px(ctx, tx + 1, above ? y + h + 4 : y - 5, bg);
  } else {
    const tyy = above ? y + h : y - 1;
    const dir = above ? 1 : -1;
    rect(ctx, tx - 1, tyy, 3, 1, bg); rect(ctx, tx, tyy + dir, 1, 1, bg);
    px(ctx, tx - 2, tyy, color); px(ctx, tx + 2, tyy, color); px(ctx, tx - 1, tyy + dir, color); px(ctx, tx + 1, tyy + dir, color); px(ctx, tx, tyy + 2 * dir, color);
  }
  lines.forEach((l, i) => text(ctx, l, x + 3, y + 2 + i * 6, color));
  return { x, y, w, h };
}
