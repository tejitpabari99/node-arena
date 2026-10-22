const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { step } = api;

const { compiledGolden } = require('./fixtures.cjs');

const draw = (player, from, to) => ({ type: 'DrawLine', player, from, to });
const mkState = (edit, seed = 3) => { const l = compiledGolden(); if (edit) edit(l); return api.createState(l, seed); };
const spawnTicks = (state, n, cmds = {}) => {
  const fires = [];
  for (let i = 0; i < n; i++) {
    const ev = step(state, cmds[i] ?? [], true);
    if (ev.some((e) => e.type === 'TroopSpawned')) fires.push(state.tick);
  }
  return fires;
};
const idivB = (a, b) => a / b; // BigInt division truncates

test('covers R-TCK-06, R-SPN-01: spawnPeriodMt matches BigInt oracle over a grid, clamp >= 1000', () => {
  for (const speed of [1, 100, 500, 2000, 9999]) for (const pen of [0, 300, 1000]) for (const L of [0, 1, 10, 33, 64, 200]) for (const n of [0, 1, 2, 3, 8]) {
    const K = 1000n + BigInt(pen) * BigInt(Math.max(n, 1) - 1);
    let want = idivB(K * 1_200_000n, BigInt(speed) * BigInt(L) + 60000n);
    if (want < 1000n) want = 1000n;
    assert.equal(api.spawnPeriodMt(L, n, speed, pen), Number(want), `${L},${n},${speed},${pen}`);
  }
});

test('covers R-TCK-06, R-GRW-01: growPeriodMt matches BigInt oracle over a grid', () => {
  const isqrtB = (v) => { let x = BigInt(Math.floor(Math.sqrt(Number(v)))); while (x * x > v) x--; while ((x + 1n) * (x + 1n) <= v) x++; return x; };
  for (const base of [1, 900, 5000]) for (const gt of [1, 100, 1700, 9000]) for (let L = 0; L <= 200; L += 3) {
    const k = BigInt(Math.floor(L / 10)) + 1n;
    let want = idivB((idivB(BigInt(base) * 1000n, isqrtB(k * 1_000_000n)) + 1000n) * BigInt(gt), 50n);
    if (want < 1000n) want = 1000n;
    assert.equal(api.growPeriodMt(L, gt, base), Number(want), `${L},${gt},${base}`);
  }
});

test('covers R-SPN-01, R-GRW-01: pinned worked examples (E-SPAWN, E-GROWTH)', () => {
  assert.equal(api.spawnPeriodMt(10, 1, 500, 300), 18461);
  assert.equal(api.spawnPeriodMt(10, 2, 500, 300), 24000);
  assert.equal(api.spawnPeriodMt(64, 3, 500, 300), 20869);
  assert.equal(api.growPeriodMt(0, 1700, 900), 64600);
  assert.equal(api.growPeriodMt(60, 1700, 900), 45560);
});

test('covers R-TCK-06, R-SPN-03, R-ENT-01: E-TIMER fires at ticks 19, 37, 56 with remainders 539, 78, 617; draw tick accrues', () => {
  const state = mkState((l) => { l.buildings[0].level = 10; });
  const rems = [];
  const fires = [];
  for (let i = 0; i < 56; i++) {
    const ev = step(state, i === 0 ? [draw(0, 0, 2)] : [], true);
    if (ev.some((e) => e.type === 'TroopSpawned')) { fires.push(state.tick); rems.push(api.getChannel(state, 0, 2).timer); }
  }
  assert.deepEqual(fires, [19, 37, 56]);
  assert.deepEqual(rems, [539, 78, 617]);
  assert.equal(state.buildings.level[0], 10, 'spawning is free; no growth with a line');
  assert.equal(state.buildings.alive[0] + state.counters.arrived, 3, 'first troop arrived at tick 51 (Task 5)');
});

test('covers R-SPN-01, R-TCK-06: TroopSpawned event shape; troop at progress 0 with next seq', () => {
  const state = mkState((l) => { l.buildings[0].level = 10; });
  step(state, [draw(0, 0, 2)], false);
  let ev = [];
  for (let i = 0; i < 18; i++) ev = step(state, [], true);
  assert.deepEqual(ev, [{ type: 'TroopSpawned', channel: api.channelKey(state, 0, 2), seq: 0, owner: 0, kind: 'soldier', cause: 'timer' }]);
  const ch = api.getChannel(state, 0, 2);
  assert.equal(ch.troops.len, 1);
  assert.equal(ch.troops.p0[0], 0);
});

test('covers R-TCK-06: mid-interval line add uses the new period on the carried timer', () => {
  const state = mkState((l) => { l.buildings[0].level = 10; });
  step(state, [draw(0, 0, 2)], false); // tick 1: timer 1000
  for (let i = 0; i < 9; i++) step(state, [], false); // tick 10: 10000
  assert.equal(api.getChannel(state, 0, 2).timer, 10000);
  // draw second line at tick 11: period 24000 now; line 1 timer 11000 keeps going, new line starts 0 then accrues 1000
  step(state, [draw(0, 0, 3)], false);
  assert.equal(api.getChannel(state, 0, 2).timer, 11000);
  assert.equal(api.getChannel(state, 0, 3).timer, 1000);
  let first = 0;
  for (let i = 0; i < 20 && !first; i++) { const ev = step(state, [], true); if (ev.some((e) => e.type === 'TroopSpawned')) first = state.tick; }
  assert.equal(first, 11 + 13, 'fires when 24000 reached (11000 + 13*1000)');
});

