import { describe, expect, it } from 'vitest';
import { blankDocument } from '../../src/editor/document.js';
import { createHistory, historyReducer } from '../../src/editor/model.js';
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
  it('undo to saved authored content stays clean across server version bumps', () => {
    const original = { ...blankDocument('na-undo', 'green', 'small'), editorVersion: '0.0.1' };
    let history = createHistory(original);
    history = historyReducer(history, { type: 'edit', op: { type: 'level-properties', value: { name: 'Edited', theme: original.theme, players: original.players, timeLimitSec: null } } });
    const saved = { ...history.present, editorVersion: '0.0.2' };
    history = historyReducer(history, { type: 'edit', op: { type: 'level-properties', value: { name: 'Later edit', theme: original.theme, players: original.players, timeLimitSec: null } } });
    expect(isDirty(history.present, saved)).toBe(true);
    history = historyReducer(history, { type: 'undo' });
    expect(history.present.editorVersion).toBe('0.0.1');
    expect(isDirty(history.present, saved)).toBe(false);
    history = historyReducer(history, { type: 'undo' });
    expect(isDirty(history.present, saved)).toBe(true);
  });
  it('ignores only the root server version and preserves concurrent authored changes', () => {
    const sent = { name: 'Saved', editorVersion: '0.0.1', nested: { editorVersion: 'authored' } };
    const saved = { ...sent, editorVersion: '0.0.2' };
    expect(isDirty(sent, saved)).toBe(false);
    expect(isDirty({ ...sent, name: 'Concurrent edit' }, saved)).toBe(true);
    expect(isDirty({ ...sent, nested: { editorVersion: 'changed' } }, saved)).toBe(true);
    expect(isDirty({ name: 'Legacy', editorVersion: '0.0.1' }, { name: 'Legacy' })).toBe(false);
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
