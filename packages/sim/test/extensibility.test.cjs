const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
const { PHASES } = require('../src/registry.ts');

function level() {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'extensibility', timeLimitSec: 100, visual: '', bots: [],
    players: ['p0', 'p1'].map((id, i) => ({ id, team: id, kind: i ? 'bot' : 'human', colorKey: id })),
    towers: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 5, y: 0, owner: i % 2, garrison: 0, archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 0 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 0, visual: '' }, { id: 'tank', value: 2, speedMilli: 0, visual: '' }] };
}
function troop(s, from, to, owner, progress, kind = 1) {
  const channel = s.ensureChannel(from, to);
  const value = s.kinds[kind].value;
  channel.troops.push({ p0: progress, t0: 0, owner, kind, seq: ++s.troopSeq, value });
  s.players.transit[owner] += value;
  // Fixture-supplied value enters conservation as initial inventory.
  s.accounting.initial += value;
  return channel;
}
function installShoots(input, observed) {
  const registry = createComponentRegistry();
  registry.registerPhase('ranged', { after: 'clash' });
  registry.registerComponent({ name: 'shoots', state: { acc: 0 }, systems: { ranged: { order: 0, run(s, towers) {
    observed.push(['ranged', s.accounting.clashes, s.tower.col['garrison.count'][3]]);
    for (const i of towers) s.tower.col['shoots.acc'][i]++;
    const channel = s.channels[3];
    if (channel) {
      const removed = s.killFront(channel, 1);
      s.accounting.overflow += removed;
    }
  } } } });
  input.componentNames.push('shoots');
  input.towers[0].components.shoots = {};
  return registry;
}

test('shoots fixture runs after clash and before arrivals, removes real value and adds automatically hashed/snapshotted state', () => {
  const input = level(), observed = [];
  input.towers[3].garrison = 5;
  const registry = installShoots(input, observed);
  const s = create(input, 7, { registry, debug: true });
  troop(s, 0, 1, 0, 60); troop(s, 1, 0, 1, 40, 0);
  const shot = troop(s, 0, 3, 0, 300);
  const events = s.step([]);
  assert.deepEqual(observed, [['ranged', 1, 5]]);
  assert.deepEqual(events.map(e => [e.type, e.value ?? e.effect]), [['Clash', 1], ['TroopArrived', 'hit']]);
  assert.equal(shot.troops.size, 0);
  assert.equal(s.tower.col['garrison.count'][3], 4); // Shot reduced tank to one before its hit.
  assert.deepEqual([...s.players.transit], [1, 0]);
  assert.equal(s.accounting.overflow, 1);
  assert.deepEqual(s.snapshot().tower.col['shoots.acc'], [1, 0, 0, 0]);
  const hash = s.hash(), snapshot = s.snapshot();
  s.tower.col['shoots.acc'][0]++;
  assert.notEqual(s.hash(), hash);
  assert.deepEqual(snapshot.tower.col['shoots.acc'], [1, 0, 0, 0]);
  assert.deepEqual(s.snapshot().tower.col['shoots.acc'], [2, 0, 0, 0]);
});

test('killFront caps removal at one remaining front and decrements its owner transit without assigning a cause', () => {
  const s = create(level(), 0, { debug: true });
  assert.equal(typeof s.killFront, 'function');
  const channel = troop(s, 0, 1, 1, 0);
  troop(s, 0, 1, 0, 0);
  assert.equal(s.killFront(channel, 0), 0);
  assert.equal(s.killFront(channel, 1), 1);
  assert.equal(channel.troops.front().value, 1);
  assert.equal(channel.troops.front().owner, 1);
  assert.deepEqual([...s.players.transit], [2, 1]);
  assert.equal(s.killFront(channel, 99), 1);
  assert.equal(channel.troops.front().owner, 0);
  assert.equal(channel.troops.size, 1);
  assert.deepEqual([...s.players.transit], [2, 0]);
  assert.equal(s.killFront(channel, 99), 2);
  assert.equal(s.killFront(channel, 99), 0);
  assert.deepEqual([...s.players.transit], [0, 0]);
  assert.equal(s.accounting.overflow, 0);
  for (const value of [-1, 0.5, NaN]) assert.throws(() => s.killFront(channel, value), /integer/i);
  s.accounting.overflow += 4;
  assert.doesNotThrow(() => s.step([]));
});

