import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { dataOnly, hashFixture } from './hash-fixture.js';
const LEVEL = 'levelview-1';
const compile = (files = hashFixture()) => content.loadContent(dataOnly(files)).compiled[LEVEL]!;

test('pure SHA-256 agrees with published vectors and UTF-8 including surrogate replacement', () => {
  assert.equal(content.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(content.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const input of ['你好🌍', '\ud800', 'a'.repeat(1000000), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) {
    assert.equal(content.sha256(input), createHash('sha256').update(input).digest('hex'));
  }
});

test('canonical JSON sorts keys, preserves arrays and rejects noninteger sim values', () => {
  assert.equal(content.canonicalJson({ z: [2, 1], a: { b: -0, a: 1250 } }), '{"a":{"a":1250,"b":0},"z":[2,1]}');
  for (const invalid of [1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.throws(() => content.canonicalJson(invalid));
});

test('resolved rules, unit stats, positions, ownership, levels and time limits change sim identity', () => {
  const original = compile().simHash;
  assert.match(original, /^[a-f0-9]{64}$/);
  const changes: Array<(f: Record<string, any>) => void> = [
    (f) => { f['data/balance.json'].growth.base = 1.1; },
    (f) => { f['data/units/soldier.json'].speed = 6; },
    (f) => { f['data/buildings/house-wt1.json'].modules.level.maxLevel += 1; },
    (f) => { f[`data/levels/${LEVEL}.json`].buildings[0].pos.x += 1; },
    (f) => { f[`data/levels/${LEVEL}.json`].buildings[0].level += 1; },
    (f) => { f[`data/levels/${LEVEL}.json`].timeLimitSec = 200; },
  ];
  for (const change of changes) { const files = hashFixture(); change(files); assert.notEqual(compile(files).simHash, original); }
});

test('names, source, visuals, metadata and bot tuning preserve sim identity; bot edits move only botHash', () => {
  const before = compile();
  const files = hashFixture();
  const level = files[`data/levels/${LEVEL}.json`];
  level.name = 'Renamed'; level.source.asset = 'Other'; level.theme = 'green';
  for (const p of level.players) p.colorKey = `${p.colorKey}-alt`;
  files['data/units/soldier.json'].visual = 'unit.skin';
  files['content.json'].contentVersion = '2.0.1';
  const seat = level.players.find((p: any) => p.bot);
  seat.bot.behavior = seat.bot.behavior === 'full' ? 'attackOnly' : 'full';
  const after = compile(files);
  assert.equal(after.simHash, before.simHash);
  assert.notDeepEqual(after.botHash, before.botHash);
  assert.deepEqual(Object.keys(after.botHash), Object.keys(before.botHash));
  for (const key of Object.keys(after.botHash)) assert.match(key, /^levelview-1#p\d+$/);
});

test('file key order is immaterial', () => {
  const before = compile();
  const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
  assert.equal(compile(reverseKeys(hashFixture()) as Record<string, any>).simHash, before.simHash);
});
