import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import type { SimEvent, SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { Disposables } from '../src/render/disposables.js';
import { createLineRenderer } from '../src/render/lines.js';
import { buildVisualProbe, type VisualProbe } from '../src/test-harness/probe.js';

const webRoot = resolve(import.meta.dirname, '..');
function fixture() {
  const view = {
    tick: 30,
    ids: { towers: ['t1', 't2'], players: ['p1', 'p2'] },
    players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }],
    towerStatic: [{ x: -10000, y: 0, visual: 'tower.standard' }, { x: 10000, y: 0, visual: 'tower.small' }],
    tower: { owner: new Int32Array([0, -1]), col: { 'garrison.count': new Int32Array([12, 5]), 'garrison.cap': new Int32Array([63, 63]) } },
    lines: [{ channel: 1, from: 0, to: 1, owner: 0, length: 400000 }, { channel: 2, from: 1, to: 0, owner: 1, length: 400000 }],
  } as unknown as SimView;
  const scene = new Scene(), scope = new Disposables();
  const ground = new Mesh(new PlaneGeometry(200, 200), new MeshBasicMaterial()); ground.rotation.x = -Math.PI / 2; ground.userData.visualRole = 'ground'; scene.add(ground);
  for (let i = 0; i < 2; i++) {
    const group = new Group(); group.position.set(i ? 10 : -10, 0, 0); group.userData = { visualRole: 'tower', towerIndex: i, paintColor: i ? '#9ca3af' : '#2f6fde' };
    const model = new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial()); model.position.y = 2; model.userData.visualPart = 'model';
    const roof = new Mesh(new PlaneGeometry(1.5, 1.5), new MeshBasicMaterial()); roof.rotation.x = -Math.PI / 2; roof.position.y = 4.02; roof.userData.visualRole = 'count';
    group.add(model, roof); scene.add(group);
  }
  const lines = createLineRenderer({ view, manifest: structuredClone(manifestJSON) as Manifest, scene, scope });
  const troops = new InstancedMesh(new BoxGeometry(.5, 1, .5), new MeshBasicMaterial(), 4);
  const pose = new Float32Array(16); pose.set([-5, 0, 0, 1, 0, 0, 0, 2]); troops.geometry.setAttribute('troopPose', new InstancedBufferAttribute(pose, 4));
  troops.count = 2; troops.userData = { visualRole: 'troop', heightWorld: 1, widthWorld: .5, baseY: 0 }; scene.add(troops);
  const camera = new PerspectiveCamera(40, 800 / 600, .1, 1000); camera.position.set(0, 40, 25); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const events: SimEvent[] = [{ type: 'Clash', tick: 28, channel: 1, progA: 100000, progB: 300000, value: 1 }];
  const input = { scene, camera, view, events, viewport: { w: 800, h: 600 }, clearColor: '#87ceeb', hasCard: (i: number) => i === 1, fx: [] as Mesh[] };
  return { input, lines, scope };
}

