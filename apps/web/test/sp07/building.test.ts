import { describe, expect, it } from 'vitest';
import { Group, Mesh, BoxGeometry, Object3D, Texture, MeshLambertMaterial } from 'three';
import type { SimEvent } from '@node-arena/defs';
import { createBuildingFactory, MILLI, PROJECTILE_MS, type BuildingRenderer, type BuildingInit } from '../../src/render/building.js';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache } from '../../src/render/gltf-cache.js';
import { RendererRegistry, type VisualDef } from '../../src/render/registry.js';
import type { LabelPainter } from '../../src/render/building-label.js';
import manifestJson from '../../assets/manifest.json';
import balance from '../../../../packages/content/data/balance.json';
import type { ManifestV2 } from '@node-arena/content';

const manifest = manifestJson as unknown as ManifestV2;
const THRESHOLDS = balance.stageThresholds as number[];
/** Same rule as sim stageOf (1-based); thresholds come from content, never literals here. */
const stageOf = (level: number) => 1 + THRESHOLDS.filter(t => t <= level).length;

const mesh = (name: string): Mesh => { const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial()); m.name = name; return m; };
function fakeScene(file: string, names: string[], extra: Record<string, [number, number, number]> = {}): Group {
  const scene = new Group(), root = new Group(); root.name = file;
  for (const n of names) root.add(mesh(n));
  for (const [n, p] of Object.entries(extra)) { const o = new Object3D(); o.name = n; o.position.set(...p); root.add(o); }
  scene.add(root); return scene;
}
const loaded: Record<string, Texture> = {};
const materials = new MaterialCache(path => (loaded[path] = new Texture()));
const scenes: Record<string, () => Group> = {};
const models = new ModelCache(async file => ({ scene: scenes[file]!() }));

function setup(visualId: string) {
  const visual = manifest.visuals[visualId] as VisualDef;
  const names = [...new Set((visual.stages ?? []).flatMap(s => ('enable' in s && s.enable ? s.enable : 'mesh' in s && s.mesh ? [s.mesh] : [])))];
  scenes[visual.model.parts] = () => fakeScene(visual.model.parts, names, { UIPosition: [0, 2, 0], ...(visualId === 'building.tower' ? { BulletPosition: [0, 1.3, 0] } : {}) });
  const proj = manifest.visuals['fx.projectile'] as VisualDef;
  scenes[proj.model.parts] = () => fakeScene(proj.model.parts, ['ball']);
  const calls: [number, number][] = [];
  const painter: LabelPainter = { texture(l, s) { calls.push([l, s]); const t = new Texture(); t.name = `${l}:${s}`; return t; }, dispose() {} };
  const reg = new RendererRegistry(); reg.register('building', createBuildingFactory({ painter, projectile: { visualId: 'fx.projectile', visual: proj } }));
  return { visual, calls, make: async () => (await reg.get('building')({ visualId, visual, materials, models })) as BuildingRenderer, proj };
}
const players = [{ kind: 'human', colorKey: 'blue' }, { kind: 'ai', colorKey: 'red' }] as const;
function frame(level: number, owner: number) {
  return { view: { players, buildings: { owner: [owner], level: [level], stage: [stageOf(level)] } } as never };
}
const inits: BuildingInit[] = [{ index: 0, id: 'b0', x: 2000, z: -3000, radius: 700 }];
const vis = (r: BuildingRenderer, ...names: string[]) => names.map(n => (r.root.getObjectByName(n) as Object3D).visible);

describe('building renderer: team textures', () => {
  it('captures swap the per-team texture on every mesh, neutral = gray', async () => {
    const { make, visual } = setup('building.house-wt1'); const r = await make(); r.setBuildings(inits);
    const tex = (visual.team!.textures as Record<string, string>);
    const mapOf = () => (r.pickMeshes[0]!.material as MeshLambertMaterial).map;
    r.update(frame(5, -1), [], 16); expect(mapOf()).toBe(loaded[tex['gray']!]);
    r.update(frame(5, 0), [], 16); expect(mapOf()).toBe(loaded[tex['blue']!]);
    r.update(frame(5, 1), [], 16); expect(mapOf()).toBe(loaded[tex['red']!]);
    expect(new Set(r.pickMeshes.map(m => m.material)).size).toBe(1);
  });
});

