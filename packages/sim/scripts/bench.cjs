// Node adapter: clocks and synthetic workload setup stay outside the pure sim core.
const assert = require('node:assert/strict');
const BUDGETS = { mean: 0.3, p99: 1, hash: 0.5, hashP99: 0.5 };
const STRESS_TROOPS = 720;
// Lane length (world units) of the stress fixture: short enough that head-on fronts meet right after saturation.
const STRESS_LANE = 100;

function assertBudgets(metrics, ci = false) {
  for (const [metric, budget] of Object.entries(BUDGETS)) {
    const limit = budget * (ci ? 5 : 1);
    assert.ok(Number.isFinite(metrics[metric]) && metrics[metric] >= 0 && metrics[metric] < limit,
      `${metric} budget breached: ${metrics[metric]} ms (must be < ${limit} ms)`);
  }
}

let loaded;
function load() {
  if (loaded) return loaded;
  // Measure the shipped native ESM core. Load it before the fixture's TS hook,
  // which would otherwise transpile live imports through CJS export getters.
  const api = require('../dist/internal.js');
  assert.equal(api[Symbol.toStringTag], 'Module', 'benchmark core must be native ESM');
  assert.equal(typeof Object.getOwnPropertyDescriptor(api, 'create').value, 'function');
  require('tsx/cjs');
  loaded = { api, levels: require('../test/golden/levels.ts') };
  return loaded;
}
const total = (view) => Array.from(view.buildings.alive).reduce((a, b) => a + b, 0);

/**
 * (a) Stress: 24 houses (L64, 3 lines each, STRESS_LANE-unit lanes), 4 blocks of K(3,3) between a human and an AI side,
 * so every line has a hostile reverse line (head-on pairs). Each house saturates at the alive cap of 30: 24 x 30 = 720.
 * Returns { level, commands } where commands are the tick-0 draws.
 */
