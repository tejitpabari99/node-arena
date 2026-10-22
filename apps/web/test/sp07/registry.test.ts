import { describe, expect, it, vi } from 'vitest';
import { Group, Object3D, Texture, SRGBColorSpace, LinearMipmapLinearFilter, MeshLambertMaterial } from 'three';
import { RENDER_KINDS } from '@node-arena/defs';
import { RendererRegistry, type RendererFactory } from '../../src/render/registry.js';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache } from '../../src/render/gltf-cache.js';
import { buildLightRig } from '../../src/render/light-rig.js';
import { parseModelRef } from '../../src/manifest/model-ref.js';
import { assertAssetPath, assertManifestReferences, createManifestResolver, ManifestError } from '../../src/manifest/resolve.js';
import manifestJson from '../../assets/manifest.json';
import type { ManifestV2 } from '@node-arena/content';

const manifest = manifestJson as unknown as ManifestV2;
const factory: RendererFactory = () => ({ dispose() {} });

describe('renderer registry', () => {
  it('registers, looks up, lists kinds', () => {
    const r = new RendererRegistry();
    expect(r.has('unit')).toBe(false);
    r.register('unit', factory);
    expect(r.has('unit')).toBe(true); expect(r.get('unit')).toBe(factory); expect(r.kinds()).toEqual(['unit']);
  });
  it('rejects duplicate and unknown-kind registration, and missing lookup', () => {
    const r = new RendererRegistry(); r.register('fx', factory);
    expect(() => r.register('fx', factory)).toThrow(/already registered/);
    expect(() => r.register('bogus' as never, factory)).toThrow(/Unknown renderer kind/);
    expect(() => r.get('lane')).toThrow(/No renderer registered/);
  });
});

describe('resolve: open kinds vs registry', () => {
  const full = () => { const r = new RendererRegistry(); for (const k of RENDER_KINDS) r.register(k, factory); return r; };
  it('accepts the shipped manifest when every kind is registered', () => {
    expect(() => assertManifestReferences(manifest, full())).not.toThrow();
  });
  it('rejects a visual whose kind has no renderer', () => {
    const r = full(); r.clear(); r.register('unit', factory);
    expect(() => assertManifestReferences(manifest, r)).toThrow(ManifestError);
    expect(() => assertManifestReferences(manifest, r)).toThrow(/No renderer registered for kind/);
  });
  it('rejects unresolved fx and unsafe paths', () => {
    const bad = structuredClone(manifest); bad.events.Clash = { fx: 'nope' };
    expect(() => assertManifestReferences(bad, full())).toThrow(/Unresolved fx nope/);
    expect(() => assertAssetPath('../x.glb')).toThrow(ManifestError);
    expect(() => assertAssetPath('a/b.glb#n')).toThrow(ManifestError);
    expect(() => assertAssetPath('a/b.glb#n', true)).not.toThrow();
  });
  it('resolver finds visuals with parsed model ref and enforces kind', () => {
    const res = createManifestResolver(manifest); const id = Object.keys(manifest.visuals)[0]!;
    expect(res.visual(id).modelRef.file).toBe(manifest.visuals[id]!.model.parts);
    expect(() => res.visual(id, 'fx')).toThrow(/Expected kind/);
    expect(() => res.visual('missing')).toThrow(/Unresolved visual/);
  });
});

describe('model refs', () => {
  it('parses file and node fragment', () => {
    expect(parseModelRef('models/tw/obstacle-green.glb#small')).toEqual({ file: 'models/tw/obstacle-green.glb', node: 'small' });
    expect(parseModelRef('models/a.glb')).toEqual({ file: 'models/a.glb' });
    expect(() => parseModelRef('models/a.glb#')).toThrow(); expect(() => parseModelRef('#x')).toThrow(); expect(() => parseModelRef('a#b#c')).toThrow();
  });
  it('shipped obstacle refs parse', () => {
    for (const t of Object.values(manifest.themes)) { expect(parseModelRef(t.obstacle.small).node).toBe('small'); expect(parseModelRef(t.obstacle.big).node).toBe('big'); }
  });
});

describe('material cache', () => {
  const mk = () => { const load = vi.fn((_p: string) => new Texture()); return { load, cache: new MaterialCache(load) }; };
  it('same instance per (family, team); distinct per team and family', () => {
    const { cache } = mk();
    const a = cache.material('barracks', 'blue', 'b.png');
    expect(cache.material('barracks', 'blue', 'b.png')).toBe(a);
    expect(cache.material('barracks', 'red', 'r.png')).not.toBe(a);
    expect(cache.material('tower', 'blue', 'b.png')).not.toBe(a);
    expect(a).toBeInstanceOf(MeshLambertMaterial);
  });
  it('textures: SRGB, mipmaps, aniso 4, flipY false; loaded once per path', () => {
    const { cache, load } = mk();
    const m = cache.material('f', 'blue', 'b.png'); cache.material('g', 'blue', 'b.png');
    const t = m.map!;
    expect(t.colorSpace).toBe(SRGBColorSpace); expect(t.generateMipmaps).toBe(true);
    expect(t.minFilter).toBe(LinearMipmapLinearFilter); expect(t.anisotropy).toBe(4); expect(t.flipY).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('teamMaterial throws on missing team texture', () => {
    const { cache } = mk();
    expect(() => cache.teamMaterial('unit', 'gray', { blue: 'b.png' })).toThrow(/no texture for team "gray"/);
    expect(cache.teamMaterial('unit', 'blue', { blue: 'b.png' })).toBeInstanceOf(MeshLambertMaterial);
  });
});

describe('model cache', () => {
  const scene = () => { const s = new Group(); const n = new Object3D(); n.name = 'small'; s.add(n); return s; };
  it('loads each file once, resolves #node, rejects missing node', async () => {
    const load = vi.fn(async (_f: string) => ({ scene: scene() }));
    const c = new ModelCache(load);
    const [a, b] = await Promise.all([c.resolve('m/o.glb#small'), c.resolve('m/o.glb#small')]);
    expect(a).toBe(b); expect(a.name).toBe('small');
    expect((await c.resolve('m/o.glb')).type).toBe('Group');
    expect(load).toHaveBeenCalledTimes(1);
    await expect(c.resolve('m/o.glb#big')).rejects.toThrow(/not found/);
  });
  it('evicts failed loads so retry reloads', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ scene: scene() });
    const c = new ModelCache(load);
    await expect(c.file('a.glb')).rejects.toThrow('x');
    await expect(c.file('a.glb')).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('light rig', () => {
  it('builds directional + flat ambient from the green theme', () => {
    const rig = buildLightRig(manifest.themes.green!.light);
    expect(rig.directional.intensity).toBeCloseTo(0.2); expect(rig.ambient).toBeDefined();
    expect(rig.directional.position.length()).toBeCloseTo(50);
    expect(rig.directional.position.y).toBeGreaterThan(0);
  });
  it('omits ambient when absent', () => {
    expect(buildLightRig({ dir: [0, 1, 0], color: '#ffffff', intensity: 1 }).ambient).toBeUndefined();
  });
});
