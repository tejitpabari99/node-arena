const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const sim = require('../src/index.ts');
const content = require('../../content/src/component-registry.ts');
function level() {
  const components = { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 1125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} };
  return { componentNames: Object.keys(content.COMPONENT_REGISTRY.components).sort(), id: 'test', timeLimitSec: 120, visual: 'city', bounds: { w: 100000, h: 100000 }, globals: { timeLimitSec: 300, theme: 'city' }, simHash: 'identity', botHash: {}, bots: [],
    players: [{ id: 'a', team: 'same', kind: 'human', colorKey: 'red' }, { id: 'b', team: 'same', kind: 'bot', colorKey: 'blue' }, { id: 'c', team: 'other', kind: 'bot', colorKey: 'green' }],
    towers: [{ id: 'a', archetype: 'small', x: 0, y: 0, owner: -1, garrison: 10, visual: 'neutral', footprintRadius: 2125, components: structuredClone(components) }, { id: 'b', archetype: 'small', x: 3000, y: 4000, owner: 1, garrison: 31, visual: 'tower', footprintRadius: 2125, components: structuredClone(components) }, { id: 'c', archetype: 'object', x: -500000, y: -500000, owner: 2, garrison: 0, visual: 'object', footprintRadius: 0, components: {} }],
    kinds: [{ id: 'regular', value: 1, speedMilli: 3001, visual: 'soldier' }] };
}
test('create derives indexed integer columns, strict slot thresholds and visual metadata without touching bots', () => {
  assert.equal(typeof sim.create, 'function');
  const input = level();
  Object.defineProperty(input, 'bots', { get() { throw new Error('bots must be ignored'); } });
  const state = sim.create(input, 123);
  assert.equal(state.tick, 0);
  assert.equal(state.timeLimitTicks, 2400);
  assert.deepEqual([...state.players.team], [0, 0, 1]);
  assert.deepEqual([...state.players.alive], [0, 1, 1]);
  assert.deepEqual([...state.players.transit], [0, 0, 0]);
  assert.deepEqual([...state.tower.owner], [-1, 1, 2]);
  assert.deepEqual([...state.tower.team], [-1, 0, 1]);
  assert.deepEqual([...state.tower.slots], [1, 3, 0]);
  assert.deepEqual([...state.tower.col['garrison.count']], [10, 31, 0]);
  assert.deepEqual([...state.tower.col['garrison.cap']], [50, 50, 0]);
  assert.deepEqual([...state.tower.col['generates.acc']], [0, 0, 0]);
  assert.deepEqual([...state.tower.col['generates.ratePerSec']], [1125, 1125, 0]);
  assert.deepEqual([...state.tower.col['generates.troop']], [0, 0, 0]);
  state.towerParams[0].drawsLines.extraSlotAbove.push(99);
  assert.deepEqual(input.towers[0].components.drawsLines.extraSlotAbove, [10, 30]);
  assert.deepEqual([...state.componentTowers.get('garrison')], [0, 1]);
  assert.equal(state.towerStatic[0].visual, 'neutral');
  assert.deepEqual(state.towerStatic[0].components, ['capturable', 'drawsLines', 'garrison', 'generates']);
  assert.deepEqual(state.kinds, [{ id: 'regular', value: 1, speedPerTick: 3001, visual: 'soldier' }]);
  assert.deepEqual(state.ids, { players: ['a', 'b', 'c'], towers: ['a', 'b', 'c'] });
  assert.equal(state.players.colorKey[1], 'blue');
  assert.equal(state.visual, 'city');
  assert.equal(state.lengths[1], 100000);
  assert.equal(state.lengths[3], 100000);
  assert.equal(state.lengths[2], 14142135);
  assert.equal(state.channels.filter(Boolean).length, 0);
  assert.deepEqual(state.prng.snapshot(), new sim.Sfc32(123).snapshot());
  state.tower.col['garrison.count'][0] = 0;
  assert.equal(input.towers[0].garrison, 10);
});
test('registry parity rejects missing, extra and unknown level components; fixture injection matches its own content', () => {
  assert.equal(typeof sim.createComponentRegistry, 'function');
  const registry = sim.createComponentRegistry();
  assert.doesNotThrow(() => registry.assertParity(Object.keys(content.COMPONENT_REGISTRY.components)));
  assert.throws(() => registry.assertParity([]), /parity/i);
  registry.registerComponent({ name: 'shoots', state: { acc: 7 }, systems: { generation: { order: 1, run: () => {} } } });
  assert.throws(() => sim.create(level(), 0, { registry }), /parity/i);
  const fixtureContent = { ...content.COMPONENT_REGISTRY, components: { ...content.COMPONENT_REGISTRY.components, shoots: { params: {}, ruleIds: [] } } };
  const fixture = level(); fixture.componentNames = Object.keys(fixtureContent.components); fixture.towers[1].components.shoots = {};
  const state = sim.create(fixture, 0, { registry });
  assert.deepEqual([...state.componentTowers.get('shoots')], [1]);
  assert.deepEqual([...state.tower.col['shoots.acc']], [0, 7, 0]);
  assert.equal(state.systems.generation.at(-1).component, 'shoots');
  const bad = level(); bad.towers[0].components.unknown = {};
  assert.throws(() => sim.create(bad, 0), /unknown component/i);
  assert.throws(() => registry.registerComponent({ name: 'shoots', state: {} }), /duplicate/i);
});
test('lazy channels keep FIFO data through wrap, growth, partial front consumption and line cutting', () => {
  assert.equal(typeof sim.create, 'function');
  const state = sim.create(level(), 0);
  const channel = state.ensureChannel(0, 1);
  assert.equal(channel, state.ensureChannel(0, 1));
  assert.equal(channel.key, 1);
  assert.equal(channel.length, 100000);
  const q = channel.troops;
  for (let i = 0; i < 40; i++) q.push({ p0: i, t0: i, owner: 1, kind: 0, seq: i, value: 2 });
  assert.equal(q.consumeFront(1), 1);
  assert.equal(q.front().value, 1);
  assert.equal(q.front().seq, 0);
  assert.equal(q.consumeFront(8), 1);
  for (let i = 1; i < 30; i++) { assert.equal(q.front().seq, i); q.shift(); }
  for (let i = 40; i < 100; i++) q.push({ p0: i, t0: i, owner: 1, kind: 0, seq: i, value: 2 });
  channel.drawn = 1; channel.drawn = 0;
  assert.equal(q.size, 70);
  for (let i = 30; i < 100; i++) { assert.deepEqual(q.front(), { p0: i, t0: i, owner: 1, kind: 0, seq: i, value: 2 }); q.shift(); }
  assert.equal(q.front(), undefined);
  assert.equal(q.consumeFront(1), 0);
  assert.throws(() => state.ensureChannel(0, 0), /channel/i);
  assert.throws(() => state.ensureChannel(-1, 0), /channel/i);
});

test('the shipped sample crosses the real content compiler boundary into create', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const api = require('../../content/src/index.ts');
  const root = path.resolve(__dirname, '../../content');
  const files = { 'content.json': JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')) };
  for (const entry of fs.readdirSync(path.join(root, 'data'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(root, file)] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const compiled = api.compileLevel(api.loadContent(files), 'sample');
  const state = sim.create(compiled, 0);
  assert.deepEqual([...state.tower.owner], [1, 0, -1]);
  assert.deepEqual([...state.tower.col['garrison.count']], [10, 10, 15]);
  assert.equal(state.lengths[1], 1600000);
  assert.equal(state.kinds[0].speedPerTick, 10000);
  assert.equal(state.timeLimitTicks, 6000);
  assert.equal(api.hashCompiledLevel({ ...compiled, componentNames: ['fixture'] }), compiled.simHash);
  assert.throws(() => sim.create({ ...compiled, componentNames: ['garrison'] }, 0), /parity/i);
});
