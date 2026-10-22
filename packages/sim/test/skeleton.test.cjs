const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
require('tsx/cjs');
const { create, IMPLS } = require('../src/index.ts');
const { compiledGolden: golden } = require('./fixtures.cjs');

test('create on compiled levelview-1 exposes the view skeleton', async () => {
  const level = await golden();
  const sim = create(level, 7);
  const v = sim.view;
  assert.equal(v.tick, 0);
  assert.equal(v.over, null);
  assert.equal(v.ids.buildings.length, level.buildings.length);
  assert.equal(v.buildings.owner.length, level.buildings.length);
  assert.equal(v.buildingStatic.length, level.buildings.length);
  assert.deepEqual(v.bounds, level.bounds);
  assert.ok(v.buildings.stage.every((s) => s >= 1 && s <= 3));
  assert.ok('grows.timer' in v.buildings.col && 'shoots.cooldown' in v.buildings.col);
  assert.deepEqual(Object.keys(IMPLS).sort(), ['blocksLines', 'drawsLines', 'grows', 'level', 'shoots', 'spawns']);
});

test('buildingStatic.kind comes from the compiled archetype kind, not module inference', async () => {
  const level = structuredClone(await golden());
  assert.deepEqual(create(level, 7).view.buildingStatic.map((b) => b.kind), level.buildings.map((b) => b.kind));
  const plain = level.buildings.findIndex((b) => b.modules.shoots === undefined);
  level.buildings[plain].kind = 'tower';
  assert.equal(create(level, 7).view.buildingStatic[plain].kind, 'tower');
});

test('step advances tick; events:false and events:true return arrays and hash identically', async () => {
  const level = await golden();
  const a = create(level, 7), b = create(level, 7);
  assert.deepEqual(a.step([]), []);
  assert.deepEqual(b.step([], { events: true }), []);
  assert.equal(a.view.tick, 1);
  a.step([]); b.step([]);
  assert.equal(a.view.tick, 2);
  assert.equal(a.hash(), b.hash());
});

test('hash is deterministic across instances and sensitive to tick', async () => {
  const level = await golden();
  const a = create(level, 1), b = create(level, 1);
  assert.match(a.hash(), /^[0-9a-f]{16}$/);
  assert.equal(a.hash(), b.hash());
  const h0 = a.hash();
  a.step([]);
  assert.notEqual(a.hash(), h0);
  for (let i = 0; i < 20; i++) { a.step([]); b.step([]); }
  b.step([]);
  assert.equal(a.hash(), b.hash());
});
