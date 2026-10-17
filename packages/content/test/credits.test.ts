import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCredited } from '../src/index.js';

test('isCredited accepts plain, backticked, and link entries', () => {
  assert.equal(isCredited('models/a.glb', '| models/a.glb | CC0 |'), true);
  assert.equal(isCredited('models/a.glb', '| `models/a.glb` | CC0 |'), true);
  assert.equal(isCredited('models/a.glb', '[x](models/a.glb)'), true);
});

test('isCredited never lets a longer filename credit a shorter one', () => {
  assert.equal(isCredited('models/a.glb', 'models/a.glb.bak\nmodels/ba.glb\nmodels/a.glbx'), false);
  assert.equal(isCredited('models/a.glb', ''), false);
});

test('isCredited escapes regex metacharacters in the path', () => {
  assert.equal(isCredited('models/a.glb', 'models/aXglb'), false);
});
