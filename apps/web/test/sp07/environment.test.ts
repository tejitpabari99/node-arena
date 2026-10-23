import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Matrix4, Mesh, Quaternion, Texture, Vector3, type MeshBasicMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RENDER_KINDS } from '@node-arena/defs';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache, type LoadedGltf } from '../../src/render/gltf-cache.js';
import { RendererRegistry, defaultRegistry } from '../../src/render/registry.js';
import { createGroundRenderer, planGround, readGroundPrefab, GROUND_MARGIN } from '../../src/render/ground-renderer.js';
import { childIndex, createElementRenderer, placeObstacles, type ChildExtra, type ElementInstance } from '../../src/render/element-renderer.js';
import { createLaneRenderer, laneTiles, LANE_SCROLL } from '../../src/render/lane-renderer.js';
import { createEnvironment } from '../../src/render/environment.js';
import manifestJson from '../../assets/manifest.json';
import type { ManifestV2 } from '@node-arena/content';

const manifest = manifestJson as unknown as ManifestV2;
const loadGlb = async (file: string): Promise<LoadedGltf> => {
  const b = fs.readFileSync(path.resolve(__dirname, '../../assets', file));
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', g => res(g), rej));
};
const mk = () => ({ materials: new MaterialCache(() => new Texture()), models: new ModelCache(loadGlb) });
const ctx = (id: string) => ({ visualId: id, visual: manifest.visuals[id]!, ...mk() });
const L4 = { minX: -9000, maxX: 6000, minZ: -7000, maxZ: 8000 }, L21 = { minX: -10000, maxX: 10000, minZ: -7000, maxZ: 7000 };

describe('registration', () => {
  it('ground, element, lane are in the default registry', async () => {
    expect(defaultRegistry.has('ground') && defaultRegistry.has('element') && defaultRegistry.has('lane')).toBe(true);
    const r = new RendererRegistry(); for (const k of RENDER_KINDS) r.register(k, () => ({ dispose() {} }));
    expect(r.kinds().length).toBe(RENDER_KINDS.length);
  });
});

describe('ground sizing', () => {
  const green = { scaleX: 6, scaleZ: 10, meshSize: 10, uvRepeat: [3, 3] as const, uvOffset: [0, -0.05] as const };
  const snow = { scaleX: 18.8618, scaleZ: 15.7, meshSize: 10, uvRepeat: [3, 3] as const, uvOffset: [0, -0.05] as const };
  it('never smaller than the prefab (quarter turn: prefab z -> data x), keeps tile size', () => {
    const p = planGround(L4, green);
    expect(p.halfX).toBe(50); expect(p.halfZ).toBe(30);
    expect(p.repeatV).toBeCloseTo(3); expect(p.repeatU).toBeCloseTo(3); // full prefab = 3 tiles
    const s = planGround(L21, snow);
    expect(s.halfX).toBeCloseTo(78.5); expect(s.halfZ).toBeCloseTo(94.309);
  });
  it('covers bounds + margin on every side, any bounds (no void)', () => {
    for (const b of [L4, L21, { minX: -60000, maxX: 55000, minZ: -45000, maxZ: 70000 }, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }]) {
      for (const prefab of [green, snow]) {
        const p = planGround(b, prefab, GROUND_MARGIN);
        expect(p.halfX).toBeGreaterThanOrEqual(Math.max(-b.minX, b.maxX) / 1000 + GROUND_MARGIN - 1e-9);
        expect(p.halfZ).toBeGreaterThanOrEqual(Math.max(-b.minZ, b.maxZ) / 1000 + GROUND_MARGIN - 1e-9);
      }
    }
    const big = planGround({ minX: -60000, maxX: 55000, minZ: 0, maxZ: 0 }, green);
    expect(big.halfX).toBe(72); expect(big.repeatV).toBeCloseTo((2 * 72) / (100 / 3)); // density constant
  });
  it('reads the shipped GLBs and builds a rotated, scaled plane with Repeat wrap', async () => {
    for (const theme of ['green', 'snow'] as const) {
      const c = ctx('ground'), g = createGroundRenderer(c), t = manifest.themes[theme]!;
      const { prefab } = readGroundPrefab((await loadGlb(t.ground.mesh)).scene);
      expect(prefab.uvRepeat).toEqual([3, 3]); expect(prefab.meshSize).toBe(10);
      const plan = await g.setLevel(L4, t);
      const m = g.root.children[0] as Mesh;
      expect(m.rotation.y).toBeCloseTo(Math.PI / 2);
      // local x -> data z, local z -> data x: world half extents = plan
      m.updateMatrixWorld(true); m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      expect(box.max.x).toBeCloseTo(plan.halfX); expect(box.max.z).toBeCloseTo(plan.halfZ); expect(box.min.x).toBeCloseTo(-plan.halfX);
      const tex = c.materials.texture(t.ground.texture);
      expect(tex.wrapS).toBe(1002); expect(tex.repeat.x).toBeCloseTo(plan.repeatU);
      expect(g.plan).toBe(plan); g.dispose(); expect(g.root.children.length).toBe(0);
    }
  });
});

