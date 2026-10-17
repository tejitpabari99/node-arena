import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { AssetManager } from '../src/manifest/assets';
import { cloneModel, mergeModel } from '../src/render/model';
import { Disposables } from '../src/render/disposables';
const keys = (name = 'shared', audio = true) => ({ models: new Set([name]), audio: new Set(audio ? ['audio/shared.wav'] : []), visuals: new Set<string>(), sources: new Set<string>() });
function fixture() {
  const manifest = structuredClone(manifestJSON) as Manifest;
  manifest.models = Object.fromEntries(['shared', ...Array.from({ length: 10 }, (_, i) => `m${i}`)].map(name => [name, { src: `models/${name}.glb` }]));
  return manifest;
}
function model() { const group = new Group(); group.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: new Texture() }))); return group; }
describe('application CPU cache and level GPU ownership', () => {
  it('reuses decoded model/audio after restart and shared-source switch with transport unavailable', async () => {
    let offline = false; const source = model(), audio = {} as AudioBuffer;
    const loadModel = vi.fn(async () => { if (offline) throw Error('offline'); return source; });
    const loadAudio = vi.fn(async () => { if (offline) throw Error('offline'); return audio; });
    const manager = new AssetManager(fixture(), { loadModel, loadAudio });
    for (let i = 0; i < 21; i++) {
      const session = manager.createSession(keys()); await session.load();
      expect(session.state).toBe('ready'); expect(session.models.get('shared')).toBe(source); expect(session.audio.get('audio/shared.wav')).toBe(audio);
      session.dispose(); offline = true;
    }
    expect(loadModel).toHaveBeenCalledTimes(1); expect(loadAudio).toHaveBeenCalledTimes(1); expect(manager.cachedSources).toBe(2);
    const dispose = vi.spyOn((source.children[0] as Mesh).geometry, 'dispose'); manager.dispose(); manager.dispose(); expect(dispose).toHaveBeenCalledTimes(1); expect(manager.cachedSources).toBe(0);
  });
  it('retains exactly eight successful idle sources with LRU eviction and protects active leases', async () => {
    const sources = new Map<string, Group>(), disposals = new Map<string, ReturnType<typeof vi.fn>>();
    const manager = new AssetManager(fixture(), { loadModel: async src => { const source = model(), disposed = vi.fn(); (source.children[0] as Mesh).geometry.addEventListener('dispose', disposed); sources.set(src, source); disposals.set(src, disposed); return source; } });
    const active = manager.createSession(keys('shared', false)); await active.load();
    for (let i = 0; i < 8; i++) { const session = manager.createSession(keys(`m${i}`, false)); await session.load(); session.dispose(); }
    const recent = manager.createSession(keys('m0', false)); await recent.load(); recent.dispose();
    for (let i = 8; i < 10; i++) { const session = manager.createSession(keys(`m${i}`, false)); await session.load(); session.dispose(); }
    expect(manager.cachedSources).toBe(9); expect(disposals.get('models/shared.glb')).not.toHaveBeenCalled();
    expect(disposals.get('models/m0.glb')).not.toHaveBeenCalled(); expect(disposals.get('models/m1.glb')).toHaveBeenCalledTimes(1); expect(disposals.get('models/m2.glb')).toHaveBeenCalledTimes(1);
    active.dispose(); expect(manager.cachedSources).toBe(8); expect(disposals.get('models/m3.glb')).toHaveBeenCalledTimes(1);
    manager.dispose(); expect(manager.cachedSources).toBe(0); for (const disposed of disposals.values()) expect(disposed).toHaveBeenCalledTimes(1);
  });
  it('frees a cancelled pending source even with default retention and supports late application disposal', async () => {
    for (const closeManager of [false, true]) {
      const source = model(), disposed = vi.spyOn((source.children[0] as Mesh).geometry, 'dispose'); let finish!: (source: Group) => void;
      const manager = new AssetManager(fixture(), { loadModel: () => new Promise(resolve => { finish = resolve; }) });
      const session = manager.createSession(keys('shared', false)), loading = session.load(); session.dispose(); if (closeManager) manager.dispose(); finish(source); await loading;
      expect(session.models.size).toBe(0); expect(manager.cachedSources).toBe(0); expect(disposed).toHaveBeenCalledTimes(1); manager.dispose();
    }
  });
  it('clones geometry/textures once per scope without mutating or disposing CPU templates', () => {
    const source = model(), original = source.children[0] as Mesh, texture = (original.material as MeshStandardMaterial).map!;
    const sourceDispose = [vi.spyOn(original.geometry, 'dispose'), vi.spyOn(texture, 'dispose'), vi.spyOn(original.material as MeshStandardMaterial, 'dispose')];
    const scope = new Disposables(), clones = Array.from({ length: 50 }, () => cloneModel(source, scope).children[0] as Mesh);
    const ownedTexture = (clones[0]!.material as MeshStandardMaterial).map!;
    expect(clones[0]!.geometry).not.toBe(original.geometry); expect(ownedTexture).not.toBe(texture); expect(ownedTexture.source).toBe(texture.source);
    expect(clones.every(clone => clone.geometry === clones[0]!.geometry && (clone.material as MeshStandardMaterial).map === ownedTexture)).toBe(true);
    const next = new Disposables(), other = cloneModel(source, next).children[0] as Mesh;
    expect(other.geometry).not.toBe(clones[0]!.geometry); expect((other.material as MeshStandardMaterial).map).not.toBe(ownedTexture);
    const dispose = [vi.spyOn(clones[0]!.geometry, 'dispose'), vi.spyOn(ownedTexture, 'dispose')]; scope.dispose(); scope.dispose(); dispose.forEach(spy => expect(spy).toHaveBeenCalledTimes(1)); sourceDispose.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(original.geometry).not.toBe(clones[0]!.geometry); expect((original.material as MeshStandardMaterial).map).toBe(texture); next.dispose(); new Disposables().object(source).dispose();
  });
  it('merged and tower materials share scope texture wrappers, with owner material clones borrowing wrappers', () => {
    const source = model(), original = source.children[0] as Mesh, texture = (original.material as MeshStandardMaterial).map!, scope = new Disposables();
    const tower = cloneModel(source, scope).children[0] as Mesh, merged = mergeModel(source, undefined, scope);
    const wrapped = (merged.materials[0] as MeshStandardMaterial).map!;
    expect(wrapped).not.toBe(texture); expect(wrapped).toBe((tower.material as MeshStandardMaterial).map); expect(wrapped.source).toBe(texture.source);
    const owner = merged.materials[0]!.clone(); scope.material(owner, false); expect((owner as MeshStandardMaterial).map).toBe(wrapped);
    const dispose = vi.spyOn(wrapped, 'dispose'), originalDispose = vi.spyOn(texture, 'dispose'); scope.dispose(); expect(dispose).toHaveBeenCalledTimes(1); expect(originalDispose).not.toHaveBeenCalled(); new Disposables().object(source).dispose();
  });
});
describe('music reuse across levels', () => {
  it('fetches the music file once across levels, even when an intervening level churns the model cache', async () => {
    const fetcher = vi.fn(async () => new Response(new ArrayBuffer(8)));
    const decoded = {} as AudioBuffer; const decodeAudioData = vi.fn(async () => decoded);
    const manager = new AssetManager(fixture(), { fetcher, audioContext: { decodeAudioData }, loadModel: async () => model() });
    const music = 'audio/music.ogg', level = (models: string[], audio: string[]) => ({ models: new Set(models), audio: new Set(audio), visuals: new Set<string>(), sources: new Set<string>() });
    const names = Array.from({ length: 10 }, (_, i) => `m${i}`);
    for (const keys of [level(['shared'], [music]), level(names, []), level(['m0'], [music]), level(names.slice(0, 5), [music])]) {
      const session = manager.createSession(keys); await session.load(); expect(session.state).toBe('ready');
      if (keys.audio.size) expect(session.audio.get(music)).toBe(decoded);
      session.dispose();
    }
    expect(fetcher).toHaveBeenCalledTimes(1); expect(decodeAudioData).toHaveBeenCalledTimes(1); manager.dispose();
  });
});
