import { expect, it } from 'vitest';
import { createEditorWriteGuard, shouldSkipEditorHotUpdate } from '../../src/dev/editor-middleware.js';

const level = '/r/packages/content/data/levels/na-x.json';
it('skips hot updates for editor-written content only during and shortly after a write', () => {
  let t = 1000;
  const guard = createEditorWriteGuard(500, () => t);
  expect(shouldSkipEditorHotUpdate(level, guard)).toBe(false);
  const done = guard.begin();
  expect(shouldSkipEditorHotUpdate(level, guard)).toBe(true);
  expect(shouldSkipEditorHotUpdate('/r/packages/content/data/campaigns/custom.json', guard)).toBe(true);
  expect(shouldSkipEditorHotUpdate('/r/packages/content/data/buildings/house.json', guard)).toBe(false);
  expect(shouldSkipEditorHotUpdate('/r/packages/content/data/campaigns/common.json', guard)).toBe(false);
  done(); t += 400;
  expect(shouldSkipEditorHotUpdate(level, guard)).toBe(true);
  t += 200;
  expect(shouldSkipEditorHotUpdate(level, guard)).toBe(false);
});
