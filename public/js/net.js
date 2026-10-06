// Talks to the server over Server-Sent Events, with reconnect. Falls back to demo mode when
// the server can't be reached (file://, static hosting, or the homelab is down).

export function connect(store, { onMode, demoForced = false, fallbackMs = 4000 } = {}) {
  let es = null;
  let gotState = false;
  let fallbackTimer = null;
  let retry = 0;
  let demo = null;

  const setMode = (m) => { store.mode = m; onMode && onMode(m); };

  const startDemo = async () => {
    if (demo) return;
    const mod = await import('./demo.js');
    demo = mod.startDemo(store);
    setMode('demo');
  };

  if (demoForced || location.protocol === 'file:') {
    startDemo();
    return { stop() { demo && demo.stop(); } };
  }

  const open = () => {
    if (es) { try { es.close(); } catch { /* ignore */ } }
    es = new EventSource('/api/stream');
    es.addEventListener('state', (m) => {
      try {
        const s = JSON.parse(m.data);
        if (demo) { demo.stop(); demo = null; }
        store.set(s);
        gotState = true;
        retry = 0;
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        setMode('live');
      } catch (e) { console.warn('bad state', e); }
    });
    es.addEventListener('event', (m) => {
      try {
        const ev = JSON.parse(m.data);
        // The server already applied the event and will send the new state; just announce it.
        store.event(ev, { apply: false });
      } catch (e) { console.warn('bad event', e); }
    });
    es.onerror = () => {
      // EventSource reconnects on its own for transient errors, but Safari sometimes gives up.
      if (gotState) setMode('lost');
      retry++;
      if (retry > 3) {
        try { es.close(); } catch { /* ignore */ }
        es = null;
        const wait = Math.min(30000, 1000 * 2 ** Math.min(retry, 5));
        setTimeout(open, wait);
      }
    };
  };

  fallbackTimer = setTimeout(() => { if (!gotState) startDemo(); }, fallbackMs);
  open();

  // While lost, keep probing so we come back the moment the homelab is up again.
  const probe = setInterval(async () => {
    if (store.mode !== 'lost' && store.mode !== 'demo') return;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok && !es) open();
    } catch { /* still down */ }
  }, 15000);

  return {
    stop() { clearInterval(probe); if (es) es.close(); demo && demo.stop(); },
  };
}