describe('obstacles', () => {
  const children: ChildExtra[] = [
    { index: 0, variant: 'big', scale: [1, 0.9, 1] }, { index: 1, variant: 'small', scale: [0.855, 0.77, 0.855] }, { index: 2, variant: 'big', scale: [1.19, 1.19, 1.19] },
  ];
  const el = (id: string, x: number, z: number, yaw: number, variant?: string): ElementInstance => ({ id, x, z, yawMilliDeg: yaw, visual: 'element.obstacle', ...(variant && { variant }) });
  it('parses the child index from the element id', () => { expect(childIndex('o3-7')).toBe(7); expect(childIndex('o12-0')).toBe(0); expect(childIndex('x')).toBeUndefined(); });
  it('variant from element, child scale by k, pose in scene units; other visuals ignored', () => {
    const els = [el('o1-0', 1000, -2000, 90000, 'big'), el('o1-1', 3500, 500, 0, 'small'), { ...el('o1-2', 0, 0, 0, 'big'), visual: 'element.tree' }];
    const p = placeObstacles(els, 'element.obstacle', children);
    expect(p.length).toBe(2);
    expect(p[0]).toEqual({ variant: 'big', x: 1, z: -2, yaw: Math.PI / 2, scale: [1, 0.9, 1] });
    expect(p[1]!.variant).toBe('small'); expect(p[1]!.scale).toEqual([0.855, 0.77, 0.855]);
  });
  it('inactive children (absent elements) produce no instances; unknown index falls back to scale 1 and child variant', () => {
    const p = placeObstacles([el('o1-0', 0, 0, 0), el('o1-2', 0, 0, 0)], 'element.obstacle', children); // k=1 inactive, not emitted
    expect(p.map(q => q.variant)).toEqual(['big', 'big']);
    expect(placeObstacles([el('o1-7', 0, 0, 0)], 'element.obstacle', children)[0]!.scale).toEqual([1, 1, 1]);
  });
  it('instances real GLB meshes per variant (2 draws max), matrix = T*Ry*S*base', async () => {
    for (const theme of ['green', 'snow'] as const) {
      const r = createElementRenderer(ctx('element.obstacle'));
      const els = [el('o1-0', 1000, -2000, 90000), el('o1-1', 3000, 0, 0), el('o2-3', -4000, 1000, 45000), el('o2-5', 0, 5000, 0)];
      await r.setLevel(els, manifest.themes[theme]!.obstacle, theme);
      expect(r.counts).toEqual({ small: 2, big: 2 }); expect(r.drawCalls).toBe(2);
      const big = r.root.children.find(c => c.name === 'obstacle:big') as import('three').InstancedMesh;
      const m = new Matrix4(); big.getMatrixAt(0, m);
      const pos = new Vector3(), q = new Quaternion(), s = new Vector3(); m.decompose(pos, q, s);
      expect(pos.x).toBeCloseTo(1); expect(pos.z).toBeCloseTo(-2); expect(pos.y).toBe(0); big.geometry.computeBoundingBox(); expect(big.geometry.boundingBox!.min.y).toBeGreaterThan(0); // base offset + mesh scale live in the geometry/node matrix
      expect(s.x).toBeCloseTo(1.0181, 3); expect(s.y).toBeCloseTo(0.9195, 3);
      expect(new Vector3(1, 0, 0).applyQuaternion(q).z).toBeCloseTo(-1); // yaw +90 about y
      await r.setLevel([], manifest.themes[theme]!.obstacle, theme); expect(r.root.children.length).toBe(0); expect(r.drawCalls).toBe(0);
    }
  });
});

