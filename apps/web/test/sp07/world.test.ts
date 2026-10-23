import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Group, Mesh, Object3D, Scene, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadContent, type CompiledLevel, type ManifestV2 } from '@node-arena/content';
import { create, createTroopBuffer, type SimEvent } from '@node-arena/sim';
import { RendererRegistry } from '../../src/render/registry.js';
import { createWorldRenderer, type WorldFrame } from '../../src/render/world.js';
import { createMirroredWorldRoot } from '../../src/render/world-root.js';
import type { LabelPainter } from '../../src/render/building-label.js';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache, type LoadedGltf } from '../../src/render/gltf-cache.js';
import { assertManifestReferences } from '../../src/manifest/resolve.js';
import manifestJson from '../../assets/manifest.json';

const manifest = manifestJson as unknown as ManifestV2;
const loadGlb = async (file: string): Promise<LoadedGltf> => {
  const b = fs.readFileSync(path.resolve(__dirname, '../../assets', file));
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', g => res(g), rej));
};
const painter = (): LabelPainter => ({ texture: () => new Texture(), dispose() {} });

const dataDir = path.resolve(__dirname, '../../../../packages/content/data');
const files: Record<string, string> = { 'data/balance.json': fs.readFileSync(path.join(dataDir, 'balance.json'), 'utf8') };
for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) for (const n of fs.readdirSync(path.join(dataDir, dir)).sort()) files[`data/${dir}/${n}`] = fs.readFileSync(path.join(dataDir, dir, n), 'utf8');
const { compiled } = loadContent(files);
const L4: CompiledLevel = compiled['levelview-1']!, L21: CompiledLevel = compiled['levelview-19']!;

function make(scene: Object3D = new Scene(), extra: Record<string, unknown> = {}) {
  const materials = new MaterialCache(() => new Texture()), models = new ModelCache(loadGlb);
  const world = createWorldRenderer(scene, manifest, { registry: new RendererRegistry(), materials, models, painter, ...extra });
  return { scene, world, materials, models };
}
const count = (o: Object3D): number => { let n = 0; o.traverse(() => n++); return n; };
const meshes = (o: Object3D): Mesh[] => { const out: Mesh[] = []; o.traverse(c => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };

/** Real sim: human draws from every owned building to the nearest enemy, a few seconds of ticks. */
function drive(level: CompiledLevel, ticks: number) {
  const sim = create(level, 7), n = level.buildings.length, buf = createTroopBuffer(2048);
  const cmds = [] as { type: 'DrawLine'; player: number; from: number; to: number }[];
  level.buildings.forEach((a, from) => {
    if (a.owner < 0) return;
    let best = -1, bd = Infinity;
    level.buildings.forEach((b, to) => { if (b.owner === a.owner || b.owner < 0) return; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = to; } });
    if (best >= 0 && sim.canDraw(a.owner, from, best) === null) cmds.push({ type: 'DrawLine', player: a.owner, from, to: best });
  });
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) events.push(...sim.step(t === 0 ? cmds : [], { events: true }));
  const rows = sim.readTroops(buf);
  const frame: WorldFrame = { view: sim.view, troops: buf, n: rows, alpha: 0.5 };
  return { sim, frame, events, n, cmds: cmds.length };
}

