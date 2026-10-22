const assert = require('node:assert/strict');
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

test('stress fixture reaches and holds 720 live troops (24 houses x alive cap 30) with head-on lines', () => {
  const stats = bench.runStress(1, 40);
  assert.equal(stats.peakTroops, bench.STRESS_TROOPS);
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
  assert.deepEqual(bench.BENCH_SCENARIOS.map((x) => x.name), ['stress', 'realistic']);
  for (const x of bench.BENCH_SCENARIOS) assert.equal(typeof x.run, 'function');
});
