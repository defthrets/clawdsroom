// Frigate, for the HUD's CAMS // RECENT square: the latest detections, their thumbnails, snapshots and
// clips, and a camera's latest frame. Proxied through our server so the iPad only ever talks to the room
// (one origin, works over our HTTPS too). Set FRIGATE_URL to Frigate's internal API, e.g.
// http://127.0.0.1:5000 (the unauthenticated port). Optional FRIGATE_TOKEN is sent as a bearer token.

import { Readable } from 'node:stream';

const ID = /^[A-Za-z0-9._-]{1,80}$/;

// One Frigate event in the shape the HUD wants.
export function shapeEvent(e) {
  const d = e.data || {};
  const score = e.top_score ?? d.top_score ?? d.score ?? e.score ?? null;
  return {
    id: String(e.id),
    camera: String(e.camera || 'cam'),
    label: String(e.sub_label && typeof e.sub_label === 'string' ? `${e.label}: ${e.sub_label}` : e.label || 'motion'),
    score: score == null ? null : Math.round(Number(score) * 100) / 100,
    start: e.start_time ? Math.round(e.start_time * 1000) : null,
    end: e.end_time ? Math.round(e.end_time * 1000) : null,
    zones: Array.isArray(e.zones) ? e.zones.slice(0, 4) : [],
    clip: !!e.has_clip,
    snapshot: !!e.has_snapshot,
    box: Array.isArray(d.box) && d.box.length === 4 ? d.box.map(Number) : null, // normalized x, y, w, h
  };
}

export class Frigate {
  constructor({ url = process.env.FRIGATE_URL || '', token = process.env.FRIGATE_TOKEN || '' } = {}) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.cache = null; this.at = 0;
  }

  get enabled() { return !!this.url; }

  headers(extra = {}) { return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra }; }

  async recent(limit = 24) {
    if (!this.enabled) return { enabled: false, events: [] };
    if (this.cache && Date.now() - this.at < 4000) return this.cache;
    const r = await fetch(`${this.url}/api/events?limit=${Math.min(50, limit)}&include_thumbnails=0`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw Object.assign(new Error(`frigate ${r.status}`), { status: 502 });
    const list = await r.json();
    this.cache = { enabled: true, at: Date.now(), events: (Array.isArray(list) ? list : []).map(shapeEvent) };
    this.at = Date.now();
    return this.cache;
  }

  // Stream a Frigate media file to the client, passing byte ranges through (Safari needs them for video).
  async pipe(req, res, kind, id, query = '') {
    if (!this.enabled) { res.writeHead(404); return res.end('frigate not configured'); }
    if (!ID.test(id || '')) { res.writeHead(400); return res.end('bad id'); }
    const paths = {
      thumb: [`/api/events/${id}/thumbnail.jpg`, `/api/events/${id}/thumbnail.webp`],
      snapshot: [`/api/events/${id}/snapshot.jpg?bbox=1`],
      clip: [`/api/events/${id}/clip.mp4`],
      latest: [`/api/${id}/latest.jpg?h=${Math.min(1080, Number(query) || 480)}`, `/api/${id}/latest.webp?h=${Math.min(1080, Number(query) || 480)}`],
    }[kind];
    if (!paths) { res.writeHead(404); return res.end(); }
    let r = null;
    for (const p of paths) {
      try {
        r = await fetch(`${this.url}${p}`, { headers: this.headers(req.headers.range ? { range: req.headers.range } : {}), signal: AbortSignal.timeout(kind === 'clip' ? 30000 : 8000) });
      } catch { r = null; }
      if (r && (r.ok || r.status === 206)) break;
    }
    if (!r || !(r.ok || r.status === 206)) { res.writeHead(r ? r.status : 502); return res.end(); }
    const keep = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    const headers = { 'Cache-Control': kind === 'latest' ? 'no-store' : 'max-age=86400' };
    for (const k of keep) { const v = r.headers.get(k); if (v) headers[k] = v; }
    res.writeHead(r.status, headers);
    if (req.method === 'HEAD' || !r.body) return res.end();
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  }
}
