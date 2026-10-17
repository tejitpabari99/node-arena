// Node adapter: clocks and synthetic workload setup stay outside the pure sim core.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
require('tsx/cjs');
const { create } = require('../src/index.ts');
const { assertInvariants } = require('../src/tick.ts');
const SEED = 0x5eed1234;
const BUDGETS = { mean: 0.3, p99: 1, hash: 0.5, hashP99: 0.5 };
const EMPTY = [];

function assertBudgets(metrics, ci = false) {
  for (const [metric, budget] of Object.entries(BUDGETS)) {
    const limit = budget * (ci ? 5 : 1);
    assert.ok(Number.isFinite(metrics[metric]) && metrics[metric] >= 0 && metrics[metric] < limit,
      `${metric} budget breached: ${metrics[metric]} ms (must be < ${limit} ms)`);
  }
}

function createFixture() {
  const level = {
    id: 'sim-performance', componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    timeLimitSec: 3600, visual: '', bots: [],
    players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, team: `team${i}`, kind: i ? 'bot' : 'human', colorKey: '' })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 10000, visual: '' }],
    towers: Array.from({ length: 30 }, (_, i) => ({
      id: `t${String(i).padStart(2, '0')}`, x: i % 2 ? 35000 : -35000, y: Math.floor(i / 2) * 1000,
      owner: i % 4, garrison: 50, archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} },
    })),
  };
  const sim = create(level, SEED, { debug: false });
  // Seed an already-running 70-tick pipeline. Older fronts precede younger ones.
  // Real generation replaces one clashing front per channel on every later tick.
  // Injected value belongs to initial accounting and transit, not generated stats.
  for (let from = 0; from < 30; from++) {
    const ch = sim.ensureChannel(from, from ^ 1);
    for (let age = 69; age >= 0; age--) {
      ch.troops.push({ p0: age * 10000, t0: 0, owner: from % 4, kind: 0, seq: ++sim.troopSeq, value: 1 });
      sim.players.transit[from % 4]++;
      sim.accounting.initial++;
    }
  }
  const commands = level.towers.map((tower, i) => ({ type: 'DrawLine', player: `p${i % 4}`, from: tower.id, to: level.towers[i ^ 1].id }));
  sim.step(commands, { events: false });
  assert.equal(sim.rejected, 0);
  assertWorkload(sim, 0);
  assertInvariants(sim);
  return sim;
}

function assertWorkload(sim, previousTick) {
  assert.ok(sim.tick === previousTick + 1 && sim.view.over === null && sim.over === null, 'benchmark must sample an active step');
  assert.equal(sim.debug, false, 'benchmark requires debug off');
  const troops = sim.channels.reduce((sum, channel) => sum + (channel?.troops.size ?? 0), 0);
  assert.equal(sim.view.players.reduce((sum, player) => sum + player.transit, 0), troops, 'benchmark troop/transit recount mismatch');
  assert.ok(troops >= 2000 && troops <= 2200, `benchmark troop workload escaped 2000-class range: ${troops}`);
  assert.equal(sim.view.lines.length, 30, 'benchmark lost drawn lines');
  return troops;
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, p99: sorted[Math.ceil(sorted.length * 0.99) - 1] };
}

function measure({ events = true, warmup = 3000, samples = 10000, stepsPerInterval = 1, hashSamples = 1000 } = {}) {
  for (const value of [warmup, samples, stepsPerInterval, hashSamples]) assert.ok(Number.isInteger(value) && value > 0, 'positive measurement sizes required');
  const sim = createFixture(), opts = { events };
  for (let i = 0; i < warmup; i++) {
    const tick = sim.tick; sim.step(EMPTY, opts); assertWorkload(sim, tick);
  }
  const generatedBefore = sim.accounting.generated, clashesBefore = sim.accounting.clashes;
  const times = [], eventTypes = {};
  let troopMin = Infinity, troopMax = 0, eventCount = 0;
  const start = performance.now();
  for (let interval = 0; interval < samples; interval++) for (let j = 0; j < stepsPerInterval; j++) {
    const tick = sim.tick, before = performance.now();
    const emitted = sim.step(EMPTY, opts);
    times.push(performance.now() - before);
    const troops = assertWorkload(sim, tick);
    troopMin = Math.min(troopMin, troops); troopMax = Math.max(troopMax, troops);
    eventCount += emitted.length;
    if (!events) assert.equal(emitted.length, 0, 'events:false emitted events');
    for (const event of emitted) eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
  }
  const workloadRuntimeMs = performance.now() - start;
  assert.ok(sim.accounting.generated > generatedBefore && sim.accounting.clashes > clashesBefore, 'benchmark must generate and interact');
  assert.equal(sim.rejected, 0);
  assertInvariants(sim);
  // Hash the actual final 2,100-troop state, after separate JIT warmup.
  const finalHash = sim.hash();
  for (let i = 0; i < 200; i++) assert.equal(sim.hash(), finalHash);
  const hashTimes = [];
  for (let i = 0; i < hashSamples; i++) {
    const before = performance.now(); const hash = sim.hash();
    hashTimes.push(performance.now() - before); assert.equal(hash, finalHash);
  }
  const step = summarize(times), hash = summarize(hashTimes);
  return { events, seed: SEED, warmup, intervals: samples, stepsPerInterval, activeSamples: times.length,
    tick: sim.tick, lineCount: sim.view.lines.length, troopMin, troopMax, hashTroops: troopMax,
    seats: sim.view.players.map((player, owner) => ({ id: sim.ids.players[owner], kind: player.kind,
      towers: [...sim.tower.owner].filter(value => value === owner).length,
      lines: sim.view.lines.filter(line => line.owner === owner).length, transit: player.transit })),
    mean: step.mean, p99: step.p99, hash: hash.mean, hashP99: hash.p99, hashSamples,
    workloadRuntimeMs, eventCount, eventTypes, generated: sim.accounting.generated - generatedBefore,
    clashes: sim.accounting.clashes - clashesBefore, finalHash, rejected: sim.rejected };
}

function main() {
  const ci = process.argv.includes('--ci') || /^(1|true)$/i.test(process.env.CI ?? '');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--ci');
  assert.equal(unknown.length, 0, `unknown benchmark arguments: ${unknown.join(', ')}`);
  const baseline = measure();
  const twiceVisible = measure({ stepsPerInterval: 2, samples: 5000 });
  const twiceQuiet = measure({ events: false, stepsPerInterval: 2, samples: 5000 });
  assert.equal(twiceVisible.finalHash, twiceQuiet.finalHash);
  assert.equal(twiceVisible.rejected, twiceQuiet.rejected);
  assert.equal(twiceQuiet.eventCount, 0);
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model, cpus: os.cpus().length }, mode: ci ? 'ci' : 'strict',
    budgetsMs: Object.fromEntries(Object.entries(BUDGETS).map(([key, value]) => [key, value * (ci ? 5 : 1)])),
    baseline, twiceVisible, twiceQuiet }, null, 2));
  for (const result of [baseline, twiceVisible, twiceQuiet]) assertBudgets(result, ci);
  console.log('PASS: active workload, event parity, and all performance budgets');
}
module.exports = { assertBudgets, createFixture, assertWorkload, measure };
if (require.main === module) main();
