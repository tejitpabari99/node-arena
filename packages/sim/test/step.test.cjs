const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
function level({ owners = [0, 1, 0, 1], counts = [31, 5, 5, 5], teams = ['human-team', 'bot-team'], limit = 100, rate = 0, speed = 100 } = {}) {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'step', timeLimitSec: limit, visual: '', bots: [],
    players: teams.map((team, i) => ({ id: `p${i}`, team, kind: i ? 'bot' : 'human', colorKey: '' })),
    towers: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 5, y: 0, owner: owners[i], garrison: counts[i], archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: rate }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: speed, visual: '' }] };
}
const draw = (from, to) => ({ type: 'DrawLine', player: 'p0', from, to });
function enqueue(s, from, to, owner, p0, value = 1) {
  const ch = s.ensureChannel(from, to);
  ch.troops.push({ p0, t0: s.tick, owner, kind: 0, seq: ++s.troopSeq, value });
  s.players.transit[owner] += value;
  return ch;
}
test('covers R-TCK-05: arrivals lower slots and cut greatest drawSeq repeatedly, retaining troops', () => {
  const s = create(level({ speed: 0 }), 0);
  s.step([draw('a', 'd'), draw('a', 'b'), draw('a', 'c')]);
  const kept = enqueue(s, 0, 2, 0, 0);
  enqueue(s, 1, 0, 1, 100, 21);
  const events = s.step([]);
  assert.equal(s.tower.col['garrison.count'][0], 10);
  assert.equal(s.tower.slots[0], 1);
  assert.equal(s.tower.lines[0], 1);
  assert.deepEqual(events.filter(e => e.type === 'LineCut'), [
    { type: 'LineCut', tick: 2, channel: 2, reason: 'slots' },
    { type: 'LineCut', tick: 2, channel: 1, reason: 'slots' },
  ]);
  assert.equal(s.channels[3].drawn, 1);
  assert.equal(kept.troops.size, 1);
});
test('covers R-LIN-02: reinforcement and capture refresh final slots before next command', () => {
  const s = create(level({ counts: [10, 31, 5, 5], speed: 0 }), 0);
  enqueue(s, 2, 0, 0, 200);
  enqueue(s, 0, 1, 0, 100, 32);
  s.step([]);
  assert.equal(s.tower.slots[0], 2);
  assert.equal(s.tower.slots[1], 1);
  assert.equal(s.canDraw('p0', 'a', 'b'), null);
  assert.equal(s.canDraw('p0', 'b', 'd'), null);
});
test('covers R-WIN-01: eliminated tower owner survives in transit until its last troop is gone', () => {
  const s = create(level({ owners: [0, 1, 0, 0], counts: [5, 1, 5, 5] }), 0);
  enqueue(s, 0, 1, 0, 0);
  enqueue(s, 1, 3, 1, -100);
  const first = s.step([]);
  assert.equal(s.tower.owner[1], 0);
  assert.equal(s.players.alive[1], 1);
  assert.equal(s.over, null);
  assert.ok(!first.some(e => e.type === 'PlayerEliminated'));
  s.step([]);
  const final = s.step([]);
  assert.deepEqual(final.slice(-2), [
    { type: 'PlayerEliminated', tick: 3, player: 1 },
    { type: 'GameOver', tick: 3, outcome: 'won', winnerTeam: 'human-team' },
  ]);
  assert.deepEqual(s.over, { outcome: 'won', winnerTeam: 'human-team' });
});
test('covers R-WIN-02: human elimination loses even with multiple bot teams, unique winner only', () => {
  for (const [owners, winner] of [[[1, 2, 1, 2], null], [[1, 1, 1, 1], 'bot-team']]) {
    const s = create(level({ owners, teams: ['human-team', 'bot-team', 'third-team'] }), 0);
    const events = s.step([]);
    assert.deepEqual(s.over, { outcome: 'lost', winnerTeam: winner });
    assert.deepEqual(events.at(-1), { type: 'GameOver', tick: 1, outcome: 'lost', winnerTeam: winner });
  }
});
test('covers R-WIN-01: teams determine winner, neutral towers do not keep a player alive', () => {
  const s = create(level({ owners: [0, 1, -1, -1], teams: ['allied', 'allied'] }), 0);
  assert.deepEqual(s.step([]).at(-1), { type: 'GameOver', tick: 1, outcome: 'won', winnerTeam: 'allied' });
});
test('covers R-WIN-02: simultaneous last-front destruction produces draw and one elimination per player', () => {
  const s = create(level({ owners: [-1, -1, -1, -1], speed: 0 }), 0);
  enqueue(s, 0, 1, 0, 60); enqueue(s, 1, 0, 1, 40);
  assert.deepEqual(s.step([]).slice(-3), [
    { type: 'PlayerEliminated', tick: 1, player: 0 },
    { type: 'PlayerEliminated', tick: 1, player: 1 },
    { type: 'GameOver', tick: 1, outcome: 'draw', winnerTeam: null },
  ]);
});
test('covers R-WIN-03: timeout boundary overrides win, loss and draw; postgame is completely inert', () => {
  for (const owners of [[0, 0, 0, 0], [1, 1, 1, 1], [-1, -1, -1, -1], [0, 1, 0, 1]]) {
    const s = create(level({ owners, limit: 1 }), 0); s.tick = 19;
    assert.deepEqual(s.step([]).at(-1), { type: 'GameOver', tick: 20, outcome: 'timeout', winnerTeam: null });
    assert.deepEqual(s.over, { outcome: 'timeout', winnerTeam: null });
    const before = { tick: s.tick, rejected: s.rejected, drawSeq: s.drawSeq, troopSeq: s.troopSeq, over: s.over, prng: s.prng.snapshot(), counts: [...s.tower.col['garrison.count']] };
    assert.deepEqual(s.step([null, draw('a', 'b')]), []);
    assert.deepEqual(s.step([], { events: false }), []);
    assert.deepEqual({ tick: s.tick, rejected: s.rejected, drawSeq: s.drawSeq, troopSeq: s.troopSeq, over: s.over, prng: s.prng.snapshot(), counts: [...s.tower.col['garrison.count']] }, before);
    assert.equal(s.canDraw('p0', 'a', 'b'), 'gameover');
  }
});
test('all seven registered phases execute in order, win after slots; events:false preserves outcomes and rejects', () => {
  const order = [], registry = createComponentRegistry();
  const phases = ['commands', 'generation', 'departures', 'clash', 'arrivals', 'slots', 'win'];
  registry.registerComponent({ name: 'fixture', state: {}, systems: Object.fromEntries(phases.map(phase => [phase, { order: 2, run() { order.push(phase); } }])) });
  const input = level(); input.componentNames.push('fixture'); input.towers[0].components.fixture = {};
  create(input, 0, { registry }).step([]);
  assert.deepEqual(order, phases);
  const visible = create(level({ owners: [0, 0, 0, 0] }), 0), quiet = create(level({ owners: [0, 0, 0, 0] }), 0);
  assert.ok(visible.step([null]).some(e => e.type === 'GameOver'));
  assert.deepEqual(quiet.step([null], { events: false }), []);
  assert.deepEqual(quiet.over, visible.over);
  assert.equal(quiet.rejected, 1);
  assert.equal(quiet.events, null);
});
test('debug asserts transit recount, conservation, int32 scalars; normal steps avoid scanning troop rings', () => {
  const transit = create(level(), 0, { debug: true }); transit.players.transit[0] = 1;
  assert.throws(() => transit.step([]), /transit/i);
  const conservation = create(level(), 0, { debug: true }); conservation.tower.col['garrison.count'][0]--;
  assert.throws(() => conservation.step([]), /conservation/i);
  const range = create(level(), 0, { debug: true }); range.drawSeq = 2147483648;
  assert.throws(() => range.step([]), /int32/i);
  const lazy = create(level({ speed: 0 }), 0); const ch = enqueue(lazy, 0, 1, 0, 0);
  ch.troops.forEach = () => { throw new Error('debug scan ran'); };
  assert.doesNotThrow(() => lazy.step([]));
});
test('debug conservation includes neutral defense, generation, overflow and clash losses without relying on kills', () => {
  const s = create(level({ owners: [0, -1, 0, 1], counts: [49, 1, 5, 5], rate: 40000 }), 0, { debug: true });
  s.step([draw('a', 'b'), { type: 'DrawLine', player: 'p1', from: 'd', to: 'c' }]);
  s.step([]);
  assert.equal(s.tower.owner[1], 0);
  assert.ok(s.players.stats.kills[0] > 0);
  for (let i = 0; i < 5 && !s.over; i++) assert.doesNotThrow(() => s.step([], { events: false }));
});

