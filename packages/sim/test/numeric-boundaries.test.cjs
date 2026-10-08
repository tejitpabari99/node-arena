const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const content = require('../../content/src/index.ts');
const { hashFixture } = require('../../content/test/hash-fixture.ts');
const sim = require('../src/index.ts');
const { garrisonArrive, capturableHit } = require('../src/combat.ts');
const { assertInvariants } = require('../src/tick.ts');
function compiled() { return content.compileLevel(content.loadContent(hashFixture()), 'sample'); }
for (const debug of [false, true]) {
  test(`accepted authored generation stays exact beyond aggregate int32 (debug=${debug})`, () => {
    const files = hashFixture();
    files['data/archetypes/standard.json'].components.garrison.cap = 2147483647;
    files['data/archetypes/standard.json'].components.generates.ratePerSec = 2000000;
    const level = files['data/levels/sample.json'];
    level.timeLimitSec = 600;
    level.towers[0].garrison = 0;
    level.towers[1].garrison = 2147483647; // idle bot at cap
    level.towers.push({ ...structuredClone(level.towers[0]), id: 't3', pos: { x: 0, y: 10 } });
    const s = sim.create(content.compileLevel(content.loadContent(files), 'sample'), 0, { debug });
    for (let tick = 0; tick < 10738; tick++) s.step([], { events: false });
    assert.equal(s.view.players[1].stats.generated, 2147600000);
    assert.equal(s.snapshot().players[1].stats.generated, 2147600000);
    assert.equal(s.view.tower.col['garrison.count'][0], 1073800000);
    assert.equal(s.view.tower.col['garrison.count'][2], 1073800000);
  });
}
test('overflow, kill and capture credits remain exact beyond int32 and stay excluded from hash', () => {
  const s = sim.create(compiled(), 0);
  const hash = s.hash();
  for (const name of ['overflowLost', 'kills', 'captures']) s.players.stats[name][1] = 2147483647;
  assert.equal(s.hash(), hash);
  s.tower.col['garrison.count'][0] = s.tower.col['garrison.cap'][0];
  garrisonArrive(s, 0, { owner: 1, value: 1 });
  garrisonArrive(s, 1, { owner: 1, value: 1 });
  s.tower.col['garrison.count'][1] = 0;
  capturableHit(s, 1, { owner: 1, value: 0 });
  assert.deepEqual([s.players.stats.overflowLost[1], s.players.stats.kills[1], s.players.stats.captures[1]], [2147483648, 2147483648, 2147483648]);
});
test('stat additions reject loss of exact safe-integer precision in production', () => {
  const s = sim.create(compiled(), 0);
  s.players.stats.generated[1] = Number.MAX_SAFE_INTEGER;
  assert.throws(() => { for (let i = 0; i < 20; i++) s.step([]); }, /stats.*integer/i);
});
test('debug stat invariants reject fractions and unsafe integers', () => {
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, -1]) {
    const s = sim.create(compiled(), 0);
    s.players.stats.captures[0] = value;
    assert.throws(() => assertInvariants(s), /stats.*integer/i);
  }
});
test('create and both replay paths enforce positive int32 duration ticks', () => {
  const level = compiled();
  for (const timeLimitSec of [0, -1, 1.5, NaN, Infinity, 107374183]) {
    const bad = { ...level, timeLimitSec };
    assert.throws(() => sim.create(bad, 0), /timeLimit/i);
    assert.throws(() => sim.createReplayRecorder(bad, 0, hashFixture()['content.json']), /timeLimit/i);
    const valid = sim.createReplayRecorder(level, 0, hashFixture()['content.json']).record();
    assert.throws(() => sim.playReplay({ metadata: hashFixture()['content.json'], level: bad }, valid), /timeLimit/i);
  }
  const boundary = { ...level, timeLimitSec: 107374182 };
  const s = sim.create(boundary, 0, { debug: true }); s.step([]);
  assert.equal(s.view.timeLimitTicks, 2147483640);
  const rec = sim.createReplayRecorder(boundary, 0, hashFixture()['content.json']); rec.step([]);
  assert.equal(sim.playReplay({ metadata: hashFixture()['content.json'], level: boundary }, rec.record()).ok, true);
});
