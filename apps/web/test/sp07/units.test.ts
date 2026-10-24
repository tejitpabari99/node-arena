import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { SimEvent } from '@node-arena/sim';
import { createTroopBuffer } from '@node-arena/sim';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache, type LoadedGltf } from '../../src/render/gltf-cache.js';
import { bakeClip, collectParts, hash32, loopFrame, oneShotFrame, phaseOf } from '../../src/render/unit-anim.js';
import { createUnitRenderer, GHOST_CAP, troopPose, type UnitFrame } from '../../src/render/unit-renderer.js';
import manifestJson from '../../assets/manifest.json';
import type { ManifestV2 } from '@node-arena/content';

const manifest = manifestJson as unknown as ManifestV2;
const loadGlb = async (file: string): Promise<LoadedGltf> => {
  const b = fs.readFileSync(path.resolve(__dirname, '../../assets', file));
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', g => res(g), rej));
};
const ctxFor = (id: string) => ({ visualId: id, visual: manifest.visuals[id]!, materials: new MaterialCache(() => new Texture()), models: new ModelCache(loadGlb) });

describe('bake tables', async () => {
  const { scene, animations } = await loadGlb('models/tw/soldier.glb');
  const run = bakeClip(scene, animations!.find(a => a.name === 'Run')!, true);
  const death = bakeClip(scene, animations!.find(a => a.name === 'Death')!, false);
  const { rest, meshes } = collectParts(scene);
  it('shape: Run 17 frames x 9 parts x 16 floats, Death 37 frames', () => {
    expect(meshes.length).toBe(9);
    expect(run.frames).toBe(17); expect(run.data.length).toBe(17 * 9 * 16);
    expect(death.frames).toBe(37); expect(death.data.length).toBe(37 * 9 * 16);
    expect(run.data.every(Number.isFinite) && death.data.every(Number.isFinite)).toBe(true);
  });
  it('Run frame 0 equals the rest pose (no seam at rest)', () => {
    let max = 0; for (let i = 0; i < rest.length; i++) max = Math.max(max, Math.abs(run.data[i]! - rest[i]!));
    expect(max).toBeLessThan(0.02);
  });
  it('Run loops: last frame differs from frame 0 by about one step only', () => {
    const d = (a: number, b: number) => { let m = 0; for (let i = 0; i < 9 * 16; i++) m = Math.max(m, Math.abs(run.data[a * 144 + i]! - run.data[b * 144 + i]!)); return m; };
    expect(d(16, 0)).toBeLessThan(Math.max(d(8, 9), d(0, 1)) * 3 + 0.05);
  });
  it('Death moves parts and ends clamped', () => {
    let moved = 0; for (let i = 0; i < 144; i++) moved = Math.max(moved, Math.abs(death.data[36 * 144 + i]! - death.data[i]!));
    expect(moved).toBeGreaterThan(0.1);
  });
});