describe('visualProbe', () => {
  it('returns the plain-JSON PRD shape from tags and camera projection', () => {
    const { input, lines } = fixture();
    expect(lines.meshes.map(m => m.userData)).toEqual([
      { visualRole: 'lane', from: 0, to: 1, pair: 't1-t2' }, { visualRole: 'lane', from: 1, to: 0, pair: 't1-t2' }]);
    const probe: VisualProbe = buildVisualProbe(input);
    expect(JSON.parse(JSON.stringify(probe))).toEqual(probe);
    expect(Object.keys(probe).sort()).toEqual(['clash', 'clearColor', 'ground', 'lanes', 'towers', 'troops', 'viewport']);
    expect(probe.viewport).toEqual({ w: 800, h: 600 });
    expect(probe.clearColor).toBe('#87ceeb');
    expect(probe.ground.cornerRayHits).toEqual(Array(9).fill(true));
    expect(probe.towers).toHaveLength(2);
    const [a, b] = probe.towers;
    expect(a).toMatchObject({ id: 't1', owner: 'p1', count: 12, cap: 63, slotDots: 0, hasCard: false, countOnRoof: true });
    expect(b).toMatchObject({ id: 't2', owner: null, count: 5, hasCard: true });
    expect(a!.paintHue).toBeCloseTo(218.06, 1);
    for (const t of probe.towers) {
      expect(t.model.w).toBeGreaterThan(0); expect(t.model.h).toBeGreaterThan(0);
      const c = t.countRect!; expect(c.x).toBeGreaterThanOrEqual(t.model.x); expect(c.x + c.w).toBeLessThanOrEqual(t.model.x + t.model.w);
    }
    expect(a!.model.x + a!.model.w).toBeLessThan(400); expect(b!.model.x).toBeGreaterThan(400);
    expect(probe.lanes.map(l => [l.from, l.to, l.pair])).toEqual([['t1', 't2', 't1-t2'], ['t2', 't1', 't1-t2']]);
    expect(probe.lanes[0]!.mid.x).toBeCloseTo(400, -1);
    expect(probe.troops.count).toBe(2);
    expect(probe.troops.sampleRects).toHaveLength(2);
    expect(probe.troops.screenHeightPx).toBeGreaterThan(0);
    expect(probe.clash).toMatchObject({ eventTick: 28, eventPair: 't1-t2', fxScreen: null });
    expect(probe.clash.eventScreen!.x).toBeLessThan(400);
  });
  it('returns null for v1 gaps (floors, split, ribbon width, play quad) and clash-free states', () => {
    const { input } = fixture();
    const probe = buildVisualProbe({ ...input, events: [] });
    expect(probe.ground.playQuadScreen).toBeNull();
    for (const t of probe.towers) { expect(t.floors).toBeNull(); expect(t.visualWidthWorld).toBeNull(); }
    for (const l of probe.lanes) { expect(l.widthWorld).toBeNull(); expect(l.screenWidthPx).toBeNull(); expect(l.splitWorld).toBeNull(); expect(l.splitScreen).toBeNull(); }
    expect(probe.clash).toEqual({ fxScreen: null, eventScreen: null, eventTick: null, eventPair: null });
  });
  it('projects renderer-provided fields once later SPs tag them', () => {
    const { input } = fixture();
    const ground = input.scene.children.find(c => c.userData.visualRole === 'ground')!;
    ground.userData.playQuad = [[-12, -6], [12, -6], [12, 6], [-12, 6]];
    for (const c of input.scene.children) if (c.userData.visualRole === 'lane') Object.assign(c.userData, { widthWorld: .6, splitWorld: 5 });
    const probe = buildVisualProbe(input);
    expect(probe.ground.playQuadScreen).toHaveLength(4);
    expect(probe.lanes[0]!.screenWidthPx).toBeGreaterThan(0);
    expect(probe.lanes[0]!.splitScreen!.x).toBeLessThan(400);
  });
  it('reports void corners when the ground does not fill the frame', () => {
    const { input } = fixture();
    input.camera.position.set(0, 10, 60); input.camera.lookAt(0, 0, 0); input.camera.updateMatrixWorld();
    expect(buildVisualProbe(input).ground.cornerRayHits.filter(Boolean).length).toBeLessThan(9);
  });
  it('derives instanced-tower model rects from empty Group roots + visualWidth + stack height', () => {
    const { input } = fixture();
    const scene = input.scene;
    for (const c of [...scene.children]) if (c.userData.visualRole === 'tower') scene.remove(c);
    // SP03 layout: empty roots (no geometry), one InstancedMesh per material across all towers, instanced roof decal.
    const r0 = new Group(); r0.position.set(-10, 0, 0); r0.userData = { visualRole: 'tower', towerId: 't1', visualWidth: 2, floors: 2, slotDots: 1, paintColor: '#2f6fde' };
    const r1 = new Group(); r1.position.set(10, 0, 0); r1.userData = { visualRole: 'tower', towerIndex: 1, visualWidthWorld: 3, stackHeight: 5 };
    scene.add(r0, r1);
    const body = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3); body.userData = { visualRole: 'tower', towerIds: ['t2', 't1', 't2'] };
    const decal = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial(), 2); decal.userData = { visualRole: 'count', towerIds: ['t2', 't1'] };
    decal.setMatrixAt(0, new Matrix4().makeRotationX(-Math.PI / 2).setPosition(10, 5.02, 0));
    decal.setMatrixAt(1, new Matrix4().makeRotationX(-Math.PI / 2).setPosition(-10, 0.9 * 2 + 1 + .02, 0));
    scene.add(body, decal);
    const probe = buildVisualProbe(input);
    expect(probe.towers.map(t => t.id)).toEqual(['t1', 't2']);
    const [a, b] = probe.towers;
    expect(a).toMatchObject({ id: 't1', owner: 'p1', floors: 2, slotDots: 1, visualWidthWorld: 2, countOnRoof: true });
    expect(b).toMatchObject({ id: 't2', owner: null, floors: null, visualWidthWorld: 3, countOnRoof: true });
    for (const t of probe.towers) { expect(t.model.w).toBeGreaterThan(0); expect(t.model.h).toBeGreaterThan(0); expect(t.countRect).not.toBeNull(); }
    expect(a!.model.x + a!.model.w).toBeLessThan(400); expect(b!.model.x).toBeGreaterThan(400);
    expect(b!.model.w).toBeGreaterThan(a!.model.w);
    expect(a!.countRect!.x + a!.countRect!.w).toBeLessThan(400); expect(b!.countRect!.x).toBeGreaterThan(400);
    // Model rect = projected box of root world position +- visualWidth/2, y 0..stack height.
    const proj = (x: number, y: number, z: number) => { const q = new Vector3(x, y, z).project(input.camera); return { x: (q.x + 1) * 400, y: (1 - q.y) * 300 }; };
    const top = proj(10, 5, -1.5), bottom = proj(10, 0, 1.5);
    expect(b!.model.y).toBeCloseTo(top.y, 1); expect(b!.model.y + b!.model.h).toBeCloseTo(bottom.y, 1);
    // Stack height default (no tag): floors x FLOOR_HEIGHT_WORLD + 0.5 x visualWidth.
    const aTop = proj(-10, 0.9 * 2 + 1, -1);
    expect(a!.model.y).toBeCloseTo(aTop.y, 1);
  });
  it('is identical when called twice on the same state', () => {
    const { input } = fixture();
    expect(JSON.stringify(buildVisualProbe(input))).toBe(JSON.stringify(buildVisualProbe(input)));
  });
});

