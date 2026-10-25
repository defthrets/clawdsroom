// HERMES // SYSTEMS: everything around Clawd on Hermes Agent, as a full-screen takeover. Health and
// readiness, capabilities, model, skills (a hex matrix), toolsets, scheduled jobs (run / pause / resume)
// and recent sessions. Fields Hermes doesn't pin down are read defensively.

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');
const arr = (v) => (Array.isArray(v) ? v : []);
function when(v) {
  if (v == null || v === '') return '—';
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(t)) return esc(String(v)).slice(0, 20);
  const d = new Date(t), diff = (t - Date.now()) / 60000;
  const rel = Math.abs(diff) < 60 ? `${Math.round(Math.abs(diff))}m` : Math.abs(diff) < 1440 ? `${Math.round(Math.abs(diff) / 60)}h` : `${Math.round(Math.abs(diff) / 1440)}d`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())} <small>${diff >= 0 ? 'in ' : ''}${rel}${diff < 0 ? ' ago' : ''}</small>`;
}

const DEMO = {
  online: true,
  capabilities: { platform: 'hermes-agent', model: 'hermes-agent', features: { chat_completions: true, responses_api: true, run_submission: true, run_events_sse: true, run_stop: true, run_approval: true, reasoning_streaming: true, tool_progress_events: true } },
  health: { status: 'ok', model: 'anthropic/claude', active_runs: 1, readiness: { checks: { config: 'ok', state_db: 'ok', model: 'ok', disk: 'ok', gateway: 'ok', delegations: 'ok' } } },
  skills: ['github-pr-workflow', 'homelab-ops', 'frigate-review', 'starlink-diag', 'foxess-power', 'immich-search', 'chirpa-birds', 'diary', 'web-research', 'cron-author', 'docker-doctor', 'backup-check'].map((name, i) => ({ name, category: ['dev', 'ops', 'ops', 'net', 'power', 'media', 'media', 'self', 'web', 'ops', 'ops', 'ops'][i] })),
  toolsets: [
    { name: 'core', label: 'Core', enabled: true, configured: true, tools: ['read_file', 'write_file', 'patch', 'search'] },
    { name: 'terminal', label: 'Terminal', enabled: true, configured: true, tools: ['terminal', 'process'] },
    { name: 'web', label: 'Web', enabled: true, configured: true, tools: ['web_search', 'web_extract'] },
    { name: 'browser', label: 'Browser', enabled: false, configured: false, tools: ['browser_navigate', 'browser_click'] },
    { name: 'delegation', label: 'Delegation', enabled: true, configured: true, tools: ['delegate_task'] },
    { name: 'tts', label: 'Voice', enabled: true, configured: true, tools: ['text_to_speech'] },
  ],
  jobs: [
    { id: 'j1', name: 'morning brief', schedule: '40 7 * * *', next_run_at: Date.now() + 5.5 * 3600e3, last_status: 'ok', enabled: true },
    { id: 'j2', name: 'nightly diary', schedule: '30 22 * * *', next_run_at: Date.now() + 14 * 3600e3, last_status: 'ok', enabled: true },
    { id: 'j3', name: 'watchdog sweep', schedule: 'every 5m', next_run_at: Date.now() + 3 * 60e3, last_status: 'ok', enabled: true },
    { id: 'j4', name: 'backup /mnt', schedule: '0 3 * * 0', next_run_at: Date.now() + 3 * 86400e3, last_status: 'error', enabled: false },
  ],
  sessions: [
    { id: 's1', title: 'HUD neural link', source: 'api', message_count: 14, updated_at: Date.now() - 60e3 },
    { id: 's2', title: 'Telegram · you', source: 'telegram', message_count: 210, updated_at: Date.now() - 3600e3 },
    { id: 's3', title: 'crew bus', source: 'discord', message_count: 88, updated_at: Date.now() - 4 * 3600e3 },
    { id: 's4', title: 'cron: morning brief', source: 'cron', message_count: 6, updated_at: Date.now() - 22 * 3600e3 },
  ],
  models: { providers: [{ name: 'anthropic' }, { name: 'nous' }, { name: 'openrouter' }] },
};

export function initSystems(store, { $, auth = {} }) {
  const panel = $('sys'), btn = $('sys-btn');
  let data = null, timer = null, agent = 'clawd', busy = false;
  const isOpen = () => !panel.classList.contains('hidden');

  async function load(fresh = false) {
    if (store.mode === 'demo') { data = DEMO; render(); return; }
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(`/api/hermes/overview?agent=${encodeURIComponent(agent)}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' });
      data = r.ok ? await r.json() : { online: false, error: (await r.json().catch(() => ({}))).error || r.status };
    } catch (e) { data = { online: false, error: e.message }; }
    busy = false;
    render();
  }

  function open() {
    panel.classList.remove('hidden');
    btn.classList.add('on');
    load(true);
    clearInterval(timer);
    timer = setInterval(() => { if (isOpen()) load(); }, 20000);
  }
  function close() { panel.classList.add('hidden'); btn.classList.remove('on'); clearInterval(timer); }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  $('sys-close').addEventListener('click', close);
  $('sys-refresh').addEventListener('click', () => load(true));

  // job controls
  panel.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-job]');
    if (!b) return;
    b.disabled = true;
    if (store.mode === 'demo') { setTimeout(() => { b.disabled = false; b.classList.add('fired'); }, 500); return; }
    try {
      const r = await fetch(`/api/hermes/jobs/${encodeURIComponent(b.dataset.job)}/${b.dataset.act}?agent=${encodeURIComponent(agent)}`, { method: 'POST', headers: auth });
      if (!r.ok) throw new Error();
      b.classList.add('fired');
      setTimeout(() => load(true), 800);
    } catch { b.classList.add('err'); }
    setTimeout(() => { b.disabled = false; }, 1200);
  });

  function render() {
    const d = data || {};
    const h = d.health || {}, caps = d.capabilities || {};
    const status = String(pick(h.status, d.online ? 'online' : 'offline')).toLowerCase();
    const lv = /ok|healthy|ready|online/.test(status) ? 'good' : /degrad|warn/.test(status) ? 'warn' : 'bad';
    $('sys-status').className = `sys-orb ${lv}`;
    $('sys-status-t').textContent = d.online === false ? 'OFFLINE' : status.toUpperCase();
    $('sys-model').textContent = String(pick(h.model?.name, h.model, caps.model, '—')).toUpperCase();
    $('sys-platform').textContent = String(pick(caps.platform, 'hermes-agent')).toUpperCase();
    $('sys-runs').textContent = String(pick(h.active_runs, h.runs?.active, h.api_runs, 0));
    $('sys-err').textContent = d.error ? `LINK ERROR · ${String(d.error).toUpperCase()}` : '';

    // readiness checks
    const checks = h.readiness?.checks || h.checks || {};
    const entries = Array.isArray(checks) ? checks.map((c) => [pick(c.name, c.id, '?'), pick(c.status, c.ok)]) : Object.entries(checks).map(([k, v]) => [k, typeof v === 'object' ? pick(v.status, v.ok) : v]);
    $('sys-checks').innerHTML = entries.length ? entries.map(([k, v]) => {
      const ok = v === true || /ok|pass|ready|healthy/i.test(String(v));
      return `<li class="${ok ? 'ok' : 'bad'}"><i></i><span>${esc(String(k).replace(/_/g, ' ').toUpperCase())}</span><b>${ok ? 'NOMINAL' : esc(String(v).toUpperCase())}</b></li>`;
    }).join('') : '<li class="none">NO READINESS DATA</li>';

    // capability flags
    const f = caps.features || {};
    $('sys-caps').innerHTML = Object.keys(f).length ? Object.entries(f).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => `<span class="cap${v ? ' on' : ''}">${esc(k.replace(/_/g, ' ').toUpperCase())}</span>`).join('') : '<span class="cap">NO CAPABILITY DATA</span>';

    // models
    const m = d.models || {};
    const providers = arr(pick(m.providers, m.authenticated_providers, m.data));
    $('sys-providers').innerHTML = providers.length ? providers.slice(0, 8).map((p) => `<span class="cap on">${esc(String(pick(p.name, p.id, p.provider, p)).toUpperCase())}</span>`).join('') : '<span class="cap">—</span>';

    // skills matrix
    const skills = arr(d.skills);
    $('sys-skill-n').textContent = skills.length;
    $('sys-skills').innerHTML = skills.length ? skills.slice(0, 48).map((s, i) => {
      const name = String(pick(s.name, s.id, s)), cat = String(pick(s.category, '') || '');
      return `<div class="hex" style="--d:${(i % 12) * 0.05}s" title="${esc(s.description || '')}"><span>${esc(name.replace(/[-_]/g, ' ').toUpperCase())}</span>${cat ? `<em>${esc(cat.toUpperCase())}</em>` : ''}</div>`;
    }).join('') : `<div class="sys-none">${d.skills?.error ? 'SKILLS UNAVAILABLE' : 'NO SKILLS INSTALLED'}</div>`;

    // toolsets
    const ts = arr(d.toolsets);
    $('sys-tool-n').textContent = `${ts.filter((t) => t.enabled !== false).length}/${ts.length}`;
    $('sys-toolsets').innerHTML = ts.length ? ts.slice(0, 12).map((t) => {
      const on = t.enabled !== false, tools = arr(t.tools);
      return `<div class="ts${on ? ' on' : ''}"><i></i><b>${esc(String(pick(t.label, t.name)).toUpperCase())}</b><span>${tools.length} TOOLS${t.configured === false ? ' · NOT CONFIGURED' : ''}</span><div class="ts-tools">${tools.slice(0, 8).map((x) => `<em>${esc(x)}</em>`).join('')}</div></div>`;
    }).join('') : '<div class="sys-none">NO TOOLSETS REPORTED</div>';

    // scheduled jobs
    const jobs = arr(d.jobs);
    $('sys-job-n').textContent = jobs.length;
    $('sys-jobs').innerHTML = jobs.length ? jobs.slice(0, 8).map((j) => {
      const id = pick(j.id, j.job_id, j.name);
      const paused = j.enabled === false || /pause/i.test(String(j.state || j.status || ''));
      const last = String(pick(j.last_status, j.last_run?.status, j.last_result, '') || '');
      const lastLv = /err|fail/i.test(last) ? 'bad' : last ? 'good' : '';
      return `<div class="job${paused ? ' paused' : ''}">
        <div class="job-main"><b>${esc(String(pick(j.name, j.title, j.prompt, id)).slice(0, 40).toUpperCase())}</b><span>${esc(String(pick(j.schedule, j.cron, j.interval, '')).toUpperCase())}${paused ? ' · PAUSED' : ''}</span></div>
        <div class="job-next"><span>NEXT</span><b>${paused ? '—' : when(pick(j.next_run_at, j.next_run, j.next))}</b></div>
        <div class="job-last ${lastLv}">${last ? esc(last.toUpperCase()) : '—'}</div>
        <div class="job-act"><button data-job="${esc(id)}" data-act="run" title="run now">▶</button><button data-job="${esc(id)}" data-act="${paused ? 'resume' : 'pause'}" title="${paused ? 'resume' : 'pause'}">${paused ? '↻' : '❚❚'}</button></div>
      </div>`;
    }).join('') : '<div class="sys-none">NO SCHEDULED JOBS</div>';

    // sessions
    const ss = arr(d.sessions);
    $('sys-sessions').innerHTML = ss.length ? ss.slice(0, 7).map((s) => `<div class="sess"><i class="src-${esc(String(pick(s.source, s.platform, 'api')).toLowerCase())}"></i><b>${esc(String(pick(s.title, s.name, s.id)).slice(0, 34))}</b><span>${esc(String(pick(s.source, s.platform, '')).toUpperCase())}${pick(s.message_count, s.messages) != null ? ` · ${pick(s.message_count, s.messages)} MSG` : ''}</span><em>${when(pick(s.updated_at, s.last_active, s.updated, s.created_at))}</em></div>`).join('') : '<div class="sys-none">NO SESSIONS</div>';

    const t = new Date(d.at || Date.now());
    $('sys-at').textContent = `SYNC ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  }

  return { open, close, setAgent: (a) => { agent = a; } };
}
