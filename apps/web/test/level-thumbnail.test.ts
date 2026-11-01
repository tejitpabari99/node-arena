import { expect, it, vi } from 'vitest';
import { createLevelThumbnailService, type ThumbRenderer } from '../src/render/level-thumbnail.js';

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
