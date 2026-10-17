const assert = require('node:assert/strict');
const { test } = require('node:test');
async function fixture() {
  const { create } = await import('../../sim/dist/index.js');
  const api = await import('../dist/index.js');
  const sim = create({ id: 'progress-units', componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], timeLimitSec: 100, bots: [], visual: '',
    players: [{ id: 'p0', team: 'red', kind: 'human', colorKey: '' }, { id: 'p1', team: 'blue', kind: 'bot', colorKey: '' }],
    kinds: [{ id: 'regular', value: 1, speedMilli: 1000, visual: '' }],
    towers: [0, 1].map(i => ({ id: `t${i}`, x: i * 10001, y: i * 20003, owner: i, garrison: 10, archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: i ? 0 : 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
  }, 1);
  const ctx = api.guardBotContext(sim);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 2, params: {}, seed: 1 });
  return { sim, ctx, scorer };
}
test('timeToTake uses actual diagonal channel progress length and speed per tick', async () => {
  const { sim, ctx, scorer } = await fixture();
  scorer.prepare(ctx, 0);
  const predicted = scorer.consideration('timeToTake', 'attack', 0, 1);
  sim.step([{ type: 'DrawLine', player: 'p0', from: 't0', to: 't1' }], { events: false });
  const length = ctx.view.lines[0].length;
  assert.notEqual(length, Math.floor(Math.sqrt(10001 ** 2 + 20003 ** 2)) * 20, 'diagonal must expose floor-before-scale errors');
  const travelTicks = Math.ceil(length / ctx.view.kinds[0].speedPerTick);
  const captureTicks = Math.trunc(11 * 20000 / 20000);
  assert.equal(predicted, 1000 - Math.trunc((travelTicks + captureTicks + 1) * 1000 / 2000));
});
test('mid-flight cut-channel arrival flow matches public progress and original channel length', async () => {
  const { sim, ctx, scorer } = await fixture();
  sim.step([{ type: 'DrawLine', player: 'p0', from: 't0', to: 't1' }], { events: false });
  const length = ctx.view.lines[0].length;
  for (let i = 1; i < 100; i++) sim.step([], { events: false });
  sim.step([{ type: 'CutLine', player: 'p0', from: 't0', to: 't1' }], { events: false });
  assert.equal(ctx.view.lines.length, 0);
  const out = Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(key => [key, new Int32Array(1000)]));
  const count = ctx.readTroops(out); assert.ok(count > 0);
  let arrival = 0;
  for (let i = 0; i < count; i++) arrival += Math.trunc(20000 / Math.max(1, Math.ceil((length - out.progress[i]) / ctx.view.kinds[0].speedPerTick)));
  const reserve = Math.trunc(ctx.view.tower.col['garrison.count'][1] * 1000 / Math.max(1, Math.trunc((2000 - sim.tick) / 20)));
  scorer.prepare(ctx, sim.tick);
  assert.equal(scorer.consideration('threatToTarget', 'reinforce', 0, 1), Math.trunc(arrival * 1000 / (arrival + reserve)));
});
