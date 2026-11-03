import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Frigate, shapeEvent } from '../server/frigate.js';

test('a Frigate event becomes what the HUD shows', () => {
  const e = shapeEvent({ id: '1.2-ab', camera: 'front', label: 'person', sub_label: 'you', start_time: 1700000000.5, end_time: 1700000010.5, zones: ['yard'], has_clip: true, has_snapshot: true, data: { top_score: 0.913, box: [0.1, 0.2, 0.3, 0.4] } });
  assert.deepEqual(e, { id: '1.2-ab', camera: 'front', label: 'person: you', score: 0.91, start: 1700000000500, end: 1700000010500, zones: ['yard'], clip: true, snapshot: true, box: [0.1, 0.2, 0.3, 0.4] });
});

test('recent events and media are proxied, with ranges, and bad ids refused', async () => {
  const seen = [];
  const fake = http.createServer((req, res) => {
    seen.push({ url: req.url, range: req.headers.range, auth: req.headers.authorization });
    if (req.url.startsWith('/api/events?')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([{ id: 'e1', camera: 'shed', label: 'cat', start_time: 1, data: {} }])); }
    if (req.url === '/api/events/e1/clip.mp4') { res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/10', 'content-length': '2' }); return res.end('ab'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const f = new Frigate({ url: `http://127.0.0.1:${fake.address().port}/`, token: 't0k' });
  const out = await f.recent();
  assert.equal(out.enabled, true);
  assert.equal(out.events[0].camera, 'shed');
  assert.equal(seen[0].auth, 'Bearer t0k');

  const app = http.createServer((req, res) => {
    const [, kind, id] = req.url.split('/');
    f.pipe(req, res, kind, decodeURIComponent(id));
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const clip = await fetch(`${base}/clip/e1`, { headers: { range: 'bytes=0-1' } });
  assert.equal(clip.status, 206);
  assert.equal(clip.headers.get('content-range'), 'bytes 0-1/10');
  assert.equal(await clip.text(), 'ab');
  assert.equal(seen.at(-1).range, 'bytes=0-1');
  assert.equal((await fetch(`${base}/thumb/${encodeURIComponent('../x')}`)).status, 400);
  assert.equal((await fetch(`${base}/thumb/nope`)).status, 404);
  assert.deepEqual(await new Frigate({ url: '' }).recent(), { enabled: false, events: [] });
  app.close(); fake.close();
});
