import { afterEach, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { createLevelThumbnailService, createWebGlLevelThumbnails, type ThumbRenderer } from '../src/render/level-thumbnail.js';

vi.mock('../src/manifest/load.js', async () => {
  const { readFileSync: read } = await import('node:fs');
  return { loadManifest: async () => JSON.parse(read('assets/manifest.json', 'utf8')) };
});
afterEach(() => { vi.unstubAllGlobals(); });

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fake(impl: (id: string) => Promise<string> = async id => `data:${id}`) {
  const renderer: ThumbRenderer = { render: vi.fn(impl), dispose: vi.fn() };
  const factory = vi.fn(async () => renderer);
  return { renderer, factory };
}

it('dedupes requests: one render per level, get returns the cached url', async () => {
  const { renderer, factory } = fake(), svc = createLevelThumbnailService({ version: '1', createRenderer: factory });
  svc.request('a'); svc.request('a'); svc.request('a');
  await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
  expect(svc.get('a')).toBe('data:a');
  svc.request('a'); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
  svc.dispose();
});

it('renders sequentially in request order and notifies subscribers', async () => {
  const log: string[] = []; let active = 0, maxActive = 0;
  const { factory } = fake(async id => { active++; maxActive = Math.max(maxActive, active); log.push(`start ${id}`); await flush(); log.push(`end ${id}`); active--; return `data:${id}`; });
  const svc = createLevelThumbnailService({ version: '1', createRenderer: factory }), cb = vi.fn();
  svc.subscribe(cb);
  svc.request('a'); svc.request('b'); svc.request('c');
  await flush(); await flush(); await flush(); await flush();
  expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  expect(maxActive).toBe(1);
  expect(cb).toHaveBeenCalledTimes(3);
  svc.dispose();
});

it('failure yields undefined without throwing, is not retried, and others still render', async () => {
  const { renderer, factory } = fake(async id => { if (id === 'bad') throw new Error('boom'); return `data:${id}`; });
  const svc = createLevelThumbnailService({ version: '1', createRenderer: factory });
  expect(() => { svc.request('bad'); svc.request('ok'); }).not.toThrow();
  await flush(); await flush();
  expect(svc.get('bad')).toBeUndefined();
  expect(svc.get('ok')).toBe('data:ok');
  svc.request('bad'); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(2);
  svc.dispose();
});

it('renderer factory failure marks pending levels failed, no throw', async () => {
  const svc = createLevelThumbnailService({ version: '1', createRenderer: async () => { throw new Error('no webgl'); } });
  svc.request('a'); await flush(); await flush();
  expect(svc.get('a')).toBeUndefined();
  svc.dispose();
});

it('tears the renderer down after idle and recreates it on demand; dispose releases it', async () => {
  vi.useFakeTimers();
  try {
    const { renderer, factory } = fake(), svc = createLevelThumbnailService({ version: '1', createRenderer: factory, idleMs: 5000 });
    svc.request('a'); await vi.advanceTimersByTimeAsync(0);
    expect(renderer.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    svc.request('b'); await vi.advanceTimersByTimeAsync(0);
    expect(factory).toHaveBeenCalledTimes(2);
    svc.dispose(); await vi.advanceTimersByTimeAsync(0);
    expect(renderer.dispose).toHaveBeenCalledTimes(2);
    svc.request('c'); await vi.advanceTimersByTimeAsync(10);
    expect(svc.get('c')).toBeUndefined();
  } finally { vi.useRealTimers(); }
});

it('dispose during an in-flight render drops the result without notifying and releases the renderer', async () => {
  let finish!: (url: string) => void;
  const { renderer, factory } = fake(() => new Promise<string>(done => { finish = done; }));
  const svc = createLevelThumbnailService({ version: '1', createRenderer: factory }), cb = vi.fn();
  svc.subscribe(cb);
  svc.request('a'); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
  svc.dispose();
  finish('data:late'); await flush(); await flush();
  expect(cb).not.toHaveBeenCalled();
  expect(svc.get('a')).toBeUndefined();
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  svc.request('b'); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
});

it('unsubscribe stops notifications for that listener only', async () => {
  const { factory } = fake(), svc = createLevelThumbnailService({ version: '1', createRenderer: factory }), a = vi.fn(), b = vi.fn();
  const offA = svc.subscribe(a); svc.subscribe(b);
  svc.request('x'); await flush();
  expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  offA(); offA();
  svc.request('y'); await flush();
  expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(2);
  svc.dispose();
});

it('a throwing listener neither breaks the queue nor other listeners', async () => {
  const { factory } = fake(), svc = createLevelThumbnailService({ version: '1', createRenderer: factory }), ok = vi.fn();
  svc.subscribe(() => { throw new Error('listener'); }); svc.subscribe(ok);
  svc.request('a'); svc.request('b'); await flush(); await flush();
  expect(ok).toHaveBeenCalledTimes(2); expect(svc.get('b')).toBe('data:b');
  svc.dispose();
});

it('a failed render discards the renderer so the next level gets a fresh one', async () => {
  const dead: ThumbRenderer = { render: vi.fn(async () => { throw new Error('lost context'); }), dispose: vi.fn() };
  const live: ThumbRenderer = { render: vi.fn(async (id: string) => `data:${id}`), dispose: vi.fn() };
  const factory = vi.fn().mockResolvedValueOnce(dead).mockResolvedValue(live);
  const svc = createLevelThumbnailService({ version: '1', createRenderer: factory });
  svc.request('a'); svc.request('b'); await flush(); await flush();
  expect(dead.dispose).toHaveBeenCalledTimes(1);
  expect(svc.get('a')).toBeUndefined(); expect(svc.get('b')).toBe('data:b');
  expect(factory).toHaveBeenCalledTimes(2);
  svc.dispose();
});

it('cache and dedupe are per content version: services with different versions render independently', async () => {
  const { renderer, factory } = fake(), v1 = createLevelThumbnailService({ version: '1', createRenderer: factory }), v2 = createLevelThumbnailService({ version: '2', createRenderer: factory });
  v1.request('a'); await flush();
  expect(v2.get('a')).toBeUndefined();
  v2.request('a'); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(v1.get('a')).toBe('data:a'); expect(v2.get('a')).toBe('data:a');
  v1.dispose(); v2.dispose();
});

it('unknown level id: web service yields no thumbnail, never throws, and releases its GL host', async () => {
  const removed = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ style: {}, remove: removed }), body: { appendChild: () => {} } });
  const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map(p => [p.slice('packages/content/'.length), readFileSync('../../' + p, 'utf8')]));
  const svc = createWebGlLevelThumbnails(files, 'v');
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  try {
    expect(() => svc.request('na-does-not-exist')).not.toThrow();
    for (let i = 0; i < 200 && !debug.mock.calls.length; i++) await new Promise(r => setTimeout(r, 10));
    expect(debug.mock.calls[0]![0]).toBe('level thumbnail failed');
    expect(String((debug.mock.calls[0]![2] as Error).message)).toContain('Unknown level: na-does-not-exist');
    expect(svc.get('na-does-not-exist')).toBeUndefined();
    await flush();
    expect(removed).toHaveBeenCalledTimes(1);
  } finally { debug.mockRestore(); svc.dispose(); }
});
