const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
require('tsx/cjs');
const api = require('../src/index.ts');
const { step } = require('../src/tick.ts');
const { compiledGolden } = require('./fixtures.cjs');

const TANK = { id: 'tank', visual: 'unit.tank', speed: 5000, hp: 2, attack: 2, defense: 1 };
const TICKS = 300;
const cmdArb = fc.record({
  t: fc.integer({ min: 0, max: TICKS - 1 }),
  type: fc.constantFrom('DrawLine', 'CutLine'),
  player: fc.integer({ min: 0, max: 2 }), // 2 = invalid player: must be rejected, never throw
  from: fc.integer({ min: 0, max: 5 }),
  to: fc.integer({ min: 0, max: 5 }),
});
const levelArb = fc.record({
  levels: fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 5, maxLength: 5 }),
  cap: fc.integer({ min: 2, max: 30 }),
  tank: fc.boolean(),
  timeLimitSec: fc.constantFrom(null, 5, 12),
});
function build(cfg) {
  const l = compiledGolden();
  cfg.levels.forEach((v, i) => { l.buildings[i].level = Math.min(v, l.buildings[i].maxLevel ?? v); });
  l.rules.aliveCap = cfg.cap;
  l.rules.timeLimitSec = cfg.timeLimitSec;
  if (cfg.tank) l.units.push({ ...TANK });
  return l;
}
const byTick = (cmds) => { const m = new Map(); for (const { t, ...c } of cmds) { if (!m.has(t)) m.set(t, []); m.get(t).push(c); } return m; };

test('covers R-TCK-05: random command streams keep every invariant each tick (int32, recount, level range, FIFO, ring <= cap, conservation)', () => {
  fc.assert(fc.property(levelArb, fc.array(cmdArb, { maxLength: 60 }), fc.integer({ min: 0, max: 0x7fffffff }), (cfg, cmds, seed) => {
    const state = api.createState(build(cfg), seed);
    const plan = byTick(cmds);
    for (let t = 0; t < TICKS; t++) {
      const before = state.tick;
      step(state, plan.get(t) ?? [], t % 2 === 0);
      api.assertInvariants(state);
      assert.equal(state.tick, before + 1);
      if (state.over) break;
    }
    if (state.over) { // finished match accepts no further simulation changes
      const h = api.hashState(state), tick = state.tick;
      step(state, [{ type: 'DrawLine', player: 0, from: 0, to: 2 }], true);
      assert.equal(state.tick, tick);
      assert.equal(api.hashState(state), h);
    }
  }), { numRuns: 40 });
});

// ---- 50-seed determinism: two independent runs per seed produce the same hash sequence ----
function scripted(seed) {
  const rng = new api.Sfc32(api.mixSeed(seed, 0xd1ce));
  const plan = new Map();
  for (let i = 0; i < 40; i++) {
    const t = rng.below(TICKS);
    const c = { type: rng.below(4) === 0 ? 'CutLine' : 'DrawLine', player: rng.below(2), from: rng.below(5), to: rng.below(5) };
    if (!plan.has(t)) plan.set(t, []);
    plan.get(t).push(c);
  }
  return plan;
}
function hashes(seed) {
  const l = compiledGolden();
  l.units.push({ ...TANK });
  const sim = api.create(l, seed);
  const plan = scripted(seed);
  const out = [];
  for (let t = 0; t < TICKS; t++) { sim.step(plan.get(t) ?? [], { events: t % 3 === 0 }); out.push(sim.hash()); }
  return out;
}

test('covers R-TCK-03: 50 seeds, two runs each, identical per-tick hash sequences (events on/off does not matter)', () => {
  const finals = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const a = hashes(seed), b = hashes(seed);
    assert.deepEqual(a, b, `seed ${seed}`);
    finals.add(a[a.length - 1]);
  }
  assert.ok(finals.size > 1, 'different scripts reach different states');
});
