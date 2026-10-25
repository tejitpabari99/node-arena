import { expect, it } from 'vitest';
import { blankDocument } from '../../src/editor/document.js';
import { copySelection, createHistory, historyReducer, reduceDocument, snapPosition, snapYaw } from '../../src/editor/model.js';

function fixture() {
  const doc = blankDocument('na-layout', 'green', 'medium');
  doc.bounds = { minX: -4, maxX: 8, minZ: -6, maxZ: 10 };
  doc.buildings = [
    { id: 'b0', archetype: 'house-wt1', pos: { x: 1, z: 3 }, owner: 'p1', level: 1, ignoreForWin: false, params: { level: { maxLevel: 5 } } },
    { id: 'b1', archetype: 'house-wt1', pos: { x: 5, z: 1 }, owner: 'p2', level: 1, ignoreForWin: false },
    { id: 'b2', archetype: 'tower', pos: { x: 0, z: 0 }, owner: null, level: 1, ignoreForWin: false },
  ];
  doc.elements = [{ id: 'e0', archetype: 'obstacle', pos: { x: -1, z: 4 }, yawDeg: 225, variant: 'big' }];
  return doc;
}
it('coalesces multi-move into one exact undo', () => {
  const doc = fixture(), targets = [{ kind: 'building', id: 'b0' }, { kind: 'obstacle', id: 'e0' }] as const;
  const state = historyReducer(createHistory(doc), { type: 'edit', op: { type: 'move-selection', targets: [...targets], delta: { x: 1.25, z: -2.5 } } });
  expect(state.present.buildings[0]!.pos).toEqual({ x: 2.25, z: .5 });
  expect(state.present.elements[0]!.pos).toEqual({ x: .25, z: 1.5 });
  expect(state.past).toHaveLength(1); expect(historyReducer(state, { type: 'undo' }).present).toBe(doc);
});
it('copies and pastes detached item fields with collision-free identities and preserved offsets', () => {
  const doc = fixture(), clipboard = copySelection(doc, [{ kind: 'building', id: 'b0' }, { kind: 'obstacle', id: 'e0' }]);
  const next = reduceDocument(doc, { type: 'paste', clipboard, offset: { x: .5, z: .5 } });
  const again = reduceDocument(next, { type: 'paste', clipboard, offset: { x: 1, z: 1 } });
  expect(again.buildings.map(b => b.id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
  expect(again.elements.map(e => e.id)).toEqual(['e0', 'e1', 'e2']);
  expect(next.buildings[3]).toMatchObject({ pos: { x: 1.5, z: 3.5 }, owner: 'p1', params: { level: { maxLevel: 5 } } });
  (next.buildings[3]!.params!.level as { maxLevel: number }).maxLevel = 9;
  expect(doc.buildings[0]!.params!.level).toEqual({ maxLevel: 5 });
  expect(clipboard.buildings[0]!.params!.level).toEqual({ maxLevel: 5 });
});
it('snaps positions by .25 and yaw by 15 degrees, optionally preserving unsnapped values', () => {
  expect(snapPosition({ x: 1.13, z: -2.14 })).toEqual({ x: 1.25, z: -2.25 });
  expect(snapPosition({ x: 1.137, z: -2.146 }, false)).toEqual({ x: 1.14, z: -2.15 });
  expect(snapYaw(359.999, false)).toBe(0); expect(snapYaw(360)).toBe(0);
  expect(snapYaw(23)).toBe(30); expect(snapYaw(-23)).toBe(330); expect(snapYaw(23.127, false)).toBe(23.13);
});
it('grow-only bounds: no-op identity, one-side growth, no shrink, inside items ignored, undo restores', () => {
  const doc = fixture();
  const same = reduceDocument(doc, { type: 'move', target: { kind: 'building', id: 'b0' }, pos: { x: 2, z: 3 } });
  expect(same.bounds).toBe(doc.bounds);
  expect(reduceDocument(doc, { type: 'move', target: { kind: 'building', id: 'b0' }, pos: { x: 1, z: 3 } })).toBe(doc);
  const state = historyReducer(createHistory(doc), { type: 'edit', op: { type: 'place', item: 'tower', pos: { x: 10.5, z: 0 } } });
  expect(state.present.bounds).toEqual({ minX: -4, maxX: 13, minZ: -6, maxZ: 10 });
  expect(historyReducer(state, { type: 'undo' }).present.bounds).toEqual({ minX: -4, maxX: 8, minZ: -6, maxZ: 10 });
  const moved = reduceDocument(state.present, { type: 'move', target: { kind: 'building', id: 'b3' }, pos: { x: 0, z: 0 } });
  expect(moved.bounds).toEqual({ minX: -4, maxX: 13, minZ: -6, maxZ: 10 });
  const pasted = reduceDocument(doc, { type: 'paste', clipboard: copySelection(doc, [{ kind: 'building', id: 'b1' }]), offset: { x: 0, z: -9 } });
  expect(pasted.bounds).toEqual({ minX: -4, maxX: 8, minZ: -10, maxZ: 10 });
  const ms = reduceDocument(doc, { type: 'move-selection', targets: [{ kind: 'obstacle', id: 'e0' }], delta: { x: -10, z: 0 } });
  expect(ms.bounds).toEqual({ minX: -13, maxX: 8, minZ: -6, maxZ: 10 });
});

import { buildableArea, clampDelta, clampPoint } from '../../src/editor/model.js';
const A = { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };
it('buildableArea is 40x30 centred on bounds centre rounded to 0.25', () => {
  expect(buildableArea({ minX: -4, maxX: 8, minZ: -6, maxZ: 10 })).toEqual({ minX: -18, maxX: 22, minZ: -13, maxZ: 17 });
  expect(buildableArea({ minX: 0, maxX: 0.9, minZ: 0, maxZ: 0 })).toEqual({ minX: -19.5, maxX: 20.5, minZ: -15, maxZ: 15 });
});
it('clampPoint keeps inside points and pulls outside points to the edge', () => {
  expect(clampPoint({ x: 3, z: -4 }, A)).toEqual({ x: 3, z: -4 });
  expect(clampPoint({ x: 99, z: -99 }, A)).toEqual({ x: 20, z: -15 });
});
it('clampDelta clamps per axis, passes inside deltas, zeroes axes of groups wider than the area', () => {
  const pts = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
  expect(clampDelta(pts, { x: 2, z: 3 }, A)).toEqual({ x: 2, z: 3 });
  expect(clampDelta(pts, { x: 100, z: -100 }, A)).toEqual({ x: 15, z: -15 });
  expect(clampDelta([{ x: -30, z: 0 }, { x: 30, z: 2 }], { x: 5, z: 50 }, A)).toEqual({ x: 0, z: 13 });
});
it('reducer clamps place/move/move-selection/paste only when an area is carried', () => {
  const doc = blankDocument('na-clamp', 'green', 'medium');
  const far = { x: 50, z: -50 };
  const placed = (area?: typeof A) => historyReducer(createHistory(doc), { type: 'edit', op: { type: 'place', item: 'tower', pos: far }, ...(area ? { area } : {}) }).present;
  expect(placed(A).buildings[0]!.pos).toEqual({ x: 20, z: -15 });
  expect(placed().buildings[0]!.pos).toEqual(far);
  const base = placed(A), t = { kind: 'building', id: 'b0' } as const;
  expect(reduceDocument(base, { type: 'move', target: t, pos: { x: -99, z: 99 } }, A).buildings[0]!.pos).toEqual({ x: -20, z: 15 });
  expect(reduceDocument(base, { type: 'move', target: t, pos: { x: -99, z: 99 } }).buildings[0]!.pos).toEqual({ x: -99, z: 99 });
  expect(reduceDocument(base, { type: 'move-selection', targets: [t], delta: { x: 5, z: 0 } }, A).buildings[0]!.pos).toEqual({ x: 20, z: -15 });
  expect(reduceDocument(base, { type: 'move-selection', targets: [t], delta: { x: 5, z: 0 } }).buildings[0]!.pos).toEqual({ x: 25, z: -15 });
  const clipboard = { buildings: [{ ...base.buildings[0]!, pos: { x: 19, z: 0 } }, { ...base.buildings[0]!, id: 'x', pos: { x: 10, z: 0 } }], elements: [] };
  const pasted = reduceDocument(base, { type: 'paste', clipboard, offset: { x: 3, z: 0 } }, A).buildings.slice(1);
  expect(pasted.map(b => b.pos.x)).toEqual([20, 11]);
  expect(reduceDocument(base, { type: 'paste', clipboard, offset: { x: 3, z: 0 } }).buildings.slice(1).map(b => b.pos.x)).toEqual([22, 13]);
  // legacy item outside the area is untouched by unrelated ops
  const legacy = { ...base, buildings: [{ ...base.buildings[0]!, pos: { x: 90, z: 0 } }] };
  expect(reduceDocument(legacy, { type: 'level-properties', value: legacy }, A).buildings[0]!.pos.x).toBe(90);
});