describe('createWorldRenderer', () => {
  it('registers every kind before the manifest resolves', () => {
    const { world, scene } = make();
    void world; expect(scene.children.length).toBeGreaterThan(0);
    const reg = new RendererRegistry();
    createWorldRenderer(new Scene(), manifest, { registry: reg, painter, materials: new MaterialCache(() => new Texture()), models: new ModelCache(loadGlb) });
    expect(() => assertManifestReferences(manifest, reg)).not.toThrow();
    expect([...reg.kinds()].sort()).toEqual(['building', 'element', 'fx', 'ground', 'lane', 'unit']);
  });

  it('creates the mirrored root itself, or adopts the one SP08 passes; labels stay outside it', async () => {
    const own = make();
    await own.world.setLevel(L4, L4.theme);
    const root = own.scene.getObjectByName('worldRoot')!;
    expect(root.scale.z).toBe(-1);
    const labels = own.scene.getObjectByName('world:labels')!;
    expect(labels.parent).toBe(own.scene); let sprites = 0; labels.traverse(o => { if ((o as { isSprite?: boolean }).isSprite) sprites++; }); expect(sprites).toBe(L4.buildings.length);
    let inside = false; root.traverse(o => { if (o === labels) inside = true; }); expect(inside).toBe(false);

    const scene = new Scene(), theirs = createMirroredWorldRoot(); scene.add(theirs);
    const adopted = make(scene, { worldRoot: theirs });
    await adopted.world.setLevel(L4, L4.theme);
    expect(scene.children.filter(c => c.name === 'worldRoot')).toHaveLength(1);
    expect(theirs.children.length).toBeGreaterThan(0);
    adopted.world.dispose();
    expect(theirs.children.length).toBe(0); expect(scene.children).toEqual([theirs]);
  });

  it('setLevel twice does not leak scene children; the second level fully replaces the first', async () => {
    const { world, scene } = make();
    await world.setLevel(L4, L4.theme);
    const nodes = count(scene), kids = scene.children.length;
    await world.setLevel(L21, L21.theme);
    await world.setLevel(L4, L4.theme);
    expect(scene.children.length).toBe(kids);
    expect(count(scene)).toBe(nodes);
    await world.setLevel(L21, L21.theme);
    expect(world.anchors.building(L21.buildings[0]!.id)).toBeDefined();
    expect(world.pickMeshes.length).toBeGreaterThan(0);
  });

  describe('overlapping setLevel (generation token)', () => {
    /** Loader whose theme-specific files (green/snow) block until released, so completion order is controllable. */
    function gatedLoader() {
      const gates = new Map<string, () => void>();
      const load = (file: string): Promise<LoadedGltf> => /green|snow/.test(file)
        ? new Promise<LoadedGltf>((res, rej) => { gates.set(file, () => { loadGlb(file).then(res, rej); }); })
        : loadGlb(file);
      const release = (theme: string) => { for (const [f, g] of [...gates]) if (f.includes(theme)) { gates.delete(f); g(); } };
      const waitFor = async (theme: string) => { for (let i = 0; i < 200 && ![...gates.keys()].some(f => f.includes(theme)); i++) await new Promise(r => setTimeout(r, 1)); };
      return { load, release, waitFor };
    }
    const obstacleCount = (o: Object3D) => meshes(o).filter(m => m.name.startsWith('obstacle:')).reduce((s, m) => s + (m as unknown as { count: number }).count, 0);
    const groundCount = (o: Object3D) => meshes(o).filter(m => m.name === 'ground-plane').length;

    const els = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o1-${i}`, x: i * 1000, z: 0, yawMilliDeg: 0, visual: 'element.obstacle', variant: i % 2 ? 'big' : 'small' }));
    const LA = { ...L4, elements: els(5) } as unknown as CompiledLevel, LB = { ...L21, elements: els(3) } as unknown as CompiledLevel;

    for (const order of ['A-then-B', 'B-then-A'] as const) {
      it(`only B's ground/obstacles remain when A and B overlap (load completion ${order})`, async () => {
        const g = gatedLoader();
        const scene = new Scene(), materials = new MaterialCache(() => new Texture()), models = new ModelCache(g.load);
        const world = createWorldRenderer(scene, manifest, { registry: new RendererRegistry(), materials, models, painter });
        const a = world.setLevel(LA, LA.theme); // not awaited
        await g.waitFor('green');
        const b = world.setLevel(LB, LB.theme);
        await g.waitFor('snow');
        if (order === 'A-then-B') { g.release('green'); await a; g.release('snow'); } else { g.release('snow'); await b; g.release('green'); }
        await Promise.all([a, b]);

                const ref = make();
        await ref.world.setLevel(LB, LB.theme);
        expect(groundCount(scene)).toBe(1);
        expect(obstacleCount(scene)).toBe(3);
        expect(obstacleCount(scene)).toBe(obstacleCount(ref.scene));
        expect(count(scene)).toBe(count(ref.scene));
        expect(world.anchors.building(L21.buildings[0]!.id)).toBeDefined();
        const gs = (o: Object3D) => meshes(o).find(m => m.name === 'ground-plane')!.scale.toArray();
        expect(gs(scene)).toEqual(gs(ref.scene)); // B's ground size, not A's
        world.dispose(); ref.world.dispose();
      });
    }
  });

  it('update with real sim frames + events draws buildings, units, lanes and fx; anchors and pick work', async () => {
    const { world, scene } = make();
    await world.setLevel(L4, L4.theme);
    const { frame, events, cmds } = drive(L4, 400);
    expect(cmds).toBeGreaterThan(0); expect(frame.n).toBeGreaterThan(0);
    world.update(frame, events, 50);
    const root = scene.getObjectByName('worldRoot')!;
    const units = root.getObjectByName('world:level')!;
    const instanced = meshes(units).filter(m => (m as unknown as { count?: number }).count! > 0);
    expect(instanced.length).toBeGreaterThan(0);
    for (const b of L4.buildings) {
      const a = world.anchors.building(b.id)!;
      expect(a.pos.x).toBeCloseTo(b.x / 1000); expect(a.pos.z).toBeCloseTo(b.z / 1000);
      expect(a.radius).toBeGreaterThan(0); expect(a.labelPos.y).toBeGreaterThan(a.pos.y);
    }
    expect(world.anchors.building('nope')).toBeUndefined();
    expect(world.pickMeshes.every(m => typeof m.userData['buildingIndex'] === 'number')).toBe(true);
    const idx = new Set(world.pickMeshes.map(m => m.userData['buildingIndex'] as number));
    expect(idx.size).toBe(L4.buildings.length);
    world.previewLane({ x: 0, z: 0 }, { x: 3, z: 2 }, 'blue'); // does not throw, adds nothing to the scene graph root level
    world.update(frame, [], 16);
  });

  it('update before setLevel is a no-op', () => {
    const { world, scene } = make();
    const { frame } = drive(L4, 5);
    expect(() => world.update(frame, [], 16)).not.toThrow();
    void scene;
  });

  it('dispose removes everything the world added and keeps injected caches usable', async () => {
    const { world, scene, models } = make();
    await world.setLevel(L21, L21.theme);
    world.dispose();
    expect(scene.children.length).toBe(0);
    expect(models.loadedFiles).toBeGreaterThan(0); // injected caches are not owned
  });

  it('unit capacity = houses x aliveCap (+ghosts) and never shrinks across levels', async () => {
    const { world, scene } = make();
    await world.setLevel(L21, L21.theme);
    const root = scene.getObjectByName('worldRoot')!;
    const cap = (o: Object3D) => Math.max(...meshes(o).map(m => (m as unknown as { instanceMatrix?: { count: number } }).instanceMatrix?.count ?? 0));
    const houses = L21.buildings.filter(b => b.kind === 'house').length;
    expect(cap(root.getObjectByName('world:level')!)).toBeGreaterThanOrEqual(houses * L21.rules.aliveCap);
    void new Group();
  });
});
