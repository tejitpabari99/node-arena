import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOUNDS_PAD } from '@node-arena/content';
import { levelBounds, outOfBounds, rotatePos, rotateYaw, BOUNDS_PAD as REEXPORT } from '../rotate.js';
import { serializeCampaign, serializeLevel } from '../serialize.js';

const goldenPath = fileURLToPath(new URL('../../../../packages/content/data/levels/levelview-1.json', import.meta.url));
const goldenText = readFileSync(goldenPath, 'utf8');

test('covers R-rotation: position (x,z)->(z,-x), golden value', () => {
  assert.deepEqual(rotatePos(-0.1, -6.79), { x: -6.79, z: 0.1 });
  assert.deepEqual(rotatePos(2, 3), { x: 3, z: -2 });
});

test('position: -0 normalised', () => {
  const r = rotatePos(0, 0);
  assert.ok(Object.is(r.x, 0) && Object.is(r.z, 0));
  const s = rotatePos(0, 5);
  assert.ok(Object.is(s.z, 0));
  assert.equal(JSON.stringify(rotatePos(-0, -0)), '{"x":0,"z":0}');
});

test('position: 4x rotation is identity', () => {
  for (const [x, z] of [[1.25, -3.5], [0, 7], [-6.79, 0.1]] as const) {
    let p: { x: number; z: number } = { x, z };
    for (let i = 0; i < 4; i++) p = rotatePos(p.x, p.z);
    assert.deepEqual(p, { x, z });
  }
});

test('yaw: (Y+90) mod 360, wrap, 2 dp (Frame contract)', () => {
  assert.equal(rotateYaw(0), 90);
  assert.equal(rotateYaw(270), 0);
  assert.equal(rotateYaw(300), 30);
  assert.equal(rotateYaw(-90), 0);
  assert.equal(rotateYaw(-100), 350);
  assert.equal(rotateYaw(720), 90);
  assert.equal(rotateYaw(12.3456), 102.35);
  assert.equal(rotateYaw(269.999), 0); // rounds to 360 -> 0
  assert.ok(Object.is(rotateYaw(270), 0));
});

test('bounds: AABB + pad, integer outward; pad is the content constant', () => {
  assert.equal(REEXPORT, BOUNDS_PAD);
  assert.equal(BOUNDS_PAD, 2.0);
  const b = levelBounds([
    { x: -6.79, z: 0.1 }, { x: 3.7, z: -2.56 }, { x: -0.7, z: -4.95 }, { x: -4.66, z: 5.01 }, { x: 0.6, z: 2.74 },
  ]);
  assert.deepEqual(b, { minX: -9, maxX: 6, minZ: -7, maxZ: 8 });
  assert.throws(() => levelBounds([]));
});

test('out-of-bounds elements are only reported', () => {
  const b = { minX: -9, maxX: 6, minZ: -7, maxZ: 8 };
  assert.deepEqual(outOfBounds(b, [{ id: 'a', pos: { x: 0, z: 0 } }, { id: 'o1-0', pos: { x: 28, z: 0 } }]), ['o1-0']);
});

test('golden bounds follow the rule from its own building positions', () => {
  const g = JSON.parse(goldenText) as { bounds: unknown; buildings: { pos: { x: number; z: number } }[] };
  assert.deepEqual(levelBounds(g.buildings.map((x) => x.pos)), g.bounds);
});

test('serialize: re-serializing the parsed golden reproduces its bytes', () => {
  assert.equal(serializeLevel(JSON.parse(goldenText)), goldenText);
});

test('serialize: scrambled key order is canonicalised; array order kept', () => {
  const g = JSON.parse(goldenText) as Record<string, unknown>;
  const scrambled: Record<string, unknown> = {};
  for (const k of Object.keys(g).reverse()) scrambled[k] = g[k];
  const src = scrambled.source as Record<string, unknown>;
  scrambled.source = Object.fromEntries(Object.entries(src).reverse());
  scrambled.buildings = (g.buildings as Record<string, unknown>[]).map((b) => Object.fromEntries(Object.entries(b).reverse()));
  assert.equal(serializeLevel(scrambled), goldenText);
});

test('serialize: 2-space + trailing newline; campaign order', () => {
  const t = serializeCampaign({ entries: [{ position: 4, level: 'levelview-1' }], id: 'common' });
  assert.equal(t, '{\n  "id": "common",\n  "entries": [\n    {\n      "level": "levelview-1",\n      "position": 4\n    }\n  ]\n}\n');
});
