// The comms "core": a holographic particle sphere with rings, drawn on a canvas. It is the talk
// button, and it shows the state of the link: standby, listening, sending, thinking, speaking.

import { CLAWD_BODY, CLAW } from '/js/sprites.js';

const TAU = Math.PI * 2;
const PALETTE = {
  idle:      { core: [34, 229, 255], hot: [190, 250, 255] },
  listening: { core: [34, 229, 255], hot: [255, 255, 255] },
  note:      { core: [255, 130, 60], hot: [255, 220, 190] },
  sending:   { core: [120, 200, 255], hot: [230, 245, 255] },
  thinking:  { core: [250, 190, 40], hot: [255, 240, 190] },
  composing: { core: [255, 170, 60], hot: [255, 245, 215] },
  speaking:  { core: [255, 120, 50], hot: [255, 230, 200] },
  offline:   { core: [244, 63, 94], hot: [255, 190, 200] },
};
const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export class Core {
  // opts: rScale (core size against the canvas), ringText (the lettering around it), holo (Clawd inside)
  constructor(canvas, { rScale = 0.245, ringText = true, holo = true, holoScale = 1.1 } = {}) {
    this.opts = { rScale, ringText, holo, holoScale };
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.level = 0;            // 0..1, smoothed amplitude (mic or speech)
    this.target = 0;
    this.bins = new Float32Array(72);
    this.label = 'CLAWD';
    this.ring = 'CLAWD · HERMES AGENT · NEURAL LINK · ';
    this.col = PALETTE.idle.core.slice();
    this.hot = PALETTE.idle.hot.slice();
    this.boot = 0;             // 0 → 1 as the core powers up
    this.t = 0;
    this.burst = 0;            // a flash when something is sent or arrives
    // points on a sphere (Fibonacci lattice)
    const N = 520;
    this.pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r, s: Math.random() * TAU, k: 0.6 + Math.random() * 0.8 };
    });
    this.sats = Array.from({ length: 3 }, (_, i) => ({ a: (i / 3) * TAU, tilt: 0.35 + i * 0.5, sp: 0.9 + i * 0.35 }));
    this.nodes = []; // tool calls launched onto an orbit: {label, born, a}
    this.blinkAt = 3; this.glitchAt = 4; this.glitch = 0;
  }

  // A tool Clawd is using: it launches out of the core and orbits with its name for a while.
  addNode(label) {
    const a = this.nodes.length ? this.nodes[this.nodes.length - 1].a + 2.1 : -Math.PI / 3;
    this.nodes.push({ label: String(label).toUpperCase().slice(0, 30), born: this.t, a });
    if (this.nodes.length > 4) this.nodes.shift();
    this.burst = Math.max(this.burst, 0.6);
  }

  set(state) { if (state !== this.state) { this.state = state; if (state === 'sending') this.burst = 1; } }
  powerUp() { this.boot = 0; }
  flash() { this.burst = 1; }

  // Feed a frequency array (0..255) from an analyser, or nothing to let the core make its own motion.
  feed(bytes) {
    if (!bytes) return;
    let sum = 0;
    for (let i = 0; i < this.bins.length; i++) {
      const v = bytes[Math.floor((i / this.bins.length) * bytes.length * 0.55)] / 255;
      this.bins[i] = Math.max(v, this.bins[i] * 0.82);
      sum += v;
    }
    this.target = Math.min(1, (sum / this.bins.length) * 2.4);
  }
  pulse(v = 1) { this.target = Math.max(this.target, v); } // speech word boundaries

  fit() {
    const s = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1)) * (this.scale || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== Math.round(w * s) || this.cv.height !== Math.round(h * s)) { this.cv.width = Math.round(w * s); this.cv.height = Math.round(h * s); }
    this.ctx.setTransform(s, 0, 0, s, 0, 0);
    return { w, h };
  }

  // Is (x, y) in CSS pixels of the canvas on the core itself?
  hit(x, y) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    return Math.hypot(x - w / 2, y - h / 2) < this.R * 1.25;
  }

  frame(dt) {
    const { w, h } = this.fit();
    const ctx = this.ctx;
    this.t += dt;
    const t = this.t;
    this.boot = Math.min(1, this.boot + dt / 1.1);
    const boot = 1 - (1 - this.boot) ** 3;
    this.burst = Math.max(0, this.burst - dt * 1.6);
    const st = this.state;

    // motion when nothing is feeding us
    if (st === 'speaking') this.target = Math.max(this.target * 0.9, 0.18 + 0.12 * Math.sin(t * 9) * Math.sin(t * 3.1));
    else if (st === 'thinking') this.target = 0.22 + 0.08 * Math.sin(t * 4);
    else if (st === 'composing') this.target = Math.max(this.target * 0.9, 0.2 + 0.1 * Math.sin(t * 11));
    else if (st !== 'listening' && st !== 'note') this.target = 0.05 + 0.03 * Math.sin(t * 1.2);
    this.level = lerp(this.level, this.target, Math.min(1, dt * (this.target > this.level ? 14 : 4)));
    this.target *= 0.92;
    if (st !== 'listening' && st !== 'note') for (let i = 0; i < this.bins.length; i++) this.bins[i] = Math.max(this.bins[i] * 0.9, this.level * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.7 + t * (st === 'speaking' ? 8 : 2)))));

    const pal = PALETTE[st] || PALETTE.idle;
    this.col = mixc(this.col, pal.core, Math.min(1, dt * 4));
    this.hot = mixc(this.hot, pal.hot, Math.min(1, dt * 4));
    const col = this.col, hot = this.hot, L = this.level;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = (this.R = Math.min(w, h) * this.opts.rScale * (0.6 + 0.4 * boot));

    // halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.3);
    halo.addColorStop(0, rgba(col, 0.20 + L * 0.35 + this.burst * 0.3));
    halo.addColorStop(0.45, rgba(col, 0.06 + L * 0.08));
    halo.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // outer tick ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = boot;
    ctx.rotate(t * 0.08);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU, long = i % 10 === 0;
      ctx.strokeStyle = rgba(col, long ? 0.7 : 0.25);
      ctx.lineWidth = long ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 1.62, Math.sin(a) * R * 1.62);
      ctx.lineTo(Math.cos(a) * R * (long ? 1.7 : 1.66), Math.sin(a) * R * (long ? 1.7 : 1.66));
      ctx.stroke();
    }
    ctx.restore();

    // text running around the outside
    if (this.opts.ringText) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.55 * boot;
    ctx.rotate(-t * 0.05);
    ctx.font = '600 9px ui-monospace, Menlo, monospace';
    ctx.fillStyle = rgba(col, 0.9);
    const txt = (this.ring + this.ring).toUpperCase();
    const step = TAU / txt.length;
    for (let i = 0; i < txt.length; i++) {
      ctx.save();
      ctx.rotate(i * step);
      ctx.translate(0, -R * 1.82);
      ctx.fillText(txt[i], -3, 0);
      ctx.restore();
    }
    ctx.restore();
    }

    // three counter-rotating arcs
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = boot;
    const spin = st === 'thinking' ? 2.6 : st === 'composing' ? 1.6 : st === 'sending' ? 3.5 : 0.5;
    for (let k = 0; k < 3; k++) {
      const r = R * (1.42 + k * 0.06);
      const a0 = t * spin * (k % 2 ? -1 : 1) * (1 + k * 0.3) + k * 2.1;
      ctx.strokeStyle = rgba(k === 1 ? hot : col, 0.55 + 0.3 * L);
      ctx.lineWidth = k === 1 ? 2.5 : 1.5;
      ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, 0, r, a0, a0 + 0.9 + k * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r, a0 + Math.PI, a0 + Math.PI + 0.5); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // spectrum ring
    ctx.save();
    ctx.translate(cx, cy);
    const nb = this.bins.length;
    for (let i = 0; i < nb; i++) {
      const v = this.bins[i] * boot;
      const a = (i / nb) * TAU - Math.PI / 2;
      const r0 = R * 1.18, r1 = r0 + 3 + v * R * 0.32;
      ctx.strokeStyle = rgba(v > 0.5 ? hot : col, 0.35 + v * 0.65);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();

    // the sphere
    const rotY = t * (st === 'thinking' ? 1.1 : st === 'composing' ? 0.7 : st === 'sending' ? 2 : 0.25);
    const rotX = 0.35 + Math.sin(t * 0.3) * 0.15;
    const cyY = Math.cos(rotY), syY = Math.sin(rotY), cxX = Math.cos(rotX), sxX = Math.sin(rotX);
    const proj = [];
    for (const p of this.pts) {
      const wob = st === 'thinking'
        ? 0.12 * Math.sin(p.y * 6 + t * 5 + p.s)
        : L * 0.55 * Math.sin(p.x * 4 + t * 7 * p.k + p.s) * Math.cos(p.y * 3 + t * 3);
      const rr = (1 + wob + this.burst * 0.25) * boot;
      let x = p.x * rr, y = p.y * rr, z = p.z * rr;
      const x1 = x * cyY + z * syY, z1 = -x * syY + z * cyY;
      const y2 = y * cxX - z1 * sxX, z2 = y * sxX + z1 * cxX;
      const f = 2.6 / (2.6 + z2);
      proj.push([cx + x1 * R * f, cy + y2 * R * f, z2]);
    }
    proj.sort((a, b) => b[2] - a[2]);
    for (const [x, y, z] of proj) {
      const d = (1 - z) / 2; // 0 back .. 1 front
      ctx.fillStyle = rgba(d > 0.75 ? hot : col, (0.15 + d * 0.85) * (this.opts.holo ? 0.6 : 1));
      const s = (0.8 + d * 1.8) * (this.opts.holo ? 0.85 : 1);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    // latitude scan while thinking
    if (st === 'thinking' || st === 'sending') {
      const yy = Math.sin(t * 2.2) * R * 0.95;
      const rx = Math.sqrt(Math.max(0, R * R - yy * yy));
      ctx.strokeStyle = rgba(hot, 0.8); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + yy, rx, rx * 0.22, 0, 0, TAU); ctx.stroke();
      // satellites orbiting the core
      for (const s of this.sats) {
        s.a += dt * s.sp * 2.2;
        const ox = Math.cos(s.a) * R * 1.3, oy = Math.sin(s.a) * R * 1.3 * Math.cos(s.tilt);
        ctx.fillStyle = rgba(hot, 0.95);
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 3, 0, TAU); ctx.fill();
      }
    }

    // tool nodes: fly out of the core, then orbit with their label, fading after ~14s
    this.nodes = this.nodes.filter((n) => t - n.born < 14);
    ctx.font = '600 9.5px ui-monospace, Menlo, monospace';
    for (const n of this.nodes) {
      const age = t - n.born;
      const out = Math.min(1, age / 0.7), ease = 1 - (1 - out) ** 3;
      const fade = age > 11 ? Math.max(0, 1 - (age - 11) / 3) : 1;
      n.a += dt * 0.12;
      const orbit = R * (0.2 + 1.18 * ease);
      const x = cx + Math.cos(n.a) * orbit, y = cy + Math.sin(n.a) * orbit * 0.82;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = rgba(hot, 0.35); ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(n.a) * R * 0.3, cy + Math.sin(n.a) * R * 0.3 * 0.82); ctx.lineTo(x, y); ctx.stroke();
      ctx.setLineDash([]);
      // diamond node with a pulse ring
      ctx.fillStyle = rgba(hot, 1);
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill();
      const pr = 6 + ((age * 1.4) % 1) * 12;
      ctx.strokeStyle = rgba(hot, 0.6 * (1 - ((age * 1.4) % 1)));
      ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.stroke();
      if (out >= 1) {
        const tw = ctx.measureText(n.label).width;
        let right = x >= cx;
        if (right && x + 14 + tw + 10 > w - 2) right = false;
        if (!right && x - 14 - tw - 10 < 2) right = true;
        const lx = Math.max(2, Math.min(w - tw - 12, right ? x + 14 : x - 14 - tw - 10)), ly = y - 9;
        ctx.fillStyle = 'rgba(2,8,16,0.85)'; ctx.fillRect(lx, ly, tw + 10, 18);
        ctx.strokeStyle = rgba(hot, 0.7); ctx.strokeRect(lx + 0.5, ly + 0.5, tw + 9, 17);
        ctx.fillStyle = rgba(hot, 1); ctx.fillText(n.label, lx + 5, ly + 12.5);
      }
      ctx.globalAlpha = 1;
    }

    // inner core glow
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.55 + L * 0.5));
    g.addColorStop(0, rgba(hot, (this.opts.holo ? 0.3 : 0.65) + L * 0.35));
    g.addColorStop(0.35, rgba(col, 0.25 + L * 0.3));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R * (0.55 + L * 0.5), 0, TAU); ctx.fill();

    if (this.opts.holo) {
      // a dark well behind him so the hologram reads against the sphere
      const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95);
      well.addColorStop(0, 'rgba(1, 6, 12, 0.78)'); well.addColorStop(0.7, 'rgba(1, 6, 12, 0.5)'); well.addColorStop(1, 'rgba(1, 6, 12, 0)');
      ctx.fillStyle = well;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.95, 0, TAU); ctx.fill();
      this.hologram(ctx, cx, cy, R, dt, boot);
    }

    // targeting brackets
    ctx.strokeStyle = rgba(col, 0.6 * boot); ctx.lineWidth = 1.5;
    const B = R * 2.05, l = 16;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + sx * B, y = cy + sy * B * 0.62;
      ctx.beginPath(); ctx.moveTo(x, y - sy * l); ctx.lineTo(x, y); ctx.lineTo(x - sx * l, y); ctx.stroke();
    }
  }

  // Clawd himself as a hologram inside the core: his room sprite, voxel by voxel, scanlined and flickering,
  // standing on a projector beam. His eyes and mouth follow the link: wide while listening, darting while
  // thinking, talking while he answers, crossed out when the link is down.
  hologram(ctx, cx, cy, R, dt, boot) {
    const t = this.t, st = this.state, L = this.level, col = this.col, hot = this.hot;
    const rows = CLAWD_BODY.rows, H = rows.length, W = rows[0].length;
    const px = (R * this.opts.holoScale) / H;
    const bob = Math.sin(t * 1.7) * px * 0.5;
    const x0 = cx - (W / 2) * px, y0 = cy - (H / 2) * px - px * 0.6 + bob;
    // blink and glitch timers
    if (t > this.blinkAt + 0.14) this.blinkAt = t + 2.5 + Math.random() * 3;
    const blinking = t > this.blinkAt && t < this.blinkAt + 0.14;
    if (t > this.glitchAt) { this.glitch = 0.16; this.glitchAt = t + 3 + Math.random() * 5; }
    this.glitch = Math.max(0, this.glitch - dt);
    const glitching = this.glitch > 0 || this.burst > 0.5;

    ctx.save();
    ctx.globalAlpha = boot * (0.82 + 0.18 * Math.sin(t * 23) * Math.sin(t * 7));
    // projector: a glowing pad under his feet and a cone of light up through him
    const fy = y0 + H * px + px * 0.8;
    const cone = ctx.createLinearGradient(0, fy, 0, y0 - px * 2);
    cone.addColorStop(0, rgba(col, 0.32)); cone.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(cx - W * px * 0.28, fy); ctx.lineTo(cx + W * px * 0.28, fy); ctx.lineTo(cx + W * px * 0.62, y0 - px * 2); ctx.lineTo(cx - W * px * 0.62, y0 - px * 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(hot, 0.7); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(cx, fy, W * px * 0.34, px * 0.9, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(col, 0.4);
    ctx.beginPath(); ctx.ellipse(cx, fy, W * px * 0.46 + Math.sin(t * 3) * px, px * 1.3, 0, 0, TAU); ctx.stroke();

    // body voxels
    ctx.globalCompositeOperation = 'lighter';
    const scanY = (t * 0.6) % 1.4 - 0.2; // a bright band sweeping down through him
    for (let r = 0; r < H; r++) {
      const shift = glitching && (r * 7 + Math.floor(t * 30)) % 5 === 0 ? (Math.random() - 0.5) * px * 3 : 0;
      const band = Math.max(0, 1 - Math.abs(r / H - scanY) * 6);
      for (let c = 0; c < W; c++) {
        const ch = rows[r][c];
        if (ch === '.') continue;
        const base = ch === 'p' ? hot : col;
        const a = (ch === 'p' ? 0.78 : 0.55) + band * 0.35;
        ctx.fillStyle = rgba(base, a);
        ctx.fillRect(x0 + c * px + shift, y0 + r * px, px - 0.7, px * 0.7);
      }
    }
    // claws, raised while he listens
    const up = st === 'listening' || st === 'note' ? -px * 2.2 : st === 'speaking' ? -px * (0.6 + Math.sin(t * 8) * 0.6) : 0;
    for (const [side, cxw] of [[-1, x0 - px * 2.2], [1, x0 + W * px - px * 0.8]]) {
      CLAW.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.') continue;
          const cc = side < 0 ? row.length - 1 - c : c;
          ctx.fillStyle = rgba(hot, 0.5);
          ctx.fillRect(cxw + cc * px, y0 + (8 + r) * px + up, px - 0.7, px * 0.7);
        }
      });
    }
    ctx.globalCompositeOperation = 'source-over';

    // face: drawn dark, so it reads against the glow
    const dark = 'rgba(2, 10, 20, 0.92)';
    const ex = [4, 10];
    const look = st === 'thinking' ? Math.round(Math.sin(t * 2.4)) : 0;
    if (st === 'offline') {
      ctx.strokeStyle = 'rgba(255,90,110,0.95)'; ctx.lineWidth = Math.max(1.5, px * 0.35);
      for (const e of ex) {
        const x = x0 + e * px, y = y0 + 6 * px;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px * 2, y + px * 2); ctx.moveTo(x + px * 2, y); ctx.lineTo(x, y + px * 2); ctx.stroke();
      }
    } else if (blinking) {
      ctx.fillStyle = dark;
      for (const e of ex) ctx.fillRect(x0 + e * px, y0 + 7 * px, px * 2, px * 0.5);
    } else {
      const wide = st === 'listening' || st === 'note';
      for (const e of ex) {
        ctx.fillStyle = dark;
        if (wide) ctx.fillRect(x0 + (e - 0.5) * px, y0 + 5 * px, px * 3, px * 3);
        else ctx.fillRect(x0 + e * px, y0 + 6 * px, px * 2, px * 2);
        // the pupil glints in the core colour
        ctx.fillStyle = rgba(hot, 1);
        const gx = x0 + (e + (wide ? 0.6 : 0.5) + look * 0.5) * px, gy = y0 + (wide ? 5.7 : 6.3) * px;
        ctx.fillRect(gx, gy, px * 0.8, px * 0.8);
      }
    }
    // mouth: a line at rest, open and moving while he talks or writes
    ctx.fillStyle = dark;
    const talking = st === 'speaking' || st === 'composing';
    const open = talking ? Math.max(0.4, L * 4.2) : st === 'listening' || st === 'note' ? 0.5 : 0.45;
    ctx.fillRect(x0 + 6 * px, y0 + 9.2 * px, px * 4, px * Math.min(2.6, open));
    if (st === 'thinking') { // a little loading bar across his chest
      const w = px * 6, x = x0 + 5 * px, y = y0 + 12 * px;
      ctx.fillStyle = 'rgba(2,10,20,0.7)'; ctx.fillRect(x, y, w, px * 0.6);
      ctx.fillStyle = rgba(hot, 1); ctx.fillRect(x + ((t * 0.8) % 1) * (w - px * 1.5), y, px * 1.5, px * 0.6);
    }
    // antenna tips pulse
    ctx.globalCompositeOperation = 'lighter';
    for (const c of [4, 11]) {
      const g = ctx.createRadialGradient(x0 + c * px + px / 2, y0 + px / 2, 0, x0 + c * px + px / 2, y0 + px / 2, px * (1.6 + L * 3));
      g.addColorStop(0, rgba(hot, 0.9)); g.addColorStop(1, rgba(hot, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0 + c * px - px * 4, y0 - px * 4, px * 9, px * 9);
    }
    ctx.restore();
  }
}
