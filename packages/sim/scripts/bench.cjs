// Node adapter: clocks and synthetic workload setup stay outside the pure sim core.
const assert = require('node:assert/strict');
const BUDGETS = { mean: 0.3, p99: 1, hash: 0.5, hashP99: 0.5 };

function assertBudgets(metrics, ci = false) {
  for (const [metric, budget] of Object.entries(BUDGETS)) {
    const limit = budget * (ci ? 5 : 1);
    assert.ok(Number.isFinite(metrics[metric]) && metrics[metric] >= 0 && metrics[metric] < limit,
      `${metric} budget breached: ${metrics[metric]} ms (must be < ${limit} ms)`);
  }
}

// The v1 2000-troop workload fixture died with the v1 engine (CUT). SP03 rewrites it on the new engine and un-parks bench:sim.
function main() {
  throw new Error('bench:sim fixture is rewritten by SP03 (parked)');
}
module.exports = { assertBudgets };
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
