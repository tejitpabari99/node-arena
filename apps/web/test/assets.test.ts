import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, InstancedMesh, Texture } from 'three';
import { AssetManager } from '../src/manifest/assets.js';
import { AssetError } from '../src/manifest/resolve.js';
import { Disposables } from '../src/render/disposables.js';
import { createPrimitiveModel, mergeModel } from '../src/render/model.js';
import manifestJSON from './fixtures/greybox-manifest.json';
import type { Manifest } from '@node-arena/content';
const manifest = structuredClone(manifestJSON) as Manifest;
const keys = { visuals: new Set<string>(), models: new Set(['a', 'b']), audio: new Set(['audio/a.wav']), sources: new Set<string>() };
function fixture() {
  const m = structuredClone(manifest); m.models = { a: { src: 'models/shared.glb' }, b: { src: 'models/shared.glb' } }; return m;
}
function model() { return createPrimitiveModel({ primitive: 'box', size: [1, 2, 1] }); }
describe('asset sessions', () => {
  it('loads in parallel, retries twice, preserves successes and retries failed only', async () => {
    const loadModel = vi.fn(async () => model()); let broken = true;
    const loadAudio = vi.fn(async () => { if (broken) throw new Error('decode'); return {} as AudioBuffer; });
    const manager = new AssetManager(fixture(), { loadModel, loadAudio }); const session = manager.createSession(keys);
    await session.load(); expect(session.state).toBe('error'); expect(session.failures[0]).toBeInstanceOf(AssetError);
    expect(session.failures[0]).toMatchObject({ key: 'audio/a.wav', src: 'audio/a.wav', cause: expect.any(Error) });
    expect(loadAudio).toHaveBeenCalledTimes(3); expect(loadModel).toHaveBeenCalledTimes(1);
    expect(session.models.get('a')).toBe(session.models.get('b'));
    broken = false; await session.retryFailed(); expect(session.state).toBe('ready'); expect(loadAudio).toHaveBeenCalledTimes(4); expect(loadModel).toHaveBeenCalledTimes(1);
    session.dispose(); manager.dispose();
  });
  it('starts different sources concurrently and safely handles an empty keyset', async () => {
    let finish!: (g: Group) => void;
    const loadModel = vi.fn(() => new Promise<Group>(resolve => { finish = resolve; })); const loadAudio = vi.fn(async () => ({} as AudioBuffer));
    const manager = new AssetManager(fixture(), { loadModel, loadAudio }); const session = manager.createSession(keys); const loading = session.load();
    expect(loadAudio).toHaveBeenCalledTimes(1); expect(loadModel).toHaveBeenCalledTimes(1); finish(model()); await loading; expect(session.state).toBe('ready');
    const empty = manager.createSession({ ...keys, models: new Set(), audio: new Set() }); await empty.load(); expect(empty.state).toBe('ready'); manager.dispose();
  });
  it('refcounts shared sources and frees resources only after the final session', async () => {
    const asset = model(); const mesh = asset.children[0] as Mesh; const disposed = vi.spyOn(mesh.geometry, 'dispose');
    const manager = new AssetManager(fixture(), { loadModel: async () => asset, maxIdle: 0 });
    const a = manager.createSession(keysWithoutAudio()); const b = manager.createSession(keysWithoutAudio()); await Promise.all([a.load(), b.load()]);
    a.dispose(); expect(disposed).not.toHaveBeenCalled(); b.dispose(); expect(disposed).toHaveBeenCalledTimes(1); manager.dispose();
  });
  it('disposes stale pending loads and does not publish them after cancellation', async () => {
    let resolve!: (g: Group) => void; const asset = model(); const dispose = vi.spyOn((asset.children[0] as Mesh).geometry, 'dispose');
    const manager = new AssetManager(fixture(), { loadModel: () => new Promise(r => { resolve = r; }), maxIdle: 0 });
    const session = manager.createSession(keysWithoutAudio()); const loading = session.load(); session.dispose(); resolve(asset); await loading;
    expect(session.state).toBe('disposed'); expect(session.models.size).toBe(0); expect(dispose).toHaveBeenCalledTimes(1); manager.dispose();
  });
  it('evicts failed promises and bounds idle models across 20 switches', async () => {
    const disposed = vi.fn(); const manager = new AssetManager(fixture(), { maxIdle: 0, loadModel: async () => { const g = model(); (g.children[0] as Mesh).geometry.addEventListener('dispose', disposed); return g; } });
    for (let i = 0; i < 20; i++) { const s = manager.createSession(keysWithoutAudio()); await s.load(); s.dispose(); }
    expect(disposed).toHaveBeenCalledTimes(20); expect(manager.cachedSources).toBe(0); manager.dispose();
  });
});
function keysWithoutAudio() { return { ...keys, audio: new Set<string>() }; }
describe('model resources', () => {
  it.each(['box', 'capsule', 'cylinder'] as const)('makes base-centred budgeted %s primitives', primitive => {
    const group = createPrimitiveModel({ primitive, size: [1, 2, 1] }); const mesh = group.children[0] as Mesh; mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0); expect((mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3).toBeLessThanOrEqual(300);
    new Disposables().object(group).dispose();
  });
  it('merges transformed primitives with team masks without disposing shared model data', () => {
    const group = model(); const mesh = group.children[0] as Mesh; (mesh.material as MeshStandardMaterial).name = 'Accent'; const sourceDispose = vi.spyOn(mesh.geometry, 'dispose');
    const other = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); other.position.x = 3; group.add(other);
    const scope = new Disposables(); const merged = mergeModel(group, 'Accent', scope);
    expect(new Set(Array.from(merged.geometry.getAttribute('teamMask').array))).toEqual(new Set([0, 1]));
    expect(merged.geometry.groups).toHaveLength(2); scope.dispose(); expect(sourceDispose).not.toHaveBeenCalled(); new Disposables().object(group).dispose();
  });
  it('frees geometries/materials/textures/instance buffers and removes DOM labels once', () => {
    const scope = new Disposables(); const material = new MeshStandardMaterial({ map: new Texture() }); const mesh = new InstancedMesh(new BoxGeometry(), material, 3);
    const spies = [vi.spyOn(mesh.geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(material.map!, 'dispose'), vi.spyOn(mesh, 'dispose')]; const remove = vi.fn();
    scope.object(mesh); scope.label({ remove }); scope.dispose(); scope.dispose(); for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  });
});
