const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { scenarios } = require('./golden/scenarios.ts');
const { allScenarios } = require('./golden/all.ts');
const { metadata } = require('./fixtures.cjs');

const byName = (name) => scenarios.find((s) => s.name === name);
/** Plays a scenario through the public sim, tagging each event with the tick it occurred in. */
function play(name, until = Infinity) {
  const s = byName(name), sim = api.create(s.level, s.seed), log = [], at = {};
  for (let i = 0; i < s.ticks && i < until && !sim.view.over; i++) {
    const cmds = s.commands.filter((c) => c.tick === sim.view.tick).map((c) => c.cmd);
    for (const e of sim.step(cmds, { events: true })) log.push({ tick: sim.view.tick, ...e });
    at[sim.view.tick] = { level: Array.from(sim.view.buildings.level), owner: Array.from(sim.view.buildings.owner), lines: Array.from(sim.view.buildings.lines), alive: Array.from(sim.view.buildings.alive) };
  }
  return { s, sim, log, at, of: (type) => log.filter((e) => e.type === type) };
}

test('scenario list is composed in all.ts; names unique, compiled levels hashed', () => {
  assert.ok(allScenarios.length >= 15);
  assert.equal(new Set(allScenarios.map((s) => s.name)).size, allScenarios.length);
  for (const s of allScenarios) assert.equal(s.level.simHash.length, 64);
});

test('covers R-SPN-01, R-SPN-03: spawn table first departures = ceil(period/1000); E-SPAWN 18461/24000/20869 mt', () => {
  const { s, log, sim } = play('spawn-table');
  const n = s.level.buildings.length, first = new Map();
  for (const e of log) if (e.type === 'TroopSpawned' && !first.has(e.channel)) first.set(e.channel, e.tick);
  const ROWS = [[1, 1], [10, 1], [30, 1], [64, 1], [10, 2], [30, 2], [64, 2], [30, 3], [64, 3]];
  const sp = s.level.buildings[0].modules.spawns;
  let target = ROWS.length;
  ROWS.forEach(([L, lines], row) => {
    const period = api.spawnPeriodMt(L, lines, sp.spawnSpeed, sp.lineSpawnPenalty);
    for (let k = 0; k < lines; k++) assert.equal(first.get(row * n + target + k), Math.ceil(period / 1000), `L${L} n${lines}`);
    target += lines;
  });
  assert.equal(api.spawnPeriodMt(10, 1, 500, 300), 18461);
  assert.equal(first.get(1 * n + ROWS.length + 1), 19); // L10, 1 line
  assert.equal(first.get(4 * n + ROWS.length + 4), 24); // L10, 2 lines
  assert.equal(first.get(8 * n + ROWS.length + 15), 21); // L64, 3 lines
  assert.equal(sim.view.tick, 100);
});

test('covers R-GRW-01: growth 64600 mt (L1) fires at tick 65, 45560 mt (L63) at tick 46', () => {
  const { at } = play('growth');
    assert.equal(at[45].level[1], 63); assert.equal(at[46].level[1], 64);
  assert.equal(at[64].level[0], 1); assert.equal(at[65].level[0], 2);
  assert.equal(api.growPeriodMt(1, 1700, 900), 64600);
  assert.equal(api.growPeriodMt(63, 1700, 900), 45560);
});

test('covers R-CPT-01: exact L does not flip (level 0, still neutral); L+1 flips to level 0', () => {
  const exact = play('capture-exact-no-flip');
  assert.equal(exact.of('TroopArrived').length, 1);
  assert.deepEqual([exact.of('TroopArrived')[0].effect, exact.sim.view.buildings.owner[1], exact.sim.view.buildings.level[1]], ['hit', -1, 0]);
  assert.equal(exact.of('BuildingCaptured').length, 0);
  const flip = play('capture-flip-overshoot');
  assert.equal(flip.of('TroopArrived').length, 2);
  assert.deepEqual(flip.of('BuildingCaptured').map((e) => [e.tick, e.building, e.from, e.to]), [[47, 1, -1, 0]]);
  assert.deepEqual([flip.sim.view.buildings.owner[1], flip.sim.view.buildings.level[1]], [0, 0]);
});

test('covers R-CPT-01: capture kills in-flight troops of the captured building, including those on a cut line', () => {
  const { of, sim, at } = play('capture-kills-troops');
  const cap = of('BuildingCaptured');
  assert.deepEqual(cap.map((e) => [e.tick, e.building, e.from, e.to]), [[67, 1, 1, 0]]);
  assert.ok(at[66].alive[1] >= 2);
  const killed = of('TroopDied').filter((e) => e.cause === 'capture');
  assert.ok(killed.length >= 2);
  assert.ok(killed.every((e) => e.tick === 67 && e.owner === 1));
  assert.equal(sim.view.buildings.alive[1], 0);
  assert.ok(of('LineCut').some((e) => e.from === 1 && e.reason === 'captured'));
  assert.ok(of('LineCut').some((e) => e.from === 1 && e.reason === 'player'));
});

