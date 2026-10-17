const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
const content = require('../../content/src/index.ts');
const { hashFixture } = require('../../content/test/hash-fixture.ts');

// Hand-built fixtures keep expected mechanics independent of compilation/helpers.
function level({ rate = 0, count = 12, speed = 3001 } = {}) {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'rules', timeLimitSec: 300,
    visual: '', bots: [], players: ['p0', 'p1'].map((id, i) => ({ id, team: id, kind: i ? 'bot' : 'human', colorKey: id })),
    towers: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 6002, y: 0, owner: i === 1 ? 1 : 0,
      garrison: count, archetype: 'standard', visual: 'tower', footprintRadius: 1000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: rate }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: speed, visual: 'soldier' }] };
}
const draw = (from, to, player = 'p0') => ({ type: 'DrawLine', player, from, to });
const cut = (from, to, player = 'p0') => ({ type: 'CutLine', player, from, to });
function advance(sim, n) { for (let i = 0; i < n; i++) sim.step([]); }
function buffer(n = 100) { return Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(key => [key, new Int32Array(n)])); }
const counts = sim => [...sim.view.tower.col['garrison.count']];
function compiled(files) { return content.compileLevel(content.loadContent(files), 'sample'); }

// Break caught: driver batching or reading state advances time / consumes RNG.
test('covers R-TCK-01: pause is inert and twenty scheduled steps equal one simulated second', () => {
  const normal = create(level({ rate: 1000 }), 73), accelerated = create(level({ rate: 1000 }), 73);
  const paused = normal.hash();
  for (let i = 0; i < 10; i++) { normal.view; normal.snapshot(); normal.readTroops(buffer()); }
  assert.equal(normal.hash(), paused);
  advance(normal, 19);
  assert.equal(normal.tick, 19); assert.equal(counts(normal)[0], 12);
  normal.step([]); assert.equal(normal.tick, 20); assert.equal(counts(normal)[0], 13);
  for (let batch = 0; batch < 10; batch++) advance(accelerated, 2);
  assert.equal(accelerated.hash(), normal.hash());
  assert.deepEqual(normal.snapshot().prng, create(level(), 73).snapshot().prng);
});

// Break caught: progress rounds speed or advances newly departed troops.
test('covers R-TCK-04: E-TICK speed 3.001 over length 6.002 arrives after exactly forty elapsed ticks', () => {
  const sim = create(level({ rate: 20000 }), 0), out = buffer();
  sim.step([draw('a', 'b')]);
  assert.equal(sim.view.lines[0].length, 120040);
  assert.equal(sim.readTroops(out), 1); assert.equal(out.progress[0], 0);
  sim.step([cut('a', 'b')]); assert.equal(out.progress[0], 0); // caller storage is a snapshot
  assert.equal(sim.readTroops(out), 1); assert.equal(out.progress[0], 3001);
  advance(sim, 38); assert.equal(sim.readTroops(out), 1); assert.equal(out.progress[0], 117039);
  const events = sim.step([]);
  assert.equal(sim.readTroops(out), 0);
  assert.deepEqual(events.filter(e => e.type === 'TroopArrived').map(e => [e.tower, e.owner, e.effect]), [[1, 0, 'hit']]);
});

// Break caught: neutral generation, or an absent component gains mechanics.
test('covers R-GEN-01: E-GENERATION produces only for owned generating towers', () => {
  const input = level({ rate: 1500 }); input.towers[2].owner = -1;
  input.towers[3].components = { garrison: { cap: 50 } };
  const sim = create(input, 0);
  advance(sim, 13); assert.deepEqual(counts(sim), [12, 12, 12, 12]);
  sim.step([]); assert.deepEqual(counts(sim), [13, 13, 12, 12]);
  assert.deepEqual([...sim.view.tower.col['generates.acc']], [1000, 1000, 0, 0]);
});

// Break caught: drawing dispatches stored stack or line permission expires without input.
test('covers R-SND-01: E-GENERATION persists sending at shared rate with a frozen starting stack', () => {
  const sim = create(level({ rate: 1500 }), 0);
  sim.step([draw('a', 'c'), draw('a', 'b')]);
  advance(sim, 39);
  const shot = sim.snapshot();
  assert.equal(counts(sim)[0], 12);
  assert.deepEqual(sim.view.lines.map(l => l.to), [1, 2]);
  assert.deepEqual(shot.channels.map(ch => ch.troops.map(t => t.seq)), [[1, 3], [2]]);
  assert.equal(sim.view.players[0].transit, 3);
  assert.equal(sim.view.players[0].stats.generated, 9); // three owned generators each emit three
});

