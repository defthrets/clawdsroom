// The HUD's voice link: hold to talk to Clawd or Hermes (or leave a voice note), read the thread,
// hear the replies. Recording needs a secure page (HTTPS) on the iPad; typing works anywhere.

const AUTO_CLOSE_MS = 90000;
const MAX_REC_S = 120;
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hms = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const STATUS = { sending: 'SENDING', transcribing: 'TRANSCRIBING', thinking: 'THINKING', delivered: 'DELIVERED', queued: 'QUEUED · NO LINK', failed: 'FAILED', received: '' };

export function initComms(store, { $, params }) {
  // ------------------------------------------------------------ token (only needed if the server has one)
  let token = params.get('token') || '';
  try { if (token) localStorage.setItem('clawdhud.token', token); else token = localStorage.getItem('clawdhud.token') || ''; } catch { /* private mode */ }
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const panel = $('comms'), btn = $('comms-btn');
  const ui = {
    agents: $('cm-agents'), thread: $('cm-thread'), title: $('cm-title'), ptt: $('cm-ptt'), pttLabel: $('cm-ptt-label'),
    level: $('cm-level'), cancel: $('cm-cancel'), hint: $('cm-hint'), live: $('cm-live'), input: $('cm-input'),
    sendBtn: $('cm-send'), speak: $('cm-speak'), badge: $('comms-badge'),
  };
  let agents = [{ id: 'clawd', label: 'Clawd', ready: false }, { id: 'hermes', label: 'Hermes', ready: false }];
  let current = 'clawd';
  let mode = 'talk';
  let speakReplies = true;
  try { speakReplies = localStorage.getItem('clawdhud.speak') !== '0'; } catch { /* ignore */ }
  let lastTouch = 0;
  const seen = new Set();
  let seeded = false;

  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ------------------------------------------------------------ open / close
  const isOpen = () => !panel.classList.contains('hidden');
  function open(agent) {
    if (agent) current = agent;
    panel.classList.remove('hidden');
    btn.classList.add('on');
    lastTouch = Date.now();
    loadAgents();
    render(true);
  }
  function close() {
    if (rec) stopRec(false);
    panel.classList.add('hidden');
    btn.classList.remove('on');
  }
  btn.addEventListener('click', () => { unlockAudio(); isOpen() ? close() : open(); });
  $('cm-close').addEventListener('click', close);
  panel.addEventListener('pointerdown', () => { lastTouch = Date.now(); unlockAudio(); });
  setInterval(() => {
    if (isOpen() && !rec && !speaking() && Date.now() - lastTouch > AUTO_CLOSE_MS) close();
  }, 5000);

  // ------------------------------------------------------------ agents
  async function loadAgents() {
    if (store.mode === 'demo') { agents = agents.map((a) => ({ ...a, ready: true, type: 'demo' })); renderAgents(); return; }
    try {
      const r = await fetch('/api/comms/agents', { cache: 'no-store' });
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) agents = list; }
    } catch { /* offline */ }
    if (!agents.some((a) => a.id === current)) current = agents[0]?.id;
    renderAgents();
  }
  setInterval(() => { if (isOpen()) loadAgents(); }, 60000);

  function renderAgents() {
    ui.agents.innerHTML = agents.map((a) => {
      const thinking = log().some((e) => e.to === a.id && (e.status === 'thinking' || e.status === 'sending' || e.status === 'transcribing'));
      const sub = thinking ? 'THINKING…' : a.ready ? `LINKED · ${String(a.type || '').toUpperCase()}` : 'NO LINK · QUEUES';
      return `<button class="agent${a.id === current ? ' sel' : ''}${a.ready ? ' ready' : ''}${thinking ? ' busy' : ''}${speakingAgent === a.id ? ' talking' : ''}" data-id="${esc(a.id)}">
        <span class="ag-dot"></span><span class="ag-name">${esc(String(a.label || a.id).toUpperCase())}</span><span class="ag-sub">${sub}</span></button>`;
    }).join('');
  }
  ui.agents.addEventListener('click', (ev) => {
    const b = ev.target.closest('.agent');
    if (!b) return;
    current = b.dataset.id;
    renderAgents(); render(true);
  });

  for (const b of document.querySelectorAll('.cm-mode button')) {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      for (const o of document.querySelectorAll('.cm-mode button')) o.classList.toggle('sel', o === b);
      ui.pttLabel.textContent = rec ? ui.pttLabel.textContent : idleLabel();
    });
  }
  const idleLabel = () => (mode === 'note' ? 'HOLD TO RECORD' : 'HOLD TO TALK');

  ui.speak.addEventListener('click', () => {
    speakReplies = !speakReplies;
    try { localStorage.setItem('clawdhud.speak', speakReplies ? '1' : '0'); } catch { /* ignore */ }
    ui.speak.classList.toggle('sel', speakReplies);
    ui.speak.textContent = speakReplies ? '🔊 SPEAK REPLIES' : '🔇 REPLIES MUTED';
    if (!speakReplies) stopSpeaking();
  });
  ui.speak.classList.toggle('sel', speakReplies);
  ui.speak.textContent = speakReplies ? '🔊 SPEAK REPLIES' : '🔇 REPLIES MUTED';

  // ------------------------------------------------------------ thread
  const log = () => (Array.isArray(store.state.comms?.log) ? store.state.comms.log : []);
  let threadKey = '';
  function render(force = false) {
    const agent = agents.find((a) => a.id === current) || { id: current, label: current };
    ui.title.textContent = String(agent.label || current).toUpperCase();
    const items = log().filter((e) => e.to === current || e.from === current).slice(-30);
    const key = JSON.stringify(items.map((e) => [e.id, e.status, e.text, e.audio]));
    if (!force && key === threadKey) return;
    threadKey = key;
    if (!items.length) {
      ui.thread.innerHTML = `<div class="cm-empty">NO TRAFFIC WITH ${esc(String(agent.label || current).toUpperCase())} YET<br><small>${secure ? 'hold the button and speak' : 'type below, or open the HUD over HTTPS to use the mic'}</small></div>`;
      return;
    }
    ui.thread.innerHTML = items.map((e) => {
      const mine = e.from === 'you';
      const who = mine ? `YOU → ${esc(String(e.to).toUpperCase())}` : `${esc(String(e.from).toUpperCase())} → YOU`;
      const kind = e.kind === 'note' ? ' · VOICE NOTE' : e.kind === 'talk' ? ' · TALK' : '';
      const st = STATUS[e.status] ?? String(e.status || '').toUpperCase();
      const src = e.audio ? `/api/comms/audio/${e.audio}` : e.audio_src || '';
      const thinking = e.status === 'thinking' || e.status === 'sending' || e.status === 'transcribing';
      return `<div class="msg ${mine ? 'you' : 'them'}${e.status === 'failed' ? ' failed' : ''}">
        <div class="msg-meta">${who}${kind} · ${hms(e.at)}${st ? ` · <b class="st-${esc(e.status)}">${esc(st)}</b>` : ''}</div>
        <div class="msg-body">${src ? `<button class="play" data-src="${esc(src)}">▶</button>` : ''}<span>${esc(e.text || (src ? '(voice, no transcript)' : ''))}</span></div>
        ${e.error ? `<div class="msg-err">${esc(e.error)}</div>` : ''}
        ${thinking && mine ? '<div class="dots"><i></i><i></i><i></i></div>' : ''}
      </div>`;
    }).join('');
    ui.thread.scrollTop = ui.thread.scrollHeight;
  }
  ui.thread.addEventListener('click', (ev) => {
    const b = ev.target.closest('.play');
    if (!b) return;
    unlockAudio();
    playSrc(b.dataset.src);
  });

  // New replies: open the console on that agent and say them out loud.
  store.on('state', () => {
    const items = log();
    if (!seeded) { for (const e of items) seen.add(e.id); seeded = true; } // don't read out old replies on load
    for (const e of items) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.kind === 'reply') {
        if (!isOpen()) open(e.from); else if (!rec) current = e.from;
        lastTouch = Date.now();
        if (speakReplies && !rec) say(e);
      }
    }
    const pending = items.filter((e) => e.from === 'you' && (e.status === 'thinking' || e.status === 'sending' || e.status === 'transcribing')).length;
    ui.badge.textContent = pending ? String(pending) : '';
    ui.badge.classList.toggle('hidden', !pending);
    if (isOpen()) { renderAgents(); render(); }
  });

  // ------------------------------------------------------------ sending
  async function sendText(text) {
    text = text.trim();
    if (!text) return;
    if (store.mode === 'demo') return demoExchange({ text });
    try {
      const r = await fetch('/api/comms/send', { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ to: current, kind: mode, text }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      flash(`sent to ${current}`);
    } catch (e) { flash(`not sent: ${e.message}`, true); }
  }

  async function sendVoice(blob, text, secs) {
    if (store.mode === 'demo') return demoExchange({ text: text || `(${secs.toFixed(0)}s voice ${mode === 'note' ? 'note' : 'clip'})` });
    const q = new URLSearchParams({ to: current, kind: mode });
    if (text) q.set('text', text.slice(0, 1500));
    try {
      const r = await fetch(`/api/comms/voice?${q}`, { method: 'POST', headers: { 'content-type': blob.type || 'audio/mp4', ...auth }, body: blob });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      flash(mode === 'note' ? `voice note left for ${current}` : `sent to ${current}`);
    } catch (e) { flash(`not sent: ${e.message}`, true); }
  }

  ui.sendBtn.addEventListener('click', () => { sendText(ui.input.value); ui.input.value = ''; ui.input.blur(); });
  ui.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { sendText(ui.input.value); ui.input.value = ''; ui.input.blur(); } });

  let hintTimer = null;
  function flash(text, bad = false) {
    ui.hint.textContent = text.toUpperCase();
    ui.hint.classList.toggle('bad', bad);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { ui.hint.classList.remove('bad'); ui.hint.textContent = baseHint(); }, 4000);
  }
  const baseHint = () => (secure ? 'HOLD, OR TAP TO START · TAP AGAIN TO SEND' : 'MIC NEEDS HTTPS · SEE README');

  // Demo mode has no server: fake the round trip so the console can be tried.
  function demoExchange({ text }) {
    const id = `d${Date.now().toString(36)}`;
    const entry = { id, at: Date.now(), from: 'you', to: current, kind: mode, text, status: 'thinking' };
    const put = (e) => store.patch({ comms: { log: [...log().filter((x) => x.id !== e.id), e].slice(-60) } });
    put(entry);
    const who = current;
    setTimeout(() => {
      put({ ...entry, status: 'delivered' });
      const lines = mode === 'note'
        ? ['Got your voice note. I will pick it up shortly.', 'Noted. I will get on it.']
        : ['Copy that. Everything looks quiet on the homelab.', 'On it. Starlink is holding steady.', 'Roger. I will keep an eye on it.'];
      put({ id: `${id}r`, at: Date.now(), from: who, to: 'you', kind: 'reply', text: lines[Math.floor(Math.random() * lines.length)], status: 'received' });
    }, 1800);
  }

  // ------------------------------------------------------------ recording
  let rec = null; // {mr, stream, chunks, started, ctx, analyser, sr, transcript, timer, held}
  function pickMime() {
    for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* old Safari */ }
    }
    return '';
  }

  async function startRec() {
    if (rec) return;
    stopSpeaking();
    if (!secure) { flash('mic needs the HUD over https', true); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { flash(`mic blocked: ${e.name || e.message}`, true); return; }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const r = { mr, stream, chunks: [], started: performance.now(), transcript: '', interim: '', held: false };
    rec = r;
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
    mr.start(250);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      r.ctx = new Ctx();
      r.analyser = r.ctx.createAnalyser();
      r.analyser.fftSize = 512;
      r.ctx.createMediaStreamSource(stream).connect(r.analyser);
    } catch { /* no level meter */ }
    if (SR) {
      try {
        const sr = new SR();
        sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-GB';
        sr.onresult = (ev) => {
          let fin = '', interim = '';
          for (let i = 0; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript) : (interim += ev.results[i][0].transcript));
          r.transcript = fin.trim(); r.interim = interim.trim();
          ui.live.textContent = `${r.transcript} ${r.interim}`.trim() || '…';
        };
        sr.onerror = () => {};
        sr.start();
        r.sr = sr;
      } catch { /* not allowed here */ }
    }
    panel.classList.add('recording');
    ui.cancel.classList.remove('hidden');
    ui.live.textContent = SR ? '…' : '';
    ui.live.classList.toggle('hidden', !SR);
    r.timer = setInterval(() => {
      const s = (performance.now() - r.started) / 1000;
      ui.pttLabel.textContent = `${mode === 'note' ? 'RECORDING' : 'LISTENING'} ${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
      if (s >= MAX_REC_S) stopRec(true);
    }, 200);
    drawLevel();
  }

  function stopRec(send) {
    const r = rec;
    if (!r) return;
    rec = null;
    clearInterval(r.timer);
    const secs = (performance.now() - r.started) / 1000;
    try { r.sr && r.sr.stop(); } catch { /* ignore */ }
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      try { r.ctx && r.ctx.close(); } catch { /* ignore */ }
      const blob = new Blob(r.chunks, { type: (r.mr.mimeType || 'audio/mp4').split(';')[0] });
      const text = `${r.transcript} ${r.interim}`.trim();
      if (send && secs >= 0.6 && blob.size > 0) sendVoice(blob, text, secs);
      else if (send) flash('too short, hold a little longer', true);
    };
    try { r.mr.state !== 'inactive' ? r.mr.stop() : r.mr.onstop(); } catch { r.mr.onstop(); }
    panel.classList.remove('recording');
    ui.cancel.classList.add('hidden');
    ui.pttLabel.textContent = idleLabel();
    setTimeout(() => { if (!rec) ui.live.classList.add('hidden'); }, 2500);
  }

  // Hold to talk, or tap to start and tap again to send.
  const HOLD_MS = 450;
  let downAt = 0, early = null; // early: how long it was held if released before the mic was ready
  ui.ptt.addEventListener('pointerdown', async (ev) => {
    ev.preventDefault();
    unlockAudio();
    if (rec) { stopRec(true); downAt = 0; return; }
    downAt = performance.now();
    early = null;
    await startRec();
    if (rec && early != null && early > HOLD_MS) stopRec(true);
  });
  const release = () => {
    if (!downAt) return;
    const held = performance.now() - downAt;
    downAt = 0;
    if (!rec) { early = held; return; }
    if (held > HOLD_MS) stopRec(true); // a hold sends on release; a tap leaves it recording
  };
  ui.ptt.addEventListener('pointerup', release);
  ui.ptt.addEventListener('pointercancel', release);
  ui.ptt.addEventListener('contextmenu', (ev) => ev.preventDefault());
  ui.cancel.addEventListener('click', () => { stopRec(false); flash('discarded'); });

  // A ring around the button that follows the mic level.
  function drawLevel() {
    const cv = ui.level, ctx = cv.getContext('2d');
    const s = Math.max(1, Math.min(3, window.devicePixelRatio || 1)) * 1.5;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * s)) { cv.width = Math.round(w * s); cv.height = Math.round(h * s); }
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const r = rec;
    if (!r) return;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14;
    const bins = new Uint8Array(r.analyser ? r.analyser.frequencyBinCount : 64);
    if (r.analyser) r.analyser.getByteFrequencyData(bins);
    const n = 64;
    for (let i = 0; i < n; i++) {
      const v = bins[Math.floor((i / n) * bins.length * 0.6)] / 255;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const l = 4 + v * 16;
      ctx.strokeStyle = mode === 'note' ? `rgba(224,96,26,${0.4 + v * 0.6})` : `rgba(34,229,255,${0.4 + v * 0.6})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l));
      ctx.stroke();
    }
    requestAnimationFrame(drawLevel);
  }

  // ------------------------------------------------------------ playback + speech
  const player = new Audio();
  player.preload = 'auto';
  let unlocked = false;
  let speakingAgent = null;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try { player.src = SILENT_WAV; player.play().catch(() => {}); } catch { /* ignore */ }
    try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch { /* ignore */ }
  }
  const speaking = () => !!speakingAgent;
  function stopSpeaking() {
    try { player.pause(); } catch { /* ignore */ }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch { /* ignore */ }
    speakingAgent = null;
  }
  function playSrc(src, agent = null) {
    stopSpeaking();
    speakingAgent = agent || 'clip';
    player.src = src;
    player.onended = player.onerror = () => { speakingAgent = null; renderAgents(); };
    player.play().catch(() => { speakingAgent = null; });
    renderAgents();
  }
  function voiceFor(agentId) {
    const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    const cfg = agents.find((a) => a.id === agentId) || {};
    if (cfg.voice) { const v = voices.find((x) => x.name.toLowerCase().includes(String(cfg.voice).toLowerCase())); if (v) return v; }
    const en = voices.filter((v) => /^en/i.test(v.lang));
    const gb = en.filter((v) => /GB/i.test(v.lang));
    const pool = [...gb, ...en.filter((v) => !/GB/i.test(v.lang))];
    const idx = Math.max(0, agents.findIndex((a) => a.id === agentId));
    return pool[idx % Math.max(1, pool.length)] || null;
  }
  function say(e) {
    if (e.audio || e.audio_src) return playSrc(e.audio ? `/api/comms/audio/${e.audio}` : e.audio_src, e.from);
    if (!window.speechSynthesis || !e.text) return;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(e.text.slice(0, 600));
    const v = voiceFor(e.from);
    if (v) u.voice = v;
    u.rate = 1.03;
    u.pitch = e.from === 'clawd' ? 1.05 : 0.9;
    speakingAgent = e.from;
    u.onend = u.onerror = () => { speakingAgent = null; renderAgents(); };
    speechSynthesis.speak(u);
    renderAgents();
  }

  // ------------------------------------------------------------ boot
  ui.hint.textContent = baseHint();
  ui.pttLabel.textContent = idleLabel();
  panel.classList.toggle('no-mic', !secure);
  if (params.get('comms') === '1') setTimeout(() => open(), 500);
  return { open, close };
}