describe('building renderer: stages follow view stage (content thresholds)', () => {
  it('house wt1 swaps stage meshes exactly at the content thresholds', async () => {
    const { make } = setup('building.house-wt1'); const r = await make(); r.setBuildings(inits);
    const [t1, t2] = [THRESHOLDS[0]!, THRESHOLDS[1]!];
    for (const [lvl, want] of [[t1 - 1, [true, false, false]], [t1, [false, true, false]], [t2 - 1, [false, true, false]], [t2, [false, false, true]]] as const) {
      r.update(frame(lvl, 0), [], 16); expect(vis(r, 'stage0', 'stage1', 'stage2'), `level ${lvl}`).toEqual(want);
    }
    expect([t1, t2]).toEqual([10, 30]);
  });
  it('factory stages are enable-lists; pick meshes track visibility', async () => {
    const { make, visual } = setup('building.house-wt2'); const r = await make(); r.setBuildings(inits);
    const lists = visual.stages!.map(s => new Set((s as { enable: string[] }).enable));
    for (const lvl of [1, THRESHOLDS[0]!, THRESHOLDS[1]!]) {
      r.update(frame(lvl, 0), [], 16);
      const want = lists[stageOf(lvl) - 1]!;
      expect(new Set(r.pickMeshes.map(m => m.name))).toEqual(want);
      expect(r.pickMeshes.every(m => m.userData['buildingIndex'] === 0)).toBe(true);
    }
    expect(r.root.getObjectByName('SecondLevelSmallPipe_0')!.visible).toBe(false);
  });
});

describe('building renderer: labels, anchors, ring, shots', () => {
  it('label texture updates on level/stage change only; sits outside root at uiPosition height', async () => {
    const { make, calls, visual } = setup('building.house-wt1'); const r = await make(); r.setBuildings(inits);
    r.update(frame(5, 0), [], 16); r.update(frame(5, 0), [], 16); expect(calls).toEqual([[5, 0]]);
    r.update(frame(6, 0), [], 16); r.update(frame(THRESHOLDS[0]!, 0), [], 16);
    expect(calls).toEqual([[5, 0], [6, 0], [THRESHOLDS[0]!, 1]]);
    expect(r.labelRoot.children).toHaveLength(1); expect(r.root.getObjectByName('b0')!.children.some(c => (c as { isSprite?: boolean }).isSprite)).toBe(false);
    const a = r.anchors.building('b0')!;
    expect(a.pos.toArray()).toEqual([2000 / MILLI, 0, -3000 / MILLI]); expect(a.radius).toBeCloseTo(0.7);
    expect(a.labelPos.y).toBeCloseTo(visual.label!.height);
    expect(r.anchors.building('nope')).toBeUndefined();
  });
  it('label follows a mirrored worldRoot (z flipped)', async () => {
    const { make } = setup('building.house-wt1'); const r = await make(); r.setBuildings(inits);
    const wr = new Group(); wr.scale.z = -1; wr.add(r.root); r.bindWorldRoot(wr);
    r.update(frame(5, 0), [], 16);
    expect(r.labelRoot.children[0]!.position.z).toBeCloseTo(3);
    expect(r.labelRoot.children[0]!.position.x).toBeCloseTo(2);
  });
  it('tower range ring uses sim.towerRadiusMilli; shot spawns projectile with owner team and lands', async () => {
    const { make, proj } = setup('building.tower'); const r = await make(); r.setBuildings(inits);
    const sim = { towerRadiusMilli: (_v: unknown, b: number) => (b === 0 ? 4500 : 0) };
    r.update(frame(5, 0), [], 16, sim);
    const ring = r.root.getObjectByName('b0')!.children.find(c => c.scale.x === 4.5)!; expect(ring.visible).toBe(true);
    const ev = { type: 'TowerShot', tower: 0, target: { kind: 'troop' }, x: 5000, z: 0 } as unknown as SimEvent;
    r.update(frame(5, 0), [ev], 0, sim);
    const shot = r.root.children.find(c => c.name !== 'b0')!; expect(shot).toBeDefined();
    const sm = shot.children[0] as Mesh; expect((sm.material as MeshLambertMaterial).map).toBe(loaded[(proj.team!.textures as Record<string, string>)['blue']!]);
    r.update(frame(5, 0), [], PROJECTILE_MS / 2, sim); expect(shot.position.x).toBeGreaterThan(2); expect(shot.position.x).toBeLessThan(5);
    r.update(frame(5, 0), [], PROJECTILE_MS, sim); expect(r.root.children.filter(c => c.name !== 'b0')).toHaveLength(0);
  });
  it('select shows a ring on a house; dispose is safe', async () => {
    const { make } = setup('building.house-wt1'); const r = await make(); r.setBuildings(inits);
    r.update(frame(5, 0), [], 16); expect(r.root.getObjectByName('b0')!.children.filter(c => c.scale.x > 0.99 && (c as Mesh).isMesh && !c.name)).toBeDefined();
    r.select(0); r.update(frame(5, 0), [], 16);
    const ring = r.root.getObjectByName('b0')!.children.find(c => c.position.y === 0.02)!; expect(ring.visible).toBe(true);
    r.select(null); r.update(frame(5, 0), [], 16); expect(ring.visible).toBe(false);
    r.dispose();
  });
});
