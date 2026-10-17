import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { hashFixture } from './hash-fixture.js';
const compile = (files = hashFixture()) => content.compileLevel(content.loadContent(files), 'sample');

test('pure SHA-256 agrees with published vectors and UTF-8 including surrogate replacement', () => {
  assert.equal(typeof content.sha256, 'function');
  assert.equal(content.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(content.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const input of ['你好🌍', '\ud800', 'a'.repeat(1000000), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) {
    assert.equal(content.sha256(input), createHash('sha256').update(input).digest('hex'));
  }
});

test('canonical JSON sorts keys, preserves arrays and rejects noninteger sim values', () => {
  assert.equal(typeof content.canonicalJson, 'function');
  assert.equal(content.canonicalJson({ z: [2, 1], a: { b: -0, a: 1250 } }), '{"a":{"a":1250,"b":0},"z":[2,1]}');
  for (const invalid of [1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.throws(() => content.canonicalJson(invalid));
});

test('resolved rates, speeds, positions, ownership, garrison, teams and time limits change sim identity', () => {
  const original = compile().simHash;
  assert.match(original ?? '', /^[a-f0-9]{64}$/);
  const changes = [
    (f: content.ContentFileMap) => { (f['data/archetypes/standard.json'] as content.Archetype).components.generates!.ratePerSec = 1.5; },
    (f: content.ContentFileMap) => { (f['data/troops/regular.json'] as content.Troop).speed = 11; },
    (f: content.ContentFileMap) => { (f['data/levels/sample.json'] as content.Level).towers[0]!.pos.x = -39; },
    (f: content.ContentFileMap) => { (f['data/levels/sample.json'] as content.Level).towers[0]!.garrison = 11; },
    (f: content.ContentFileMap) => { const players = (f['data/levels/sample.json'] as content.Level).players; players[0]!.team = 'b1'; players[1]!.team = 'p1'; },
    (f: content.ContentFileMap) => { (f['data/levels/sample.json'] as content.Level).timeLimitSec = 200; },
  ];
  for (const change of changes) { const files = hashFixture(); change(files); assert.notEqual(compile(files).simHash, original); }
});

test('reskins, names, metadata, unused entities and bot tuning preserve sim identity', () => {
  const files = hashFixture(); const before = compile(files);
  (files['data/levels/sample.json'] as content.Level).name = 'Renamed';
  (files['data/levels/sample.json'] as content.Level).visual = 'night';
  (files['data/levels/sample.json'] as content.Level).players[0]!.colorKey = 'green';
  (files['data/archetypes/standard.json'] as content.Archetype).visual = 'skin';
  (files['data/troops/regular.json'] as content.Troop).visual = 'skin';
  (files['data/troops/unused.json'] as content.Troop).speed = 6;
  (files['data/balance.json'] as content.Balance).defaults.theme = 'night';
  (files['content.json'] as content.Content).contentVersion = '1.0.1';
  (files['data/bots/base.json'] as content.BotProfile).params.bias!.attack = 2;
  const after = compile(files);
  assert.equal(after.simHash, before.simHash);
  assert.notEqual(after.botHash?.easy, before.botHash?.easy);
});

test('key, file and entity ordering are immaterial and bot inheritance provenance is excluded', () => {
  const files = hashFixture(); const before = compile(files);
  const level = files['data/levels/sample.json'] as content.Level;
  level.players.reverse(); level.towers.reverse();
  const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
  assert.equal(compile(reverseKeys(files) as content.ContentFileMap).simHash, before.simHash);
  files['data/bots/easy.json'] = { $schema: 'bot.schema.json', schemaVersion: '1.0.0', ...before.bots[0]!.profile, params: { skill: { decisionIntervalSec: 1.25, noise: 0.3, actionsPerDecision: 2 }, bias: { attack: 1.125 } } };
  assert.deepEqual(compile(files).botHash, before.botHash);
});
