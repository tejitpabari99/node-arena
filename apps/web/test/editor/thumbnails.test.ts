import { beforeEach, expect, it, vi } from 'vitest';
import { getThumbnails, LIBRARY_ITEMS, resetThumbnailsForTest, type ThumbnailRenderer } from '../../src/editor/thumbnails.js';

beforeEach(() => resetThumbnailsForTest());
const fake = (fail: string[] = []) => {
  const dispose = vi.fn();
  const renderer: ThumbnailRenderer = {
    render: async item => { if (fail.includes(item)) throw new Error('boom'); return `data:${item}`; },
    dispose,
  };
  return Object.assign(renderer, { disposed: dispose });
};

it('returns five data URLs, memoizes, and disposes once', async () => {
  const renderer = fake(), factory = vi.fn(async () => renderer);
  const [a, b] = [await getThumbnails(factory), await getThumbnails(factory)];
  expect(Object.keys(a)).toEqual([...LIBRARY_ITEMS]);
  expect(b).toBe(a);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(renderer.disposed).toHaveBeenCalledTimes(1);
});
it('a failing item is missing; others remain; renderer still disposed', async () => {
  const renderer = fake(['tower']);
  const result = await getThumbnails(async () => renderer);
  expect(result.tower).toBeUndefined();
  expect(Object.keys(result)).toHaveLength(4);
  expect(renderer.disposed).toHaveBeenCalledTimes(1);
});
it('factory failure resolves to an empty result without rejecting', async () => {
  expect(await getThumbnails(async () => { throw new Error('no webgl'); })).toEqual({});
});
