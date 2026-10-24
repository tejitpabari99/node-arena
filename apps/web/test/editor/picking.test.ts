import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { groundAt, pickObstacle } from '../../src/editor/picking.js';

// Catches canvas offsets, wrong data-z sign, missing root inverse and premature rounding.
describe('editor ground coordinates', () => {
  it('unprojects client coordinates through an offset canvas and transformed mirrored root', () => {
    const camera = new PerspectiveCamera(45, 2, .1, 100);
    camera.position.set(0, 16, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const root = new Group(); root.scale.z = -1; root.position.x = 2; root.updateMatrixWorld();
    const screen = new Vector3(1.234, 0, 2.346).applyMatrix4(root.matrixWorld).project(camera);
    const rect = { left: 240, top: 130, width: 800, height: 400 };
    expect(groundAt(rect.left + (screen.x + 1) * 400, rect.top + (1 - screen.y) * 200, rect, camera, root)).toEqual({ x: 1.23, z: 2.35 });
  });
  it('returns null for collapsed viewports and rays facing away from ground', () => {
    const camera = new PerspectiveCamera(); camera.position.y = 5; camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
    const root = new Group();
    expect(groundAt(50, 50, { left: 0, top: 0, width: 100, height: 100 }, camera, root)).toBeNull();
    expect(groundAt(0, 0, { left: 0, top: 0, width: 0, height: 0 }, camera, root)).toBeNull();
  });
});

// Catches center-only picking, wrong milli scale, wrong rotated box and unstable overlap choice.
describe('nearest obstacle footprint', () => {
  const circle = { id: 'circle', x: 1000, z: 2000, yawMilliDeg: 0, footprint: { shape: 'circle' as const, radius: 1000 } };
  const box = { id: 'box', x: 4000, z: 2000, yawMilliDeg: 90000, footprint: { shape: 'box' as const, w: 4000, d: 1000 } };
  it('hits circles and rotated boxes including their edges but ignores empty ground', () => {
    expect(pickObstacle({ x: 1, z: 3 }, [circle, box])).toBe('circle');
    expect(pickObstacle({ x: 4.49, z: .1 }, [circle, box])).toBe('box');
    expect(pickObstacle({ x: 4.6, z: 2 }, [circle, box])).toBeNull();
    expect(pickObstacle({ x: 9, z: 9 }, [circle, box])).toBeNull();
  });
  it('chooses the nearest center inside overlapping footprints; ties retain document order', () => {
    const second = { ...circle, id: 'second', x: 1500 };
    expect(pickObstacle({ x: 1.4, z: 2 }, [circle, second])).toBe('second');
    expect(pickObstacle({ x: 1.25, z: 2 }, [circle, second])).toBe('circle');
  });
});
