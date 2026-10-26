import { afterEach, expect, it, vi } from 'vitest';
import { createLiveField } from '../../src/editor/live-field.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  let document = 'Initial';
  const commits: string[] = [];
  let boundaries = 0;
  const field = createLiveField({ value: document, mergeKey: 'level:name', validate: text => text.trim() ? undefined : 'Name is required', commit: text => { document = text; commits.push(text); }, endBurst: () => boundaries++ }, () => undefined);
  return { field, commits, document: () => document, boundaries: () => boundaries };
}
it('debounces a typing burst for 400ms and keeps its local text', () => {
  vi.useFakeTimers();
  const { field, commits } = fixture();
  field.input('A'); vi.advanceTimersByTime(300);
  field.input('Arena'); vi.advanceTimersByTime(399);
  expect(commits).toEqual([]);
  expect(field.value).toBe('Arena');
  vi.advanceTimersByTime(1);
  expect(commits).toEqual(['Arena']);
  field.input('Arena 2'); field.flush();
  vi.advanceTimersByTime(400);
  expect(commits).toEqual(['Arena', 'Arena 2']);
});
it('retains invalid local text and never commits it on debounce or blur', () => {
  vi.useFakeTimers();
  const { field, commits, document, boundaries } = fixture();
  field.input(''); vi.advanceTimersByTime(400); field.finish();
  expect(document()).toBe('Initial'); expect(commits).toEqual([]);
  expect(field.value).toBe(''); expect(field.error).toBe('Name is required');
  expect(boundaries()).toBe(1);
  field.input('Valid'); field.finish();
  expect(document()).toBe('Valid'); expect(field.error).toBeUndefined();
  expect(boundaries()).toBe(2);
});
it('flushes the old item before selection changes and cancels stale timers', () => {
  vi.useFakeTimers();
  const { field, commits } = fixture();
  field.input('Old item'); field.finish();
  vi.advanceTimersByTime(400);
  expect(commits).toEqual(['Old item']);
});
it('external undo replaces local text without re-committing it', () => {
  vi.useFakeTimers();
  const { field, commits } = fixture();
  field.input('New'); field.flush();
  field.sync('New'); field.input('Pending'); field.sync('Initial');
  expect(field.value).toBe('Initial');
  field.finish(); vi.advanceTimersByTime(400);
  expect(commits).toEqual(['New']);
});
it('a committed value acknowledgement preserves newer local typing', () => {
  vi.useFakeTimers();
  const { field, commits } = fixture();
  field.input('First'); field.flush(); field.input('Second'); field.sync('First');
  expect(field.value).toBe('Second');
  vi.advanceTimersByTime(400); expect(commits).toEqual(['First', 'Second']);
});
