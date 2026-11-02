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

const graphOf = (files: Array<string | undefined>, log: string[], tag: string) => ({
  idToModuleMap: new Map(files.map((file, i) => [`${tag}${i}`, { file }])),
  invalidateModule: (m: { file?: string }) => { log.push(`${tag}:${m.file}`); },
});

it('invalidates content modules in every environment and re-watches only content JSON', () => {
  const invalidated: string[] = [], watched: string[] = [], unwatched: string[] = [];
  const server = {
    environments: {
      client: { moduleGraph: graphOf(['/r/packages/content/data/levels/na-x.json', '/r/apps/web/src/app/boot.ts', '/r/apps/web/src/main.tsx'], invalidated, 'client') },
      ssr: { moduleGraph: graphOf(['/r/packages/content/data/campaigns/custom.json', '/r/packages/content/data/levels/na-x.json'], invalidated, 'ssr') },
    },
    watcher: { unwatch: (f: string) => { unwatched.push(f); }, add: (f: string) => { watched.push(f); } },
  };
  invalidateEditorContent(server as never);
  expect(invalidated).toEqual([
    'client:/r/packages/content/data/levels/na-x.json', 'client:/r/apps/web/src/app/boot.ts',
    'ssr:/r/packages/content/data/campaigns/custom.json', 'ssr:/r/packages/content/data/levels/na-x.json',
  ]);
  // boot.ts (the eager-glob importer) is invalidated but never un-/re-watched.
  expect(unwatched).toEqual(['/r/packages/content/data/levels/na-x.json', '/r/packages/content/data/campaigns/custom.json', '/r/packages/content/data/levels/na-x.json']);
  expect(watched).toEqual(unwatched);
  expect(watched).not.toContain('/r/apps/web/src/app/boot.ts');
});

it('skips modules without a file or outside content, and tolerates empty graphs/environments', () => {
  const invalidated: string[] = [], watched: string[] = [];
  const server = {
    environments: {
      client: { moduleGraph: graphOf([undefined, '/r/apps/web/src/other.ts', '/r/packages/content/data/readme.txt', '/r/packages/content/data/buildings/house.json'], invalidated, 'c') },
      empty: { moduleGraph: graphOf([], invalidated, 'e') },
    },
    watcher: { unwatch: () => {}, add: (f: string) => { watched.push(f); } },
  };
  expect(() => invalidateEditorContent(server as never)).not.toThrow();
  expect(invalidated).toEqual(['c:/r/packages/content/data/buildings/house.json']);
  expect(watched).toEqual(['/r/packages/content/data/buildings/house.json']);
  expect(() => invalidateEditorContent({ environments: {}, watcher: { unwatch: () => {}, add: () => {} } } as never)).not.toThrow();
});

it('Windows-style content paths are recognised', () => {
  const invalidated: string[] = [];
  invalidateEditorContent({ environments: { client: { moduleGraph: graphOf(['C:\\r\\packages\\content\\data\\levels\\na-x.json', 'C:\\r\\apps\\web\\src\\app\\boot.ts'], invalidated, 'w') } }, watcher: { unwatch: () => {}, add: () => {} } } as never);
  expect(invalidated).toHaveLength(2);
});
