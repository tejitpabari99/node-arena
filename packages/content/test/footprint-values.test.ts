import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileLevel, loadCatalog, loadLevel } from '../src/index.js';
import { dataOnly, hashFixture } from './hash-fixture.js';

test('a hand-authored obstacle without a footprint override compiles the real child-zero box', () => {
  const files = dataOnly(hashFixture());
  const catalog = loadCatalog(files);
  const level = structuredClone(files['data/levels/levelview-2-ab.json']) as Record<string, any>;
  level.elements = [{ id: 'hand-obstacle', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 135, variant: 'big' }];
  const compiled = compileLevel(catalog, loadLevel(catalog, level).level);
  assert.deepEqual(compiled.elements[0]!.footprint, { shape: 'box', w: 713, d: 713 });
  assert.equal(compiled.elements[0]!.yawMilliDeg, 135000);
});
