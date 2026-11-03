// Hermes Agent's API server, beyond chat: runs (live tool calls, sub-agents, approvals, clarifying
// questions, stop), and the system around Clawd (health, capabilities, skills, toolsets, scheduled
// jobs, sessions, models). The HUD reaches all of it through our server, so the key never leaves here.
//
// Several payloads are not pinned down in Hermes' docs, so the readers below accept the likely field
// names and fall back gracefully. Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server

// Hermes Agent base URL (with an optional multiplexed profile), from whatever form the config gives.
export function hermesBase(cfg) {
  const base = String(cfg.url || 'http://127.0.0.1:8642').replace(/\/+$/, '').replace(/\/v1(\/chat\/completions)?$/, '');
  return cfg.profile ? `${base}/p/${encodeURIComponent(cfg.profile)}` : base;
}

// One SSE block → {event, data} (data parsed as JSON when it can be).
export function parseSseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  try { return { event, data: JSON.parse(raw), raw }; } catch { return { event, data: null, raw }; }
}

// A short label for a Hermes tool-progress event, whatever shape it comes in.
export function progressLabel(d) {
  if (!d || typeof d !== 'object') return '';
  const p = d.progress || d.tool_progress || d;
  const name = p.tool || p.tool_name || p.name || p.function || '';
  const what = p.label || p.message || p.status || p.summary || '';
  return String([name, what].filter(Boolean).join(': ')).slice(0, 80);
}

// POST a streamed chat completion to Hermes Agent; returns the reply text. onEvent gets
// {type: 'tool', label} | {type: 'tool_call', name} | {type: 'reasoning', delta} | {type: 'content', delta} as they stream.
// The timeout is for silence, not the whole turn: Hermes sends keepalives while it works.
export async function hermesChat(url, { key, session, sessionKey, model, messages }, { idleMs = 300000, onEvent = () => {}, signal } = {}) {
  const ac = new AbortController();
  signal?.addEventListener('abort', () => ac.abort());
  let timer = setTimeout(() => ac.abort(), idleMs);
  const poke = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), idleMs); };
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(session ? { 'X-Hermes-Session-Id': session } : {}),
        ...(sessionKey ? { 'X-Hermes-Session-Key': sessionKey } : {}),
      },
      body: JSON.stringify({ model: model || 'hermes-agent', messages, stream: true }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
    if (!/event-stream/.test(r.headers.get('content-type') || '')) {
      const j = await r.json();
      return j.choices?.[0]?.message?.content ?? '';
    }
    let text = '', buf = '';
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      poke();
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const ev = parseSseBlock(block);
        if (!ev) continue;
        if (ev.raw === '[DONE]') return text;
        const d = ev.data;
        if (/tool\.progress/.test(ev.event) || /tool\.progress/.test(String(d?.object || d?.type || ''))) { onEvent({ type: 'tool', label: progressLabel(d) }); continue; }
        const ch = d?.choices?.[0];
        if (!ch) continue;
        const delta = ch.delta || {};
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof thought === 'string' && thought) onEvent({ type: 'reasoning', delta: thought });
        for (const tc of delta.tool_calls || []) if (tc.function?.name) onEvent({ type: 'tool_call', name: tc.function.name });
        if (delta.content) { text += delta.content; onEvent({ type: 'content', delta: delta.content }); }
        if (ch.finish_reason === 'error' || ch.finish_reason === 'cancelled') throw new Error(`Hermes ended the turn: ${ch.finish_reason}`);
      }
    }
    return text;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? (signal?.aborted ? 'stopped from the HUD' : `no word from Hermes for ${Math.round(idleMs / 1000)}s`) : e.message);
  } finally { clearTimeout(timer); }
}

const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');
const short = (v, n = 160) => {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// A pending approval or clarifying question, in one shape for the HUD.
export function normalizeControl(c) {
  if (!c || typeof c !== 'object') return null;
  const kindRaw = String(pick(c.kind, c.type, c.control, c.category, '') || '').toLowerCase();
  const type = /clarif|question|ask/.test(kindRaw) || (c.question && !c.command) ? 'clarify' : 'approval';
  const choices = pick(c.choices, c.options, c.allowed_choices);
  return {
    type,
    request_id: pick(c.prompt_id, c.request_id, c.id),
    execution_generation: pick(c.execution_generation, c.generation, 0),
    title: short(pick(c.title, c.question, c.prompt, c.message, c.description, c.reason, type === 'clarify' ? 'Clawd has a question' : 'Clawd wants to run something'), 240),
    detail: short(pick(c.command, c.preview, c.detail, c.args, c.arguments, c.tool_input, c.input), 600),
    tool: short(pick(c.tool, c.tool_name, c.server, ''), 60),
    choices: Array.isArray(choices) ? choices.slice(0, 6).map((x) => (typeof x === 'string' ? x : pick(x.value, x.id, x.label, short(x)))) : null,
  };
}

// The final answer from a finished run, wherever Hermes put it.
export function runOutput(d) {
  if (!d || typeof d !== 'object') return '';
  const o = pick(d.output_text, d.final_response, d.response, d.output, d.result, d.answer, d.text, d.message?.content, d.content);
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) { // OpenAI-style output items
    return o.map((it) => (typeof it === 'string' ? it : it.text || (it.content || []).map((c) => c.text || '').join(''))).join('');
  }
  return o && typeof o === 'object' ? pick(o.text, o.content, '') : '';
}

