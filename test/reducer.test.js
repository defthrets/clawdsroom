import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, expandDots, coerce, applyEvent, clone } from '../public/js/reducer.js';
import { DEFAULT_STATE } from '../public/js/defaults.js';

test('expandDots nests dotted keys', () => {
  assert.deepEqual(expandDots({ 'clawd.activity': 'terminal', 'power.battery': 42 }), { clawd: { activity: 'terminal' }, power: { battery: 42 } });
  assert.deepEqual(expandDots({ 'a.b': 1, a: { c: 2 } }), { a: { b: 1, c: 2 } });
});

test('deepMerge merges objects, replaces arrays, deletes on null', () => {
  const base = { a: { b: 1, c: [1, 2] }, d: 'x', e: 5 };
  const out = deepMerge(base, { a: { c: [3] }, d: null, f: true });
  assert.deepEqual(out, { a: { b: 1, c: [3] }, e: 5, f: true });
  assert.deepEqual(base.a.c, [1, 2], 'does not mutate the base');
});

test('coerce turns query strings into numbers and booleans', () => {
  assert.equal(coerce('12'), 12);
  assert.equal(coerce('true'), true);
  assert.equal(coerce('null'), null);
  assert.equal(coerce('hello'), 'hello');
  assert.equal(coerce(''), '');
});

test('applyEvent updates counters and keeps a ring buffer', () => {
  let s = clone(DEFAULT_STATE);
  s = applyEvent(s, { type: 'bird', species: 'Robin', new_species: true, at: 1 });
  assert.equal(s.chirpa.detections_today, 1);
  assert.equal(s.chirpa.species_today, 1);
  assert.equal(s.chirpa.last.species, 'Robin');
  s = applyEvent(s, { type: 'telegram', from: 'you', text: 'hi', at: 2 });
  assert.equal(s.telegram.unread, 1);
  s = applyEvent(s, { type: 'subagent', action: 'spawn', name: 'scout', at: 3 });
  assert.equal(s.subagents.active, 1);
  assert.equal(s.clawd.activity, 'delegating');
  s = applyEvent(s, { type: 'subagent', action: 'done', name: 'scout', at: 4 });
  assert.equal(s.subagents.active, 0);
  assert.deepEqual(s.subagents.names, []);
  for (let i = 0; i < 80; i++) s = applyEvent(s, { type: 'note', text: `n${i}`, at: 10 + i });
  assert.equal(s.events.length, 60);
  assert.equal(s.events[59].text, 'n79');
});

test('bark escalates watchdog state and keeps up to five reasons', () => {
  let s = clone(DEFAULT_STATE);
  s = applyEvent(s, { type: 'bark', reason: 'disk 92%' });
  assert.equal(s.watchdog.state, 'warning');
  s = applyEvent(s, { type: 'bark', reason: 'gateway down', level: 'alert' });
  assert.equal(s.watchdog.state, 'alert');
  for (let i = 0; i < 6; i++) s = applyEvent(s, { type: 'bark', reason: `r${i}` });
  assert.equal(s.watchdog.alerts.length, 5);
});