describe('test hook builds', () => {
  async function bundle(hooks: boolean) {
    const { build } = await import('vite');
    // Vitest runs with NODE_ENV=test, which would make Vite's import.meta.env.DEV true; build exactly like `vite build`.
    const previous = process.env.VITE_TEST_HOOKS, nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    if (hooks) process.env.VITE_TEST_HOOKS = '1'; else delete process.env.VITE_TEST_HOOKS;
    try {
      const output = await build({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts'), logLevel: 'silent', mode: 'production', build: { write: false } });
      const outputs = (Array.isArray(output) ? output : [output]) as { output: { type: string; code?: string; fileName: string }[] }[];
      return outputs.flatMap(o => o.output).filter(c => c.type === 'chunk').map(c => c.code ?? '').join('\n');
    } finally {
      for (const [key, value] of [['NODE_ENV', nodeEnv], ['VITE_TEST_HOOKS', previous]] as const) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  it('ships visualProbe only in the test-hook build, never in production', async () => {
    expect(readFileSync(resolve(webRoot, 'src/test-harness/index.ts'), 'utf8')).toContain('visualProbe');
    expect(readdirSync(resolve(webRoot, 'src/test-harness'))).toContain('probe.ts');
    const [prod, hooks] = [await bundle(false), await bundle(true)];
    expect(hooks).toContain('visualProbe');
    expect(prod).not.toContain('visualProbe');
    expect(prod).not.toContain('cornerRayHits');
  }, 240_000);
});

describe('harness seed', () => {
  it('startLevel takes an optional seed for test hooks; default stays 1', async () => {
    const { create } = await import('@node-arena/sim');
    const { createAppController } = await import('../src/app/state');
    const { contentFiles } = await import('../src/app/boot');
    const { parseManifest } = await import('../src/manifest/load');
    const { createSaveStore } = await import('../src/save');
    const seeds: number[] = [];
    const app = createAppController({ files: contentFiles(), loadManifest: async () => parseManifest(manifestJSON), save: createSaveStore({ storage: null }), autoStart: false,
      createSim: (level: Parameters<typeof create>[0], seed: number) => { seeds.push(seed); return create(level, seed); } });
    await app.boot();
    await app.startLevel('sample'); await app.startLevel('sample', 42);
    expect(seeds).toEqual([1, 42]);
    app.dispose();
  });
});