// Break caught: missing registry entry, unsupported authored component, or implicit capturability.
test('covers R-ENT-01: every v1 component registers and absent capabilities stay absent', () => {
  const names = createComponentRegistry().definitions().map(component => component.name);
  assert.deepEqual(names, ['capturable', 'drawsLines', 'garrison', 'generates']);
  assert.doesNotThrow(() => createComponentRegistry().assertParity(Object.keys(content.COMPONENT_REGISTRY.components)));
  assert.throws(() => create(level(), 0, { registry: new (require('../src/index.ts').ComponentRegistry)() }), /parity/);
  const invalid = hashFixture(); invalid['data/archetypes/standard.json'].components.shoots = { ratePerSec: 1, radius: 1, targeting: 'nearestHostile' };
  assert.throws(() => content.loadContent(invalid), content.ContentLoadError);
  const input = level({ rate: 20000 }); input.towers[1].garrison = 0;
  input.towers[1].components = { garrison: { cap: 50 } };
  const sim = create(input, 0);
  assert.equal(sim.canDraw('p1', 'b', 'a'), 'no-component');
  sim.step([draw('a', 'b')]); sim.step([cut('a', 'b')]); advance(sim, 39);
  assert.equal(sim.view.tower.owner[1], 1); assert.equal(counts(sim)[1], 0);
  assert.equal(sim.view.towerStatic[1].archetype, 'standard');
});

// Break caught: unsupported troop values accepted, or presentation enters mechanics/identity.
test('covers R-ENT-02: unit troops use their kind while presentation leaves mechanics and identity unchanged', () => {
  for (const value of [0, 2]) {
    const invalid = hashFixture(); invalid['data/troops/regular.json'].value = value;
    assert.throws(() => content.loadContent(invalid), content.ContentLoadError);
  }
  const files = hashFixture(), decorated = structuredClone(files);
  decorated['data/troops/regular.json'].visual = 'other-soldier';
  decorated['data/archetypes/standard.json'].visual = 'other-tower';
  decorated['data/levels/sample.json'].name = 'Other name';
  decorated['data/levels/sample.json'].players[0].colorKey = 'other-color';
  const a = compiled(files), b = compiled(decorated);
  assert.equal(a.simHash, b.simHash); assert.notEqual(a.kinds[0].visual, b.kinds[0].visual);
  const first = create(a, 9), second = create(b, 9);
  const command = draw('t1', 't2', 'p1');
  assert.deepEqual(first.step([command]), second.step([command]));
  for (let i = 0; i < 100; i++) { assert.deepEqual(first.step([]), second.step([])); assert.equal(first.hash(), second.hash()); }
});

// Break caught: cutting destroys FIFO/channel or permits further spawns.
test('covers R-ENT-03: E-CUT retains channel FIFO and departure owner after permission is removed', () => {
  const sim = create(level({ rate: 20000 }), 0);
  sim.step([draw('a', 'b')]); sim.step([]);
  const line = sim.view.lines[0]; assert.deepEqual([line.from, line.to, line.owner, line.drawSeq], [0, 1, 0, 1]);
  sim.step([cut('a', 'b')]);
  assert.deepEqual(sim.view.lines, []);
  assert.deepEqual(sim.snapshot().channels[0].troops.map(t => [t.owner, t.kind, t.seq, t.value]), [[0, 0, 1, 1], [0, 0, 2, 1]]);
  const out = buffer(); assert.equal(sim.readTroops(out), 2);
  assert.deepEqual([...out.progress.subarray(0, 2)], [6002, 3001]);
  advance(sim, 39); assert.equal(sim.readTroops(out), 0);
});

// Break caught: geometric crossings are treated as an opposed channel pair.
test('covers R-LIN-04: straight crossing paths pass through each other without combat or blocking', () => {
  const input = level({ rate: 20000, speed: 100 });
  input.towers.forEach((tower, i) => { tower.owner = i < 2 ? 0 : 1; });
  [[-5, 0], [5, 0], [0, -5], [0, 5]].forEach(([x, y], i) => { input.towers[i].x = x; input.towers[i].y = y; });
  const sim = create(input, 0), events = [];
  events.push(...sim.step([draw('a', 'b'), draw('c', 'd', 'p1')]));
  assert.deepEqual(sim.view.lines.map(l => l.length), [200, 200]);
  events.push(...sim.step([cut('a', 'b'), cut('c', 'd', 'p1')]));
  events.push(...sim.step([]));
  assert.equal(events.filter(e => e.type === 'Clash').length, 0);
  assert.deepEqual(events.filter(e => e.type === 'TroopArrived').map(e => [e.tower, e.effect]), [[1, 'reinforce'], [3, 'reinforce']]);
  assert.deepEqual(sim.view.players.map(p => p.transit), [0, 0]);
  for (const key of ['obstacles', 'mapObjects']) {
    const invalid = hashFixture(); invalid['data/levels/sample.json'][key] = [{ kind: 'wall', pos: { x: 0, y: 0 }, hp: 1 }];
    assert.throws(() => content.loadContent(invalid), content.ContentLoadError);
  }
});

