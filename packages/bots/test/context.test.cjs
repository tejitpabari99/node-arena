const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('tsx/cjs');

let api;
before(async () => { api = await import('../dist/index.js'); });
function guard(context) {
  assert.equal(typeof api.guardBotContext, 'function', 'bot package must expose guardBotContext');
  return api.guardBotContext(context);
}
async function simFixture() {
  const { create } = await import('../../sim/dist/index.js');
  return create({ componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    id: 'bot-context', timeLimitSec: 100, bots: [], visual: 'map',
    players: [{ id: 'p0', team: 'red', kind: 'human', colorKey: 'red' }, { id: 'p1', team: 'blue', kind: 'bot', colorKey: 'blue' }],
    towers: ['a', 'b'].map((id, i) => ({ id, x: i * 10000, y: 0, owner: i, garrison: 31, archetype: 'tower', visual: 'tower', footprintRadius: 2000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 2, speedMilli: 3001, visual: 'troop' }],
  }, 42);
}
const buffer = () => Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(key => [key, new Int32Array(10)]));

test('guard preserves the live public view and draw/troop reads across a sim step', async () => {
  const sim = await simFixture();
  const ctx = guard(sim);
  assert.equal(ctx.view, sim.view);
  assert.equal(ctx.canDraw('p0', 'a', 'b'), null);
  assert.notEqual(ctx.canDraw('p1', 'a', 'b'), null);
  const out = buffer();
  assert.equal(ctx.readTroops(out), 0);
  sim.step([{ type: 'DrawLine', player: 'p0', from: 'a', to: 'b' }]);
  assert.equal(ctx.view.tick, 1);
  assert.equal(ctx.view.lines.length, 1);
  assert.equal(ctx.readTroops(out), sim.readTroops(buffer()));
  assert.ok(out.seq[0] > 0);
});

test('guard rejects every extra string or symbol read including inherited properties', async () => {
  const ctx = guard(await simFixture());
  for (const key of ['snapshot', 'step', 'hash', 'rejected', 'prng', 'events', 'tick', 'constructor', '__proto__', 'toString', 'anything', Symbol.iterator, Symbol.toStringTag]) {
    assert.throws(() => Reflect.get(ctx, key), TypeError, String(key));
  }
});

test('guard exposes only its three capabilities through reflection and cannot be extended', async () => {
  const ctx = guard(await simFixture());
  assert.deepEqual(Reflect.ownKeys(ctx).sort(), ['canDraw', 'readTroops', 'view']);
  assert.equal(Object.getPrototypeOf(ctx), null);
  assert.equal(Object.getOwnPropertyDescriptor(ctx, 'snapshot'), undefined);
  assert.equal(Reflect.set(ctx, 'snapshot', () => {}), false);
  assert.equal(Reflect.set(ctx, 'view', {}), false);
  assert.equal(Reflect.defineProperty(ctx, 'snapshot', { value: () => {} }), false);
});
