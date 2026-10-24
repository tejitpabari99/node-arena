import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { fitCamera, levelVisualBounds, zoomFraming, ZOOM_CLOSE, ZOOM_NEAR } from '../../src/render/camera.js';

const settings = { fov: 21, pitchDeg: 55, margin: 3 };
const padding = { left: 36, right: 52, top: 104, bottom: 64 };
const sizes = [[1280,720], [1600,900], [1920,1080], [1366,768], [2560,1080], [1024,768]];
const corners = (b: Box3) => [b.min.x,b.max.x].flatMap(x => [b.min.y,b.max.y].flatMap(y => [b.min.z,b.max.z].map(z => new Vector3(x,y,z))));
describe('landscape camera', () => {
  it('unions milli-unit sim bounds with data-frame anchors, mirrored once', () => {
    const bounds = levelVisualBounds({ bounds: { minX: -1000, maxX: 2000, minZ: -3000, maxZ: 4000 } }, ['edge'], {
      building: () => ({ pos: new Vector3(5,0,7), radius: 2, labelPos: new Vector3(5,4,7) }),
    });
    expect(bounds.min.toArray()).toEqual([-1,0,-9]);
    expect(bounds.max.toArray()).toEqual([7,6,3]);
  });
  it('includes an off-centre renderer label anchor in the fit', () => {
    const bounds = levelVisualBounds({ bounds: { minX:-1000,maxX:1000,minZ:-1000,maxZ:1000 } }, ['label'], {
      building: () => ({pos:new Vector3(),radius:1,labelPos:new Vector3(8,5,9)}),
    });
    expect(bounds.containsPoint(new Vector3(8,5,-9))).toBe(true);
  });
  for (const [width,height] of sizes) it(`fits all 3D corners inside HUD edges at ${width}x${height}`, () => {
    const bounds = new Box3(new Vector3(-16,0,-7),new Vector3(19,8,12));
    const camera = new PerspectiveCamera();
    fitCamera(camera,bounds,{...settings, margin: 0},width!/height!,{width: width!,height: height!,padding});
    for (const p of corners(bounds)) {
      p.project(camera); const x = (p.x+1)*width!/2, y = (1-p.y)*height!/2;
      expect(x).toBeGreaterThanOrEqual(padding.left); expect(x).toBeLessThanOrEqual(width!-padding.right);
      expect(y).toBeGreaterThanOrEqual(padding.top); expect(y).toBeLessThanOrEqual(height!-padding.bottom);
      expect(p.z).toBeGreaterThan(-1); expect(p.z).toBeLessThan(1);
    }
    const origin = new Vector3().project(camera), right = new Vector3(1,0,0).project(camera), north = new Vector3(0,0,-1).project(camera);
    expect(right.x).toBeGreaterThan(origin.x); expect(north.y).toBeGreaterThan(origin.y);
    expect(camera.fov).toBe(21);
    expect(camera.rotation.z).toBeCloseTo(0);
  });
  it('keeps a temporarily tiny host finite and the arena on screen', () => {
    const camera = new PerspectiveCamera(), bounds = new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1));
    fitCamera(camera,bounds,settings,1,{width:1,height:1,padding});
    const center = bounds.getCenter(new Vector3()).project(camera);
    expect(Math.abs(center.x)).toBeLessThan(1); expect(Math.abs(center.y)).toBeLessThan(1);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });
  it('clears an old view offset when fit without HUD margins', () => {
    const camera = new PerspectiveCamera(), bounds = new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1));
    fitCamera(camera,bounds,settings,16/9,{width:1600,height:900,padding});
    fitCamera(camera,bounds,settings,4/3);
    expect(camera.view?.enabled ?? false).toBe(false);
  });
  it('zoom framing: near tighter than 1, close tighter than near, stays centred and projects correctly', () => {
    expect(zoomFraming(false)).toBe(ZOOM_NEAR); expect(zoomFraming(true)).toBe(ZOOM_CLOSE);
    expect(ZOOM_NEAR).toBeLessThan(1); expect(ZOOM_CLOSE).toBeLessThan(ZOOM_NEAR);
    const bounds = new Box3(new Vector3(-16,0,-7),new Vector3(19,8,12)), vp = {width:1600,height:900,padding};
    const dist = (f: number) => { const c = new PerspectiveCamera(); fitCamera(c,bounds,settings,16/9,vp,f); return { d: c.position.distanceTo(bounds.getCenter(new Vector3())), c }; };
    const full = dist(1), near = dist(ZOOM_NEAR), close = dist(ZOOM_CLOSE);
    expect(near.d).toBeLessThan(full.d); expect(close.d).toBeLessThan(near.d);
    const mid = bounds.getCenter(new Vector3()).project(close.c);
    expect(Math.abs(mid.x)).toBeLessThan(0.1);
  });
});
