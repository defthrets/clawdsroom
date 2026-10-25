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
const STEP_ICON = { rx: '◈', stt: '≋', link: '⟁', tool: '⚙', agent: '⧉', interim: '❝', auth: '⚠', ask: '?', reason: '◌', compose: '✎', done: '✓', fail: '✕', queue: '⧗' };
const CHOICE_LABEL = { once: 'APPROVE ONCE', session: 'APPROVE · SESSION', always: 'ALWAYS ALLOW', deny: 'DENY' };
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
  // the big Clawd on the main HUD: the same link, always on screen
  const hud = {
    core: new Core($('hud-core'), { rScale: 0.27, ringText: true, holoScale: 1.6 }), panel: $('clawd-panel'),
    state: $('hud-state'), caption: $('hud-caption'), step: $('hud-step'), link: $('hud-link'), tip: $('hud-tip'),
  };
  const cores = [core, hud.core];
  const flashAll = () => cores.forEach((c) => c.flash());
  const pulseAll = (v) => cores.forEach((c) => c.pulse(v));
  let agents = [{ id: 'clawd', label: 'Clawd', ready: false }];
  let current = 'clawd';
  let mode = 'talk';
  let speakReplies = true;
  try { speakReplies = localStorage.getItem('clawdhud.speak') !== '0'; } catch { /* ignore */ }
  let lastTouch = 0, openedAt = 0, bootUntil = 0, sendFlashAt = 0;
  const markSending = () => { sendFlashAt = performance.now(); cores.forEach((c) => c.flash()); };
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
    if (!was) { openedAt = performance.now(); bootUntil = openedAt + 1100; core.powerUp(); }
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
  $('hud-expand').addEventListener('click', () => { unlockAudio(); open(); });
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
  setInterval(loadAgents, 30000); // the main HUD shows the link too, so keep it fresh
  setTimeout(loadAgents, 1500);
  setTimeout(loadAgents, 6000); // demo mode starts after a few seconds

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
    flashAll();
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
  for (const b of document.querySelectorAll('.nl-mode button, .hud-mode button')) {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      for (const o of document.querySelectorAll('.nl-mode button, .hud-mode button')) o.classList.toggle('sel', o.dataset.mode === mode);
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
    const list = tr.steps.map((s) => `<li class="k-${esc(s.kind)}${s.error ? ' k-fail' : ''}"><b>${STEP_ICON[s.kind] || '·'} ${esc(s.text)}${s.detail ? ` <small>· ${esc(s.detail)}</small>` : ''}</b><span>${s.ms != null ? secs(s.ms) : secs(s.at)}</span></li>`).join('');
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
        if (isOpen() && !rec) current = e.from; // the main HUD shows it too, so the link doesn't take over the screen
        lastTouch = Date.now();
        flashAll();
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

  // Demo mode has no server: fake a traced round trip so the link can be tried. Ask it to clear,
  // delete or restart something and it stops for your authorization, like Hermes does.
  const demoStop = new Set(), demoAnswer = new Map();
  async function demoExchange({ text }) {
    const id = `d${Date.now().toString(36)}`;
    const t0 = Date.now(), who = current, note = mode === 'note';
    const risky = /clear|delete|restart|reboot|\brm\b|prune|wipe/i.test(text);
    const steps = [];
    let entry = { id, at: t0, from: 'you', to: current, kind: mode, text, status: 'sending' };
    let reasoning = '', partial = '';
    const put = () => store.patch({ comms: { log: [...log().filter((x) => x.id !== entry.id), { ...entry, trace: { t0, ms: Date.now() - t0, done: false, steps: steps.map((s) => ({ ...s })), reasoning, partial } }].slice(-60) } });
    const step = (kind, label, extra = {}) => { const at = Date.now() - t0; const prev = steps[steps.length - 1]; if (prev && prev.end == null) prev.end = at; steps.push({ kind, text: label, at, ...extra }); if (kind === 'tool') entry.progress = label; put(); };
    const finish = (label, extra) => { const s = [...steps].reverse().find((x) => x.text === label && !x.finished); if (s) Object.assign(s, extra, { finished: true }); put(); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const stopped = () => demoStop.has(id);
    const stream = async (src, ms, set) => { for (let k = 1; k <= 16 && !stopped(); k++) { set(src.slice(0, Math.round((src.length * k) / 16))); put(); await sleep(ms / 16); } };
    const thought = risky
      ? 'They want the Docker build cache cleared. Check how big it is first, then prune it. Pruning deletes data, so Hermes will ask for approval before it runs.'
      : 'They want a status check. The dish is the thing most likely to wobble, so look at Starlink first: ping, drops, obstruction. Then the homelab load. Keep the answer short; it will be read out loud.';
    const answer = note ? 'Got your voice note. I will pick it up shortly.'
      : risky ? 'Done. I pruned the Docker build cache and freed 6.4 gigabytes on the root disk.'
        : 'All good. Starlink is holding at thirty one milliseconds with no drops, and the homelab is idling at twelve percent.';
    put();
    step('rx', note ? 'VOICE NOTE RECEIVED' : 'TEXT PACKET RECEIVED');
    await sleep(350); entry.status = 'thinking'; step('link', 'UPLINK → HERMES AGENT');
    await sleep(450); step('reason', 'REASONING');
    await stream(thought.slice(0, 80), 1300, (v) => { reasoning = v; });
    if (risky) {
      step('tool', 'terminal', { detail: 'docker system df' }); await sleep(900); finish('terminal', { ms: 640, detail: 'Build Cache  6.4GB  reclaimable' });
      step('agent', 'disk-auditor'); await sleep(1100); finish('disk-auditor', { detail: 'ok · 1.1s · $0.002' });
      entry.control = { type: 'approval', request_id: 'demo', execution_generation: 1, title: 'Run a command that deletes data?', detail: 'docker builder prune --all --force', tool: 'terminal', choices: null };
      step('auth', 'AUTHORIZATION: docker builder prune --all --force');
      const ans = await new Promise((res) => demoAnswer.set(id, res));
      demoAnswer.delete(id);
      entry.control = null;
      if (ans.choice === 'deny') {
        step('auth', 'DENIED FROM THE HUD');
        await sleep(500);
        step('done', 'RESPONSE RECEIVED'); steps[steps.length - 1].end = steps[steps.length - 1].at;
        entry = { ...entry, status: 'delivered', progress: null }; put();
        store.patch({ comms: { log: [...log(), { id: `${id}r`, at: Date.now(), from: who, to: 'you', kind: 'reply', text: 'Understood, I left the cache alone. It is still using 6.4 gigabytes.', status: 'received', reply_to: id }].slice(-60) } });
        return;
      }
      step('auth', 'APPROVED (ONCE) FROM THE HUD');
      step('tool', 'terminal', { detail: 'docker builder prune --all --force' }); await sleep(1400); finish('terminal', { ms: 1380, detail: 'Total reclaimed space: 6.4GB' });
    } else {
      step('tool', 'terminal', { detail: 'grpcurl 192.168.100.1:9200 get_status' }); await sleep(1300); finish('terminal', { ms: 1210, detail: 'ping 31ms · drop 0.0% · obstructed 0.4%' });
      step('tool', 'web_search', { detail: 'starlink outage map today' }); await sleep(1100); finish('web_search', { ms: 980, detail: '3 results · no outages reported' });
    }
    if (stopped()) { step('fail', 'stopped from the HUD'); entry = { ...entry, status: 'failed', error: 'stopped from the HUD', progress: null }; put(); return; }
    step('reason', 'REASONING');
    await stream(thought, 700, (v) => { reasoning = v; });
    step('compose', 'COMPOSING RESPONSE');
    await stream(answer, 1400, (v) => { partial = v; });
    if (stopped()) { step('fail', 'stopped from the HUD'); entry = { ...entry, status: 'failed', error: 'stopped from the HUD', progress: null }; put(); return; }
    partial = '';
    step('done', 'RESPONSE RECEIVED'); steps[steps.length - 1].end = steps[steps.length - 1].at;
    entry = { ...entry, status: 'delivered', progress: null };
    store.patch({ comms: { log: [...log().filter((x) => x.id !== id), { ...entry, trace: { t0, ms: Date.now() - t0, done: true, steps, reasoning, partial: '' } }, { id: `${id}r`, at: Date.now(), from: who, to: 'you', kind: 'reply', text: answer, status: 'received', reply_to: id }].slice(-60) } });
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
    flashAll();
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
  }

  // Either core is the button: hold to talk, or tap to start and tap again to send.
  let downAt = 0, early = null; // early: how long it was held if released before the mic was ready
  function bindTalk(canvas, c) {
    canvas.addEventListener('pointerdown', async (ev) => {
      const box = canvas.getBoundingClientRect();
      const k = box.width / canvas.clientWidth; // the stage is scaled
      if (!c.hit((ev.clientX - box.left) / k, (ev.clientY - box.top) / k)) return;
      ev.preventDefault();
      unlockAudio();
      lastTouch = Date.now();
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
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  bindTalk(ui.core, core);
  bindTalk($('hud-core'), hud.core);
  ui.cancel.addEventListener('click', () => {
    if (rec) { stopRec(false); flash('discarded'); return; }
    const p = pendingFor(current);
    if (p) stopTurn(p);
  });
  async function stopTurn(entry) {
    if (store.mode === 'demo') { demoStop.add(entry.id); flash('abort sent'); return; }
    try {
      const r = await fetch('/api/comms/stop', { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ id: entry.id }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      flash('abort sent to hermes');
    } catch (e) { flash(`abort failed: ${e.message}`, true); }
  }

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
    player.ontimeupdate = () => { if (lastReply && text && player.duration) lastReply.lit = Math.floor(text.length * (player.currentTime / player.duration)); pulseAll(0.5); };
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
      pulseAll(0.55 + Math.random() * 0.3);
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
  let hudText = '', hudCap = '', hudStep = '';
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || now - lastFrame < 1000 / 40) return;
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    const k = parseFloat(getComputedStyle(document.getElementById('stage')).getPropertyValue('--k')) || 1;
    const p = pendingFor(current);
    // tools launch out of both cores as they start
    if (p?.trace) {
      const tools = (p.trace.steps || []).filter((x) => x.kind === 'tool');
      const seenN = toolsSeen.get(p.id) ?? 0;
      for (const x of tools.slice(seenN)) cores.forEach((c) => c.addNode(x.text));
      toolsSeen.set(p.id, tools.length);
      if (toolsSeen.size > 20) toolsSeen.delete(toolsSeen.keys().next().value);
    }
    if (rec && rec.analyser) { rec.analyser.getByteFrequencyData(rec.bytes); cores.forEach((c) => c.feed(rec.bytes)); }
    if (!isOpen()) { renderHud(now, dt, k, p); return; }
    core.scale = k;
    const booting = now < bootUntil;
    const st = booting ? 'sending' : coreState();
    core.set(st);
    core.frame(dt);
    panel.dataset.state = st;

    // state label, with what Clawd is doing while he thinks
    const label = booting ? 'LINKING' : LABEL[st];
    const sub = st === 'thinking' && p?.progress ? `⚙ ${String(p.progress).toUpperCase()}` : st === 'offline' ? 'HERMES AGENT IS NOT ANSWERING' : '';
    const html = `${label}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    if (html !== lastText) { ui.state.innerHTML = html; lastText = html; }

    // caption: your words while you talk, his words (lit as spoken) while he answers
    const { cap, you, forming } = caption(now, st, p, 220);
    if (ui.caption.innerHTML !== cap) ui.caption.innerHTML = cap;
    ui.caption.classList.toggle('you', you);
    ui.caption.classList.toggle('forming', forming);
    renderCog(now, p);
    // one button: discard a recording, or abort a turn that is running
    const mode2 = rec ? 'discard' : p ? 'abort' : 'idle';
    if (ui.cancel.dataset.mode !== mode2) {
      ui.cancel.dataset.mode = mode2;
      ui.cancel.disabled = mode2 === 'idle';
      ui.cancel.classList.toggle('abort', mode2 === 'abort');
      ui.cancel.textContent = mode2 === 'abort' ? '■ ABORT' : '✕ DISCARD';
    }

    // readouts
    const a = agentOf(current);
    ui.sig.textContent = a.ready ? (a.online === false ? 'NO CARRIER' : st === 'offline' ? 'NO CARRIER' : `${92 + Math.round(Math.sin(now / 1700) * 4)}%`) : 'NO LINK';
    const db = 20 * Math.log10(Math.max(0.001, core.level));
    ui.amp.textContent = `${db.toFixed(1)} dB`;
    const since = rec ? (now - rec.started) / 1000 : speakingAgent ? (now - speakStart) / 1000 : (now - openedAt) / 1000;
    ui.clock.textContent = mmss(since);
    if (rec && (now - rec.started) / 1000 >= MAX_REC_S) stopRec(true);
  }

  function caption(now, st, p, max) {
    if (rec) return { cap: `${esc(`${rec.transcript} ${rec.interim}`.trim())}<span class="cur"></span>`, you: true, forming: false };
    if (st === 'composing' && p?.trace?.partial) { const t = p.trace.partial; return { cap: `${esc(t.length > max ? `…${t.slice(-max)}` : t)}<span class="cur"></span>`, you: false, forming: true }; }
    if (lastReply && (speakingAgent || now - speakStart < 20000)) {
      const t = lastReply.text, n = Math.min(t.length, lastReply.lit);
      const from = n > max ? n - Math.floor(max * 0.6) : 0;
      return { cap: `${from ? '…' : ''}<span class="lit">${esc(t.slice(from, n))}</span>${esc(t.slice(n, from + max))}`, you: false, forming: false };
    }
    return { cap: '', you: false, forming: false };
  }

  // The big Clawd on the main HUD.
  function renderHud(now, dt, k, p) {
    const st = coreState();
    hud.core.scale = k;
    hud.core.set(st);
    hud.core.frame(dt);
    hud.panel.dataset.state = st;
    const html = LABEL[st];
    if (html !== hudText) { hud.state.textContent = html; hudText = html; }
    const { cap, you, forming } = caption(now, st, p, 120);
    if (cap !== hudCap) { hud.caption.innerHTML = cap; hudCap = cap; }
    hud.caption.classList.toggle('you', you);
    hud.caption.classList.toggle('forming', forming);
    const step = st === 'thinking' || st === 'composing' ? (p?.progress ? `⚙ ${String(p.progress).toUpperCase()}` : p?.trace?.steps?.length ? `◌ ${String(p.trace.steps[p.trace.steps.length - 1].text).toUpperCase()}` : '') : st === 'offline' ? 'HERMES AGENT IS NOT ANSWERING' : '';
    if (step !== hudStep) { hud.step.textContent = step; hudStep = step; }
    const a = agentOf(current);
    const link = !a.ready ? 'NO LINK' : a.online === false ? 'OFFLINE' : 'LINKED';
    if (hud.link.textContent !== link) { hud.link.textContent = link; hud.link.className = !a.ready ? 'warn' : a.online === false ? 'bad' : 'good'; }
    const tip = rec ? (secure ? `${mode === 'note' ? 'RECORDING' : 'LISTENING'} ${mmss((now - rec.started) / 1000)} · RELEASE TO SEND` : '') : secure ? 'HOLD CLAWD TO TALK' : 'MIC NEEDS HTTPS · TAP ⤢ LINK TO TYPE';
    if (hud.tip.textContent !== tip) hud.tip.textContent = tip;
    if (rec && (now - rec.started) / 1000 >= MAX_REC_S) stopRec(true);
  }

  // ------------------------------------------------------------ cognition: the steps and the thought stream
  let cogKey = '', cogFor = null, thoughtShown = 0, thoughtHtml = '', toolsSeen = new Map(), stepsShown = { id: null, n: 0 };
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
    const tools = steps.filter((s) => s.kind === 'tool');

    const elapsed = live ? Date.now() - tr.t0 : tr.ms;
    ui.cgLive.textContent = live ? (tr.partial ? '● COMPOSING' : '● LIVE') : 'LAST TRACE';
    ui.cgSteps.textContent = String(steps.length);
    ui.cgTools.textContent = String(tools.length);
    ui.cgTime.textContent = secs(elapsed);
    const key = `${e.id}|${steps.length}|${live}|${steps.map((s) => (s.finished ? 1 : 0)).join('')}`;
    if (key !== cogKey) {
      cogKey = key;
      const firstNew = stepsShown.id === e.id ? stepsShown.n : (live ? 0 : steps.length);
      stepsShown = { id: e.id, n: steps.length };
      const off = Math.max(0, steps.length - 8);
      ui.cgList.innerHTML = steps.slice(-8).map((s, i, arr) => {
        const isLive = live && i === arr.length - 1;
        const fresh = off + i >= firstNew;
        const sub = s.error ? `✕ ${s.error}` : s.detail || '';
        const du = isLive ? '' : s.ms != null ? secs(s.ms) : secs((s.end ?? s.at) - s.at);
        return `<li class="step k-${esc(s.kind)}${isLive ? ' live' : ''}${s.error ? ' err' : ''}${fresh ? ' fresh' : ''}"><span class="ic"><span>${STEP_ICON[s.kind] || '·'}</span></span><span class="tx">${esc(s.text)}</span><span class="du">${du}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</li>`;
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

  // ------------------------------------------------------------ authorization: Hermes is waiting on you
  const au = { box: $('auth'), k: $('auth-k'), who: $('auth-who'), title: $('auth-title'), cmd: $('auth-cmd'), choices: $('auth-choices'), answer: $('auth-answer'), input: $('auth-input'), send: $('auth-send'), foot: $('auth-foot') };
  let authKey = null, authEntry = null;
  function waitingOnYou() { return log().filter((e) => e.from === 'you' && e.control && PENDING.has(e.status)).pop() || null; }
  function renderAuth() {
    const e = waitingOnYou();
    const key = e ? `${e.id}|${e.control.request_id}|${e.control.execution_generation}` : null;
    if (key === authKey) return;
    authKey = key; authEntry = e;
    if (!e) { au.box.classList.add('hidden'); return; }
    const c = e.control, ask = c.type === 'clarify';
    const who = String(agentOf(e.to).label || e.to).toUpperCase();
    au.box.classList.toggle('ask', ask);
    au.k.textContent = ask ? '? CLARIFICATION REQUESTED' : '⚠ AUTHORIZATION REQUIRED';
    au.who.textContent = `${who} · HERMES AGENT${c.tool ? ` · ${String(c.tool).toUpperCase()}` : ''}`;
    au.title.textContent = c.title || '';
    au.cmd.textContent = ask ? '' : c.detail || '';
    const choices = c.choices && c.choices.length ? c.choices : ask ? [] : ['once', 'deny'];
    au.choices.innerHTML = choices.map((ch) => `<button data-choice="${esc(ch)}" class="${!ask && ch !== 'deny' ? 'go' : ''}">${esc(ask ? String(ch).toUpperCase() : CHOICE_LABEL[ch] || String(ch).toUpperCase())}</button>`).join('');
    au.answer.classList.toggle('hidden', !ask);
    au.input.value = '';
    au.foot.textContent = ask ? `${who} IS WAITING FOR YOUR ANSWER` : `${who} IS PAUSED UNTIL YOU DECIDE · NOTHING RUNS WITHOUT YOUR SAY-SO`;
    au.box.classList.remove('hidden');
    lastTouch = Date.now();
    // say it out loud so it is noticed across the room
    if (speakReplies && window.speechSynthesis && !rec) {
      try { const u = new SpeechSynthesisUtterance(ask ? `${who} has a question.` : `${who} needs your authorization.`); const v = voiceFor(e.to); if (v) u.voice = v; speechSynthesis.speak(u); } catch { /* ignore */ }
    }
  }
  async function answerControl(body) {
    const e = authEntry;
    if (!e) return;
    for (const b of au.box.querySelectorAll('button')) b.disabled = true;
    if (store.mode === 'demo') { demoAnswer.get(e.id)?.(body); }
    else {
      try {
        const r = await fetch('/api/comms/control', { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ id: e.id, ...body }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      } catch (err) { au.foot.textContent = `NOT SENT · ${String(err.message).toUpperCase()}`; for (const b of au.box.querySelectorAll('button')) b.disabled = false; return; }
    }
    au.box.classList.add('hidden');
    authKey = null;
  }
  au.choices.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-choice]');
    if (!b) return;
    unlockAudio();
    if (authEntry?.control?.type === 'clarify') answerControl({ answer: b.dataset.choice });
    else answerControl({ choice: b.dataset.choice });
  });
  const sendAnswer = () => { const v = au.input.value.trim(); if (v) { au.input.blur(); answerControl({ answer: v }); } };
  au.send.addEventListener('click', sendAnswer);
  au.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendAnswer(); });
  store.on('state', renderAuth);

  // ------------------------------------------------------------ boot
  ui.hint.textContent = baseHint();
  requestAnimationFrame(loop);
  if (params.get('comms') === '1') setTimeout(() => open(), 500);
  return { open, close, auth };
}