// Break caught: loader drops/defaults fixed-point params or compiler ignores data edits.
test('data changes alone alter generation, speed, position, capacity and strict slot thresholds', () => {
  const files = hashFixture();
  files['data/archetypes/standard.json'].components.generates.ratePerSec = 1;
  files['data/archetypes/standard.json'].footprintRadius = 1;
  files['data/troops/regular.json'].speed = 3.001;
  files['data/levels/sample.json'].towers[0].pos = { x: 0, y: 0 };
  files['data/levels/sample.json'].towers[1].pos = { x: 6.002, y: 0 };
  const base = compiled(files);
  const tune = edit => { const next = structuredClone(files); edit(next); const result = compiled(next); assert.notEqual(result.simHash, base.simHash); return result; };
  const rate = tune(f => { f['data/archetypes/standard.json'].components.generates.ratePerSec = 2; });
  const normal = create(base, 0), faster = create(rate, 0); advance(normal, 20); advance(faster, 20);
  assert.equal(counts(normal)[1], 16); assert.equal(counts(faster)[1], 17);
  const speed = tune(f => { f['data/troops/regular.json'].speed = 6.002; });
  const position = tune(f => { f['data/levels/sample.json'].towers[1].pos.x = 3.001; });
  for (const [data, steps, expected] of [[base, 39, 17], [speed, 19, 16], [position, 19, 16]]) {
    const sim = create(data, 0); sim.step([draw('t1', 't2', 'p1')]); advance(sim, 19); // first departure at tick 20
    assert.equal(sim.readTroops(buffer()), 1);
    sim.step([cut('t1', 't2', 'p1')]); advance(sim, steps - 1);
    assert.equal(counts(sim)[1], expected); // target generation before the arrival boundary
    const arrived = sim.step([]).filter(e => e.type === 'TroopArrived');
    assert.equal(arrived.length, 1); assert.equal(arrived[0].effect, 'hit');
  }
  const cap = tune(f => { f['data/archetypes/standard.json'].components.garrison.cap = 16; });
  const capped = create(cap, 0); advance(capped, 60); assert.equal(counts(capped)[1], 16);
  const uncapped = create(base, 0); advance(uncapped, 60); assert.equal(counts(uncapped)[1], 18);
  const thresholds = tune(f => { f['data/archetypes/standard.json'].components.drawsLines.extraSlotAbove = [9, 30]; });
  assert.equal(create(base, 0).view.tower.slots[0], 1); assert.equal(create(thresholds, 0).view.tower.slots[0], 2);
});

test('covers R-TCK-02: public loader enforces three decimal places and compiles milli-units', () => {
  const files = hashFixture(); files['data/troops/regular.json'].speed = 3.001;
  assert.equal(compiled(files).kinds[0].speedMilli, 3001);
  files['data/troops/regular.json'].speed = 3.0001;
  assert.throws(() => content.loadContent(files), content.ContentLoadError);
});

test('covers R-WIN-03: compiler selects explicit duration or balance default for the public timer', () => {
  const files = hashFixture(); files['data/balance.json'].defaults.timeLimitSec = 7;
  assert.equal(create(compiled(files), 0).view.timeLimitTicks, 140);
  files['data/levels/sample.json'].timeLimitSec = 2;
  const sim = create(compiled(files), 0); assert.equal(sim.view.timeLimitTicks, 40);
  advance(sim, 39); assert.equal(sim.view.over, null);
  sim.step([]); assert.deepEqual(sim.view.over, { outcome: 'timeout', winnerTeam: null });
  const hash = sim.hash(); sim.step([draw('t1', 't2', 'p1')]); assert.equal(sim.hash(), hash);
});

