// Direct adapter tests require fresh dist: pnpm build:prerequisites first.
const assert = require('node:assert/strict');
// Native API must load before fixture registration installs the TS/CJS hook.
const native = require('../dist/internal.js');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const adapter = path.join(__dirname, '../scripts/bench.cjs');
const bench = fs.existsSync(adapter) ? require(adapter) : {};

test('performance budgets reject each breached metric and CI tolerates only 5x', () => {
  assert.equal(typeof bench.assertBudgets, 'function');
  const good = { mean: 0.29, p99: 0.99, hash: 0.49, hashP99: 0.49 };
  assert.doesNotThrow(() => bench.assertBudgets(good));
  for (const [metric, limit] of [['mean', 0.3], ['p99', 1], ['hash', 0.5], ['hashP99', 0.5]]) {
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: limit }), /budget/);
    assert.doesNotThrow(() => bench.assertBudgets({ ...good, [metric]: limit * 4.99 }, true));
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: limit * 5 }, true), /budget/);
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: NaN }), /budget/);
  }
});

test('stress fixture reaches 720 live troops (24 houses x alive cap 30) and reports min alive in the timed window, with head-on lines', () => {
  const stats = bench.runStress(1, 40);
  assert.equal(stats.peakTroops, bench.STRESS_TROOPS);
  assert.ok(Number.isInteger(stats.minTimedTroops) && stats.minTimedTroops > 0 && stats.minTimedTroops <= stats.peakTroops, `min alive in timed window reported (${stats.minTimedTroops})`);
  assert.ok(stats.clashes >= 1, 'head-on clashes happen inside the timed window');
  assert.equal(bench.STRESS_TROOPS, 720);
  const { level, commands } = bench.stressFixture(require('../test/golden/levels.ts'));
  assert.equal(level.buildings.length, 24);
  const lines = new Set(commands.map((c) => `${c.from}>${c.to}`));
  assert.equal(lines.size, 72);
  for (const c of commands) assert.ok(lines.has(`${c.to}>${c.from}`), 'every line has a hostile reverse line');
});

test('realistic fixture has 12 buildings', () => {
  assert.equal(bench.realisticFixture(require('../test/golden/levels.ts')).level.buildings.length, 12);
});

test('BENCH_SCENARIOS is the append point for SP04: named scenarios with a run()', () => {
  assert.deepEqual(bench.BENCH_SCENARIOS.map((x) => x.name), ['stress', 'realistic', 'geometry']);
  for (const x of bench.BENCH_SCENARIOS) assert.equal(typeof x.run, 'function');
});

 test('geometry workload reaches 720 troops, >=40 hostile active crossings and three firing towers', () => {
  const stats = bench.runGeometry(1, 360);
  assert.equal(stats.peakTroops, 720);
  assert.ok(stats.minTimedTroops > 0);
  assert.ok(stats.hostileCrossings >= 40);
  assert.ok(stats.crossingClashes > 0);
  assert.equal(stats.firingTowers, 3);
  assert.ok(stats.towerShots >= 3);
 });

test('shipped native ESM core matches every golden replay and event log', () => {
  assert.equal(native[Symbol.toStringTag], 'Module');
  assert.equal(typeof Object.getOwnPropertyDescriptor(native, 'create').value, 'function');
  require('tsx/cjs');
  const { allScenarios } = require('./golden/all.ts');
  const { eventLogHash, runScenario } = require('./golden/run.ts');
  const baseline = require('./golden/baseline.json');
  for (const scenario of allScenarios) {
    const recorder = native.createReplayRecorder(scenario.level, scenario.seed, baseline.metadata), events=[];
    for(let i=0;i<scenario.ticks&&!recorder.view.over;i++) {
      events.push(...recorder.step(scenario.commands.filter(c=>c.tick===recorder.view.tick).map(c=>c.cmd), {events:true}));
    }
    const expected=baseline.results.find(result=>result.name===scenario.name);
    assert.deepEqual(recorder.record(), expected.replay, scenario.name);
    assert.equal(eventLogHash(events), expected.eventLogHash, scenario.name);
    const source=runScenario(scenario,baseline.metadata);
    assert.deepEqual(events,source.events,scenario.name);
    assert.equal(native.playReplay({metadata:baseline.metadata,level:scenario.level},recorder.record()).ok,true);
  }
});
