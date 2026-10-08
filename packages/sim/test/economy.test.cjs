const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
function level({ rate = 20000, count = 11, cap = 50, value = 1 } = {}) {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'economy', timeLimitSec: 100, visual: '', bots: [],
    players: ['p0', 'p1'].map((id, i) => ({ id, team: id, kind: i ? 'bot' : 'human', colorKey: id })),
    towers: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 1000, y: 0, owner: i === 2 ? 1 : i === 3 ? -1 : 0, garrison: count, archetype: '', visual: '', footprintRadius: 0,
      components: i === 3 ? { garrison: { cap } } : { garrison: { cap }, generates: { troop: 0, ratePerSec: rate }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value, speedMilli: 1000, visual: '' }] };
}
const draw = (from, to, player = 'p0') => ({ type: 'DrawLine', player, from, to });
const cut = (from, to, player = 'p0') => ({ type: 'CutLine', player, from, to });
test('covers R-LIN-01: canDraw shares atomic validation and malformed commands never throw', () => {
  const s = create(level({ rate: 0, count: 10 }), 0);
  assert.equal(typeof s.canDraw, 'function');
  assert.equal(s.canDraw('p0', 'a', 'b'), null);
  assert.equal(s.canDraw('p0', 'a', 'a'), 'self');
  assert.equal(s.canDraw('p1', 'a', 'b'), 'not-owner');
  assert.equal(s.canDraw('p0', 'missing', 'b'), 'unknown-id');
  s.step([draw('a', 'b')]);
  assert.equal(s.canDraw('p0', 'a', 'b'), 'duplicate');
  assert.equal(s.canDraw('p0', 'a', 'c'), 'no-slot');
  const before = s.channels.filter(Boolean).length;
  const events = s.step([draw('a', 'c'), null, 12, {}, { type: 'Bogus', player: 'p0', from: 'a', to: 'b' }, draw(1, 'b')]);
  assert.equal(events.filter(e => e.type === 'CommandRejected').length, 6);
  assert.equal(s.rejected, 6);
  assert.equal(s.channels.filter(Boolean).length, before);
  assert.deepEqual([...s.tower.lines], [1, 0, 0, 0]);
  s.step([draw('a', 'c')], { events: false });
  assert.equal(s.rejected, 7);
  assert.equal(s.canDraw('p0', 'b', 'd'), null);
  s.tower.owner[3] = 0;
  assert.equal(s.canDraw('p0', 'd', 'b'), 'no-component');
});
test('covers R-TCK-03: stable player ordering preserves commands within each player', () => {
  const s = create(level({ rate: 0 }), 0);
  const events = s.step([draw('c', 'a', 'p1'), draw('a', 'c'), cut('a', 'c'), draw('a', 'b')]);
  assert.deepEqual(events.map(e => e.type), ['LineDrawn', 'LineCut', 'LineDrawn', 'LineDrawn']);
  assert.deepEqual(events.filter(e => e.type === 'LineDrawn').map(e => e.owner), [0, 0, 1]);
});
test('covers R-LIN-03 R-LIN-05: replacement and cuts preserve in-flight troops; rejection preserves reverse permission', () => {
  const s = create(level({ count: 10 }), 0);
  s.step([draw('b', 'a'), draw('a', 'c')]);
  const reverse = s.channels[4];
  assert.equal(reverse.troops.size, 1);
  assert.equal(s.canDraw('p0', 'a', 'b'), 'no-slot');
  s.step([draw('a', 'b')]);
  assert.equal(reverse.drawn, 1);
  const events = s.step([cut('a', 'c'), draw('a', 'b')]);
  assert.equal(reverse.drawn, 0);
  assert.equal(reverse.troops.size, 2);
  assert.ok(events.some(e => e.type === 'LineCut' && e.reason === 'replaced'));
  s.step([cut('a', 'b')]);
  assert.equal(s.channels[1].troops.size, 1);
  assert.equal(s.rejected, 1);
});
test('covers R-GEN-01 R-GEN-02: fractional generation, neutral and missing components, slots refresh', () => {
  const s = create(level({ rate: 1500, count: 10 }), 0);
  assert.equal(typeof s.step, 'function');
  for (let i = 0; i < 13; i++) s.step([]);
  assert.equal(s.tower.col['garrison.count'][0], 10);
  s.step([]);
  assert.equal(s.tower.col['garrison.count'][0], 11);
  assert.equal(s.tower.col['generates.acc'][0], 1000);
  assert.equal(s.tower.slots[0], 2);
  assert.equal(s.tower.col['garrison.count'][3], 10);
  s.step([draw('a', 'b'), draw('a', 'c')]);
  assert.equal(s.rejected, 0);
  const neutral = create(level(), 0); neutral.tower.owner[0] = -1; neutral.step([]);
  assert.equal(neutral.tower.col['generates.acc'][0], 0);
  assert.equal(neutral.players.stats.generated[0], 1); // b alone
});
test('covers R-SND-01 R-SND-02: sending freezes count and shares generation by sorted targets through cuts', () => {
  const s = create(level({ rate: 60000 }), 0);
  const events = s.step([draw('a', 'c'), draw('a', 'b')]);
  assert.deepEqual(events.filter(e => e.type === 'TroopSpawned' && e.channel < 4).map(e => e.channel), [1, 2, 1]);
  assert.equal(s.tower.col['garrison.count'][0], 11);
  assert.equal(s.channels[1].troops.front().t0, 1);
  assert.equal(s.channels[1].troops.front().p0, 0);
  s.step([cut('a', 'b')]);
  assert.equal(s.channels[2].troops.size, 4);
  s.step([draw('a', 'b')]);
  assert.equal(s.channels[1].troops.size, 4);
  assert.equal(s.channels[2].troops.size, 5);
});
test('covers R-CAP-01 R-CAP-02: no-bank cap preserves fractional remainder, discards overflow and keeps sending', () => {
  const s = create(level({ rate: 65000, count: 49 }), 0);
  s.step([]);
  assert.equal(s.tower.col['garrison.count'][0], 50);
  assert.equal(s.players.stats.generated[0], 6);
  assert.equal(s.players.stats.overflowLost[0], 4);
  assert.equal(s.tower.col['generates.acc'][0], 5000);
  for (let i = 0; i < 20; i++) s.step([]);
  assert.equal(s.tower.col['generates.acc'][0], 5000);
  const events = s.step([draw('a', 'c')]);
  assert.equal(events.filter(e => e.type === 'TroopSpawned').length, 3);
  assert.equal(s.tower.col['garrison.count'][0], 50);
  assert.equal(s.tower.col['generates.acc'][0], 10000);
});
test('value-unit accounting supports tank departures and garrison overflow; events:false keeps identical economy', () => {
  const a = create(level({ value: 2, count: 49 }), 0), b = create(level({ value: 2, count: 49 }), 0);
  assert.equal(typeof a.step, 'function');
  const events = a.step([draw('a', 'c')]);
  assert.deepEqual(b.step([draw('a', 'c')], { events: false }), []);
  assert.equal(events.filter(e => e.type === 'TroopSpawned').length, 1);
  assert.deepEqual([...a.players.transit], [2, 0]);
  assert.deepEqual([...a.players.stats.generated], [4, 2]);
  assert.deepEqual([...a.players.stats.overflowLost], [1, 1]);
  assert.equal(a.channels[2].troops.front().value, 2);
  assert.deepEqual([...a.tower.col['garrison.count']], [...b.tower.col['garrison.count']]);
  assert.deepEqual([...a.players.transit], [...b.players.transit]);
});
test('covers R-CPT-01: capture helper resets registered accumulator/cursor without touching transit', () => {
  const s = create(level({ rate: 21500 }), 0);
  assert.equal(typeof s.resetOnCapture, 'function');
  s.step([draw('a', 'c')]);
  assert.equal(s.tower.col['generates.acc'][0], 1500);
  assert.equal(s.tower.col['drawsLines.cursor'][0], 2);
  s.resetOnCapture(0);
  assert.equal(s.tower.col['generates.acc'][0], 0);
  assert.equal(s.tower.col['drawsLines.cursor'][0], -1);
  assert.equal(s.players.transit[0], 1);
});
test('registered extension systems execute in order without component-specific core interpretation', () => {
  const registry = createComponentRegistry();
  registry.registerComponent({ name: 'shoots', state: { acc: 0 }, systems: { generation: { order: 1, run(state, towers) { for (const i of towers) state.tower.col['shoots.acc'][i] = state.tower.col['garrison.count'][i]; } } } });
  const input = level(); input.componentNames.push('shoots'); input.towers[0].components.shoots = {};
  const s = create(input, 0, { registry });
  assert.equal(typeof s.step, 'function'); s.step([]);
  assert.equal(s.tower.col['shoots.acc'][0], 12);
});
test('covers R-LIN-05: cuts validate channel ownership without mutating its permission or troops', () => {
  const s = create(level(), 0);
  s.step([draw('a', 'c')]);
  const events = s.step([cut('a', 'c', 'p1'), cut('b', 'c'), cut('missing', 'c')]);
  assert.deepEqual(events.filter(e => e.type === 'CommandRejected').map(e => e.reason), ['unknown-id', 'unknown-id', 'not-owner']);
  assert.equal(s.rejected, 3);
  assert.equal(s.channels[2].drawn, 1);
  assert.equal(s.channels[2].troops.size, 2);
});
test('covers R-WIN-03: staged gameover gate rejects previews and makes later steps a no-op', () => {
  const s = create(level(), 0);
  s.over = { outcome: 'won', winnerTeam: 0 };
  assert.equal(s.canDraw('p0', 'a', 'c'), 'gameover');
  assert.deepEqual(s.step([draw('a', 'c')]), []);
  assert.equal(s.tick, 0);
  assert.equal(s.rejected, 0);
  assert.equal(s.channels.filter(Boolean).length, 0);
  assert.equal(s.players.stats.generated[0], 0);
});
