// Particles and timed labels: notes, Zzz, sparks, barks, sound waves, smoke, rain.

import { drawSprite, text, textCentered, px, ring, rand, randInt } from './util.js';
import { NOTE, HEART } from './sprites.js';

export class Effects {
  constructor() { this.list = []; }

  add(p) { this.list.push({ t: 0, life: 1, ...p }); return p; }

  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      if (p.update) p.update(p, dt);
      else { p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; }
    }
    this.list = this.list.filter((p) => p.t < p.life);
  }

  draw(ctx) {
    for (const p of this.list) p.draw(ctx, p, p.t / p.life);
  }

  // ---- recipes
  note(x, y) {
    this.add({
      x, y, life: rand(1.6, 2.4), vx: rand(-6, 6), vy: rand(-18, -10), phase: rand(6.28),
      draw: (ctx, p, k) => { if (k < 0.85 || Math.floor(p.t * 10) % 2) drawSprite(ctx, NOTE, p.x + Math.sin(p.t * 4 + p.phase) * 2, p.y); },
    });
  }

  zzz(x, y, { small = false } = {}) {
    this.add({
      x, y, life: small ? 2 : 2.6, vx: 4, vy: -7,
      draw: (ctx, p, k) => text(ctx, 'z', p.x, p.y, '#dbe4ff', !small && k > 0.5 ? 2 : 1),
    });
  }

  spark(x, y) {
    for (let i = 0; i < 5; i++) {
      this.add({
        x, y, life: rand(0.3, 0.7), vx: rand(-40, 40), vy: rand(-60, -10),
        update: (p, dt) => { p.vy += 160 * dt; p.x += p.vx * dt; p.y += p.vy * dt; },
        draw: (ctx, p, k) => px(ctx, p.x, p.y, k < 0.5 ? '#fde68a' : '#fb923c'),
      });
    }
  }

  bark(x, y, dir = 1) {
    this.add({
      x, y, life: 0.9,
      draw: (ctx, p, k) => {
        const r = 3 + Math.floor(k * 8);
        for (let a = -0.6; a <= 0.6; a += 0.12) px(ctx, p.x + Math.cos(a) * r * dir, p.y + Math.sin(a) * r, k < 0.6 ? '#fff' : '#cbd5e1');
      },
    });
    this.add({ x, y: y - 10, life: 1.2, draw: (ctx, p, k) => { if (k < 0.9) text(ctx, '!', p.x + 4 * dir, p.y - k * 4, '#fbbf24', 2); } });
  }

  wave(x, y, color = '#a5f3fc', dir = 1) {
    this.add({
      x, y, life: 1.1,
      draw: (ctx, p, k) => {
        const r = 2 + k * 10;
        for (let a = -0.9; a <= 0.9; a += 0.1) px(ctx, p.x + Math.cos(a) * r * dir, p.y + Math.sin(a) * r, color);
      },
    });
  }

  smoke(x, y, strength = 1) {
    this.add({
      x, y, life: rand(2.5, 4), vx: rand(2, 8), vy: rand(-12, -6) * strength, phase: rand(6.28),
      draw: (ctx, p, k) => {
        if (k > 0.85) return;
        const r = 1 + Math.floor(k * 3);
        const c = k < 0.4 ? '#e2e8f0' : k < 0.7 ? '#cbd5e1' : '#94a3b8';
        const cx = p.x + Math.sin(p.t * 2 + p.phase) * 2;
        ctx.fillStyle = c;
        for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); ctx.fillRect(Math.round(cx - w), Math.round(p.y + dy), w * 2 + 1, 1); }
      },
    });
  }

  heart(x, y) {
    this.add({ x, y, life: 1.6, vx: rand(-4, 4), vy: -14, draw: (ctx, p, k) => { if (k < 0.9) drawSprite(ctx, HEART, p.x, p.y); } });
  }

  glow(x, y, w, h, color = '#fde68a', life = 0.6) {
    this.add({ x, y, life, draw: (ctx, p, k) => { ctx.globalAlpha = (1 - k) * 0.7; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; } });
  }

  label(x, y, str, { color = '#fff', bg = '#1e1b4b', life = 5, scale = 1, rise = 0 } = {}) {
    this.add({
      x, y, life,
      draw: (ctx, p, k) => {
        const yy = p.y - rise * k;
        const w = str.length * 4 * scale + 4;
        ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        ctx.fillStyle = bg; ctx.fillRect(Math.round(p.x - w / 2), Math.round(yy - 2), w, 5 * scale + 4);
        textCentered(ctx, str, p.x, yy, color, scale);
        ctx.globalAlpha = 1;
      },
    });
  }

  ringPulse(x, y, color = '#22d3ee') {
    this.add({ x, y, life: 1, draw: (ctx, p, k) => ring(ctx, p.x, p.y, 2 + k * 10, color) });
  }

  rain(ctx, intensity, t) {
    // Stateless rain streaks; the caller draws this every frame.
    ctx.fillStyle = 'rgba(180, 200, 255, 0.55)';
    const n = Math.floor(90 * intensity);
    for (let i = 0; i < n; i++) {
      const x = (i * 97 + Math.floor(t * 60) * 3) % 480;
      const y = (i * 53 + Math.floor(t * 240)) % 300;
      ctx.fillRect(x, y, 1, 3);
    }
  }
}

export const randPos = (x, y, r = 3) => ({ x: x + randInt(-r, r), y: y + randInt(-r, r) });