test('covers R-SPN-02: alive cap skips the spawn but consumes the timer', () => {
  const state = mkState((l) => { l.buildings[0].level = 10; });
  step(state, [draw(0, 0, 2)], false);
  state.buildings.alive[0] = state.level.rules.aliveCap;
  const before = api.getChannel(state, 0, 2).troops.len;
  const fires = spawnTicks(state, 18);
  assert.deepEqual(fires, []);
  const ch = api.getChannel(state, 0, 2);
  assert.equal(ch.troops.len, before);
  assert.equal(ch.timer, 539, 'timer consumed at tick 19');
  assert.equal(state.buildings.alive[0], state.level.rules.aliveCap);
  assert.equal(state.troopSeq, 0);
});

test('covers R-SPN-03, R-ENT-02: neutral buildings and undrawn/cut lines never spawn; cut zeroes timer', () => {
  const state = mkState((l) => { l.buildings[0].level = 10; });
  assert.deepEqual(spawnTicks(state, 40), [], 'no line, no spawn; neutral b2/b3 never spawn');
  step(state, [draw(0, 0, 2)], false);
  for (let i = 0; i < 5; i++) step(state, [], false);
  step(state, [{ type: 'CutLine', player: 0, from: 0, to: 2 }], false);
  assert.equal(api.getChannel(state, 0, 2).timer, 0);
  assert.deepEqual(spawnTicks(state, 30), []);
  // neutral source with a forced drawn line: still no spawn
  const n = mkState();
  const ch = api.getChannel(n, 2, 3); ch.drawn = 1; n.buildings.lines[2] = 1;
  assert.deepEqual(spawnTicks(n, 80), []);
  assert.equal(ch.timer, 0);
});

test('covers R-ENT-03: only houses with spawns/grows modules run; tower (no spawns/grows) never spawns or grows', () => {
  const state = mkState((l) => { l.buildings[4].owner = 0; });
  const lvl = state.buildings.level[4];
  assert.deepEqual(spawnTicks(state, 120), []);
  assert.equal(state.buildings.level[4], lvl);
  assert.equal(state.buildings.col['grows.timer'][4], 0);
});

test('covers R-GRW-01: growth fires at period, resets timer, raises level and stage; paused (kept) while a line exists', () => {
  const state = mkState((l) => { l.buildings[0].level = 9; }); // k=1, period 64600
  const p = api.growPeriodMt(9, 1700, 900);
  assert.equal(p, 64600);
  for (let i = 0; i < 64; i++) step(state, [], false);
  assert.equal(state.buildings.col['grows.timer'][0], 64000);
  assert.equal(state.buildings.level[0], 9);
  // line drawn at tick 65: timer kept at 64000, not advanced
  step(state, [draw(0, 0, 2)], false);
  for (let i = 0; i < 5; i++) step(state, [], false);
  assert.equal(state.buildings.col['grows.timer'][0], 64000);
  assert.equal(state.buildings.level[0], 9);
  step(state, [{ type: 'CutLine', player: 0, from: 0, to: 2 }], false);
  assert.equal(state.buildings.col['grows.timer'][0], 0, 'cut tick accrues 1000 -> 65000 >= 64600, fires, resets');
  assert.equal(state.buildings.level[0], 10, 'fired: 65000 >= period(9)');
  assert.equal(state.buildings.stage[0], 2, 'stage updated at threshold 10');
});

test('covers R-GRW-01: fire resets timer to 0 (no remainder); neutral never grows; growth caps at maxLevel but timer still ticks', () => {
  const state = mkState((l) => { l.buildings[0].level = 9; });
  for (let i = 0; i < 65; i++) step(state, [], false);
  assert.equal(state.buildings.level[0], 10);
  assert.equal(state.buildings.col['grows.timer'][0], 0);
  for (let i = 0; i < 64; i++) step(state, [], false);
  assert.equal(state.buildings.level[2], 7, 'neutral b2 never grows');
  const cap = mkState((l) => { l.buildings[0].level = 64; });
  for (let i = 0; i < 100; i++) step(cap, [], false);
  assert.equal(cap.buildings.level[0], 64);
  assert.ok(cap.buildings.col['grows.timer'][0] > 0 && cap.buildings.col['grows.timer'][0] < 100000, 'timer ticks/reset at max level');
});

test('covers R-GRW-01: capture resets the growth timer', () => {
  const state = mkState();
  for (let i = 0; i < 10; i++) step(state, [], false);
  assert.equal(state.buildings.col['grows.timer'][1], 10000);
  api.fireCapture(state, 1, 1, 0);
  assert.equal(state.buildings.col['grows.timer'][1], 0);
});

test('covers R-GRW-02: stage derived from stageThresholds after growth', () => {
  const state = mkState((l) => { l.buildings[0].level = 29; });
  assert.equal(state.buildings.stage[0], 2);
  while (state.buildings.level[0] === 29) step(state, [], false);
  assert.equal(state.buildings.stage[0], 3);
});

test('covers R-ENT-01: growth phase precedes spawn phase; same-tick determinism holds with invariants', () => {
  const run = () => {
    const s = mkState((l) => { l.buildings[0].level = 10; });
    step(s, [draw(0, 0, 2), draw(0, 0, 3)], false);
    for (let i = 0; i < 200; i++) { step(s, [], false); api.assertInvariants(s); }
    return api.hashState(s);
  };
  assert.equal(run(), run());
});
