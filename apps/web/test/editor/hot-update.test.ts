import { expect, it } from 'vitest';
import { createEditorWriteGuard, invalidateEditorContent, shouldSkipEditorHotUpdate } from '../../src/dev/editor-middleware.js';

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

it('after an editor write drops cached content transforms and re-attaches their watches', () => {
  const invalidated: string[] = [], watched: string[] = [], unwatched: string[] = [];
  const mod = (file: string) => ({ file });
  const graph = {
    idToModuleMap: new Map([['a', mod('/r/packages/content/data/campaigns/custom.json')], ['b', mod('/r/apps/web/src/app/boot.ts')], ['c', mod('/r/apps/web/src/main.tsx')]]),
    invalidateModule: (m: { file: string }) => { invalidated.push(m.file); },
  };
  invalidateEditorContent({ environments: { client: { moduleGraph: graph } }, watcher: { unwatch: (f: string) => { unwatched.push(f); }, add: (f: string) => { watched.push(f); } } } as never);
  expect(invalidated).toEqual(['/r/packages/content/data/campaigns/custom.json', '/r/apps/web/src/app/boot.ts']);
  expect(unwatched).toEqual(['/r/packages/content/data/campaigns/custom.json']);
  expect(watched).toEqual(unwatched);
});
