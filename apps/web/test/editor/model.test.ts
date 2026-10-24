import type { SeatBot } from '@node-arena/content';
import { expect, it } from 'vitest';
import { blankDocument } from '../../src/editor/document.js';
import * as model from '../../src/editor/model.js';

it('places neutral archetype defaults with unique identities without mutating snapshots', () => {
  const doc = blankDocument('na-model', 'green', 'medium');
  let state = model.createHistory(doc);
  for (const item of ['house-wt1', 'house-wt2', 'tower', 'obstacle-small', 'obstacle-big'] as const) {
    state = model.historyReducer(state, { type: 'edit', op: { type: 'place', item, pos: { x: 2.346, z: -3.456 } } });
  }
  expect(doc.buildings).toEqual([]);
  expect(state.present.buildings.map(b => [b.archetype, b.owner, b.level, b.pos])).toEqual([
    ['house-wt1', null, 1, { x: 2.35, z: -3.46 }], ['house-wt2', null, 1, { x: 2.35, z: -3.46 }], ['tower', null, 1, { x: 2.35, z: -3.46 }],
  ]);
  expect(state.present.elements.map(e => [e.variant, e.pos])).toEqual([['small', { x: 2.35, z: -3.46 }], ['big', { x: 2.35, z: -3.46 }]]);
  expect(new Set([...state.present.buildings, ...state.present.elements].map(e => e.id)).size).toBe(5);
});
it('moves and deletes identified items; undo/redo restores exact documents and new edits clear redo', () => {
  let state = model.createHistory(blankDocument('na-model', 'green', 'medium'));
  state = model.historyReducer(state, { type: 'edit', op: { type: 'place', item: 'house-wt1', pos: { x: 0, z: 0 } } });
  state = model.historyReducer(state, { type: 'edit', op: { type: 'place', item: 'obstacle-big', pos: { x: 4, z: 4 } } });
  const original = state.present, target = { kind: 'building', id: original.buildings[0]!.id } as const;
  state = model.historyReducer(state, { type: 'edit', op: { type: 'move', target, pos: { x: -2.123, z: 3 } } });
  expect(state.present.buildings[0]!.pos).toEqual({ x: -2.12, z: 3 });
  expect(original.buildings[0]!.pos).toEqual({ x: 0, z: 0 });
  const moved = state.present;
  state = model.historyReducer(state, { type: 'edit', op: { type: 'delete', target } });
  expect(state.present.buildings).toEqual([]); expect(state.present.elements).toEqual(original.elements);
  state = model.historyReducer(state, { type: 'undo' }); expect(state.present).toBe(moved);
  state = model.historyReducer(state, { type: 'undo' }); expect(state.present).toBe(original);
  state = model.historyReducer(state, { type: 'redo' }); expect(state.present).toBe(moved);
  state = model.historyReducer(state, { type: 'edit', op: { type: 'delete', target: { kind: 'obstacle', id: original.elements[0]!.id } } });
  expect(state.future).toEqual([]); expect(state.present.elements).toEqual([]);
});
it('bounds history to 100 snapshots and ignores no-op edits', () => {
  let state = model.createHistory(blankDocument('na-model', 'green', 'medium'));
  state = model.historyReducer(state, { type: 'edit', op: { type: 'place', item: 'tower', pos: { x: 0, z: 0 } } });
  const target = { kind: 'building', id: state.present.buildings[0]!.id } as const;
  expect(model.historyReducer(state, { type: 'edit', op: { type: 'move', target, pos: { x: 0, z: 0 } } })).toBe(state);
  for (let x = 1; x <= 110; x++) state = model.historyReducer(state, { type: 'edit', op: { type: 'move', target, pos: { x, z: 0 } } });
  expect(state.past).toHaveLength(100);
  for (let i = 0; i < 110; i++) state = model.historyReducer(state, { type: 'undo' });
  expect(state.present.buildings[0]!.pos.x).toBe(10);
  expect(state.future).toHaveLength(100);
});
it('avoids collision with reopened building and obstacle ids', () => {
  const doc = blankDocument('na-model', 'green', 'medium');
  doc.elements = [{ id: 'b0', archetype: 'obstacle', variant: 'small', yawDeg: 0, pos: { x: 0, z: 0 } }];
  const next = model.reduceDocument(doc, { type: 'place', item: 'tower', pos: { x: 2, z: 2 } });
  expect(next.buildings[0]!.id).not.toBe('b0');
});

it('removes only scripts referencing deleted buildings including nested steps in one undo step', () => {
  const doc = blankDocument('na-script', 'green', 'medium');
  doc.buildings = [
    { id: 'b0', archetype: 'house-wt1', pos: { x: 0, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
    { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
  ];
  (doc.players[1]!.bot! as SeatBot).script = [{ op: 'delay', ms: 100 }, { op: 'steps', root: { goal: 'none', then: [{ goal: 'capture', target: 'b0' }] } }];
  doc.players.push({ id: 'p3', kind: 'ai', colorKey: 'green', bot: { kind: 'tw', actionDelayMs: 4000, behavior: 'full', script: [{ op: 'line', own: 'b1', target: null, afterMs: 0 }] } });
  let state = model.historyReducer(model.createHistory(doc), { type: 'edit', op: { type: 'delete', target: { kind: 'building', id: 'b0' } } });
  expect((state.present.players[1]!.bot! as SeatBot).script).toBeUndefined();
  expect(state.present.players[2]).toEqual(doc.players[2]);
  expect(state.past).toHaveLength(1);
  expect(model.scriptRemovalMessages(state)).toEqual(['AI 2 script removed']);
  state = model.historyReducer(state, { type: 'undo' });
  expect(state.present).toEqual(doc);
  expect(model.scriptRemovalMessages(state)).toEqual([]);
  state = model.historyReducer(state, { type: 'redo' });
  expect(model.scriptRemovalMessages(state)).toEqual(['AI 2 script removed']);
});

it('removes line own/target scripts but ignores unrelated buildings and obstacle identities', () => {
  for (const ref of ['own', 'target'] as const) {
    const doc = blankDocument('na-script', 'green', 'medium');
    doc.buildings = [{ id: 'b0', archetype: 'tower', pos: { x: 0, z: 0 }, owner: null, level: 1, ignoreForWin: false }];
    (doc.players[1]!.bot! as SeatBot).script = [{ op: 'line', own: null, target: null, afterMs: 0, [ref]: 'b0' }];
    expect((model.reduceDocument(doc, { type: 'delete', target: { kind: 'building', id: 'b0' } }).players[1]!.bot as SeatBot).script).toBeUndefined();
    expect(model.reduceDocument(doc, { type: 'delete', target: { kind: 'building', id: 'absent' } })).toBe(doc);
  }
});
