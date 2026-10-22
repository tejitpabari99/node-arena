import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../data/units/', import.meta.url);

test('covers R-ENT-02: all units.*.speed are equal (03 R2 invariant: one shared lane speed)', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 2, 'at least soldier and tank');
  const speeds = files.map((f) => (JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { speed: number }).speed);
  for (const s of speeds) assert.ok(Number.isInteger(s) && s > 0, `positive integer speed, got ${s}`);
  assert.equal(new Set(speeds).size, 1, `units differ in speed: ${files.map((f, i) => `${f}=${speeds[i]}`).join(', ')}`);
});