test('debug rejects int32 overflow before ring writes silently truncate values', () => {
  const s = create(level(), 0, { debug: true });
  assert.throws(() => enqueue(s, 0, 1, 0, 2147483648), /int32/i);
});
test('debug accounting measures every neutral hit and each clash value exactly', () => {
  const input = level({ owners: [0, -1, 0, 1], counts: [49, 1, 5, 5], rate: 40000 });
  input.towers[0].x = 0; input.towers[1].x = 5;
  input.towers[2].x = 10; input.towers[3].x = 15;
  const s = create(input, 0, { debug: true });
  s.step([draw('a', 'b'), draw('c', 'd'), { type: 'DrawLine', player: 'p1', from: 'd', to: 'c' }]);
  s.step([]);
  assert.equal(s.accounting.hits, 1);
  assert.equal(s.accounting.clashes, 2);
  assert.equal(s.accounting.generated, 12);
  assert.equal(s.accounting.initial, 60);
  assert.equal(s.accounting.overflow, 0);
  assert.equal(s.players.stats.kills[0], 3);
  assert.equal(s.players.stats.kills[1], 2); // Neutral defense contributes no opposing player statistic.
});
test('covers R-WIN-01: elimination emits once while other teams continue fighting', () => {
  const s = create(level({ owners: [0, 1, 2, 2], counts: [5, 1, 5, 5], teams: ['human', 'first-bot', 'second-bot'] }), 0);
  enqueue(s, 0, 1, 0, 0);
  assert.deepEqual(s.step([]).filter(e => e.type === 'PlayerEliminated'), [{ type: 'PlayerEliminated', tick: 1, player: 1 }]);
  assert.equal(s.over, null);
  assert.deepEqual([...s.players.alive], [1, 0, 1]);
  assert.ok(!s.step([]).some(e => e.type === 'PlayerEliminated'));
});
test('registered win systems observe enforced slots and refreshed derived capacity', () => {
  let observed;
  const registry = createComponentRegistry();
  registry.registerComponent({ name: 'fixture', state: {}, systems: { win: { order: 0, run(s) { observed = [s.tower.lines[0], s.tower.slots[0]]; } } } });
  const input = level({ speed: 0 }); input.componentNames.push('fixture'); input.towers[0].components.fixture = {};
  const s = create(input, 0, { registry });
  s.step([draw('a', 'b'), draw('a', 'c'), draw('a', 'd')]);
  enqueue(s, 1, 0, 1, 100, 21);
  s.step([]);
  assert.deepEqual(observed, [1, 1]);
});
test('debug conservation accounts discarded hostile leftovers on a valid garrison-only tower', () => {
  const input = level({ owners: [0, -1, 0, 1], counts: [10, 0, 5, 5], rate: 20000 });
  input.towers[1].components = { garrison: { cap: 50 } };
  const s = create(input, 0, { debug: true });
  s.step([draw('a', 'b')]);
  assert.doesNotThrow(() => s.step([]));
  assert.equal(s.tower.owner[1], -1);
  assert.equal(s.tower.col['garrison.count'][1], 0);
  assert.equal(s.accounting.hits, 0);
  assert.equal(s.accounting.overflow, 1);
  assert.equal(s.players.stats.overflowLost[0], 1);
  assert.equal(s.players.transit[0], 1);
});
