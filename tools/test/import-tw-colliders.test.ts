import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Vec3 = [number, number, number];
interface Child {
  index: number; name: string; variant: string; yawDeg: number;
  box: { size: Vec3; center: Vec3 };
  footprint: { w: number; d: number };
}
interface Node { name: string; layerName: string; colliders: { type: string; size?: Vec3; radius?: number; isTrigger: boolean }[] }
const doc = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/import-tw/prefab/colliders.json'), 'utf8')) as {
  frozen: boolean;
  obstacle: { children: Child[] };
  building: { collider: Node };
  tower: { colliderNodes: Node[] };
  house: { colliderNodes: Node[] };
  layerMatrix: { raw: number[]; collides: Record<string, boolean> };
};

test('colliders.json: every obstacle child has box size + yaw + variant', () => {
  assert.equal(doc.frozen, true);
  const kids = doc.obstacle.children;
  assert.equal(kids.length, 8);
  kids.forEach((c, i) => {
    assert.equal(c.index, i);
    assert.equal(c.box.size.length, 3);
    assert.ok(c.box.size.every(n => Number.isFinite(n) && n > 0), `size ${c.name}`);
    assert.ok(Number.isFinite(c.yawDeg), `yaw ${c.name}`);
    assert.ok(c.footprint.w > 0 && c.footprint.d > 0);
    assert.ok(c.variant === 'small' || c.variant === 'big', `variant ${c.name}`);
  });
  assert.equal(kids.filter(c => c.variant === 'small').length, 4);
  assert.equal(kids.filter(c => c.variant === 'big').length, 4);
});

test('colliders.json: building box, tower trigger, layer matrix', () => {
  const b = doc.building.collider.colliders[0];
  assert.ok(b);
  assert.equal(b.type, 'BoxCollider');
  assert.deepEqual(b.size, [1.5, 1, 1.5]);
  const tr = doc.tower.colliderNodes.find(n => n.name === 'TowerRadius');
  assert.ok(tr && tr.colliders[0]?.type === 'SphereCollider' && tr.colliders[0].isTrigger);
  assert.ok(Math.abs((tr.colliders[0].radius ?? 0) - 2.4) < 1e-6);
  for (const n of ['Hit', 'Building', 'Selecable']) assert.ok(doc.house.colliderNodes.some(h => h.name === n), n);
  assert.equal(doc.layerMatrix.raw.length, 32);
  assert.equal(doc.layerMatrix.collides['Aiming|Building'], true);
});