describe('interpolation, phase, frames', () => {
  const view = { buildingStatic: [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 0, z: 3000 }] } as unknown as UnitFrame['view'];
  const buf = createTroopBuffer(4);
  buf.channel[0] = 0 * 3 + 1; buf.progress[0] = 20000; buf.speed[0] = 100; buf.laneLength[0] = 80000;
  it('adds speed*alpha and converts milli to world', () => {
    const o = { x: 0, z: 0, yaw: 0 };
    troopPose(view, buf, 0, 0.5, 0.001, o);
    expect(o.x).toBeCloseTo(((20050 / 80000) * 4000) * 0.001); expect(o.z).toBe(0); expect(o.yaw).toBeCloseTo(Math.PI / 2);
  });
  it('clamps to lane length', () => {
    const o = { x: 0, z: 0, yaw: 0 }; buf.progress[0] = 79990;
    troopPose(view, buf, 0, 1, 0.001, o); expect(o.x).toBeCloseTo(4);
    buf.channel[0] = 0 * 3 + 2; buf.laneLength[0] = 60000; buf.progress[0] = 1; buf.speed[0] = 1e9;
    troopPose(view, buf, 0, 1, 0.001, o); expect(o.z).toBeCloseTo(3); expect(o.yaw).toBe(0);
  });
  it('phase hash is deterministic, in [0,1), and spread', () => {
    expect(hash32(12345)).toBe(hash32(12345)); expect(phaseOf(7, 99)).toBe(phaseOf(7, 99));
    const ph = new Set<number>(); for (let s = 0; s < 200; s++) { const p = phaseOf(3, s); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1); ph.add(Math.floor(p * 10)); }
    expect(ph.size).toBe(10);
  });
  it('frame selection wraps and clamps', () => {
    const clip = { name: 'c', loop: true, frames: 17, parts: 1, duration: 0.5667, data: new Float32Array(16 * 17) };
    expect(loopFrame(clip, 0, 0)).toBe(0); expect(loopFrame(clip, 0.5667, 0)).toBe(0);
    for (let i = 0; i < 100; i++) { const f = loopFrame(clip, i * 0.037, phaseOf(1, i)); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(17); }
    const one = { ...clip, loop: false, frames: 37, duration: 1.2 };
    expect(oneShotFrame(one, 0)).toBe(0); expect(oneShotFrame(one, 99)).toBe(36);
  });
});

const players = [{ kind: 'human', colorKey: 'blue' }, { kind: 'ai', colorKey: 'red' }, { kind: 'ai', colorKey: 'green' }, { kind: 'ai', colorKey: 'yellow' }] as const;
const mkView = () => ({
  buildingStatic: Array.from({ length: 10 }, (_, i) => ({ x: i * 2000, z: (i % 3) * 1500 })),
  units: [{ id: 'soldier', visual: 'unit.soldier' }, { id: 'tank', visual: 'unit.tank' }],
  players,
}) as unknown as UnitFrame['view'];

function fill(buf: ReturnType<typeof createTroopBuffer>, n: number, off = 0) {
  for (let i = 0; i < n; i++) {
    buf.channel[i] = 1 * 10 + 2 + (i % 5); buf.seq[i] = i; buf.owner[i] = i % 4; buf.kind[i] = i % 7 === 0 ? 1 : 0;
    buf.progress[i] = (i * 997 + off) % 30000; buf.speed[i] = 50; buf.laneLength[i] = 40000;
  }
}