test('phase extensions reject typos/duplicates and stay isolated from v1 and already-created simulations', () => {
  const registry = createComponentRegistry();
  assert.throws(() => registry.registerComponent({ name: 'bad', state: {}, systems: { ranged: { order: 0, run() {} } } }), /unknown phase/i);
  assert.throws(() => registry.registerPhase('ranged', { after: 'typo' }), /unknown phase/i);
  assert.throws(() => registry.registerPhase('', { after: 'clash' }), /invalid phase/i);
  assert.throws(() => registry.registerPhase('clash', { after: 'generation' }), /duplicate phase/i);
  const plain = level(); plain.kinds.length = 1;
  const baseline = create(plain, 3), existing = create(plain, 3, { registry });
  registry.registerPhase('ranged', { after: 'clash' });
  assert.throws(() => registry.registerPhase('ranged', { after: 'arrivals' }), /duplicate phase/i);
  assert.deepEqual(PHASES, ['commands', 'generation', 'departures', 'clash', 'arrivals', 'slots', 'win']);
  assert.deepEqual(existing.phases, PHASES);
  assert.deepEqual(create(plain, 3, { registry }).phases, ['commands', 'generation', 'departures', 'clash', 'ranged', 'arrivals', 'slots', 'win']);
  registry.registerComponent({ name: 'bad', state: {}, systems: { ranged: { order: 0, run() { throw new Error('must not leak'); } } } });
  assert.throws(() => create(plain, 3, { registry }), /parity/i);
  const freshDefault = create(plain, 3);
  for (let tick = 0; tick < 5; tick++) {
    baseline.step([]); existing.step([]); freshDefault.step([]);
    assert.equal(existing.hash(), baseline.hash());
    assert.equal(freshDefault.hash(), baseline.hash());
    assert.equal(createComponentRegistry().definitions().length, 4);
  }
});

test('test-only tank value two reinforces, hits and captures leftover through the existing component hooks', () => {
  for (const [owner, count, wantOwner, wantCount, effect] of [[0, 3, 0, 5, 'reinforce'], [1, 3, 1, 1, 'hit'], [1, 1, 0, 1, 'hit']]) {
    const input = level(); input.towers[1].owner = owner; input.towers[1].garrison = count;
    const s = create(input, 0, { debug: true });
    troop(s, 0, 1, 0, 100);
    const events = s.step([]);
    assert.equal(events[0].effect, effect);
    assert.equal(s.tower.owner[1], wantOwner);
    assert.equal(s.tower.col['garrison.count'][1], wantCount);
    assert.equal(events.some(e => e.type === 'Captured'), owner !== wantOwner);
    assert.equal(s.players.transit[0], 0);
  }
});

test('test-only tank fronts survive partial clash then repeat clash with remaining value', () => {
  const s = create(level(), 0, { debug: true });
  const forward = troop(s, 0, 1, 0, 60);
  troop(s, 1, 0, 1, 40, 0);
  assert.equal(s.step([]).filter(e => e.type === 'Clash').length, 1);
  assert.equal(forward.troops.front().value, 1);
  assert.equal(forward.troops.front().kind, 1);
  troop(s, 0, 1, 0, 60);
  troop(s, 1, 0, 1, 40);
  const events = s.step([]).filter(e => e.type === 'Clash');
  assert.deepEqual(events.map(e => e.value), [1, 1]);
  assert.equal(forward.troops.front().value, 1);
  assert.deepEqual([...s.players.transit], [1, 0]);
  assert.equal(s.accounting.clashes, 3);
});
