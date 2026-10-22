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
