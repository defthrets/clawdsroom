// The HUD's neural link: hold the core to talk to Clawd (Hermes Agent) or leave a voice note, read
// the comm log, hear the replies. Recording needs a secure page (HTTPS) on the iPad; typing works anywhere.

import { Core } from '/hud/core.js';

const AUTO_CLOSE_MS = 90000;
const MAX_REC_S = 120;
const HOLD_MS = 450;
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+=<>/\\|';

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hms = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const STATUS = { sending: 'TRANSMITTING', transcribing: 'TRANSCRIBING', thinking: 'PROCESSING', delivered: 'DELIVERED', queued: 'QUEUED · NO LINK', failed: 'FAILED', received: '' };
const PENDING = new Set(['sending', 'transcribing', 'thinking']);
const STEP_ICON = { rx: '◈', stt: '≋', link: '⟁', tool: '⚙', reason: '◌', compose: '✎', done: '✓', fail: '✕', queue: '⧗' };
const secs = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

export function initComms(store, { $, params }) {
  // ------------------------------------------------------------ token (only needed if the server has one)
  let token = params.get('token') || '';
  try { if (token) localStorage.setItem('clawdhud.token', token); else token = localStorage.getItem('clawdhud.token') || ''; } catch { /* private mode */ }
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  const panel = $('comms'), btn = $('comms-btn');
  const ui = {
    agents: $('cm-agents'), thread: $('cm-thread'), title: $('cm-title'), chips: $('cm-chips'), core: $('cm-core'),
    state: $('cm-state'), caption: $('cm-caption'), cancel: $('cm-cancel'), hint: $('cm-hint'), input: $('cm-input'),
    sendBtn: $('cm-send'), speak: $('cm-speak'), badge: $('comms-badge'), count: $('cm-count'),
    sig: $('cm-sig'), amp: $('cm-amp'), chan: $('cm-chan'), clock: $('cm-clock'),
    cog: $('cg'), cgLive: $('cg-live'), cgSteps: $('cg-steps'), cgTime: $('cg-time'), cgTools: $('cg-tools'),
    cgList: $('cg-list'), cgThought: $('cg-thought'), cgChars: $('cg-chars'),
  };
  const core = new Core(ui.core);
  let agents = [{ id: 'clawd', label: 'Clawd', ready: false }];
  let current = 'clawd';
  let mode = 'talk';
  let speakReplies = true;
  try { speakReplies = localStorage.getItem('clawdhud.speak') !== '0'; } catch { /* ignore */ }
  let lastTouch = 0, openedAt = 0, bootUntil = 0, sendFlashAt = 0;
  const markSending = () => { sendFlashAt = performance.now(); core.flash(); };
  const seen = new Set();
  let seeded = false;

  const secure = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const log = () => (Array.isArray(store.state.comms?.log) ? store.state.comms.log : []);
  const agentOf = (id) => agents.find((a) => a.id === id) || { id, label: id };

  // ------------------------------------------------------------ open / close
  const isOpen = () => !panel.classList.contains('hidden');
  function open(agent) {
    if (agent) current = agent;
    const was = isOpen();
    panel.classList.remove('hidden');
    btn.classList.add('on');
    lastTouch = Date.now();
    if (!was) { openedAt = performance.now(); bootUntil = openedAt + 1100; core.powerUp(); requestAnimationFrame(loop); }
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
    if (isOpen() && !rec && !speaking() && !pendingFor(current) && Date.now() - lastTouch > AUTO_CLOSE_MS) close();
  }, 5000);

  // ------------------------------------------------------------ agents
  async function loadAgents() {
    if (store.mode === 'demo') { agents = agents.map((a) => ({ ...a, ready: true, type: 'hermes', online: true })); renderAgents(); return; }
    try {
      const r = await fetch('/api/comms/agents', { cache: 'no-store' });
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) agents = list; }
    } catch { /* offline */ }
    if (!agents.some((a) => a.id === current)) current = agents[0]?.id;
    renderAgents();
  }
  setInterval(() => { if (isOpen()) loadAgents(); }, 30000);

  const pendingFor = (id) => log().find((e) => e.from === 'you' && e.to === id && PENDING.has(e.status));
  const linkName = (a) => (a.type === 'hermes' ? 'HERMES AGENT' : String(a.type || 'NO LINK').toUpperCase());
  function renderAgents() {
    ui.agents.classList.toggle('single', agents.length < 2);
    ui.agents.innerHTML = agents.map((a) => {
      const busy = pendingFor(a.id);
      const offline = a.ready && a.online === false;
      const sub = busy ? (busy.progress ? `⚙ ${esc(String(busy.progress).toUpperCase())}` : 'PROCESSING…') : offline ? `OFFLINE · ${linkName(a)}` : a.ready ? `LINKED · ${linkName(a)}` : 'NO LINK · QUEUES';
      return `<button class="agent${a.id === current ? ' sel' : ''}${a.ready && !offline ? ' ready' : ''}${offline ? ' offline' : ''}${busy ? ' busy' : ''}${speakingAgent === a.id ? ' talking' : ''}" data-id="${esc(a.id)}">
        <span class="ag-dot"></span><span class="ag-name">${esc(String(a.label || a.id).toUpperCase())}</span><span class="ag-sub">${sub}</span></button>`;
    }).join('');
    renderChips();
  }
  ui.agents.addEventListener('click', (ev) => {
    const b = ev.target.closest('.agent');
    if (!b || b.dataset.id === current) return;
    current = b.dataset.id;
    core.flash();
    renderAgents(); render(true);
  });

  function renderChips() {
    const a = agentOf(current);
    const ex = log().filter((e) => e.kind === 'reply' && e.from === current && e.reply_to);
    const last = ex[ex.length - 1];
    const asked = last && log().find((e) => e.id === last.reply_to);
    const rtt = last && asked ? ((last.at - asked.at) / 1000).toFixed(1) : null;
    const chip = (k, v, lv = '') => `<span class="nl-chip ${lv}">${k}<b>${v}</b></span>`;
    ui.chips.innerHTML = [
      chip('LINK', window.isSecureContext ? 'SECURE' : 'OPEN', window.isSecureContext ? 'good' : 'warn'),
      chip('MIC', secure ? 'READY' : 'NEEDS HTTPS', secure ? 'good' : 'warn'),
      a.type === 'hermes' ? chip('HERMES', a.online === false ? 'OFFLINE' : 'ONLINE', a.online === false ? 'bad' : 'good') : chip('UPLINK', a.ready ? linkName(a) : 'NONE', a.ready ? 'good' : 'warn'),
      rtt ? chip('RTT', `${rtt}s`) : '',
    ].join('');
    ui.chan.textContent = `${String(current).toUpperCase()}-HUD`;
    ui.title.textContent = String(a.label || current).toUpperCase();
    core.ring = `${String(a.label || current).toUpperCase()} · ${linkName(a)} · NEURAL LINK · `;
  }

  // ------------------------------------------------------------ mode + voice toggles
  for (const b of document.querySelectorAll('.nl-mode button')) {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      for (const o of document.querySelectorAll('.nl-mode button')) o.classList.toggle('sel', o === b);
      flash(mode === 'note' ? 'voice note: hold the core to record a message' : 'talk: hold the core and speak');
    });
  }
  function paintSpeak() { ui.speak.classList.toggle('sel', speakReplies); ui.speak.textContent = speakReplies ? 'VOICE ON' : 'VOICE OFF'; }
  ui.speak.addEventListener('click', () => {
    speakReplies = !speakReplies;
    try { localStorage.setItem('clawdhud.speak', speakReplies ? '1' : '0'); } catch { /* ignore */ }
    paintSpeak();
    if (!speakReplies) stopSpeaking();
  });
  paintSpeak();

  // ------------------------------------------------------------ the comm log
  let threadKey = '';
  const decrypted = new Set();
  function render(force = false) {
    const items = log().filter((e) => e.to === current || e.from === current).slice(-30);
    ui.count.textContent = `${items.length} TX`;
    const key = JSON.stringify([[...openTraces], ...items.map((e) => [e.id, e.status, e.text, e.audio, e.progress, e.trace?.done])]);
    if (!force && key === threadKey) return;
    threadKey = key;
    if (!items.length) {
      ui.thread.innerHTML = `<div class="cm-empty">NO TRAFFIC ON THIS CHANNEL<br><small>${secure ? 'hold the core and speak' : 'type below · open the HUD over HTTPS for the mic'}</small></div>`;
      return;
    }
    ui.thread.innerHTML = items.map((e) => {
      const mine = e.from === 'you';
      const who = mine ? `YOU ▸ ${esc(String(e.to).toUpperCase())}` : `${esc(String(e.from).toUpperCase())} ▸ YOU`;
      const kind = e.kind === 'note' ? '<span>VOICE NOTE</span>' : '';
      const st = STATUS[e.status] ?? String(e.status || '').toUpperCase();
      const src = e.audio ? `/api/comms/audio/${e.audio}` : e.audio_src || '';
      const fresh = !mine && !decrypted.has(e.id) && seeded && Date.now() - e.at < 15000;
      return `<div class="msg ${mine ? 'you' : 'them'}${e.status === 'failed' ? ' failed' : ''}">
        <div class="msg-meta"><span>${who}</span>${kind}<span>${hms(e.at)}</span>${st ? `<b class="st-${esc(e.status)}">${esc(st)}</b>` : ''}</div>
        <div class="msg-body">${src ? `<button class="play" data-src="${esc(src)}" aria-label="play">▶</button>` : ''}<span${fresh ? ` data-decrypt="${esc(e.id)}"` : ''}>${esc(e.text || (src ? '(voice, no transcript)' : ''))}</span></div>
        ${e.error ? `<div class="msg-err">${esc(e.error)}</div>` : ''}
        ${PENDING.has(e.status) && mine ? `<div class="dots"><i></i><i></i><i></i>${e.progress ? `<span class="prog">⚙ ${esc(e.progress)}</span>` : ''}</div>` : ''}
        ${mine && e.trace?.done && e.trace.steps?.length ? traceDrawer(e) : ''}
      </div>`;
    }).join('');
    for (const el of ui.thread.querySelectorAll('[data-decrypt]')) decrypt(el);
    ui.thread.scrollTop = ui.thread.scrollHeight;
  }
  // A finished turn's steps, folded away under the message.
  const openTraces = new Set();
  function traceDrawer(e) {
    const tr = e.trace, n = tr.steps.length, tools = tr.steps.filter((s) => s.kind === 'tool').length;
    const head = `<button class="tr-btn" data-trace="${esc(e.id)}">${openTraces.has(e.id) ? '▾' : '▸'} TRACE · ${n} STEPS${tools ? ` · ${tools} TOOL${tools > 1 ? 'S' : ''}` : ''} · ${secs(tr.ms)}</button>`;
    if (!openTraces.has(e.id)) return head;
    const list = tr.steps.map((s) => `<li class="${esc(s.kind)}"><b>${STEP_ICON[s.kind] || '·'} ${esc(s.text)}</b><span>${secs(s.at)}</span></li>`).join('');
    return `${head}<ul class="tr-list">${list}</ul>${tr.reasoning ? `<div class="tr-thought">${esc(tr.reasoning)}</div>` : ''}`;
  }

  // New replies arrive scrambled and resolve left to right.
  function decrypt(el) {
    const id = el.dataset.decrypt;
    decrypted.add(id);
    const text = el.textContent;
    const start = performance.now(), dur = Math.min(1400, 300 + text.length * 12);
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const upto = Math.floor(text.length * p);
      let out = text.slice(0, upto);
      for (let i = upto; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  ui.thread.addEventListener('click', (ev) => {
    const t = ev.target.closest('.tr-btn');
    if (t) { const id = t.dataset.trace; openTraces.has(id) ? openTraces.delete(id) : openTraces.add(id); render(true); return; }
    const b = ev.target.closest('.play');
    if (!b) return;
    unlockAudio();
    playSrc(b.dataset.src);
  });

  // New replies: open the link on that agent and say them out loud.
  store.on('state', () => {
    const items = log();
    if (!seeded) { for (const e of items) { seen.add(e.id); decrypted.add(e.id); } seeded = true; } // old replies stay quiet on load
    for (const e of items) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.kind === 'reply') {
        if (!isOpen()) open(e.from); else if (!rec) current = e.from;
        lastTouch = Date.now();
        core.flash();
        if (speakReplies && !rec) say(e); else lastReply = { text: e.text, lit: e.text.length };
      }
    }
    const pending = items.filter((e) => e.from === 'you' && PENDING.has(e.status)).length;
    ui.badge.textContent = pending ? String(pending) : '';
    ui.badge.classList.toggle('hidden', !pending);
    if (isOpen()) { renderAgents(); render(); }
  });

  // ------------------------------------------------------------ sending
  async function sendText(text) {
    text = text.trim();
    if (!text) return;
    markSending();
    if (store.mode === 'demo') return demoExchange({ text });
    try {
      const r = await fetch('/api/comms/send', { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ to: current, kind: mode, text }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      flash(`transmitted to ${current}`);
    } catch (e) { flash(`not sent: ${e.message}`, true); }
  }

  async function sendVoice(blob, text, secs) {
    if (store.mode === 'demo') return demoExchange({ text: text || `(${secs.toFixed(0)}s voice ${mode === 'note' ? 'note' : 'clip'})` });
    const q = new URLSearchParams({ to: current, kind: mode });
    if (text) q.set('text', text.slice(0, 1500));
    try {
      const r = await fetch(`/api/comms/voice?${q}`, { method: 'POST', headers: { 'content-type': blob.type || 'audio/mp4', ...auth }, body: blob });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      flash(mode === 'note' ? `voice note left for ${current}` : `transmitted to ${current}`);
    } catch (e) { flash(`not sent: ${e.message}`, true); }
  }

  const submit = () => { sendText(ui.input.value); ui.input.value = ''; ui.input.blur(); };
  ui.sendBtn.addEventListener('click', submit);
  ui.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });

  let hintTimer = null;
  const baseHint = () => (secure ? 'HOLD THE CORE TO SPEAK · OR TAP TO START, TAP TO SEND' : 'MIC NEEDS HTTPS · TYPE BELOW · SEE README');
  function flash(text, bad = false) {
    ui.hint.textContent = text.toUpperCase();
    ui.hint.classList.toggle('bad', bad);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { ui.hint.classList.remove('bad'); ui.hint.textContent = baseHint(); }, 4000);
  }

  // Demo mode has no server: fake a traced round trip so the link can be tried.
  function demoExchange({ text }) {
    const id = `d${Date.now().toString(36)}`;
    const t0 = Date.now(), who = current, note = mode === 'note';
    const steps = [];
    let entry = { id, at: t0, from: 'you', to: current, kind: mode, text, status: 'sending' };
    const put = (e) => store.patch({ comms: { log: [...log().filter((x) => x.id !== e.id), e].slice(-60) } });
    const trace = (extra = {}) => ({ t0, ms: Date.now() - t0, done: false, steps: steps.map((s) => ({ ...s })), reasoning: '', partial: '', ...extra });
    const step = (kind, label) => { const at = Date.now() - t0; if (steps.length) steps[steps.length - 1].end = at; steps.push({ kind, text: label, at }); };
    const thought = 'They want a status check. The dish is the thing most likely to wobble, so look at Starlink first: ping, drops, obstruction. Then the homelab load. Keep the answer short; it will be read out loud.';
    const answer = note ? 'Got your voice note. I will pick it up shortly.' : 'All good. Starlink is holding at thirty one milliseconds with no drops, and the homelab is idling at twelve percent.';
    const timeline = [
      [0, () => step('rx', note ? 'VOICE NOTE RECEIVED' : 'TEXT PACKET RECEIVED')],
      [350, () => { entry.status = 'thinking'; step('link', 'UPLINK → HERMES AGENT'); }],
      [900, () => step('reason', 'REASONING')],
      [2400, () => { step('tool', 'terminal: grpcurl dish get_status'); entry.progress = 'terminal: grpcurl dish get_status'; }],
      [3900, () => { step('tool', 'web_search: starlink outage map'); entry.progress = 'web_search: starlink outage map'; }],
      [5200, () => step('reason', 'REASONING')],
      [6000, () => step('compose', 'COMPOSING RESPONSE')],
    ];
    let reasoning = '', partial = '';
    for (const [at, fn] of timeline) setTimeout(() => { fn(); put({ ...entry, trace: trace({ reasoning, partial }) }); }, at);
    // reasoning streams in two bursts, the answer streams last
    const stream = (from, to, src, set) => { const n = src.length; for (let k = 1; k <= 20; k++) setTimeout(() => { set(src.slice(0, Math.round((n * k) / 20))); put({ ...entry, trace: trace({ reasoning, partial }) }); }, from + ((to - from) * k) / 20); };
    stream(950, 2350, thought.slice(0, 92), (v) => { reasoning = v; });
    stream(5250, 5950, thought, (v) => { reasoning = v; });
    stream(6050, 7400, answer, (v) => { partial = v; });
    setTimeout(() => {
      step('done', 'RESPONSE RECEIVED');
      steps[steps.length - 1].end = steps[steps.length - 1].at;
      entry = { ...entry, status: 'delivered', progress: null, trace: { ...trace({ reasoning }), done: true } };
      put(entry);
      put({ id: `${id}r`, at: Date.now(), from: who, to: 'you', kind: 'reply', text: answer, status: 'received', reply_to: id });
    }, 7600);
  }

  // ------------------------------------------------------------ recording
  let rec = null; // {mr, stream, chunks, started, ctx, analyser, sr, transcript, interim}
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
    const r = { mr, stream, chunks: [], started: performance.now(), transcript: '', interim: '' };
    rec = r;
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
    mr.start(250);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      r.ctx = new Ctx();
      r.analyser = r.ctx.createAnalyser();
      r.analyser.fftSize = 512;
      r.analyser.smoothingTimeConstant = 0.6;
      r.ctx.createMediaStreamSource(stream).connect(r.analyser);
      r.bytes = new Uint8Array(r.analyser.frequencyBinCount);
    } catch { /* no level meter */ }
    if (SR) {
      try {
        const sr = new SR();
        sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-GB';
        sr.onresult = (ev) => {
          let fin = '', interim = '';
          for (let i = 0; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript) : (interim += ev.results[i][0].transcript));
          r.transcript = fin.trim(); r.interim = interim.trim();
        };
        sr.onerror = () => {};
        sr.start();
        r.sr = sr;
      } catch { /* not allowed here */ }
    }
    ui.cancel.disabled = false;
    core.flash();
  }

  function stopRec(send) {
    const r = rec;
    if (!r) return;
    rec = null;
    const secs = (performance.now() - r.started) / 1000;
    try { r.sr && r.sr.stop(); } catch { /* ignore */ }
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      try { r.ctx && r.ctx.close(); } catch { /* ignore */ }
      const blob = new Blob(r.chunks, { type: (r.mr.mimeType || 'audio/mp4').split(';')[0] });
      const text = `${r.transcript} ${r.interim}`.trim();
      if (send && secs >= 0.6 && blob.size > 0) { markSending(); sendVoice(blob, text, secs); } else if (send) flash('too short · hold a little longer', true);
    };
    try { r.mr.state !== 'inactive' ? r.mr.stop() : r.mr.onstop(); } catch { r.mr.onstop(); }
    ui.cancel.disabled = true;
  }

  // The core is the button: hold to talk, or tap to start and tap again to send.
  let downAt = 0, early = null; // early: how long it was held if released before the mic was ready
  ui.core.addEventListener('pointerdown', async (ev) => {
    const box = ui.core.getBoundingClientRect();
    const k = box.width / ui.core.clientWidth; // the stage is scaled
    if (!core.hit((ev.clientX - box.left) / k, (ev.clientY - box.top) / k)) return;
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
  ui.core.addEventListener('pointerup', release);
  ui.core.addEventListener('pointercancel', release);
  ui.core.addEventListener('contextmenu', (ev) => ev.preventDefault());
  ui.cancel.addEventListener('click', () => { stopRec(false); flash('discarded'); });

  // ------------------------------------------------------------ playback + speech
  const player = new Audio();
  player.preload = 'auto';
  let unlocked = false;
  let speakingAgent = null, speakStart = 0;
  let lastReply = null; // {text, lit} what the caption shows while (and after) a reply is spoken
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
    if (lastReply) lastReply.lit = lastReply.text.length;
  }
  function playSrc(src, agent = null, text = '') {
    stopSpeaking();
    speakingAgent = agent || 'clip';
    speakStart = performance.now();
    lastReply = text ? { text, lit: 0 } : lastReply;
    player.src = src;
    player.ontimeupdate = () => { if (lastReply && text && player.duration) lastReply.lit = Math.floor(text.length * (player.currentTime / player.duration)); core.pulse(0.5); };
    player.onended = player.onerror = () => { speakingAgent = null; if (lastReply) lastReply.lit = lastReply.text.length; renderAgents(); };
    player.play().catch(() => { speakingAgent = null; });
    renderAgents();
  }
  function voiceFor(agentId) {
    const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    const cfg = agentOf(agentId);
    if (cfg.voice) { const v = voices.find((x) => x.name.toLowerCase().includes(String(cfg.voice).toLowerCase())); if (v) return v; }
    const en = voices.filter((v) => /^en/i.test(v.lang));
    const pool = [...en.filter((v) => /GB/i.test(v.lang)), ...en.filter((v) => !/GB/i.test(v.lang))];
    const idx = Math.max(0, agents.findIndex((a) => a.id === agentId));
    return pool[idx % Math.max(1, pool.length)] || null;
  }
  function say(e) {
    if (e.audio || e.audio_src) return playSrc(e.audio ? `/api/comms/audio/${e.audio}` : e.audio_src, e.from, e.text || '');
    if (!window.speechSynthesis || !e.text) { lastReply = { text: e.text || '', lit: (e.text || '').length }; speakStart = performance.now(); return; }
    stopSpeaking();
    lastReply = { text: e.text, lit: 0 };
    const spoken = e.text.slice(0, 600);
    const u = new SpeechSynthesisUtterance(spoken);
    const v = voiceFor(e.from);
    if (v) u.voice = v;
    u.rate = 1.03;
    u.pitch = e.from === 'clawd' ? 1.05 : 0.9;
    speakingAgent = e.from;
    speakStart = performance.now();
    u.onboundary = (b) => {
      const end = spoken.indexOf(' ', b.charIndex + 1);
      lastReply.lit = end < 0 ? spoken.length : end;
      core.pulse(0.55 + Math.random() * 0.3);
    };
    u.onend = u.onerror = () => { speakingAgent = null; lastReply.lit = lastReply.text.length; renderAgents(); };
    speechSynthesis.speak(u);
    renderAgents();
  }

  // ------------------------------------------------------------ the loop: core state, caption, readouts
  function coreState() {
    const a = agentOf(current);
    if (rec) return mode === 'note' ? 'note' : 'listening';
    if (speakingAgent) return 'speaking';
    const p = pendingFor(current);
    if (p) return p.trace?.partial ? 'composing' : p.status === 'thinking' ? 'thinking' : 'sending';
    if (performance.now() - sendFlashAt < 1500) return 'sending';
    if (a.ready && a.online === false) return 'offline';
    return 'idle';
  }

  const LABEL = { idle: 'STANDBY', listening: 'LISTENING', note: 'RECORDING', sending: 'TRANSMITTING', thinking: 'PROCESSING', composing: 'COMPOSING', speaking: 'RESPONDING', offline: 'LINK DOWN' };
  let lastFrame = 0, lastText = '';
  function loop(now) {
    if (!isOpen()) return;
    requestAnimationFrame(loop);
    if (now - lastFrame < 1000 / 40) return;
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    core.scale = parseFloat(getComputedStyle(document.getElementById('stage')).getPropertyValue('--k')) || 1;
    const booting = now < bootUntil;
    const st = booting ? 'sending' : coreState();
    core.set(st);
    if (rec && rec.analyser) { rec.analyser.getByteFrequencyData(rec.bytes); core.feed(rec.bytes); }
    core.frame(dt);
    panel.dataset.state = st;

    // state label, with what Clawd is doing while he thinks
    const p = pendingFor(current);
    const label = booting ? 'LINKING' : LABEL[st];
    const sub = st === 'thinking' && p?.progress ? `⚙ ${String(p.progress).toUpperCase()}` : st === 'offline' ? 'HERMES AGENT IS NOT ANSWERING' : '';
    const html = `${label}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    if (html !== lastText) { ui.state.innerHTML = html; lastText = html; }

    // caption: your words while you talk, his words (lit as spoken) while he answers
    let cap = '', you = false, forming = false;
    if (rec) { cap = `${esc(`${rec.transcript} ${rec.interim}`.trim())}<span class="cur"></span>`; you = true; }
    else if (st === 'composing' && p?.trace?.partial) { const t = p.trace.partial; cap = `${esc(t.length > 220 ? `…${t.slice(-220)}` : t)}<span class="cur"></span>`; forming = true; }
    else if (lastReply && (speakingAgent || now - speakStart < 20000)) {
      const t = lastReply.text, n = Math.min(t.length, lastReply.lit);
      cap = `<span class="lit">${esc(t.slice(0, n))}</span>${esc(t.slice(n))}`;
    } else if (st === 'idle') cap = '';
    if (ui.caption.innerHTML !== cap) ui.caption.innerHTML = cap;
    ui.caption.classList.toggle('you', you);
    ui.caption.classList.toggle('forming', forming);
    renderCog(now, p);

    // readouts
    const a = agentOf(current);
    ui.sig.textContent = a.ready ? (a.online === false ? 'NO CARRIER' : st === 'offline' ? 'NO CARRIER' : `${92 + Math.round(Math.sin(now / 1700) * 4)}%`) : 'NO LINK';
    const db = 20 * Math.log10(Math.max(0.001, core.level));
    ui.amp.textContent = `${db.toFixed(1)} dB`;
    const since = rec ? (now - rec.started) / 1000 : speakingAgent ? (now - speakStart) / 1000 : (now - openedAt) / 1000;
    ui.clock.textContent = mmss(since);
    if (rec && (now - rec.started) / 1000 >= MAX_REC_S) stopRec(true);
  }

  // ------------------------------------------------------------ cognition: the steps and the thought stream
  let cogKey = '', cogFor = null, thoughtShown = 0, thoughtHtml = '', toolsSeen = new Map();
  function activeTrace(p) {
    if (p?.trace) return { e: p, live: true };
    const last = log().filter((e) => e.from === 'you' && e.to === current && e.trace).pop();
    return last ? { e: last, live: false } : null;
  }
  function renderCog(now, p) {
    const at = activeTrace(p);
    ui.cog.classList.toggle('active', !!at?.live);
    if (!at) {
      if (cogKey !== 'none') {
        cogKey = 'none';
        ui.cgLive.textContent = 'IDLE'; ui.cgSteps.textContent = '0'; ui.cgTime.textContent = '0.0s'; ui.cgTools.textContent = '0'; ui.cgChars.textContent = '';
        ui.cgList.innerHTML = '<li class="cog-empty">AWAITING TRANSMISSION</li>';
        ui.cgThought.innerHTML = '<span class="none">NO ACTIVE THOUGHT PROCESS</span>';
      }
      return;
    }
    const { e, live } = at, tr = e.trace, steps = tr.steps || [];
    // tools launch out of the core as they start
    const tools = steps.filter((s) => s.kind === 'tool');
    const seenN = toolsSeen.get(e.id) ?? (live ? 0 : tools.length);
    for (const s of tools.slice(seenN)) core.addNode(s.text);
    toolsSeen.set(e.id, tools.length);
    if (toolsSeen.size > 20) toolsSeen.delete(toolsSeen.keys().next().value);

    const elapsed = live ? Date.now() - tr.t0 : tr.ms;
    ui.cgLive.textContent = live ? (tr.partial ? '● COMPOSING' : '● LIVE') : 'LAST TRACE';
    ui.cgSteps.textContent = String(steps.length);
    ui.cgTools.textContent = String(tools.length);
    ui.cgTime.textContent = secs(elapsed);
    const key = `${e.id}|${steps.length}|${live}`;
    if (key !== cogKey) {
      cogKey = key;
      ui.cgList.innerHTML = steps.slice(-9).map((s, i, arr) => {
        const isLive = live && i === arr.length - 1;
        return `<li class="step ${esc(s.kind)}${isLive ? ' live' : ''}"><span class="ic"><span>${STEP_ICON[s.kind] || '·'}</span></span><span class="tx">${esc(s.text)}</span><span class="du">${isLive ? '' : secs((s.end ?? s.at) - s.at)}</span></li>`;
      }).join('');
    }
    if (live && steps.length) {
      const du = ui.cgList.querySelector('.step.live .du');
      if (du) du.textContent = secs(Date.now() - tr.t0 - steps[steps.length - 1].at);
    }
    // the thought stream types itself out
    const text = tr.reasoning || '';
    if (cogFor !== e.id) { cogFor = e.id; thoughtShown = live ? 0 : text.length; }
    if (thoughtShown > text.length) thoughtShown = text.length;
    thoughtShown = Math.min(text.length, thoughtShown + Math.max(1, Math.ceil((text.length - thoughtShown) * 0.12)));
    ui.cgChars.textContent = text ? `${text.length} CH` : '';
    let html;
    if (!text) html = `<span class="none">${live ? 'NO REASONING STREAMED YET' : 'NO REASONING EXPOSED'}</span>`;
    else {
      const shown = text.slice(Math.max(0, thoughtShown - 700), thoughtShown);
      const cut = Math.max(0, shown.length - 40);
      html = `${esc(shown.slice(0, cut))}<span class="new">${esc(shown.slice(cut))}</span>${live ? '<span class="cur"></span>' : ''}`;
    }
    if (html !== thoughtHtml) { ui.cgThought.innerHTML = `<div>${html}</div>`; thoughtHtml = html; }
  }

  // ------------------------------------------------------------ boot
  ui.hint.textContent = baseHint();
  if (params.get('comms') === '1') setTimeout(() => open(), 500);
  return { open, close };
}
