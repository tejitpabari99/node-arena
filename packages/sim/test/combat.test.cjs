const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
function level({ owners = [0, 1, 0, 1], counts = [0, 0, 0, 0], cap = 50, speed = 0, rate = 0 } = {}) {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'combat', timeLimitSec: 100, visual: '', bots: [],
    players: ['p0', 'p1'].map((id, i) => ({ id, team: id, kind: i ? 'bot' : 'human', colorKey: id })),
    towers: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 5, y: 0, owner: owners[i], garrison: counts[i], archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap }, generates: { troop: 0, ratePerSec: rate }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: speed, visual: '' }, { id: 'tank', value: 2, speedMilli: speed, visual: '' }] };
}
function troop(s, from, to, owner, p0, value = 1, t0 = 0) {
  const ch = s.ensureChannel(from, to);
  ch.troops.push({ p0, t0, owner, kind: value === 2 ? 1 : 0, seq: ++s.troopSeq, value });
  s.players.transit[owner] += value;
  return ch;
}
const draw = (from, to, player = 'p0') => ({ type: 'DrawLine', player, from, to });
test('covers R-CMB-01: cut fronts clash at equality, tank retains value and loop stops at next unready front', () => {
  const s = create(level(), 0);
  const a = troop(s, 0, 1, 0, 60, 2), b = troop(s, 1, 0, 1, 40);
  troop(s, 1, 0, 1, 39);
  const events = s.step([]);
  assert.deepEqual(events, [{ type: 'Clash', tick: 1, channel: 1, progA: 60, progB: 40, value: 1 }]);
  assert.equal(a.troops.front().value, 1);
  assert.equal(b.troops.front().p0, 39);
  assert.deepEqual([...s.players.transit], [1, 1]);
  assert.deepEqual([...s.players.stats.kills], [1, 1]);
  b.troops.consumeFront(1); s.players.transit[1]--;
  troop(s, 1, 0, 1, 40);
  assert.equal(s.step([])[0].value, 1);
  assert.equal(a.troops.size, 0);
  assert.equal(b.troops.size, 0);
  assert.equal(s.channels[1], a);
});
test('covers R-CMB-01: clash repeats qualifying fronts and reports canonical own-source progress', () => {
  const s = create(level(), 0);
  troop(s, 0, 1, 0, 70, 2); troop(s, 0, 1, 0, 50);
  troop(s, 1, 0, 1, 60); troop(s, 1, 0, 1, 50, 2);
  assert.deepEqual(s.step([]), [
    { type: 'Clash', tick: 1, channel: 1, progA: 70, progB: 60, value: 1 },
    { type: 'Clash', tick: 1, channel: 1, progA: 70, progB: 50, value: 1 },
    { type: 'Clash', tick: 1, channel: 1, progA: 50, progB: 50, value: 1 },
  ]);
  assert.deepEqual([...s.players.transit], [0, 0]);
  assert.deepEqual([...s.players.stats.kills], [3, 3]);
});
test('covers R-ENT-04 R-CMB-01: friendly mixed fronts block later hostile fronts and crossing pairs never clash', () => {
  const s = create(level(), 0);
  troop(s, 0, 1, 0, 60); troop(s, 0, 1, 1, 60);
  troop(s, 1, 0, 0, 40); troop(s, 1, 0, 1, 40);
  troop(s, 2, 3, 1, 60);
  assert.deepEqual(s.step([]), []);
  assert.deepEqual([...s.players.transit], [2, 3]);
  const allied = level(); allied.players[1].team = 'p0';
  const t = create(allied, 0); troop(t, 0, 1, 0, 60); troop(t, 1, 0, 1, 40);
  assert.deepEqual(t.step([]), []);
});
test('covers R-CMB-02 R-CMB-03: overshoot order re-evaluates later arrivals through capture and recapture', () => {
  const s = create(level({ counts: [0, 1, 0, 0] }), 0);
  troop(s, 0, 1, 0, 109); troop(s, 0, 1, 0, 106);
  troop(s, 3, 1, 1, 202);
  const events = s.step([]);
  assert.deepEqual(events.map(e => [e.type, e.owner ?? e.to, e.effect]), [
    ['TroopArrived', 0, 'hit'], ['Captured', 0, undefined],
    ['TroopArrived', 0, 'reinforce'], ['TroopArrived', 1, 'hit'], ['Captured', 1, undefined],
  ]);
  assert.equal(s.tower.owner[1], 1);
  assert.equal(s.tower.col['garrison.count'][1], 0);
  assert.deepEqual([...s.players.transit], [0, 0]);
  assert.deepEqual([...s.players.stats.captures], [1, 1]);
  assert.deepEqual([...s.players.stats.kills], [2, 2]);
});
test('covers R-CMB-02: exact arrival ties use channel key then FIFO, independent of troop sequence', () => {
  const s = create(level({ counts: [0, 1, 0, 0] }), 0);
  troop(s, 2, 1, 1, 110);
  const ch = troop(s, 0, 1, 0, 110); troop(s, 0, 1, 1, 110);
  const events = s.step([]);
  assert.deepEqual(events.filter(e => e.type === 'TroopArrived').map(e => [e.owner, e.effect]), [[0, 'hit'], [1, 'hit'], [1, 'reinforce']]);
  assert.equal(ch.troops.size, 0);
  assert.equal(s.tower.owner[1], 1);
  assert.equal(s.tower.col['garrison.count'][1], 2);
});
test('covers R-CAP-01 R-CMB-03: tank leftover capture bounds garrison and accounts overflow and neutral hostility', () => {
  for (const [count, cap, want, lost, kills] of [[1, 50, 1, 0, 1], [0, 1, 1, 1, 0], [2, 50, 0, 0, 2]]) {
    const s = create(level({ owners: [0, -1, 0, 1], counts: [0, count, 0, 0], cap }), 0);
    troop(s, 0, 1, 0, 100, 2);
    s.step([]);
    assert.equal(s.tower.owner[1], 0);
    assert.equal(s.tower.team[1], 0);
    assert.equal(s.tower.col['garrison.count'][1], want);
    assert.equal(s.players.stats.overflowLost[0], lost);
    assert.equal(s.players.stats.kills[0], kills);
    assert.equal(s.players.stats.captures[0], 1);
    assert.equal(s.players.transit[0], 0);
  }
});
test('covers R-CAP-01 R-ENT-04: same-team arrivals reinforce with excess counted to troop owner', () => {
  const input = level({ counts: [0, 49, 0, 0] }); input.players[1].team = 'p0';
  const s = create(input, 0);
  troop(s, 0, 1, 0, 100, 2);
  assert.deepEqual(s.step([]), [{ type: 'TroopArrived', tick: 1, tower: 1, owner: 0, effect: 'overflow' }]);
  assert.equal(s.tower.col['garrison.count'][1], 50);
  assert.equal(s.tower.owner[1], 1);
  assert.equal(s.players.stats.overflowLost[0], 1);
  assert.deepEqual([...s.players.stats.kills], [0, 0]);
});
test('covers R-CPT-01 R-CPT-02: capture cuts old outgoing permission, resets registered state and preserves transit', () => {
  const s = create(level({ counts: [0, 1, 0, 0], rate: 1500 }), 0);
  s.step([draw('b', 'd', 'p1')]);
  const outgoing = troop(s, 1, 3, 1, 0);
  s.tower.col['drawsLines.cursor'][1] = 3;
  const incoming = troop(s, 0, 1, 0, 100);
  const events = s.step([]);
  assert.equal(outgoing.drawn, 0);
  assert.equal(outgoing.troops.front().owner, 1);
  assert.equal(outgoing.troops.size, 1);
  assert.equal(incoming.troops.size, 0);
  assert.equal(s.tower.lines[1], 0);
  assert.equal(s.tower.col['generates.acc'][1], 0);
  assert.equal(s.tower.col['drawsLines.cursor'][1], -1);
  assert.deepEqual(events.filter(e => e.type === 'LineCut'), [{ type: 'LineCut', tick: 2, channel: 7, reason: 'captured' }]);
  assert.deepEqual([...s.players.transit], [0, 1]);
});
test('covers R-TCK-05 R-ENT-02 R-LIN-05: analytic motion leaves in-flight bases unchanged and new departures at zero', () => {
  const s = create(level({ speed: 20, counts: [0, 3, 0, 0] }), 0);
  const ch = troop(s, 0, 1, 0, 0);
  const base = ch.troops.front();
  for (let i = 0; i < 4; i++) assert.deepEqual(s.step([]), []);
  assert.deepEqual(ch.troops.front(), base);
  assert.equal(s.step([])[0]?.effect, 'hit');
  assert.equal(s.tower.col['garrison.count'][1], 2);
  const moving = create(level({ speed: 100, rate: 20000 }), 0);
  const events = moving.step([draw('a', 'b')]);
  assert.ok(!events.some(e => e.type === 'TroopArrived'));
  assert.equal(moving.channels[1].troops.front().t0, 1);
});
test('registry hooks control arrival mechanics without core knowledge of component names', () => {
  const registry = createComponentRegistry();
  registry.registerComponent({ name: 'shoots', state: { received: 0 }, hooks: { onArrive(s, i, troop) { s.tower.col['shoots.received'][i] += troop.value; } } });
  const input = level(); input.componentNames.push('shoots'); input.towers[1].components = { shoots: {} };
  const s = create(input, 0, { registry }); troop(s, 0, 1, 0, 100, 2);
  s.step([]);
  assert.equal(s.tower.col['shoots.received'][1], 2);
  assert.equal(s.tower.owner[1], 1);
  assert.equal(s.players.transit[0], 0);
});
test('value conservation across clash, hit, reinforcement, cap overflow and events:false', () => {
  function run(events) {
    const s = create(level({ counts: [0, 1, 0, 49] }), 0);
    troop(s, 0, 1, 0, 70, 2); troop(s, 1, 0, 1, 30);
    troop(s, 2, 1, 0, 100, 2); troop(s, 1, 3, 1, 200, 2);
    assert.deepEqual([...s.players.transit], [4, 3]);
    const log = s.step([], { events });
    assert.deepEqual([...s.players.transit], [1, 0]);
    assert.deepEqual([...s.tower.col['garrison.count']], [0, 1, 0, 50]);
    assert.deepEqual([...s.players.stats.kills], [2, 2]);
    assert.deepEqual([...s.players.stats.overflowLost], [0, 1]);
    // Initial 50 + in-flight 7 = garrison 51 + transit 1 + hit 2 + clash 2 + overflow 1.
    const remaining = [...s.tower.col['garrison.count']].reduce((a, b) => a + b, 0) + [...s.players.transit].reduce((a, b) => a + b, 0);
    const overflow = [...s.players.stats.overflowLost].reduce((a, b) => a + b, 0);
    assert.equal(57, remaining + 2 + 2 + overflow);
    return log;
  }
  assert.equal(run(true).filter(e => e.type === 'Clash').length, 1);
  assert.deepEqual(run(false), []);
});

test('registered clash and arrival systems run around core queues in phase order', () => {
  const registry = createComponentRegistry();
  registry.registerComponent({ name: 'shoots', state: { afterClash: -1, afterArrival: -1 }, systems: {
    clash: { order: 0, run(s, towers) { for (const i of towers) s.tower.col['shoots.afterClash'][i] = s.players.transit[0]; } },
    arrivals: { order: 0, run(s, towers) { for (const i of towers) s.tower.col['shoots.afterArrival'][i] = s.players.transit[0]; } },
  } });
  const input = level(); input.componentNames.push('shoots'); input.towers[0].components.shoots = {};
  const s = create(input, 0, { registry });
  troop(s, 0, 1, 0, 70); troop(s, 1, 0, 1, 30); troop(s, 0, 3, 0, 300);
  s.step([]);
  assert.equal(s.tower.col['shoots.afterClash'][0], 1);
  assert.equal(s.tower.col['shoots.afterArrival'][0], 0);
});
