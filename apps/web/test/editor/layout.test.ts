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
for (const axis of ['vertical', 'horizontal'] as const) for (const swapOwners of [false, true]) {
  it(`mirrors ${axis} coordinates and normalized yaw with owner swap ${swapOwners}`, () => {
    const doc = fixture();
    const result = reduceDocument(doc, { type: 'mirror', targets: [], axis, center: 2, swapOwners });
    expect(result.buildings.map(b => b.pos)).toEqual(axis === 'vertical' ? [{ x: 3, z: 3 }, { x: -1, z: 1 }, { x: 4, z: 0 }] : [{ x: 1, z: 1 }, { x: 5, z: 3 }, { x: 0, z: 4 }]);
    expect(result.elements[0]).toMatchObject(axis === 'vertical' ? { pos: { x: 5, z: 4 }, yawDeg: 315 } : { pos: { x: -1, z: 0 }, yawDeg: 135 });
    expect(result.buildings.map(b => b.owner)).toEqual(swapOwners ? ['p2', 'p1', null] : ['p1', 'p2', null]);
    expect(doc.elements[0]!.yawDeg).toBe(225);
  });
}
it('mirrors only selection and coalesces multi-move into one exact undo', () => {
  const doc = fixture(), targets = [{ kind: 'building', id: 'b0' }, { kind: 'obstacle', id: 'e0' }] as const;
  const mirrored = reduceDocument(doc, { type: 'mirror', targets: [...targets], axis: 'vertical', center: 0, swapOwners: true });
  expect(mirrored.buildings[1]).toBe(doc.buildings[1]); expect(mirrored.buildings[0]!.pos.x).toBe(-1);
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
it('auto-fits both buildings and obstacles with 2-unit margin as an undoable draft edit', () => {
  const doc = fixture(), state = historyReducer(createHistory(doc), { type: 'edit', op: { type: 'auto-fit' } });
  expect(state.present.bounds).toEqual({ minX: -3, maxX: 7, minZ: -2, maxZ: 6 });
  expect(doc.bounds).toEqual({ minX: -4, maxX: 8, minZ: -6, maxZ: 10 });
  expect(historyReducer(state, { type: 'undo' }).present).toBe(doc);
});