describe('lanes', () => {
  const bs = [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 0, z: 3000 }, { x: 4000, z: 3000 }] as never;
  const players = [{ kind: 'human', colorKey: 'blue' }, { kind: 'ai', colorKey: 'red' }] as never;
  const line = (from: number, to: number, owner: number) => ({ channel: from * 4 + to, from, to, owner, length: 0, drawSeq: 0 });
  const view = (lines: ReturnType<typeof line>[]) => ({ lines, buildingStatic: bs, players });
  const palettes = manifest.palettes;
  const mesh = (r: ReturnType<typeof createLaneRenderer>, i: number) => r.root.children[i] as Mesh;

  it('ribbon geometry: width 0.6, centred, yaw along from->to, UV tiles = length/width', () => {
    const r = createLaneRenderer(ctx('lane'), { palettes });
    r.update(view([line(0, 1, 0), line(0, 2, 1)]), 0);
    const a = mesh(r, 1); // index 0 = preview
    expect(a.position.x).toBeCloseTo(2); expect(a.scale.x).toBeCloseTo(4); expect(a.scale.z).toBeCloseTo(0.6); expect(a.rotation.y).toBeCloseTo(0);
    const uv = a.geometry.getAttribute('uv'); const us = [...Array(uv.count).keys()].map(i => uv.getX(i));
    expect(Math.max(...us)).toBeCloseTo(laneTiles(4, 0.6, 1)); expect(Math.min(...us)).toBe(0);
    const b = mesh(r, 2); expect(b.scale.x).toBeCloseTo(3); expect(new Vector3(1, 0, 0).applyEuler(b.rotation).z).toBeCloseTo(1); // +x local -> +z
  });
  it('per-team colour (palette) at manifest alpha, texture is the lane-wave beam', () => {
    const r = createLaneRenderer(ctx('lane'), { palettes });
    r.update(view([line(0, 1, 0), line(2, 3, 1), line(0, 3, 0)]), 0);
    const mat = (i: number) => mesh(r, i).material as MeshBasicMaterial;
    expect(mat(1).color.getHexString()).toBe(new (mat(1).color.constructor as typeof import('three').Color)(palettes.blue).getHexString());
    expect(mat(2).color.getHexString()).not.toBe(mat(1).color.getHexString());
    expect(mat(1)).toBe(mat(3)); expect(mat(1).opacity).toBeCloseTo(0.502); expect(mat(1).transparent).toBe(true);
  });
  it('UV scroll advances toward `to` (offset decreases mod 1) and wraps', () => {
    const c = ctx('lane'), r = createLaneRenderer(c, { palettes });
    r.update(view([line(0, 1, 0)]), 0); expect(r.scrollOffset).toBe(0);
    r.update(view([line(0, 1, 0)]), 500);
    expect(r.scrollOffset).toBeCloseTo(1 - 0.5 * LANE_SCROLL);
    const tex = (mesh(r, 1).material as MeshBasicMaterial).map!;
    expect(tex.offset.x).toBeCloseTo(r.scrollOffset); expect(tex.wrapS).toBe(1000);
    r.update(view([line(0, 1, 0)]), 2000); expect(r.scrollOffset).toBeCloseTo(0.75); // 2.5 s * 0.5 = 1.25 -> frac
  });
  it('pools meshes: grow-only, reuse, hide extras, no re-creation on churn', () => {
    const r = createLaneRenderer(ctx('lane'), { palettes });
    r.update(view([line(0, 1, 0), line(0, 2, 0), line(1, 3, 1)]), 16);
    expect(r.stats.created).toBe(3); expect(r.stats.active).toBe(3);
    const first = mesh(r, 1), geo = first.geometry;
    r.update(view([line(2, 3, 1)]), 16);
    expect(r.stats.created).toBe(3); expect(r.stats.active).toBe(1);
    expect(mesh(r, 1)).toBe(first); expect(first.geometry).toBe(geo); expect(first.visible).toBe(true);
    expect(mesh(r, 2).visible).toBe(false); expect(mesh(r, 3).visible).toBe(false);
    for (let i = 0; i < 50; i++) r.update(view([line(0, 1, 0), line(1, 3, 1), line(0, 2, 1)]), 16);
    expect(r.stats.created).toBe(3); expect(r.root.children.length).toBe(4); // preview + 3
    r.update(view([line(0, 1, 0), line(0, 2, 1), line(1, 3, 1), line(2, 3, 0)]), 16); expect(r.stats.created).toBe(4);
  });
  it('previewLane: independent of the pool, team tinted, clearable', () => {
    const r = createLaneRenderer(ctx('lane'), { palettes });
    r.previewLane({ x: 1, z: 1 }, { x: 1, z: 4 }, 'blue');
    const p = mesh(r, 0);
    expect(r.stats.previewVisible).toBe(true); expect(p.visible).toBe(true); expect(p.scale.x).toBeCloseTo(3); expect(p.position.z).toBeCloseTo(2.5);
    expect((p.material as MeshBasicMaterial).color.getHexString()).toBe('2e8bff');
    r.update(view([]), 16); expect(p.visible).toBe(true); expect(r.stats.created).toBe(0);
    r.previewLane({ x: 0, z: 0 }, { x: 0, z: 0 }, 'red'); expect(r.stats.previewVisible).toBe(false); // degenerate -> hidden
    r.previewLane({ x: 0, z: 0 }, { x: 2, z: 0 }); expect((p.material as MeshBasicMaterial).color.getHexString()).toBe('8c8c8c');
    r.clearPreview(); expect(p.visible).toBe(false);
  });
});

describe('environment composite', () => {
  it('sets theme light + ground + obstacles for both themes', async () => {
    for (const [theme, bounds] of [['green', L4], ['snow', L21]] as const) {
      const { materials, models } = mk(), env = createEnvironment(manifest, materials, models);
      await env.setLevel({ bounds, elements: [{ id: 'o1-0', x: 0, z: 0, yawMilliDeg: 0, visual: 'element.obstacle', variant: 'big' }] }, theme);
      expect(env.light?.directional.intensity).toBeCloseTo(0.2 * Math.PI); expect(env.ground.plan).not.toBeNull(); expect(env.elements.counts.big).toBe(1);
      await expect(env.setLevel({ bounds, elements: [] }, 'lava')).rejects.toThrow(/Unresolved theme/);
      env.dispose();
    }
  });
});