test('covers R-CMB-05: soldier vs tank (tank hp 2 -> 1); tank vs tank both die in one round', () => {
  const st = play('exchange-soldier-vs-tank');
  const first = st.of('Clash')[0];
  assert.equal(first.kind, 'headon');
  const died = st.of('TroopDied').filter((e) => e.tick === first.tick);
  assert.deepEqual(died.map((e) => e.kind), ['soldier']);
  assert.ok(st.of('TroopDied').some((e) => e.kind === 'tank'), 'damaged tank dies to the next soldier');
  const tt = play('exchange-tank-vs-tank');
  const clash = tt.of('Clash')[0];
  assert.deepEqual(tt.of('TroopDied').filter((e) => e.tick === clash.tick).map((e) => e.kind), ['tank', 'tank']);
});

test('covers R-LIN-03: reverse own line replaces (cut reason replaced), in-flight troops keep flying', () => {
  const { of } = play('reverse-replace');
  const cutEv = of('LineCut');
  assert.deepEqual(cutEv.map((e) => [e.from, e.to, e.reason]), [[0, 1, 'replaced']]);
  assert.ok(of('TroopArrived').some((e) => e.tick > cutEv[0].tick && e.channel === 1 && e.effect !== 'hit'), 'troop from the replaced line still arrives');
});

test('covers R-LIN-02: level drop does not auto-cut; new draw rejected no-slot', () => {
  const { at, of } = play('no-auto-cut-level-drop');
  assert.equal(at[33].lines[0], 2); assert.equal(at[33].level[0], 10);
  assert.equal(at[34].level[0], 9);
  assert.equal(at[59].lines[0], 2);
  assert.deepEqual(of('CommandRejected').map((e) => [e.player, e.command, e.reason]), [[0, 'DrawLine', 'no-slot']]);
});

test('covers R-CAP-03: overflow forwards on a seeded line (cause forward); no line loses the surplus', () => {
  const { of, sim } = play('overflow-forward');
  const arrivals = of('TroopArrived').filter((e) => e.effect === 'overflow');
  const toF = arrivals.filter((e) => e.channel === 1), toC = arrivals.filter((e) => e.channel === 2);
  assert.ok(toF.length >= 3 && toC.length >= 3);
  const fwd = of('TroopSpawned').filter((e) => e.cause === 'forward');
  assert.equal(fwd.length, toF.length);
  assert.ok(fwd.every((e) => Math.floor(e.channel / 7) === 1), 'only the building with lines forwards');
  assert.ok(new Set(fwd.map((e) => e.channel)).size > 1, 'forwarding spreads over lines (seeded stream)');
  assert.equal(sim.view.buildings.level[2], 64);
});

test('covers R-SPN-02: alive cap 30 skips due spawns', () => {
  const { of, sim, at } = play('alive-cap-skip');
  assert.equal(at[300].alive[0], 30);
  assert.equal(of('TroopSpawned').length, 30);
  assert.ok(sim.view.buildings.alive[0] <= 30);
});

test('covers R-WIN-01: win flips ignored buildings; R-WIN-02: loss does not; R-WIN-03: timeout', () => {
  const win = play('win-ignored-flip');
  assert.deepEqual(win.sim.view.over, { outcome: 'won', winner: 0 });
  assert.deepEqual(Array.from(win.sim.view.buildings.owner), [0, 0, 0, 0]);
  const loss = play('loss');
  assert.deepEqual(loss.sim.view.over, { outcome: 'lost', winner: null });
  assert.deepEqual([loss.sim.view.buildings.owner[2]], [0]);
  const to = play('timeout');
  assert.deepEqual(to.sim.view.over, { outcome: 'timeout', winner: null });
  assert.equal(to.sim.view.tick, 60);
});

test('covers R-ENT-04: rejection reasons in submission order grouped by tick', () => {
  const { of } = play('rejections');
  assert.deepEqual(of('CommandRejected').map((e) => [e.tick, e.player, e.command, e.reason]), [
    [1, 0, 'DrawLine', 'self'], [1, 0, 'DrawLine', 'duplicate'], [1, 0, 'DrawLine', 'no-slot'], [1, 0, 'DrawLine', 'not-owner'],
    [1, 0, 'DrawLine', 'unknown-id'], [1, 0, 'DrawLine', 'malformed'], [1, 0, 'DrawLine', 'not-drawer'],
    [2, 0, 'DrawLine', 'duplicate'],
    [3, 0, 'CutLine', 'not-owner'], [3, 0, 'CutLine', 'no-line'], [3, 0, 'CutLine', 'unknown-id'],
  ]);
});
