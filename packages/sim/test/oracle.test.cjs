const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { step } = api;

const { compiledGolden } = require('./fixtures.cjs');

// ---- independent BigInt oracles (written from the rule text, not from timers.ts) ----
const isqrtB = (v) => { let x = BigInt(Math.floor(Math.sqrt(Number(v)))); while (x * x > v) x--; while ((x + 1n) * (x + 1n) <= v) x++; return x; };
const spawnOracle = (L, n, speed, pen) => {
  const K = 1000n + BigInt(pen) * BigInt(Math.max(n, 1) - 1);
  const p = (K * 1_200_000n) / (BigInt(speed) * BigInt(L) + 60000n);
  return p < 1000n ? 1000n : p;
};
const growOracle = (L, gt, base) => {
  const k = BigInt(Math.floor(L / 10)) + 1n;
  const p = ((BigInt(base) * 1000n / isqrtB(k * 1_000_000n) + 1000n) * BigInt(gt)) / 50n;
  return p < 1000n ? 1000n : p;
};

test('covers R-SPN-01: spawnPeriodMt equals the BigInt oracle for random params; always >= 1000 (clamp)', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 64 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 0, max: 5000 }), (L, n, speed, pen) => {
    const got = api.spawnPeriodMt(L, n, speed, pen);
    assert.equal(got, Number(spawnOracle(L, n, speed, pen)));
    assert.ok(got >= 1000);
  }), { numRuns: 500 });
});

test('covers R-SPN-01: clamp binds at huge spawnSpeed*L; period non-increasing in level, non-decreasing in line count', () => {
  assert.equal(api.spawnPeriodMt(64, 1, 100000, 0), 1000);
  assert.equal(api.spawnPeriodMt(200, 1, 2_000_000, 0), 1000);
  fc.assert(fc.property(fc.integer({ min: 0, max: 63 }), fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 2000 }), (L, n, speed, pen) => {
    assert.ok(api.spawnPeriodMt(L + 1, n, speed, pen) <= api.spawnPeriodMt(L, n, speed, pen));
    assert.ok(api.spawnPeriodMt(L, n + 1, speed, pen) >= api.spawnPeriodMt(L, n, speed, pen));
  }), { numRuns: 300 });
});

test('covers R-GRW-01: growPeriodMt equals the BigInt oracle for random params; always >= 1000; non-increasing in level', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 64 }), fc.integer({ min: 1, max: 20000 }), fc.integer({ min: 1, max: 20000 }), (L, gt, base) => {
    const got = api.growPeriodMt(L, gt, base);
    assert.equal(got, Number(growOracle(L, gt, base)));
    assert.ok(got >= 1000);
    assert.ok(api.growPeriodMt(L + 1, gt, base) <= got);
  }), { numRuns: 500 });
  assert.equal(api.growPeriodMt(0, 1, 1), 1000, 'clamp binds');
});

test('covers R-SPN-01: E-SPAWN pinned examples 18461 / 24000 / 20869 mt', () => {
  assert.equal(api.spawnPeriodMt(10, 1, 500, 300), 18461);
  assert.equal(api.spawnPeriodMt(10, 2, 500, 300), 24000);
  assert.equal(api.spawnPeriodMt(64, 3, 500, 300), 20869);
});

// ---- brute-force departure-tick oracle: per-tick timer accrual simulated independently of the engine ----
test('covers R-SPN-03: engine TroopSpawned ticks equal a brute-force per-tick timer simulation (random level / draw schedule)', () => {
  fc.assert(fc.property(
    fc.integer({ min: 10, max: 40 }), fc.integer({ min: 1, max: 30 }), // L >= 10: two slots
    fc.record({ a: fc.integer({ min: 1, max: 10 }), b: fc.integer({ min: 1, max: 60 }) }),
    (L, ahead, sched) => {
      const level = compiledGolden();
      level.buildings[0].level = L;
      level.rules.aliveCap = 1000; // keep the cap out of the oracle
      const params = level.buildings[0].modules.spawns;
      const state = api.createState(level, 7);
      const drawAt = { [sched.a]: 2, [sched.a + sched.b]: 3 }; // tick -> target
      const T = sched.a + sched.b + ahead + 60;
      const engine = { 2: [], 3: [] };
      const timer = { 2: 0, 3: 0 }, drawn = [];
      const oracle = { 2: [], 3: [] };
      for (let t = 1; t <= T; t++) {
        const cmds = drawAt[t] === undefined ? [] : [{ type: 'DrawLine', player: 0, from: 0, to: drawAt[t] }];
        const ev = step(state, cmds, true);
        for (const e of ev) if (e.type === 'TroopSpawned') engine[e.channel % state.buildings.n].push(t);
        if (drawAt[t] !== undefined) drawn.push(drawAt[t]);
        for (const to of drawn) { // draw tick accrues
          timer[to] += 1000;
          const period = Number(spawnOracle(L, drawn.length, params.spawnSpeed, params.lineSpawnPenalty));
          if (timer[to] >= period) { timer[to] -= period; oracle[to].push(t); }
        }
      }
      assert.deepEqual(engine, oracle);
      api.assertInvariants(state);
    }), { numRuns: 60 });
});
