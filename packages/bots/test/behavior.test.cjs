const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');

function fakeView(spec) {
  const lines = spec.lines ?? [];
  const lineCount = spec.owner.map((_, i) => lines.filter(l => l.from === i).length);
  return {
    over: null,
    ids: { buildings: spec.owner.map((_, i) => `b${i}`), players: ['p0', 'p1'], elements: [] },
    buildings: { owner: spec.owner, level: spec.level, lines: lineCount },
    buildingStatic: spec.owner.map((_, i) => ({ x: spec.xz?.[i]?.[0] ?? i * 1000, z: spec.xz?.[i]?.[1] ?? 0, special: false, drawsLines: true })),
    lines: lines.map(l => ({ ...l, owner: spec.owner[l.from] })),
    freeSlots: i => (spec.slots?.[i] ?? 2) - lineCount[i],
  };
}
const allow = () => null;

test('covers R3: source choice is uniform over free sources (fixed-seed histogram)', () => {
  const view = fakeView({ owner: [0, 0, 0, 0, 1], level: [5, 5, 5, 5, 5] });
  const rng = sim.createStreams(2024).fork('bot.tw', 0);
  const hist = [0, 0, 0, 0];
  const N = 4000;
  for (let n = 0; n < N; n++) {
    const [c] = bots.decideDefault(view, allow, rng, 0, { timer: 1700 }, { actionDelayMs: 1700, behavior: 'attackOnly' });
    assert.equal(c.to, 4);
    hist[c.from]++;
  }
  assert.equal(hist.reduce((a, b) => a + b, 0), N);
  for (const h of hist) assert.ok(h > N / 4 * 0.9 && h < N / 4 * 1.1, `non-uniform histogram ${hist}`);
  // fixed seed: reproducible
  const rng2 = sim.createStreams(2024).fork('bot.tw', 0);
  const again = [0, 0, 0, 0];
  for (let n = 0; n < N; n++) again[bots.decideDefault(view, allow, rng2, 0, { timer: 1700 }, { actionDelayMs: 1700, behavior: 'attackOnly' })[0].from]++;
  assert.deepEqual(again, hist);
});

test('covers R3: behavior parity - attackOnly equals full minus defense', () => {
  const specs = [
    { owner: [0, 0, 1], level: [5, 5, 5] },                                   // attack available
    { owner: [0, 0, 1, -1], level: [3, 9, 5, 2], lines: [{ from: 0, to: 3 }] },
    { owner: [0, 0, 0, 1], level: [5, 5, 5, 5], slots: [2, 2, 2, 2] },
    { owner: [0, 0, 1], level: [5, 5, 5], slots: [2, 2, 2] },                  // attack blocked below
    { owner: [0, 0, 0], level: [5, 5, 5] },                                    // no targets: defense only
  ];
  for (const [si, spec] of specs.entries()) {
    const view = fakeView(spec);
    // blocked variant: canDraw rejects every non-own target
    for (const canDraw of [allow, (_p, _f, to) => (view.buildings.owner[to] === 0 ? null : 'blocked-obstacle')]) {
      for (let seed = 0; seed < 20; seed++) {
        const run = behavior => bots.decideDefault(view, canDraw, sim.createStreams(seed).fork('bot.tw', 0), 0, { timer: 1700 }, { actionDelayMs: 1700, behavior });
        const full = run('full'), atk = run('attackOnly');
        const attackIsPossible = atk.length === 1;
        if (attackIsPossible) assert.deepEqual(full, atk, `spec ${si} seed ${seed}`);
        else {
          assert.deepEqual(atk, []);
          for (const c of full) assert.equal(view.buildings.owner[c.to], 0, 'full-only extras are defense (own target)');
        }
      }
    }
  }
});
