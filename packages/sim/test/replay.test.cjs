const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { metadata, compiledGolden } = require('./fixtures.cjs');

const level = () => compiledGolden();
function recorded(ticks = 45) {
  const rec = api.createReplayRecorder(level(), 77, metadata);
  for (let i = 0; i < ticks; i++) rec.step(i === 0 ? [{ type: 'Noop' }, null] : []);
  return rec.record();
}
const source = () => ({ metadata, level: level() });
const JSONCLONE = (x) => JSON.parse(JSON.stringify(x));

test('replay round-trips submitted order, checkpoints and manually stopped tick', () => {
  const rec = recorded();
  assert.deepEqual(rec.commands.map((c) => c.tick), [0, 0]);
  assert.deepEqual(rec.checkpoints.map((c) => c.tick), [20, 40]);
  assert.equal(rec.finalTick, 45); assert.equal(rec.outcome, null);
  assert.equal(rec.header.levelId, 'levelview-1');
  const result = api.playReplay(source(), JSONCLONE(rec));
  assert.equal(result.ok, true); assert.equal(result.sim.view.tick, 45);
  assert.equal(result.sim.hash(), rec.finalHash);
});

test('recorder clones submissions and detaches exported records', () => {
  const rec = api.createReplayRecorder(level(), 77, metadata), cmd = { type: 'Noop', nested: { a: 1 } };
  rec.step([cmd]); cmd.nested.a = 2;
  const first = rec.record(); first.commands[0].cmd.nested.a = 3; first.header.seed = 9;
  assert.equal(rec.record().commands[0].cmd.nested.a, 1);
  assert.equal(api.playReplay(source(), rec.record()).ok, true);
});

test('pause, split and twice-per-driver-interval yield identical replay hashes', () => {
  const a = api.createReplayRecorder(level(), 77, metadata), b = api.createReplayRecorder(level(), 77, metadata);
  for (let i = 0; i < 45; i++) a.step([]);
  for (let interval = 0; interval < 30; interval++) {
    if (interval % 3 === 0) continue;
    for (let speed = 0; speed < 2; speed++) b.step([]);
  }
  for (let i = 0; i < 5; i++) b.step([]);
  assert.deepEqual(a.record(), b.record());
});

test('header versions, identity, seed format and malformed records are refused', () => {
  const rec = recorded();
  for (const [key, value] of [['rulesVersion', '3.0.0'], ['schemaVersion', '9.0.0'], ['contentVersion', '9.0.0'], ['levelId', 'other'], ['simHash', 'b'.repeat(64)], ['seed', -1], ['seed', 4294967296], ['seed', 1.5], ['seed', '77']]) {
    const tampered = structuredClone(rec); tampered.header[key] = value;
    assert.throws(() => api.playReplay(source(), tampered), /replay/i, key);
  }
  for (const mutate of [(r) => r.header = null, (r) => r.finalTick = -1, (r) => r.finalTick = 1.5, (r) => r.commands[0].tick = -1, (r) => r.commands[0].tick = 45, (r) => r.checkpoints.reverse(), (r) => r.checkpoints.pop(), (r) => r.checkpoints[0].tick = 19, (r) => r.checkpoints[0].hash = 'bad', (r) => r.finalHash = 'bad', (r) => r.outcome = { outcome: 'bogus', winner: null }, (r) => r.outcome = { outcome: 'draw', winner: null }]) {
    const tampered = structuredClone(rec); mutate(tampered); assert.throws(() => api.playReplay(source(), tampered), /replay/i);
  }
  assert.throws(() => api.createReplayRecorder(level(), NaN, metadata), /replay/i);
});

test('rulesVersion requires equal major.minor only; patch may differ, minor and major refused', () => {
  const rec = recorded(), [major, minor, patch] = metadata.rulesVersion.split('.').map(Number);
  const withRules = (v) => { const t = structuredClone(rec); t.header.rulesVersion = v; return t; };
  assert.equal(api.playReplay(source(), withRules(`${major}.${minor}.${patch + 1}`)).ok, true);
  for (const v of [`${major}.${minor + 1}.${patch}`, `${major + 1}.${minor}.${patch}`]) assert.throws(() => api.playReplay(source(), withRules(v)), /replay/i, v);
});