describe('unit renderer (real soldier/tank GLB)', () => {
  it('720 units x many updates: no steady-state allocation, <=60 draw calls', async () => {
    const view = mkView(), buf = createTroopBuffer(800), ctxS = ctxFor('unit.soldier'), ctxT = ctxFor('unit.tank');
    const rs = await createUnitRenderer(ctxS), rt = await createUnitRenderer(ctxT);
    rs.setCapacity(10, 72); rt.setCapacity(10, 72);
    const f: UnitFrame = { view, troops: buf, n: 720, alpha: 0 };
    fill(buf, 720);
    rs.update(f, [], 16); rt.update(f, [], 16);
    const before = [rs.stats.meshesCreated, rt.stats.meshesCreated], caps = [rs.stats.capacity, rt.stats.capacity];
    const arrays = [rs, rt].map(r => r.root.children.map(c => (c as import('three').InstancedMesh).instanceMatrix.array));
    for (let k = 0; k < 300; k++) { f.alpha = (k % 20) / 20; fill(buf, 720, k * 31); rs.update(f, [], 16); rt.update(f, [], 16); }
    expect([rs.stats.meshesCreated, rt.stats.meshesCreated]).toEqual(before);
    expect([rs.stats.capacity, rt.stats.capacity]).toEqual(caps);
    [rs, rt].forEach((r, i) => r.root.children.forEach((c, j) => expect((c as import('three').InstancedMesh).instanceMatrix.array).toBe(arrays[i]![j])));
    const draws = rs.drawCalls + rt.drawCalls;
    console.log(`draw calls soldier=${rs.drawCalls} tank=${rt.drawCalls} total=${draws} (max ${rs.maxDrawCalls + rt.maxDrawCalls})`);
    expect(draws).toBeLessThanOrEqual(60); expect(rs.maxDrawCalls + rt.maxDrawCalls).toBeLessThanOrEqual(60);
    expect(rs.root.children.reduce((s, c) => s + ((c as import('three').InstancedMesh).count), 0) / 9).toBeGreaterThan(500);
  });
  it('global LOD: swaps to the simplified part geometry above the troop threshold, with hysteresis, no extra draws', async () => {
    const { LOD_ON, LOD_OFF } = await import('../../src/render/unit-renderer.js');
    const r = await createUnitRenderer(ctxFor('unit.soldier')), view = mkView(), buf = createTroopBuffer(800);
    const tris = () => r.root.children.filter((_, i) => i % 4 === 0).reduce((s, c) => { const g = (c as import('three').InstancedMesh).geometry; return s + (g.index?.count ?? 0) / 3; }, 0);
    const f: UnitFrame = { view, troops: buf, n: 0, alpha: 0 };
    const run = (n: number) => { buf.owner.fill(0); buf.kind.fill(0); fill(buf, n); for (let i = 0; i < n; i++) { buf.owner[i] = i % 4; buf.kind[i] = 0; } f.n = n; r.update(f, [], 16); };
    run(LOD_OFF - 1); expect(tris()).toBe(1036); expect(r.stats.lod).toBe(0);
    run(LOD_ON + 1); expect(r.stats.lod).toBe(1); expect(tris()).toBeLessThan(400); expect(tris()).toBeGreaterThan(150);
    expect(r.drawCalls).toBeLessThanOrEqual(r.maxDrawCalls);
    run(LOD_OFF + 1); expect(r.stats.lod).toBe(1); // hysteresis band keeps LOD
    run(LOD_OFF); expect(r.stats.lod).toBe(0); expect(tris()).toBe(1036);
    // rebuilt (grown) meshes pick up the active LOD geometry
    run(LOD_ON + 1); r.setCapacity(40, 100); run(LOD_ON + 1); expect(tris()).toBeLessThan(400);
  });
  it('tank has no LOD', async () => {
    const r = await createUnitRenderer(ctxFor('unit.tank')), buf = createTroopBuffer(800); buf.kind.fill(1);
    const f: UnitFrame = { view: mkView(), troops: buf, n: 600, alpha: 0 }; fill(buf, 600); buf.kind.fill(1); r.update(f, [], 16);
    expect(r.stats.lod).toBe(0);
  });
  it('growth happens once before the troop loop: no mid-frame rebuild, no identity-matrix frame', async () => {
    const r = await createUnitRenderer(ctxFor('unit.soldier')), view = mkView(), buf = createTroopBuffer(400);
    const n = 150; fill(buf, n); for (let i = 0; i < n; i++) { buf.owner[i] = 0; buf.kind[i] = 0; }
    const base = r.stats.meshesCreated;
    r.update({ view, troops: buf, n, alpha: 0 }, [], 16); // initial capacity too small -> grows inside the frame
    expect(r.stats.meshesCreated - base).toBe(r.maxDrawCalls); // exactly one rebuild
    const mesh = r.root.children.find(c => (c as import('three').InstancedMesh).count === n) as import('three').InstancedMesh;
    expect(mesh).toBeDefined();
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < n; i++) expect(Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16))).not.toEqual(id);
  });
  it('capacity grows only when needed, never shrinks', async () => {
    const r = await createUnitRenderer(ctxFor('unit.soldier')), view = mkView(), buf = createTroopBuffer(400);
    const f: UnitFrame = { view, troops: buf, n: 4, alpha: 0 }; fill(buf, 4);
    r.setCapacity(1, 10); const c0 = r.stats.capacity; r.update(f, [], 16); expect(r.stats.capacity).toBe(c0);
    r.setCapacity(1, 1); expect(r.stats.capacity).toBe(c0);
    r.setCapacity(4, 50); expect(r.stats.capacity).toBe(200 + GHOST_CAP);
    f.n = 400; fill(buf, 400); for (let i = 0; i < 400; i++) buf.owner[i] = 0; buf.kind.fill(0);
    r.update(f, [], 16); expect(r.stats.capacity).toBeGreaterThanOrEqual(400 + GHOST_CAP);
  });
  it('ghost pool: spawn on TroopDied, cap 64 with oldest recycled, expires after Death', async () => {
    const r = await createUnitRenderer(ctxFor('unit.soldier')), view = mkView(), buf = createTroopBuffer(1);
    const f: UnitFrame = { view, troops: buf, n: 0, alpha: 0 };
    const died = (seq: number, kind = 'soldier'): SimEvent => ({ type: 'TroopDied', channel: 12, seq, owner: 1, kind, cause: 'clash', x: 1000, z: 2000 } as unknown as SimEvent);
    r.update(f, [died(1), died(2, 'tank')], 16); // tank ignored by the soldier renderer
    expect(r.stats.ghosts).toBe(1);
    const evs: SimEvent[] = []; for (let i = 0; i < 100; i++) evs.push(died(i + 10));
    const made = r.stats.meshesCreated;
    r.update(f, evs, 16); expect(r.stats.ghosts).toBe(GHOST_CAP); expect(r.stats.meshesCreated).toBe(made);
    expect(r.drawCalls).toBe(9); // one team, 9 parts
    for (let i = 0; i < 200; i++) r.update(f, [], 16); // 3.2 s > Death 1.2 s
    expect(r.stats.ghosts).toBe(0); expect(r.drawCalls).toBe(0);
    r.update(f, [died(500)], 16); expect(r.stats.ghosts).toBe(1); // recycled slot reusable
  });
  it('tank is static rest pose with procedural death', async () => {
    const r = await createUnitRenderer(ctxFor('unit.tank')), view = mkView(), buf = createTroopBuffer(2);
    fill(buf, 1); buf.kind[0] = 1; buf.owner[0] = 0;
    r.update({ view, troops: buf, n: 1, alpha: 0 }, [{ type: 'TroopDied', channel: 12, seq: 3, owner: 2, kind: 'tank', cause: 'clash', x: 0, z: 0 } as unknown as SimEvent], 16);
    expect(r.drawCalls).toBe(8); expect(r.stats.ghosts).toBe(1); expect(r.maxDrawCalls).toBe(16);
  });
  it('tintMask: team keys come from palette teams, one InstancedMesh per part x team (same draw budget)', async () => {
    const visual = { ...manifest.visuals['unit.soldier']!, team: { mode: 'tintMask', base: 'textures/b.png', mask: 'textures/m.png' } } as ManifestV2['visuals'][string];
    const materials = new MaterialCache(() => new Texture(), manifest.palettes);
    const r = await createUnitRenderer({ visualId: 'unit.soldier', visual, materials, models: new ModelCache(loadGlb) });
    const teams = Object.keys(manifest.palettes), ref = await createUnitRenderer(ctxFor('unit.soldier'));
    expect(r.maxDrawCalls).toBe(9 * teams.length);
    expect(r.maxDrawCalls).toBeGreaterThanOrEqual(ref.maxDrawCalls);
    expect(materials.visualTeamMaterial('unit.soldier', 'red', visual.team)).toBe(materials.visualTeamMaterial('unit.soldier', 'red', visual.team));
    expect(() => materials.visualTeamMaterial('unit.soldier', 'purple', visual.team)).toThrow(/no palette colour/);
  });
});
