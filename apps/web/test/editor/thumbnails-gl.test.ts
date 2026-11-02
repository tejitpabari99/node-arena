import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCatalog, type CompiledLevel } from '@node-arena/content';
import { contentFiles } from '../../src/app/boot.js';
import { LIBRARY_ITEMS } from '../../src/editor/thumbnails.js';

const gl = vi.hoisted(() => ({ render: undefined as unknown, dispose: undefined as unknown, create: undefined as unknown }));
vi.mock('../../src/render/level-thumbnail.js', () => ({ createThumbnailGl: (...a: unknown[]) => (gl.create as (...x: unknown[]) => unknown)(...a) }));
const { createWebGlThumbnailRenderer, getThumbnails, resetThumbnailsForTest } = await import('../../src/editor/thumbnails.js');

const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const catalog = loadCatalog(contentFiles(), { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) });
type Render = (level: CompiledLevel, options: { width: number; height: number; hide?: string[]; frameCamera?: unknown }) => Promise<string>;
let render: ReturnType<typeof vi.fn<Render>>, dispose: ReturnType<typeof vi.fn>, create: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetThumbnailsForTest();
  render = vi.fn<Render>(async (_l, o) => `data:${o.width}x${o.height}`);
  dispose = vi.fn();
  create = vi.fn(async () => ({ manifest, catalog, theme: Object.keys(manifest.themes)[0]!, render, dispose }));
  gl.create = create;
});

it('delegates to one shared thumbnail GL built from the bundled content files', async () => {
  const r = await createWebGlThumbnailRenderer();
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0]![0]).toEqual(contentFiles());
  await r.render('tower'); await r.render('house-wt1');
  expect(create).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledTimes(2);
  r.dispose(); expect(dispose).toHaveBeenCalledOnce();
});

it('renders a 128px square per item with a compiled one-building level, hiding the helper building for obstacles', async () => {
  const r = await createWebGlThumbnailRenderer();
  await r.render('tower');
  const [towerLevel, towerOpts] = render.mock.calls[0]!;
  expect(towerOpts).toMatchObject({ width: 128, height: 128, hide: [] }); expect(typeof towerOpts.frameCamera).toBe('function');
  expect(towerLevel.buildings.map((b) => [b.id, b.archetype])).toEqual([['b0', 'tower']]);
  await r.render('obstacle-big');
  const [bigLevel, bigOpts] = render.mock.calls[1]!;
  expect(bigOpts.hide).toEqual(['b0']);
  expect(bigLevel.buildings.map((b) => b.archetype)).toEqual(['house-wt1']); // hidden helper so the level compiles
  expect(bigLevel.elements.map((e) => ({ archetype: e.archetype, variant: e.variant }))).toEqual([{ archetype: 'obstacle', variant: 'big' }]);
  await r.render('obstacle-small');
  expect(render.mock.calls[2]![0].elements[0]!.variant).toBe('small');
  r.dispose();
});

it('getThumbnails with the default factory: one GL, five images, disposed once, memoized', async () => {
  const a = await getThumbnails();
  expect(Object.keys(a)).toEqual([...LIBRARY_ITEMS]); expect(Object.values(a).every((u) => u === 'data:128x128')).toBe(true);
  expect(await getThumbnails()).toBe(a);
  expect(create).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledTimes(5); expect(dispose).toHaveBeenCalledOnce();
});

it('failure fallback: an item whose GL render rejects is missing, the rest remain, GL still disposed', async () => {
  render.mockImplementation(async (level, o) => { if (level.buildings[0]?.archetype === 'tower' && !level.elements.length) throw new Error('boom'); return `data:${o.width}`; });
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  try {
    const result = await getThumbnails();
    expect(result.tower).toBeUndefined();
    expect(Object.keys(result)).toEqual(['house-wt1', 'house-wt2', 'obstacle-small', 'obstacle-big']);
    expect(dispose).toHaveBeenCalledOnce();
  } finally { debug.mockRestore(); }
});

it('failure fallback: GL creation failure resolves to {} and is cached (no retry storm)', async () => {
  create.mockRejectedValue(new Error('no webgl'));
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  try {
    expect(await getThumbnails()).toEqual({});
    expect(await getThumbnails()).toEqual({});
    expect(create).toHaveBeenCalledOnce();
  } finally { debug.mockRestore(); }
});

it('failure fallback: a throwing dispose does not reject', async () => {
  dispose.mockImplementation(() => { throw new Error('lost'); });
  expect(Object.keys(await getThumbnails())).toHaveLength(5);
});