test('checkpoint reports first observable divergent tick; final hash mismatch fails', () => {
  const rec = recorded();
  for (const [mutate, tick] of [[(r) => r.checkpoints[0].hash = '0'.repeat(16), 20], [(r) => r.checkpoints[1].hash = '0'.repeat(16), 40], [(r) => r.finalHash = '0'.repeat(16), 45]]) {
    const tampered = structuredClone(rec); mutate(tampered);
    const result = api.playReplay(source(), tampered); assert.equal(result.ok, false); assert.equal(result.divergingTick, tick);
  }
});

test('lossy and cyclic submissions are refused atomically before stepping', () => {
  const recorder = api.createReplayRecorder(level(), 77, metadata);
  const cyclic = { type: 'Noop' }; cyclic.extra = cyclic;
  for (const cmd of [undefined, { type: 'Noop', extra: Infinity }, { type: 'Noop', extra: undefined }, cyclic]) {
    assert.throws(() => recorder.step([cmd]), /replay/i); assert.equal(recorder.view.tick, 0); assert.deepEqual(recorder.record().commands, []);
  }
  recorder.step([{ type: 'Noop', nested: [null, 'extra', 12] }]);
  assert.equal(api.playReplay(source(), recorder.record()).ok, true);
});

test('resolveLevel source resolves by header level id; an untimed level imposes no tick bound', () => {
  const rec = recorded(25);
  assert.equal(level().timeLimitSec, null);
  assert.equal(api.playReplay({ metadata, resolveLevel: (id) => { assert.equal(id, 'levelview-1'); return level(); } }, rec).ok, true);
});

test('v1 replays are rejected: 1.x rulesVersion, v1 outcome shape (winnerTeam/draw), v1 header fields', () => {
  const rec = recorded();
  const v1 = structuredClone(rec); v1.header.rulesVersion = '1.0.0';
  assert.throws(() => api.playReplay(source(), v1), /replay/i);
  const winnerTeam = structuredClone(rec); winnerTeam.outcome = { outcome: 'won', winnerTeam: 0 };
  assert.throws(() => api.playReplay(source(), winnerTeam), /replay/i);
  const draw = structuredClone(rec); draw.outcome = { outcome: 'draw', winner: null };
  assert.throws(() => api.playReplay(source(), draw), /replay/i);
  const v1hash = structuredClone(rec); v1hash.header.simHash = 'a'.repeat(32);
  assert.throws(() => api.playReplay(source(), v1hash), /replay/i);
  assert.equal(rec.header.rulesVersion, metadata.rulesVersion);
  assert.equal(metadata.rulesVersion.split('.')[0], '2');
});

test('a finite time limit bounds finalTick; limit 0 (null) imposes none; outcome carries winner', () => {
  const rec = recorded(45);
  const timed = level(); timed.timeLimitSec = 1; // 20 ticks
  assert.throws(() => api.playReplay({ metadata, level: timed }, rec), /replay/i);
  const shorter = recorded(20);
  assert.equal(api.playReplay({ metadata, level: timed }, shorter).ok, true);
  const long = recorded(300);
  assert.equal(api.playReplay(source(), long).ok, true);
  assert.equal(api.createReplayRecorder(level(), 1, metadata).view.timeLimitTicks, 0);
  assert.ok(!('winnerTeam' in (rec.outcome ?? {})));
});

test('hash round-trips through playReplay and includes seed-dependent stream states', () => {
  const lvl = level();
  const sim = api.createReplayRecorder(lvl, 5, metadata);
  for (let i = 0; i < 65; i++) sim.step([]);
  const rec = sim.record();
  assert.deepEqual(rec.checkpoints.map((c) => c.tick), [20, 40, 60]);
  const result = api.playReplay({ metadata, level: lvl }, JSONCLONE(rec));
  assert.equal(result.ok, true);
  assert.equal(result.sim.hash(), sim.hash());
  const other = api.createReplayRecorder(lvl, 6, metadata);
  for (let i = 0; i < 65; i++) other.step([]);
  assert.notEqual(other.hash(), sim.hash(), 'seed-dependent stream states are hashed');
});
