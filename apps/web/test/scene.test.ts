import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { CompiledLevel, Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { authoredBounds, fitCamera, levelVisualBounds } from '../src/render/camera.js';
import { qualitySettings } from '../src/render/scene.js';
import { createPrimitiveModel } from '../src/render/model.js';
import { Disposables } from '../src/render/disposables.js';
const manifest = structuredClone(manifestJSON) as Manifest;
describe('fixed fitted camera', () => {
  it('shipped steep camera (pitch 65, fov 35) fits the tower bounds at 16:9 and 16:10 with the top ray >= 40 deg below the horizon', () => {
    const settings = { pitchDeg: 65, fov: 35, margin: 3 };
    const bounds = new Box3(new Vector3(-50, 0, -30), new Vector3(50, 6, 30));
    const camera = new PerspectiveCamera();
    for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
      fitCamera(camera, bounds, settings, aspect);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const ndc = new Vector3(x, y, z).project(camera); expect(Math.abs(ndc.x)).toBeLessThan(1); expect(Math.abs(ndc.y)).toBeLessThan(1);
      }
      // Ray through the top-centre of the frame: its angle below horizontal.
      const top = new Vector3(0, 1, .5).unproject(camera).sub(camera.position).normalize();
      expect(-Math.asin(top.y) * 180 / Math.PI).toBeGreaterThanOrEqual(40);
    }
  });
  it.each([0, 1, 55, 89, 90])('fits all physical and label corners at pitch %s through portrait/landscape resizes', pitchDeg => {
    const bounds = new Box3(new Vector3(-25, -2, -10), new Vector3(45, 32, 65));
    const camera = new PerspectiveCamera();
    for (const aspect of [.12, .5, 1, 3, 12]) {
      fitCamera(camera, bounds, { pitchDeg, fov: 45, margin: 2 }, aspect);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const ndc = new Vector3(x, y, z).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1); expect(Math.abs(ndc.y)).toBeLessThan(1);
        expect(ndc.z).toBeGreaterThan(-1); expect(ndc.z).toBeLessThan(1);
      }
      const direction = camera.position.clone().sub(bounds.getCenter(new Vector3())).normalize();
      expect(direction.y).toBeCloseTo(Math.sin(pitchDeg * Math.PI / 180));
    }
  });
  it('converts compiled coordinates/radii once and includes scaled physical model height (roof), not label height, without changing inputs', () => {
    const m = structuredClone(manifest); m.visuals['test.tall'] = { kind: 'tower', model: 'block', scale: 2, yOffset: 3, label: { height: 20 } };
    const level = { bounds: { w: 100000, h: 80000 }, towers: [{ x: 10000, y: 30000, footprintRadius: 1000, visual: 'test.tall' }] } as CompiledLevel;
    const before = JSON.stringify(level); const model = createPrimitiveModel({ primitive: 'box', size: [4, 6, 4] });
    const bounds = levelVisualBounds(level, m, new Map([['block', model]]));
    expect(bounds.min.toArray()).toEqual([6, 0, 26]); expect(bounds.max.toArray()).toEqual([14, 15, 34]); // 3 + 6*2; label.height 20 is ignored
    expect(JSON.stringify(level)).toBe(before); new Disposables().object(model).dispose();
  });
  it('gives empty levels finite authored bounds in world units', () => {
    const bounds = levelVisualBounds({ towers: [], bounds: { w: 20000, h: 30000 } } as unknown as CompiledLevel, manifest, new Map());
    expect(bounds.min.toArray()).toEqual([-10, 0, -15]); expect(bounds.max.toArray()).toEqual([10, 0, 15]);
  });
  it('centres authored ground extents on the origin like tower coordinates', () => {
    const box = authoredBounds({ bounds: { w: 120000, h: 80000 } } as CompiledLevel);
    expect(box.getCenter(new Vector3()).toArray()).toEqual([0, 0, 0]);
    expect(box.getSize(new Vector3()).toArray()).toEqual([120, 0, 80]);
    expect(box.min.toArray()).toEqual([-60, 0, -40]);
  });
});
it('uses exact quality pixel ratios, shadow budgets and context antialias settings', () => {
  expect(qualitySettings('low', 3)).toEqual({ pixelRatio: 1, shadowSize: 0, antialias: false });
  expect(qualitySettings('med', 1)).toEqual({ pixelRatio: 1.5, shadowSize: 1024, antialias: true });
  expect(qualitySettings('high', 3)).toEqual({ pixelRatio: 2, shadowSize: 2048, antialias: true });
  expect(qualitySettings('high', 1)).toEqual({ pixelRatio: 1, shadowSize: 2048, antialias: true });
});