// Break caught: equality earns an extra slot instead of requiring strictly greater count.
test('covers R-LIN-02: E-SLOTS grants 1, 2, 2, 3 slots at counts 10, 11, 30, 31', () => {
  for (const [count, slots] of [[10, 1], [11, 2], [30, 2], [31, 3]]) {
    const sim = create(level({ count }), 0);
    sim.step([]); assert.equal(sim.view.tower.slots[0], slots);
    assert.equal(sim.view.tower.lines[0], 0);
  }
});

test('covers R-ENT-04: compiled default teams and human/bot commands use identical ownership validation', () => {
  const files = hashFixture();
  files['data/levels/sample.json'].players.reverse(); files['data/levels/sample.json'].towers.reverse();
  const data = compiled(files);
  assert.deepEqual(data.players.map(p => [p.id, p.team]), [['b1', 'b1'], ['p1', 'p1']]);
  assert.deepEqual(data.towers.map(t => t.id), ['t1', 't2']);
  const sim = create(data, 0);
  assert.equal(sim.canDraw('p1', 't1', 't2'), null);
  assert.equal(sim.canDraw('b1', 't2', 't1'), null);
  assert.equal(sim.canDraw('p1', 't2', 't1'), 'not-owner');
  assert.equal(sim.canDraw('b1', 't1', 't2'), 'not-owner');
  const events = sim.step([draw('t1', 't2', 'p1'), draw('t2', 't1', 'b1')]);
  assert.deepEqual(events.filter(e => e.type === 'LineDrawn').map(e => [e.owner, e.from, e.to]), [[0, 1, 0], [1, 0, 1]]);
});

test('covers R-CPT-01: inline capture resets state, cancels outgoing lines and generates only next tick', () => {
  const input = level({ rate: 20000, speed: 60020 });
  input.towers[1].garrison = 1; input.towers[3].owner = 1;
  input.towers[1].components.generates.ratePerSec = 1500;
  const sim = create(input, 0);
  sim.step([draw('a', 'b'), draw('b', 'd', 'p1')]);
  sim.step([cut('a', 'b')]);
  const staticBefore = structuredClone(sim.view.towerStatic[1]);
  assert.equal(sim.view.tower.col['generates.acc'][1], 3000);
  const events = sim.step([]);
  assert.deepEqual(events.filter(e => e.type === 'Captured').map(e => [e.tower, e.from, e.to]), [[1, 1, 0]]);
  assert.equal(sim.view.tower.col['garrison.count'][1], 0);
  assert.equal(sim.view.tower.col['generates.acc'][1], 0);
  assert.equal(sim.view.tower.col['drawsLines.cursor'][1], -1);
  assert.ok(events.some(e => e.type === 'LineCut' && e.reason === 'captured'));
  assert.deepEqual(sim.view.towerStatic[1], staticBefore);
  assert.equal(sim.view.tower.col['garrison.cap'][1], 50);
  sim.step([]); assert.equal(sim.view.tower.col['generates.acc'][1], 1500);
});

test('covers R-CMB-03: E-CAPTURE unit hits distinguish empty, exact depletion and surviving defense', () => {
  for (const [initial, owner, remaining] of [[0, 0, 1], [1, 0, 0], [2, 1, 1]]) {
    const input = level({ rate: 20000, speed: 60020 });
    input.towers[1].garrison = initial; input.towers[1].components.generates.ratePerSec = 0;
    input.towers[3].owner = 1;
    const sim = create(input, 0);
    sim.step([draw('a', 'b')]); sim.step([cut('a', 'b')]);
    const events = sim.step([]);
    assert.equal(sim.view.tower.owner[1], owner); assert.equal(counts(sim)[1], remaining);
    assert.equal(events.filter(e => e.type === 'Captured').length, initial < 2 ? 1 : 0);
    assert.equal(sim.view.players[0].transit, 0);
  }
});

test('covers R-CAP-01: E-CAP three friendly unit arrivals fill one space and lose two to overflow', () => {
  const input = level({ rate: 60000, speed: 60020 });
  input.towers[1].owner = 0; input.towers[1].garrison = 49;
  input.towers[1].components.generates.ratePerSec = 0; input.towers[3].owner = 1;
  const sim = create(input, 0);
  sim.step([draw('a', 'b')]); sim.step([cut('a', 'b')]);
  const events = sim.step([]);
  assert.deepEqual(events.filter(e => e.type === 'TroopArrived').map(e => e.effect), ['reinforce', 'overflow', 'overflow']);
  assert.equal(counts(sim)[1], 50); assert.equal(sim.view.players[0].stats.overflowLost, 2);
  assert.equal(sim.view.players[0].transit, 0);
});
