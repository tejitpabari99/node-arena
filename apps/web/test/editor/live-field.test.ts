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
it('normalizes valid text locally before committing and ignores repeated equivalent values', () => {
  vi.useFakeTimers();
  const commits: string[] = [];
  const field = createLiveField({ value: '0', mergeKey: 'row:rotation', validate: text => Number.isFinite(Number(text)) ? undefined : 'Enter a number', normalize: text => text === '23' ? '30' : text, commit: text => commits.push(text), endBurst() {} }, () => undefined);
  field.input('23'); field.finish(); expect(field.value).toBe('30'); expect(commits).toEqual(['30']);
  field.sync('30'); field.input('23'); field.finish();
  expect(field.value).toBe('30'); expect(commits).toEqual(['30']);
  field.input('45'); field.sync('30'); expect(field.value).toBe('45');
  field.finish(); expect(commits).toEqual(['30', '45']);
  field.input('invalid'); field.finish(); expect(field.value).toBe('invalid'); expect(field.error).toBe('Enter a number');
  expect(commits).toEqual(['30', '45']);
});
it('normalizing fields do not commit or rewrite local text on debounce; they settle on finish', () => {
  vi.useFakeTimers();
  const commits: string[] = [];
  const field = createLiveField({ value: '0', mergeKey: 'row:rotation', validate: () => undefined, normalize: text => String(Math.round(Number(text) / 15) * 15), commit: text => commits.push(text), endBurst() {} }, () => undefined);
  field.input('4'); vi.advanceTimersByTime(500);
  expect(field.value).toBe('4'); expect(commits).toEqual([]);
  field.input('45'); vi.advanceTimersByTime(500);
  expect(field.value).toBe('45'); field.finish();
  expect(field.value).toBe('45'); expect(commits).toEqual(['45']);
});
