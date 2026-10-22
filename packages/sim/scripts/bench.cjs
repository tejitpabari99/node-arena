// Node adapter: clocks and synthetic workload setup stay outside the pure sim core.
const assert = require('node:assert/strict');
const BUDGETS = { mean: 0.3, p99: 1, hash: 0.5, hashP99: 0.5 };
const STRESS_TROOPS = 720;

function assertBudgets(metrics, ci = false) {
  for (const [metric, budget] of Object.entries(BUDGETS)) {
    const limit = budget * (ci ? 5 : 1);
    assert.ok(Number.isFinite(metrics[metric]) && metrics[metric] >= 0 && metrics[metric] < limit,
      `${metric} budget breached: ${metrics[metric]} ms (must be < ${limit} ms)`);
  }
}

function load() {
  require('tsx/cjs');
  return { api: require('../src/index.ts'), levels: require('../test/golden/levels.ts') };
}
const total = (view) => Array.from(view.buildings.alive).reduce((a, b) => a + b, 0);

/**
 * (a) Stress: 24 houses (L64, 3 lines each, 130-unit lanes), 4 blocks of K(3,3) between a human and an AI side,
 * so every line has a hostile reverse line (head-on pairs). Each house saturates at the alive cap of 30: 24 x 30 = 720.
 * Returns { level, commands } where commands are the tick-0 draws.
 */
function stressFixture(levels) {
  const buildings = [], commands = [];
  for (let block = 0; block < 4; block++) {
    const z = block * 40, first = buildings.length;
    for (let i = 0; i < 3; i++) buildings.push({ at: [0, z + i * 5], owner: 0, level: 64 });
    for (let i = 0; i < 3; i++) buildings.push({ at: [130, z + i * 5], owner: 1, level: 64 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      commands.push({ type: 'DrawLine', player: 0, from: first + i, to: first + 3 + j });
      commands.push({ type: 'DrawLine', player: 1, from: first + 3 + j, to: first + i });
    }
  }
  return { level: levels.buildLevel('bench-stress', buildings), commands };
}

/** (b) Realistic: 12 buildings, three houses per side plus six neutrals, two lines each, short lanes, captures happen. */
function realisticFixture(levels) {
  const spec = [
    [0, 0, 0, 20], [0, 8, 0, 30], [0, 16, 0, 12], [30, 0, 1, 20], [30, 8, 1, 25], [30, 16, 1, 15],
    [10, 0, null, 6], [10, 8, null, 4], [10, 16, null, 8], [20, 0, null, 5], [20, 8, null, 3], [20, 16, null, 7],
  ];
  const commands = [];
  const lines = [[0, 6], [0, 7], [1, 7], [1, 8], [2, 8], [2, 9], [3, 9], [3, 10], [4, 10], [4, 11], [5, 11], [5, 8]];
  for (const [from, to] of lines) commands.push({ type: 'DrawLine', player: from < 3 ? 0 : 1, from, to });
  return { level: levels.buildLevel('bench-realistic', spec.map(([x, z, owner, level]) => ({ at: [x, z], owner, level }))), commands };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const now = () => Number(process.hrtime.bigint()) / 1e6;
function summarize(steps, hashes) {
  const a = [...steps].sort((x, y) => x - y), h = [...hashes].sort((x, y) => x - y);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return { mean: mean(steps), p99: percentile(a, 0.99), hash: mean(hashes), hashP99: percentile(h, 0.99), samples: steps.length };
}

/** Stress run: fresh sims warmed (untimed) until every house is saturated, then timed while 720 troops are alive. */
function runStress(trials = 20, window = 40) {
  const { api, levels } = load();
  const { level, commands } = stressFixture(levels);
  const steps = [], hashes = [];
  let peak = 0;
  for (let trial = -2; trial < trials; trial++) { // trials -2..-1 warm the JIT and are not sampled
    const sim = api.create(level, 1000 + trial);
    sim.step(commands, { events: false });
    let guard = 0;
    while (total(sim.view) < STRESS_TROOPS) { sim.step([], { events: false }); assert.ok(++guard < 400, 'stress never saturated'); }
    for (let i = 0; i < window && total(sim.view) === STRESS_TROOPS; i++) {
      const t0 = now(); sim.step([], { events: false }); const t1 = now(); sim.hash(); const t2 = now();
      if (trial >= 0) { steps.push(t1 - t0); hashes.push(t2 - t1); }
      peak = Math.max(peak, total(sim.view));
    }
  }
  assert.equal(peak, STRESS_TROOPS, `stress must reach and hold ${STRESS_TROOPS} live troops (peak ${peak})`);
  return { ...summarize(steps, hashes), peakTroops: peak };
}

function runRealistic(trials = 40, maxTicks = 1200) {
  const { api, levels } = load();
  const { level, commands } = realisticFixture(levels);
  const steps = [], hashes = [];
  let peak = 0;
  for (let trial = -2; trial < trials; trial++) {
    const sim = api.create(level, 5000 + trial);
    sim.step(commands, { events: false });
    for (let i = 0; i < maxTicks && !sim.view.over; i++) {
      const t0 = now(); sim.step([], { events: false }); const t1 = now(); sim.hash(); const t2 = now();
      if (trial >= 0) { steps.push(t1 - t0); hashes.push(t2 - t1); }
      peak = Math.max(peak, total(sim.view));
    }
  }
  return { ...summarize(steps, hashes), peakTroops: peak };
}

const fmt = (m) => `mean ${m.mean.toFixed(4)} ms, p99 ${m.p99.toFixed(4)} ms, hash mean ${m.hash.toFixed(4)} ms, hash p99 ${m.hashP99.toFixed(4)} ms (${m.samples} samples, peak ${m.peakTroops} troops)`;
function main(args = process.argv.slice(2)) {
  const ci = args.includes('--ci');
  const stress = runStress(), realistic = runRealistic();
  process.stdout.write(`bench:sim stress    ${fmt(stress)}\nbench:sim realistic ${fmt(realistic)}\n`);
  assertBudgets(stress, ci); assertBudgets(realistic, ci);
  process.stdout.write(`bench:sim within budget${ci ? ' (CI x5)' : ''}\n`);
}
module.exports = { assertBudgets, runStress, runRealistic, stressFixture, realisticFixture, STRESS_TROOPS };
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
