import { expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createCutTrail } from '../../src/input/trail.js';

function fixture(reduced = false) {
  let time = 0;
  const camera = new PerspectiveCamera(); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const trail = createCutTrail(camera, { now: () => time, reducedMotion: () => reduced });
  return { trail, camera, at(value: number) { time = value; trail.refresh(); } };
}
it('fades individual points over 250ms and keeps the remaining ribbon after release', () => {
  const { trail, at } = fixture();
  trail.append({ x: 0, y: 0, z: 0 }); at(50); trail.append({ x: 1, y: 0, z: 0 }); trail.refresh();
  const colors = trail.mesh.geometry.getAttribute('color');
  expect(trail.mesh.visible).toBe(true); expect(colors.getW(2)).toBeCloseTo(.8); expect(colors.getW(6)).toBe(1);
  trail.release(); trail.refresh();
  expect(trail.mesh.visible).toBe(true); expect(colors.getW(6)).toBe(1);
  at(150); expect(colors.getW(2)).toBeCloseTo(.4); expect(colors.getW(6)).toBeCloseTo(.6);
  at(300); expect(trail.mesh.visible).toBe(false); expect(trail.mesh.geometry.drawRange.count).toBe(0);
  trail.dispose();
});
it('expands camera-facing glow and core strips to .25 and .08 world units', () => {
  const { trail } = fixture();
  trail.append({ x: 0, y: 0, z: 0 }); trail.append({ x: 1, y: 0, z: 0 }); trail.refresh();
  const p = trail.mesh.geometry.getAttribute('position'), color = trail.mesh.geometry.getAttribute('color');
  expect(Math.abs(p.getY(1) - p.getY(0))).toBeCloseTo(.25);
  expect(Math.abs(p.getY(3) - p.getY(2))).toBeCloseTo(.08);
  expect(color.getW(0)).toBeGreaterThan(0); expect(color.getW(0)).toBeLessThan(color.getW(2));
  trail.dispose();
});
it('keeps buffers bounded to 128 points and reuses storage when refreshed', () => {
  const { trail, at } = fixture(), geometry = trail.mesh.geometry;
  const positions = geometry.getAttribute('position').array, colors = geometry.getAttribute('color').array, indices = geometry.index!.array;
  for (let i = 0; i < 140; i++) { at(i); trail.append({ x: i, y: 0, z: 0 }); }
  trail.refresh();
  expect(geometry.getAttribute('position').count).toBe(512);
  expect(geometry.drawRange.count).toBe(127 * 12);
  expect(geometry.getAttribute('position').getX(0)).toBe(12);
  at(150);
  expect(geometry.getAttribute('position').array).toBe(positions); expect(geometry.getAttribute('color').array).toBe(colors); expect(geometry.index!.array).toBe(indices);
  trail.dispose();
});
it('keeps released strokes fading without drawing a bridge to the next stroke', () => {
  const { trail } = fixture();
  trail.append({ x: 0, y: 0, z: 0 }); trail.append({ x: 1, y: 0, z: 0 }); trail.release();
  trail.append({ x: 10, y: 0, z: 0 }); trail.append({ x: 11, y: 0, z: 0 }); trail.refresh();
  const index = trail.mesh.geometry.index!;
  expect(trail.mesh.visible).toBe(true);
  for (let i = 12; i < 24; i++) expect(index.getX(i)).toBe(4);
  trail.dispose();
});
it('uses a short fade with no glow for reduced motion', () => {
  const { trail, at } = fixture(true);
  trail.append({ x: 0, y: 0, z: 0 }); at(10); trail.append({ x: 1, y: 0, z: 0 }); trail.refresh(); trail.release();
  const colors = trail.mesh.geometry.getAttribute('color');
  expect(colors.getW(0)).toBe(0); expect(colors.getW(2)).toBeGreaterThan(0); expect(trail.mesh.visible).toBe(true);
  at(70); expect(trail.mesh.visible).toBe(false);
  trail.dispose();
});
