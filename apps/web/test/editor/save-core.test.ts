import { describe, expect, it } from 'vitest';
import { chipText, createSaveQueue, isDirty, shouldAutosave, stableStringify } from '../../src/editor/save-core.js';

describe('dirty model', () => {
  it('is dirty without a saved ref, clean by reference or by stable JSON', () => {
    const saved = { a: 1, b: { c: 2, d: 3 } };
    expect(isDirty(saved, null)).toBe(true);
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty({ b: { d: 3, c: 2 }, a: 1 }, saved)).toBe(false);
    expect(isDirty({ ...saved, a: 2 }, saved)).toBe(true);
    expect(stableStringify({ b: 1, a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}],"b":1}');
  });
  it('formats the four chip states', () => {
    expect([chipText('saved', 0), chipText('saving', 0), chipText('unsaved', 0), chipText('error', 3)]).toEqual(['Saved ✓', 'Saving…', 'Unsaved', "Can't save · 3 issues"]);
  });
});

describe('save queue', () => {
  it('runs idle saves and re-saves a queued save only when still dirty', async () => {
    let dirty = true; const log: string[] = []; const gates: Array<() => void> = [];
    const queue = createSaveQueue<string>(source => new Promise<void>(resolve => { log.push(source); gates.push(() => { dirty = false; resolve(); }); }), () => dirty);
    const first = queue.enqueue('auto');
    const second = queue.enqueue('manual');
    expect(queue.busy).toBe(true);
    await Promise.resolve(); expect(log).toEqual(['auto']);
    gates[0]!(); await first; await second;
    expect(log).toEqual(['auto']); // second skipped: no longer dirty
    expect(queue.busy).toBe(false);
    dirty = true;
    const third = queue.enqueue('manual'); const fourth = queue.enqueue('manual');
    await Promise.resolve(); await Promise.resolve();
    dirty = true; gates[1]!(); dirty = true; await third;
    await Promise.resolve(); await Promise.resolve(); expect(log).toEqual(['auto', 'manual', 'manual']);
    gates[2]!(); await fourth; expect(queue.busy).toBe(false);
  });
});

describe('autosave decision', () => {
  const ok = { armed: true, dirty: true, valid: true, jobRunning: false, saveInFlight: false, failedThisRevision: false };
  it('fires only when armed, dirty, valid, idle, not in flight and not failed for this revision', () => {
    expect(shouldAutosave(ok)).toBe(true);
    for (const key of Object.keys(ok) as Array<keyof typeof ok>) {
      expect(shouldAutosave({ ...ok, [key]: !ok[key] })).toBe(false);
    }
  });
});