function stressFixture(levels) {
  const buildings = [], commands = [];
  for (let block = 0; block < 4; block++) {
    const z = block * 40, first = buildings.length;
    for (let i = 0; i < 3; i++) buildings.push({ at: [0, z + i * 5], owner: 0, level: 64 });
    for (let i = 0; i < 3; i++) buildings.push({ at: [STRESS_LANE, z + i * 5], owner: 1, level: 64 });
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

/** 24 long crossing lanes, 12 per hostile owner, and three neutral towers in reach.
 * Shared remote targets keep cold all-possible-lane compilation bounded; each source
 * still independently reaches its 30-troop cap before the first crossing contact. */
function geometryFixture(levels) {
  const buildings = [], commands = [];
  for (let i=0;i<12;i++) buildings.push({at:[-150,i*2-11],owner:0,level:64});
  for (let i=0;i<12;i++) buildings.push({at:[i*2-11,-150],owner:1,level:64});
  buildings.push({at:[150,0],owner:null,level:64},{at:[0,150],owner:null,level:64});
  for (const at of [[-15,8],[-15,-8],[-8,-15]]) buildings.push({at,owner:null,level:30,arch:'tower'});
  for(let i=0;i<24;i++) commands.push({type:'DrawLine',player:i<12?0:1,from:i,to:i<12?24:25});
  return {level:levels.buildLevel('bench-geometry',buildings),commands};
}
function runGeometry(trials=4, window=360) {
  const {api,levels}=load(), {level,commands}=geometryFixture(levels);
  const steps=[],hashes=[];
  let peak=0,minTimed=Infinity,hostileCrossings=0,crossingClashes=0,towerShots=0;
  const firing=new Set();
  // Validate active cache against actual hostile occupied channels, not authored count.
  const probe=api.createState(level,7000);
  api.runCommands(probe,commands);
  for(let i=0;i<24;i++) api.spawnTroop(probe,i,i<12?24:25,0);
  api.assertInvariants(probe);
  hostileCrossings=api.activeCrossings(probe).filter(p=> {
    const a=probe.channels.get(p.a),b=probe.channels.get(p.b);
    return a.troops.len && b.troops.len && a.troops.owner[0]!==b.troops.owner[0];
  }).length;
  for(let trial=-2;trial<=trials;trial++) {
    const sim=api.create(level,7000+trial);
    const validate=trial===0;
    const collect=events=> { for(const e of events) {
      if(e.type==='Clash'&&e.kind==='crossing') crossingClashes++;
      if(e.type==='TowerShot') {towerShots++;firing.add(e.tower);}
    }};
    const first=sim.step(commands,{events:validate});
    if(validate) assert.equal(first.filter(e=>e.type==='LineDrawn').length,24,'all crossing lanes must be legal');
    let warm=0;
    while(total(sim.view)<720) {
      sim.step([],{events:validate});
      peak=Math.max(peak,total(sim.view));
      assert.ok(++warm<600,'geometry never reached 720 live troops');
    }
    peak=Math.max(peak,total(sim.view));
    for(let i=0;i<window;i++) {
      if(validate) { collect(sim.step([],{events:true})); continue; }
      const t0=now();sim.step([],{events:false});const t1=now();sim.hash();const t2=now();
      if(trial>=0){steps.push(t1-t0);hashes.push(t2-t1);minTimed=Math.min(minTimed,total(sim.view));}
    }
  }
  assert.equal(peak,720);assert.ok(hostileCrossings>=40);
  assert.ok(crossingClashes>0,'geometry must actually resolve crossing clashes');
  assert.equal(firing.size,3,`all three towers must actually shoot (saw ${[...firing]})`);
  return {...summarize(steps,hashes),peakTroops:peak,minTimedTroops:minTimed,hostileCrossings,crossingClashes,towerShots,firingTowers:firing.size};
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const now = () => Number(process.hrtime.bigint()) / 1e6;
function summarize(steps, hashes) {
  const a = [...steps].sort((x, y) => x - y), h = [...hashes].sort((x, y) => x - y);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return { mean: mean(steps), p99: percentile(a, 0.99), hash: mean(hashes), hashP99: percentile(h, 0.99), samples: steps.length };
}

/** Count Clash events over the same deterministic run (events on, untimed): ticks `from`..`to` after the draw tick. */
function clashesBetween(api, level, commands, seed, from, to) {
  const sim = api.create(level, seed);
  let clashes = 0;
  sim.step(commands, { events: true }); // the draw tick itself is outside the window
  for (let t = 1; t <= to; t++) {
    const ev = sim.step([], { events: true });
    if (t >= from) clashes += ev.filter((e) => e.type === 'Clash').length;
  }
  return clashes;
}

/**
 * Stress run: fresh sims warmed (untimed) until every house is saturated, then `window` ticks timed while head-on
 * clashes resolve and the alive cap refills. Asserts 720 live troops were reached (peak) and reports the minimum alive count inside the timed window (clashes thin it), and that >= 1 clash fell inside the timed window.
 */
function runStress(trials = 20, window = 40) {
  const { api, levels } = load();
  const { level, commands } = stressFixture(levels);
  const steps = [], hashes = [];
  let peak = 0, clashes = 0, minTimed = Infinity;
  for (let trial = -2; trial < trials; trial++) { // trials -2..-1 warm the JIT and are not sampled
    const seed = 1000 + trial;
    const sim = api.create(level, seed);
    sim.step(commands, { events: false });
    let guard = 0, ticks = 1;
    while (total(sim.view) < STRESS_TROOPS) { sim.step([], { events: false }); ticks++; assert.ok(++guard < 400, 'stress never saturated'); }
    peak = Math.max(peak, total(sim.view));
    if (trial === 0) clashes = clashesBetween(api, level, commands, seed, ticks, ticks + window - 1);
    for (let i = 0; i < window; i++) {
      const t0 = now(); sim.step([], { events: false }); const t1 = now(); sim.hash(); const t2 = now();
      if (trial >= 0) { steps.push(t1 - t0); hashes.push(t2 - t1); }
      peak = Math.max(peak, total(sim.view));
      if (trial >= 0) minTimed = Math.min(minTimed, total(sim.view));
    }
  }
  assert.equal(peak, STRESS_TROOPS, `stress must reach ${STRESS_TROOPS} live troops (peak ${peak})`);
  assert.ok(clashes >= 1, `stress must resolve >= 1 head-on clash inside the timed window (saw ${clashes})`);
  return { ...summarize(steps, hashes), peakTroops: peak, minTimedTroops: minTimed, clashes };
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

/** Each scenario independently meets the unchanged strict budgets. */
const BENCH_SCENARIOS = [
  { name: 'stress', run: () => runStress() },
  { name: 'realistic', run: () => runRealistic() },
  { name: 'geometry', run: () => runGeometry() },
];

const fmt = (m) => `mean ${m.mean.toFixed(4)} ms, p99 ${m.p99.toFixed(4)} ms, hash mean ${m.hash.toFixed(4)} ms, hash p99 ${m.hashP99.toFixed(4)} ms (${m.samples} samples, peak ${m.peakTroops} troops${m.minTimedTroops === undefined ? '' : `, min ${m.minTimedTroops} in window`}${m.clashes === undefined ? '' : `, ${m.clashes} clashes in window`}${m.hostileCrossings === undefined ? '' : `, ${m.hostileCrossings} hostile active crossings, ${m.crossingClashes} crossing clashes, ${m.towerShots} shots from ${m.firingTowers} towers`})`;
function main(args = process.argv.slice(2)) {
  const ci = args.includes('--ci');
  const width = Math.max(...BENCH_SCENARIOS.map((x) => x.name.length));
  const results = BENCH_SCENARIOS.map((x) => ({ name: x.name, metrics: x.run() }));
  for (const { name, metrics } of results) process.stdout.write(`bench:sim ${name.padEnd(width)} ${fmt(metrics)}\n`);
  for (const { metrics } of results) assertBudgets(metrics, ci);
  process.stdout.write(`bench:sim within budget${ci ? ' (CI x5)' : ''}\n`);
}
module.exports = { assertBudgets, BENCH_SCENARIOS, STRESS_LANE, runStress, runRealistic, runGeometry, geometryFixture, stressFixture, realisticFixture, STRESS_TROOPS };
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
