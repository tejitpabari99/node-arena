import { expect, it } from 'vitest';
import { confirmAction } from '../../src/editor/confirm-flow.js';

it('waits for successful saving before running the pending action', async () => {
  const events: string[] = [];
  let finish!: (success: boolean) => void;
  const saving = new Promise<boolean>(resolve => { finish = resolve; });
  const result = confirmAction('save', async () => { events.push('save'); return saving; }, () => { events.push('action'); });
  expect(events).toEqual(['save']);
  finish(true);
  await expect(result).resolves.toBe(true);
  expect(events).toEqual(['save', 'action']);
});
it('aborts on handled save failure even when the save queue resolved', async () => {
  let actions = 0;
  await expect(confirmAction('save', async () => false, () => { actions++; })).resolves.toBe(false);
  expect(actions).toBe(0);
});
it('aborts on rejected saving', async () => {
  let actions = 0;
  await expect(confirmAction('save', async () => { throw new Error('offline'); }, () => { actions++; })).rejects.toThrow('offline');
  expect(actions).toBe(0);
});
it('discards without saving and awaits the action', async () => {
  const events: string[] = [];
  await expect(confirmAction('discard', async () => { events.push('save'); return false; }, async () => { await Promise.resolve(); events.push('action'); })).resolves.toBe(true);
  expect(events).toEqual(['action']);
});
it('cancels without saving or running the action', async () => {
  const events: string[] = [];
  await expect(confirmAction('cancel', async () => { events.push('save'); return true; }, () => { events.push('action'); })).resolves.toBe(false);
  expect(events).toEqual([]);
});
