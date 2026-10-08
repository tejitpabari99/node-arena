const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const metadata = require('../../content/content.json');
function level(limit = 3) {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'replay', simHash: 'a'.repeat(64), timeLimitSec: limit, visual: '', bots: [],
    players: [0, 1].map(i => ({ id: `p${i}`, team: `team${i}`, kind: i ? 'bot' : 'human', colorKey: '' })),
    towers: ['a', 'b'].map((id, i) => ({ id, x: i * 1000, y: 0, owner: i, garrison: 5, archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 1000 }, drawsLines: { extraSlotAbove: [] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 100, visual: '' }] };
}
const draw = (player = 'p0', from = 'a', to = 'b') => ({ type: 'DrawLine', player, from, to });
function recorded(ticks = 45) {
  const rec = api.createReplayRecorder(level(), 77, metadata);
  for (let i = 0; i < ticks; i++) rec.step(i === 0 ? [draw('p1', 'b', 'a'), draw(), draw(), null] : []);
  return rec.record();
}
const source = () => ({ metadata, level: level() });
test('replay round-trips submitted order, rejected commands, checkpoints and manually stopped tick', () => {
  assert.equal(typeof api.createReplayRecorder, 'function');
  const rec = recorded();
  assert.deepEqual(rec.commands.map(c => c.tick), [0, 0, 0, 0]);
  assert.deepEqual(rec.commands.map(c => c.cmd?.player), ['p1', 'p0', 'p0', undefined]);
  assert.deepEqual(rec.checkpoints.map(c => c.tick), [20, 40]);
  assert.equal(rec.finalTick, 45); assert.equal(rec.outcome, null);
  const result = api.playReplay(source(), JSON.parse(JSON.stringify(rec)));
  assert.equal(result.ok, true); assert.equal(result.sim.tick, 45);
  assert.equal(result.sim.hash(), rec.finalHash); assert.equal(result.sim.rejected, 2);
});
test('recorder clones submissions before caller and event mutation and detaches exported records', () => {
  const rec = api.createReplayRecorder(level(), 77, metadata), cmd = draw();
  const events = rec.step([cmd, { ...cmd }]); cmd.to = 'a';
  events.find(e => e.type === 'CommandRejected').cmd.to = 'a';
  const first = rec.record(); first.commands[0].cmd.to = 'a'; first.header.seed = 9;
  assert.equal(rec.record().commands[0].cmd.to, 'b');
  assert.equal(api.playReplay(source(), rec.record()).ok, true);
});
test('pause, split and twice-per-driver-interval yield identical replay hashes', () => {
  const a = api.createReplayRecorder(level(), 77, metadata), b = api.createReplayRecorder(level(), 77, metadata);
  for (let i = 0; i < 45; i++) a.step(i === 0 ? [draw()] : []);
  for (let interval = 0; interval < 30; interval++) {
    if (interval % 3 === 0) continue;
    for (let speed = 0; speed < 2; speed++) b.step(b.tick === 0 ? [draw()] : []);
  }
  for (let i = 0; i < 5; i++) b.step([]);
  assert.deepEqual(a.record(), b.record());
});
test('completed games round-trip and postgame calls neither record commands nor duplicate checkpoints', () => {
  const recorder = api.createReplayRecorder(level(1), 77, metadata);
  for (let i = 0; i < 20; i++) recorder.step([]);
  const rec = recorder.record(); recorder.step([draw()]); recorder.step([]);
  assert.deepEqual(recorder.record(), rec);
  assert.equal(rec.finalTick, 20); assert.deepEqual(rec.outcome, { outcome: 'timeout', winnerTeam: null });
  assert.equal(api.playReplay({ metadata, resolveLevel: id => { assert.equal(id, 'replay'); return level(1); } }, rec).ok, true);
});
test('header versions, identity, seed format and malformed records are refused', () => {
  const rec = recorded();
  for (const [key, value] of [['rulesVersion', '2.0.0'], ['schemaVersion', '2.0.0'], ['contentVersion', '2.0.0'], ['levelId', 'other'], ['simHash', 'b'.repeat(64)], ['seed', -1], ['seed', 4294967296], ['seed', 1.5], ['seed', '77']]) {
    const tampered = structuredClone(rec); tampered.header[key] = value;
    assert.throws(() => api.playReplay(source(), tampered), /replay/i, key);
  }
  for (const mutate of [r => r.header = null, r => r.finalTick = -1, r => r.finalTick = 1.5, r => r.commands[0].tick = -1, r => r.commands[0].tick = 45, r => r.commands[0].tick = 1, r => r.checkpoints.reverse(), r => r.checkpoints.pop(), r => r.checkpoints[0].tick = 19, r => r.checkpoints[0].hash = 'bad', r => r.finalHash = 'bad', r => r.outcome = { outcome: 'bogus', winnerTeam: null }]) {
    const tampered = structuredClone(rec); mutate(tampered); assert.throws(() => api.playReplay(source(), tampered), /replay/i);
  }
  assert.throws(() => api.createReplayRecorder(level(), NaN, metadata), /replay/i);
});
test('rulesVersion requires equal major.minor only; patch may differ, minor and major refused', () => {
  const rec = recorded(), [major, minor, patch] = metadata.rulesVersion.split('.').map(Number);
  const withRules = v => { const t = structuredClone(rec); t.header.rulesVersion = v; return t; };
  assert.equal(api.playReplay(source(), withRules(`${major}.${minor}.${patch + 1}`)).ok, true);
  for (const v of [`${major}.${minor + 1}.${patch}`, `${major + 1}.${minor}.${patch}`]) assert.throws(() => api.playReplay(source(), withRules(v)), /replay/i, v);
  assert.equal(api.playReplay({ metadata: { ...metadata, rulesVersion: `${major}.${minor}.${patch + 1}` }, level: level() }, rec).ok, true);
});
test('playback ending early (engine outcome differs from recording) reports divergence instead of throwing', () => {
  const rec = recorded(), early = level(); early.towers[1].owner = 0;
  const result = api.playReplay({ metadata, level: early }, rec);
  assert.equal(result.ok, false); assert.equal(result.divergingTick, 1); assert.equal(result.sim.view.over.outcome, 'won');
});
test('checkpoint reports first observable divergent tick and final hash, outcome and changed seed fail', () => {
  const rec = recorded();
  for (const [mutate, tick] of [[r => r.checkpoints[0].hash = '0'.repeat(16), 20], [r => r.checkpoints[1].hash = '0'.repeat(16), 40], [r => r.finalHash = '0'.repeat(16), 45], [r => r.outcome = { outcome: 'draw', winnerTeam: null }, 45], [r => r.header.seed = 78, 20], [r => { r.commands[1].cmd.to = 'a'; r.commands[2].cmd.to = 'a'; }, 20]]) {
    const tampered = structuredClone(rec); mutate(tampered);
    const result = api.playReplay(source(), tampered); assert.equal(result.ok, false); assert.equal(result.divergingTick, tick);
  }
});
test('aftergame commands and final ticks beyond gameover are refused', () => {
  const recorder = api.createReplayRecorder(level(1), 77, metadata);
  for (let i = 0; i < 20; i++) recorder.step([]);
  const rec = recorder.record(); rec.finalTick = 21; rec.commands.push({ tick: 20, cmd: draw() });
  assert.throws(() => api.playReplay({ metadata, level: level(1) }, rec), /replay/i);
});
test('authored sample content compiles outside sim and full timeout replay runs without bots', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { loadContent, compileLevel } = require('../../content/src/index.ts');
  const root = path.resolve(__dirname, '../../content');
  const files = { 'content.json': JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')) };
  for (const file of fs.readdirSync(path.join(root, 'data'), { recursive: true }).filter(f => f.endsWith('.json'))) files[`data/${file}`] = JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));
  const loaded = loadContent(files), compiled = compileLevel(loaded, 'sample');
  const recorder = api.createReplayRecorder(compiled, 4294967295, loaded['content.json']);
  recorder.step([draw(compiled.players[0].id, compiled.towers[0].id, compiled.towers[1].id)]);
  while (!recorder.view.over) recorder.step([], { events: false });
  const rec = JSON.parse(JSON.stringify(recorder.record()));
  const result = api.playReplay({ metadata: loaded['content.json'], resolveLevel: id => compileLevel(loaded, id) }, rec);
  assert.equal(result.ok, true); assert.equal(result.sim.hash(), recorder.hash());
  assert.deepEqual(result.sim.view.over, recorder.view.over);
});
test('empty initial recording and gameover before first checkpoint are deterministic', () => {
  const compiled = level(); compiled.towers[1].owner = 0;
  const recorder = api.createReplayRecorder(compiled, 0, metadata);
  assert.equal(api.playReplay({ metadata, level: compiled }, recorder.record()).sim.tick, 0);
  recorder.step([]);
  assert.equal(recorder.record().outcome.outcome, 'won');
  assert.equal(api.playReplay({ metadata, level: compiled }, recorder.record()).ok, true);
  const rec = recorder.record(); rec.finalTick = 2;
  const result = api.playReplay({ metadata, level: compiled }, rec); assert.equal(result.ok, false); assert.equal(result.divergingTick, 1);
});
test('lossy and cyclic submissions are refused atomically before stepping', () => {
  const recorder = api.createReplayRecorder(level(), 77, metadata);
  const cyclic = draw(); cyclic.extra = cyclic;
  for (const cmd of [undefined, { type: 'invalid', extra: Infinity }, { ...draw(), extra: undefined }, cyclic]) {
    assert.throws(() => recorder.step([cmd]), /replay/i); assert.equal(recorder.tick, 0); assert.deepEqual(recorder.record().commands, []);
  }
  recorder.step([{ type: 'invalid', nested: [null, 'extra', 12] }]);
  assert.equal(recorder.rejected, 1); assert.equal(api.playReplay(source(), recorder.record()).ok, true);
});
test('same-tick command order is playback order before canonical player grouping', () => {
  const recorder = api.createReplayRecorder(level(), 77, metadata);
  recorder.step([draw(), { type: 'CutLine', player: 'p0', from: 'a', to: 'b' }]);
  for (let i = 1; i < 21; i++) recorder.step([]);
  const rec = recorder.record(); assert.equal(api.playReplay(source(), rec).ok, true);
  rec.commands.reverse();
  const result = api.playReplay(source(), rec); assert.equal(result.ok, false); assert.equal(result.divergingTick, 20);
});
