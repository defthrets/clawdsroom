// CAMS // RECENT: the bottom-right square of the HUD. Frigate's latest detections as a strip of CCTV-style
// cards (newest first, swipe for more); tap one for the full viewer: snapshot, clip, and the camera live.
// With no Frigate link (FRIGATE_URL unset, or demo mode) it uses the room's own `cam` events and draws
// a stand-in frame for each.

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hms = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
// label → accent colour (identity, always shown with the label text)
const HUE = { person: '#ff4d8d', car: '#22e5ff', truck: '#22e5ff', bicycle: '#22e5ff', motorcycle: '#22e5ff', cat: '#ffb020', dog: '#ffb020', bird: '#4ade80', package: '#c084fc' };
const hueFor = (label) => HUE[String(label).split(':')[0].trim().toLowerCase()] || '#a5f3fc';

// A stand-in frame for events without a picture: a dark CCTV scene with a silhouette and noise.
const fakeCache = new Map();
function fakeFrame(ev) {
  const key = `${ev.id}`;
  if (fakeCache.has(key)) return fakeCache.get(key);
  const w = 224, h = 126, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0b1a22'); g.addColorStop(0.55, '#10262c'); g.addColorStop(1, '#0a1316');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // ground and a wall/fence line
  ctx.fillStyle = '#132d2f'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
  ctx.fillStyle = 'rgba(160,220,220,0.08)';
  for (let x = 0; x < w; x += 14) ctx.fillRect(x + rnd() * 4, h * 0.38, 2, h * 0.26);
  ctx.fillRect(0, h * 0.38, w, 2);
  // the subject
  const L = String(ev.label).split(':')[0].trim().toLowerCase();
  const cx = w * (0.3 + rnd() * 0.4), base = h * 0.86;
  ctx.fillStyle = 'rgba(190,240,240,0.55)';
  if (L === 'person') {
    ctx.beginPath(); ctx.arc(cx, base - 58, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - 9, base - 49, 18, 28); ctx.fillRect(cx - 8, base - 22, 6, 22); ctx.fillRect(cx + 2, base - 22, 6, 22);
  } else if (L === 'car' || L === 'truck') {
    ctx.fillRect(cx - 40, base - 24, 80, 18); ctx.fillRect(cx - 24, base - 38, 44, 16);
    ctx.fillStyle = 'rgba(255,240,180,0.7)'; ctx.fillRect(cx + 34, base - 20, 6, 4);
  } else if (L === 'cat' || L === 'dog') {
    ctx.fillRect(cx - 16, base - 16, 30, 11); ctx.fillRect(cx + 12, base - 24, 10, 10); ctx.fillRect(cx - 14, base - 6, 4, 6); ctx.fillRect(cx + 8, base - 6, 4, 6); ctx.fillRect(cx - 22, base - 20, 8, 3);
  } else if (L === 'bird') {
    ctx.beginPath(); ctx.ellipse(cx, base - 50, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(cx - 12, base - 54, 8, 2); ctx.fillRect(cx + 4, base - 54, 8, 2);
  } else {
    ctx.fillRect(cx - 10, base - 30, 20, 30);
  }
  // sensor noise and scanlines
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/jpeg', 0.8);
  fakeCache.set(key, url);
  if (fakeCache.size > 60) fakeCache.delete(fakeCache.keys().next().value);
  return url;
}

export function initCams(store, { $ }) {
  const strip = $('cq-strip'), meta = $('cq-meta'), viewer = $('cqv');
  let events = [], linked = null, lastKey = '', newestSeen = null, firstLoad = true;

  // ------------------------------------------------------------ data
  function fromRoom() {
    const evs = (store.state.events || []).filter((e) => e.type === 'cam').slice(-24).reverse();
    const list = evs.map((e) => ({ id: `room-${e.at}-${e.camera}`, camera: e.camera || 'cam', label: e.label || 'motion', score: null, start: e.at, end: null, zones: [], clip: false, snapshot: false, box: null, room: true }));
    if (store.mode === 'demo') { // a little history so the square isn't empty in demo mode
      const base = Math.floor(Date.now() / 3600e3) * 3600e3;
      [['front', 'person', 7], ['back', 'cat', 19], ['side', 'car', 34], ['shed', 'bird', 52], ['front', 'package', 71], ['back', 'person', 96]]
        .forEach(([camera, label, m], i) => list.push({ id: `demo-${i}`, camera, label, score: 0.7 + i * 0.04, start: base - m * 60e3, end: null, zones: [], clip: false, snapshot: false, box: null, room: true }));
    }
    return list;
  }

  async function refresh() {
    if (store.mode !== 'demo') {
      try {
        const r = await fetch('/api/cams/recent?limit=24', { cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        linked = !!(j && j.enabled);
        if (linked) { events = j.events || []; render(); return; }
      } catch { linked = false; }
    } else linked = false;
    events = fromRoom();
    render();
  }
  setInterval(refresh, 5000);
  store.on('event', (e) => { if (e.type === 'cam') setTimeout(refresh, linked ? 1500 : 50); });
  setTimeout(refresh, 800);

  const thumb = (e) => (linked && !e.room ? `/api/cams/thumb/${encodeURIComponent(e.id)}` : fakeFrame(e));

  // ------------------------------------------------------------ the strip
  function render() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = events.filter((e) => e.start >= today.getTime()).length;
    const online = store.state.cams?.online, total = (store.state.cams?.names || []).length;
    meta.innerHTML = `${linked ? '<span class="cq-live">● FRIGATE</span>' : '<span class="cq-off">○ ROOM FEED</span>'} ${n} TODAY${total ? ` · ${online ?? 0}/${total} UP` : ''}`;
    const key = events.map((e) => e.id).join('|');
    if (key === lastKey) { for (const el of strip.querySelectorAll('[data-t]')) el.textContent = ago(Number(el.dataset.t)); return; }
    lastKey = key;
    const newest = events[0]?.id;
    const fresh = !firstLoad && newest && newest !== newestSeen;
    newestSeen = newest; firstLoad = false;
    if (!events.length) {
      strip.innerHTML = '<div class="cq-empty"><span>NO DETECTIONS YET</span><small>FRIGATE EVENTS APPEAR HERE</small></div>';
      return;
    }
    strip.innerHTML = events.map((e, i) => {
      const hue = hueFor(e.label);
      return `<button class="cq-card${i === 0 ? ' newest' : ''}${i === 0 && fresh ? ' fresh' : ''}" data-i="${i}" style="--hue:${hue}">
        <img src="${esc(thumb(e))}" alt="" loading="lazy" decoding="async">
        <span class="cq-osd">${esc(String(e.camera).toUpperCase())} ${hms(e.start)}</span>
        <span class="cq-age" data-t="${e.start}">${ago(e.start)}</span>
        <span class="cq-label">${esc(String(e.label).toUpperCase())}</span>
        ${e.score != null ? `<span class="cq-score"><i style="width:${Math.round(e.score * 100)}%"></i></span>` : ''}
        ${i === 0 ? '<span class="cq-new">LATEST</span>' : ''}
      </button>`;
    }).join('');
    for (const img of strip.querySelectorAll('img')) img.addEventListener('error', () => { const e = events[Number(img.closest('.cq-card').dataset.i)]; if (e) img.src = fakeFrame(e); }, { once: true });
    if (fresh) strip.scrollTo({ left: 0, behavior: 'smooth' });
  }
  setInterval(() => { for (const el of strip.querySelectorAll('[data-t]')) el.textContent = ago(Number(el.dataset.t)); }, 10000);
  store.on('state', () => { if (linked === false) { const r = fromRoom(); if (r.map((e) => e.id).join('|') !== events.map((e) => e.id).join('|')) { events = r; render(); } } });

  strip.addEventListener('click', (ev) => {
    const c = ev.target.closest('.cq-card');
    if (c) openViewer(Number(c.dataset.i));
  });

  // ------------------------------------------------------------ the viewer
  const v = { img: $('cqv-img'), vid: $('cqv-vid'), title: $('cqv-title'), meta: $('cqv-meta'), film: $('cqv-film'), live: $('cqv-live'), clip: $('cqv-clip'), mode: $('cqv-mode') };
  let idx = 0, liveTimer = null, mode = 'snap', closeTimer = null;
  function openViewer(i) {
    idx = i; mode = 'snap';
    viewer.classList.remove('hidden');
    show();
  }
  function closeViewer() { viewer.classList.add('hidden'); stopLive(); v.vid.pause(); v.vid.removeAttribute('src'); v.vid.load(); clearTimeout(closeTimer); }
  function stopLive() { clearInterval(liveTimer); liveTimer = null; }
  function show() {
    const e = events[idx];
    if (!e) return closeViewer();
    clearTimeout(closeTimer); closeTimer = setTimeout(closeViewer, 90000);
    const real = linked && !e.room;
    stopLive();
    v.vid.pause();
    viewer.dataset.mode = mode;
    viewer.style.setProperty('--hue', hueFor(e.label));
    v.title.innerHTML = `<b>${esc(String(e.label).toUpperCase())}</b> @ ${esc(String(e.camera).toUpperCase())}`;
    const dur = e.end && e.start ? `${Math.max(1, Math.round((e.end - e.start) / 1000))}s` : e.room ? '—' : 'ONGOING';
    v.meta.innerHTML = [
      ['TIME', `${hms(e.start)} · ${ago(e.start)} AGO`],
      ['CONFIDENCE', e.score != null ? `${Math.round(e.score * 100)}%` : '—'],
      ['DURATION', dur],
      ['ZONES', e.zones && e.zones.length ? e.zones.join(', ').toUpperCase() : '—'],
      ['EVENT', esc(String(e.id).slice(0, 22))],
    ].map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    v.clip.disabled = !(real && e.clip);
    v.live.disabled = !real;
    if (mode === 'clip' && real && e.clip) {
      v.vid.src = `/api/cams/clip/${encodeURIComponent(e.id)}`;
      v.vid.play().catch(() => {});
    } else if (mode === 'live' && real) {
      const tick = () => { v.img.src = `/api/cams/latest/${encodeURIComponent(e.camera)}?h=720&t=${Date.now()}`; };
      tick(); liveTimer = setInterval(tick, 1000);
    } else {
      mode = 'snap'; viewer.dataset.mode = 'snap';
      v.img.src = real && e.snapshot ? `/api/cams/snapshot/${encodeURIComponent(e.id)}` : real ? thumb(e) : fakeFrame(e);
    }
    v.mode.textContent = mode === 'live' ? `● LIVE · ${String(e.camera).toUpperCase()}` : mode === 'clip' ? '▶ CLIP' : '◼ SNAPSHOT';
    v.film.innerHTML = events.slice(0, 16).map((x, i) => `<button class="cqv-f${i === idx ? ' on' : ''}" data-i="${i}" style="--hue:${hueFor(x.label)}"><img src="${esc(thumb(x))}" alt=""><span>${esc(String(x.label).toUpperCase())}</span></button>`).join('');
  }
  v.img.addEventListener('error', () => { const e = events[idx]; if (e && mode === 'snap') v.img.src = fakeFrame(e); });
  $('cqv-close').addEventListener('click', closeViewer);
  $('cqv-prev').addEventListener('click', () => { idx = Math.max(0, idx - 1); mode = 'snap'; show(); });
  $('cqv-next').addEventListener('click', () => { idx = Math.min(events.length - 1, idx + 1); mode = 'snap'; show(); });
  v.clip.addEventListener('click', () => { mode = mode === 'clip' ? 'snap' : 'clip'; show(); });
  v.live.addEventListener('click', () => { mode = mode === 'live' ? 'snap' : 'live'; show(); });
  v.film.addEventListener('click', (ev) => { const b = ev.target.closest('.cqv-f'); if (b) { idx = Number(b.dataset.i); mode = 'snap'; show(); } });
  viewer.addEventListener('click', (ev) => { if (ev.target === viewer) closeViewer(); });

  return { refresh, open: openViewer };
}