export class Hermes {
  constructor(cfg, { fetchImpl = fetch } = {}) {
    this.cfg = cfg;
    this.base = hermesBase(cfg);
    this.fetch = fetchImpl;
    this.caps = null; this.capsAt = 0;
    this.over = null; this.overAt = 0;
  }

  headers(extra = {}) {
    return { 'content-type': 'application/json', ...(this.cfg.key ? { Authorization: `Bearer ${this.cfg.key}` } : {}), ...extra };
  }

  async req(path, { method = 'GET', body, timeout = 8000, headers = {} } = {}) {
    const r = await this.fetch(`${this.base}${path}`, {
      method, headers: this.headers(headers), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
    if (!r.ok) throw Object.assign(new Error(`${r.status} ${short(json?.error?.message || json?.error || text, 140)}`), { status: r.status });
    return json;
  }

  async capabilities() {
    if (this.caps && Date.now() - this.capsAt < 300000) return this.caps;
    try { this.caps = await this.req('/v1/capabilities', { timeout: 3000 }); } catch { this.caps = {}; }
    this.capsAt = Date.now();
    return this.caps;
  }

  // Runs give us tools, sub-agents, approvals and stop; plain chat is the fallback.
  async useRuns() {
    if (this.cfg.api === 'chat') return false;
    if (this.cfg.api === 'runs') return true;
    const f = (await this.capabilities()).features || {};
    return !!(f.run_submission && f.run_events_sse);
  }

  // ------------------------------------------------------------ the system around Clawd
  async overview({ fresh = false } = {}) {
    if (!fresh && this.over && Date.now() - this.overAt < 15000) return this.over;
    const get = (p) => this.req(p, { timeout: 5000 });
    const [caps, health, skills, toolsets, jobs, sessions, models] = await Promise.allSettled([
      this.capabilities(), get('/health/detailed'), get('/v1/skills'), get('/v1/toolsets'), get('/api/jobs'), get('/api/sessions?limit=8'), get('/api/model/options'),
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason?.message || r.reason) });
    const list = (r, key) => { const v = val(r); return Array.isArray(v) ? v : Array.isArray(v?.[key]) ? v[key] : Array.isArray(v?.data) ? v.data : v?.error ? { error: v.error } : []; };
    this.over = {
      at: Date.now(),
      online: health.status === 'fulfilled' || caps.status === 'fulfilled',
      capabilities: val(caps),
      health: val(health),
      skills: list(skills, 'skills'),
      toolsets: list(toolsets, 'toolsets'),
      jobs: list(jobs, 'jobs'),
      sessions: list(sessions, 'sessions'),
      models: val(models),
    };
    this.overAt = Date.now();
    return this.over;
  }

  async jobAction(id, action) {
    if (!['run', 'pause', 'resume'].includes(action)) throw Object.assign(new Error('bad action'), { status: 400 });
    const out = await this.req(`/api/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });
    this.overAt = 0;
    return out;
  }

  // ------------------------------------------------------------ runs
  async startRun({ input, session, instructions }) {
    const body = { input, ...(instructions ? { instructions } : {}), ...(this.cfg.model ? { model: this.cfg.model } : {}) };
    const headers = session ? { 'X-Hermes-Session-Key': session } : {};
    try {
      return await this.req('/v1/runs', { method: 'POST', body: session ? { ...body, session_id: session } : body, headers, timeout: 20000 });
    } catch (e) {
      if (session && (e.status === 404 || e.status === 400)) return this.req('/v1/runs', { method: 'POST', body, headers, timeout: 20000 }); // no such session yet
      throw e;
    }
  }

  runStatus(id) { return this.req(`/v1/runs/${encodeURIComponent(id)}`, { timeout: 5000 }); }
  stop(id) { return this.req(`/v1/runs/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); }
  approve(id, control, choice) {
    return this.req(`/v1/runs/${encodeURIComponent(id)}/approval`, { method: 'POST', body: { request_id: control.request_id, execution_generation: control.execution_generation, choice } });
  }
  clarify(id, control, answer) {
    return this.req(`/v1/runs/${encodeURIComponent(id)}/clarify`, { method: 'POST', body: { request_id: control.request_id, execution_generation: control.execution_generation, answer } });
  }

  // One turn as a run. onEvent gets: {type:'run', id} | {type:'tool', label, detail} | {type:'tool_done', label, ms, error}
  // | {type:'agent', label} | {type:'agent_done', label, detail} | {type:'reasoning', delta} | {type:'content', delta}
  // | {type:'interim', text} | {type:'control', control} | {type:'control_clear'}. Returns the final answer.
  async runTurn({ input, session, instructions }, { idleMs = 300000, onEvent = () => {}, signal } = {}) {
    const started = await this.startRun({ input, session, instructions });
    const id = pick(started.run_id, started.id);
    if (!id) throw new Error('Hermes did not return a run id');
    onEvent({ type: 'run', id });

    let text = '', final = null, done = false, pending = null;
    const ac = new AbortController();
    const abort = () => ac.abort();
    signal?.addEventListener('abort', abort);
    let idle = setTimeout(abort, idleMs);
    const poke = () => { clearTimeout(idle); idle = setTimeout(abort, idleMs); };

    // Pending approvals and questions live on the run's status; check it on hints and every few seconds.
    const checkControls = async () => {
      try {
        const st = await this.runStatus(id);
        const list = pick(st.pending_controls, st.pending, st.controls) || [];
        const c = normalizeControl(Array.isArray(list) ? list[0] : list);
        const key = c ? `${c.request_id}|${c.execution_generation}` : null;
        if (key !== pending) { pending = key; onEvent(c ? { type: 'control', control: c } : { type: 'control_clear' }); }
        if (!final && /complet|succeed|done/.test(String(st.status || '')) && runOutput(st)) final = runOutput(st);
      } catch { /* status is best-effort */ }
    };
    const poll = setInterval(checkControls, 3000);

    try {
      const r = await this.fetch(`${this.base}/v1/runs/${encodeURIComponent(id)}/events`, { headers: this.headers({ accept: 'text/event-stream' }), signal: ac.signal });
      if (!r.ok) throw new Error(`events ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        poke();
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
          const ev = parseSseBlock(buf.slice(0, i));
          buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
          if (!ev) continue;
          const d = ev.data || {};
          const name = String(ev.event !== 'message' ? ev.event : pick(d.event, d.type, 'message'));
          if (name === 'message.delta') {
            const delta = pick(d.delta, d.text, d.content, d.choices?.[0]?.delta?.content, '');
            if (typeof delta === 'string' && delta) { text += delta; onEvent({ type: 'content', delta }); }
          } else if (name === 'message.interim') {
            if (!d.already_streamed && d.text) onEvent({ type: 'interim', text: short(d.text, 240) });
          } else if (/reasoning|thinking/.test(name)) {
            const delta = pick(d.delta, d.text, d.content, '');
            if (typeof delta === 'string' && delta) onEvent({ type: 'reasoning', delta });
          } else if (name === 'tool.started') {
            onEvent({ type: 'tool', label: short(pick(d.tool, d.name, 'tool'), 60), detail: short(d.preview, 200) });
          } else if (name === 'tool.completed') {
            onEvent({ type: 'tool_done', label: short(pick(d.tool, d.name, 'tool'), 60), ms: d.duration != null ? Math.round(Number(d.duration) * 1000) : null, error: d.error ? short(d.error, 160) : null, detail: short(d.preview, 200) });
          } else if (/tool\.progress/.test(name)) {
            onEvent({ type: 'tool', label: progressLabel(d) });
          } else if (name === 'subagent.start') {
            onEvent({ type: 'agent', label: short(pick(d.name, d.goal, d.task, d.summary, 'sub-agent'), 80) });
          } else if (name === 'subagent.complete') {
            onEvent({ type: 'agent_done', label: short(pick(d.name, d.summary, 'sub-agent'), 80), detail: [d.status, d.duration != null ? `${Number(d.duration).toFixed(1)}s` : '', d.cost != null ? `$${Number(d.cost).toFixed(3)}` : ''].filter(Boolean).join(' · ') });
          } else if (/approval|clarif|control/.test(name)) {
            const c = normalizeControl(d);
            if (c?.request_id != null) { pending = `${c.request_id}|${c.execution_generation}`; onEvent({ type: 'control', control: c }); } else checkControls();
          } else if (name === 'run.completed') {
            final = runOutput(d) || final;
            done = true;
          } else if (name === 'run.failed' || name === 'run.interrupted' || name === 'run.cancelled' || name === 'run.stopped') {
            throw new Error(`Hermes run ${name.split('.')[1]}${d.error ? `: ${short(d.error?.message || d.error, 120)}` : ''}`);
          }
          if (done) break;
        }
        if (done) break;
      }
      if (!done && !final) await checkControls();
      if (pending) onEvent({ type: 'control_clear' });
      return String(final || text || '').trim();
    } catch (e) {
      if (ac.signal.aborted) throw new Error(signal?.aborted ? 'stopped from the HUD' : `no word from Hermes for ${Math.round(idleMs / 1000)}s`);
      throw e;
    } finally {
      clearTimeout(idle); clearInterval(poll);
      signal?.removeEventListener('abort', abort);
    }
  }
}
