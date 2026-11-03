import { expect, it } from 'vitest';
import { pickBuilding } from '../../src/input/geometry.js';
import { createGestureMachine } from '../../src/input/gestures.js';

const anchors = [{ pos: { x: 0, z: 0 }, radius: .75 }];
const screens = [{ x: 0, y: 0, radius: 75 }];
function gesture(building: number | null, owned = true) {
  const machine = createGestureMachine({ now: () => 0, diagonal: () => 1000, own: () => owned,
    canDraw: () => true, draw: () => {}, stroke: () => {}, preview: () => {}, clear: () => {}, eraser: () => {}, trail: () => {} });
  machine.down(1, 'mouse', 0, { x: 0, y: 0, building });
  return machine.mode;
}
it('presses 1.05 from a .75 footprint start pending-draw; 1.2 remains pending-cut', () => {
  expect(gesture(pickBuilding({ x: 1.05, z: 0 }, { x: 105, y: 0 }, anchors, screens))).toBe('pending-draw');
  expect(gesture(pickBuilding({ x: 1.2, z: 0 }, { x: 120, y: 0 }, anchors, screens))).toBe('pending-cut');
});
it('applies a 22px floor when the projected radius plus margin is small', () => {
  const small = [{ x: 0, y: 0, radius: 5 }];
  expect(gesture(pickBuilding({ x: 3, z: 0 }, { x: 21, y: 0 }, anchors, small))).toBe('pending-draw');
  expect(pickBuilding({ x: 3, z: 0 }, { x: 22, y: 0 }, anchors, small)).toBe(0);
  expect(gesture(pickBuilding({ x: 3, z: 0 }, { x: 23, y: 0 }, anchors, small))).toBe('pending-cut');
  // A full-size projected building uses the world radius instead of a pixel magnet.
  expect(pickBuilding({ x: 1.2, z: 0 }, { x: 21, y: 0 }, anchors, screens)).toBe(null);
});
it('chooses the nearest center where floors overlap, independent of array order', () => {
  const buildings = [anchors[0]!, { pos: { x: 3.5, z: 0 }, radius: .75 }];
  const projected = [{ x: 0, y: 0, radius: 2 }, { x: 30, y: 0, radius: 2 }];
  expect(pickBuilding({ x: 2.45, z: 0 }, { x: 21, y: 0 }, buildings, projected)).toBe(1);
  expect(pickBuilding({ x: 2.45, z: 0 }, { x: 21, y: 0 }, [...buildings].reverse(), [...projected].reverse())).toBe(0);
});
it('uses center distance rather than normalizing by different building radii', () => {
  expect(pickBuilding({ x: .8, z: 0 }, { x: 80, y: 0 }, [anchors[0]!, { pos: { x: 2, z: 0 }, radius: 2 }],
    [screens[0]!, { x: 200, y: 0, radius: 200 }])).toBe(0);
});
it('ignores non-owned buildings over both the enlarged world radius and touch floor', () => {
  expect(gesture(pickBuilding({ x: 1.05, z: 0 }, { x: 105, y: 0 }, anchors, screens), false)).toBe('idle');
  expect(gesture(pickBuilding({ x: 3, z: 0 }, { x: 21, y: 0 }, anchors, [{ x: 0, y: 0, radius: 5 }]), false)).toBe('idle');
});
