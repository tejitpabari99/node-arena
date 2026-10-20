import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileLevel, loadContent, validateContent } from '@node-arena/content';
import greybox from './fixtures/greybox-manifest.json';
import shipped from '../assets/manifest.json';
import { parseManifest, loadManifest } from '../src/manifest/load.js';
import { createManifestResolver, ManifestError } from '../src/manifest/resolve.js';
import { validateManifest } from '../src/manifest/validate.js';

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'na-manifest-')); dirs.push(dir); return dir; };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const manifest = () => structuredClone(greybox);
function glb(triangles: number, texture?: Buffer): Buffer {
  const doc = { asset: { version: '2.0' }, accessors: [{ count: triangles * 3, componentType: 5126, type: 'VEC3', bufferView: 0 }], bufferViews: [{ buffer: 0, byteLength: triangles * 36 }, ...(texture ? [{ buffer: 0, byteOffset: triangles * 36, byteLength: texture.length }] : [])], buffers: [{ byteLength: triangles * 36 + (texture?.length ?? 0) }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...(texture ? { images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ source: 0 }] } : {}) };
  const json = Buffer.from(JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4, ' '));
  const bin = Buffer.alloc(Math.ceil(doc.buffers[0]!.byteLength / 4) * 4); texture?.copy(bin, triangles * 36);
  const out = Buffer.alloc(28 + json.length + bin.length); out.writeUInt32LE(0x46546c67); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20); out.writeUInt32LE(bin.length, 20 + json.length); out.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(out, 28 + json.length); return out;
}
describe('manifest pipeline', () => {
  it('schema validates greybox and resolves generic presentation keys', async () => {
    const m = parseManifest(greybox); const r = createManifestResolver(m);
    expect(r.visual('troop.regular').model).toMatchObject({ primitive: 'capsule' });
    expect(r.theme('grass').ground).toMatch(/^#/); expect(r.camera().fov).toBeGreaterThan(0);
    expect(r.color('player.1', 'colorblind')).toMatch(/^#/); expect(r.marker('player.1')).toBeTruthy();
    expect(r.event('Captured')?.fx).toBe('pulse'); expect(r.event('unknown')).toBeUndefined();
    await expect(validateManifest(m, { assetsDir: temp(), credits: '' })).resolves.toEqual(m);
  });
  it('cross-checks existing sample content and derives level asset sets', () => {
    const raw = import.meta.glob<string>(['../../../packages/content/content.json', '../../../packages/content/data/**/*.json'], { eager: true, query: '?raw', import: 'default' });
    const files = Object.fromEntries(Object.entries(raw).map(([path,value]) => [path.replace('../../../packages/content/', ''),value]));
    expect(validateContent(files, { manifest: greybox }).errors).toEqual([]);
    const level = compileLevel(loadContent(files), 'sample');
    const assets = createManifestResolver(parseManifest(greybox)).resolveLevelAssets(level);
    expect(assets.visuals.has('troop.regular')).toBe(true); expect(assets.models.has('unit')).toBe(true); expect(assets.sources.size).toBe(0);
    const bad = manifest(); delete (bad.visuals as Record<string, unknown>)['tower.small'];
    expect(validateContent(files, { manifest: bad }).errors.length).toBeGreaterThan(0);
  });
  it('reports typed schema, missing key, kind and palette errors', () => {
    expect(() => parseManifest({ ...greybox, extra: true })).toThrow(ManifestError);
    const r = createManifestResolver(parseManifest(greybox));
    expect(() => r.visual('absent')).toThrow(/absent/); expect(() => r.visual('tower.small', 'troop')).toThrow(/kind/);
    expect(() => r.color('absent')).toThrow(/palette/);
    const m = manifest(); delete (m.palettes.colorblind as Record<string,string>)['player.1'];
    expect(() => parseManifest(m)).toThrow(/palette/);
  });
  it('rejects internal model and fx references and unsafe audio paths', () => {
    const m = manifest(); m.visuals['troop.regular'].model = 'absent'; expect(() => parseManifest(m)).toThrow(/model/);
    const n = manifest(); n.events.Captured.fx = 'absent'; expect(() => parseManifest(n)).toThrow(/fx/);
    expect(() => parseManifest({ ...greybox, events: { Clash: { sfx: '../bad.wav' } } })).toThrow(/path/);
  });
  it('loads JSON and wraps transport errors with asset context and two retries', async () => {
    let calls = 0; const fetcher = async () => { calls++; if (calls < 3) throw new Error('offline'); return new Response(JSON.stringify(greybox)); };
    expect(await loadManifest('/manifest.json', fetcher)).toEqual(greybox); expect(calls).toBe(3);
    await expect(loadManifest('/missing', async () => new Response('', { status: 404 }))).rejects.toMatchObject({ key: 'manifest', src: '/missing' });
  });
  it('rejects missing files and credits, validates audio sources', async () => {
    const dir = temp(); const m = { ...manifest(), models: { ...greybox.models, external: { src: 'model.glb' } } };
    await expect(validateManifest(m, { assetsDir: dir, credits: 'model.glb' })).rejects.toThrow(/file/);
    writeFileSync(join(dir, 'model.glb'), glb(1)); await expect(validateManifest(m, { assetsDir: dir, credits: '' })).rejects.toThrow(/CREDITS/);
    const audio = { ...manifest(), events: { Clash: { sfx: 'sound.wav' } } }; await expect(validateManifest(audio, { assetsDir: dir, credits: 'sound.wav' })).rejects.toThrow(/file/);
  });
  it('counts merged primitives/repeated mesh nodes and validates external buffers/images', async () => {
    const dir = temp(); const m = manifest() as unknown as Record<string,any>; m.models.unit = { src: 'model.gltf' }; m.visuals['troop.regular'].model = 'unit';
    const doc = { asset: { version: '2.0' }, buffers: [{ uri: 'geometry.bin', byteLength: 200 * 36 }], bufferViews: [{ buffer: 0, byteLength: 200 * 36 }], accessors: [{ count: 600, type: 'VEC3', componentType: 5126, bufferView: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0,1] }], images: [{ uri: 'texture.png' }] };
    writeFileSync(join(dir, 'model.gltf'), JSON.stringify(doc)); const opts = { assetsDir: dir, credits: 'model.gltf geometry.bin texture.png' };
    await expect(validateManifest(m, opts)).rejects.toThrow(/geometry.bin/);
    writeFileSync(join(dir,'geometry.bin'), Buffer.alloc(200 * 36));
    await expect(validateManifest(m, { ...opts, credits: 'model.gltf texture.png' })).rejects.toThrow(/CREDITS/);
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR',12); png.writeUInt32BE(1,16); png.writeUInt32BE(1,20); writeFileSync(join(dir,'texture.png'),png);
    await expect(validateManifest(m,opts)).rejects.toThrow(/400 triangles/);
    doc.nodes = [{ mesh: 0 }]; doc.scenes = [{ nodes: [0] }]; doc.meshes[0]!.primitives.push({ attributes: { POSITION: 0 } }); writeFileSync(join(dir,'model.gltf'),JSON.stringify(doc));
    await expect(validateManifest(m,opts)).rejects.toThrow(/400 triangles/);
    m.visuals['troop.regular'].model = 'unit'; m.visuals['troop.regular'].kind = 'tower';
    await expect(validateManifest(m,opts)).resolves.toBeTruthy();
    doc.accessors[0]!.count = 15003; doc.buffers[0]!.byteLength = 15003 * 12; doc.bufferViews[0]!.byteLength = 15003 * 12; doc.meshes[0]!.primitives.splice(1); writeFileSync(join(dir,'geometry.bin'),Buffer.alloc(15003 * 12)); writeFileSync(join(dir,'model.gltf'),JSON.stringify(doc));
    await expect(validateManifest(m,opts)).rejects.toThrow(/5000/);
  });
  it('enforces actual GLB triangle and embedded texture budgets', async () => {
    const dir = temp(); const m = manifest() as unknown as Record<string,any>; m.models.unit = { src: 'model.glb' }; m.visuals['troop.regular'].model = 'unit';
    writeFileSync(join(dir, 'model.glb'), glb(301)); await expect(validateManifest(m, { assetsDir: dir, credits: 'model.glb' })).rejects.toThrow(/300/);
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(1025, 16); png.writeUInt32BE(16, 20);
    writeFileSync(join(dir, 'model.glb'), glb(300, png)); await expect(validateManifest(m, { assetsDir: dir, credits: 'model.glb' })).rejects.toThrow(/1024/);
    writeFileSync(join(dir, 'model.glb'), glb(300)); await expect(validateManifest(m, { assetsDir: dir, credits: 'model.glb' })).resolves.toBeTruthy();
  });
  it('accepts EXT_meshopt_compression GLBs by their declared decompressed size and rejects bad compressed ranges', async () => {
    const dir = temp(); const m = manifest() as unknown as Record<string,any>; m.models.unit = { src: 'model.glb' }; m.visuals['troop.regular'].model = 'unit';
    const pack = (compressed: { byteOffset?: number; byteLength: number }, triangles: number) => {
      // Buffer 0 holds 64 compressed bytes; buffer 1 is the virtual (uri-less) fallback with the decompressed layout.
      const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: 64 }, { byteLength: triangles * 36, extensions: { EXT_meshopt_compression: { fallback: true } } }],
        bufferViews: [{ buffer: 1, byteLength: triangles * 36, extensions: { EXT_meshopt_compression: { buffer: 0, ...compressed, byteStride: 12, mode: 'ATTRIBUTES', count: triangles * 3 } } }],
        accessors: [{ count: triangles * 3, componentType: 5126, type: 'VEC3', bufferView: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, extensionsUsed: ['EXT_meshopt_compression'] };
      const json = Buffer.from(JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4, ' ')), bin = Buffer.alloc(64);
      const out = Buffer.alloc(28 + json.length + bin.length); out.writeUInt32LE(0x46546c67); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20); out.writeUInt32LE(bin.length, 20 + json.length); out.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(out, 28 + json.length); return out;
    };
    const opts = { assetsDir: dir, credits: 'model.glb' };
    writeFileSync(join(dir, 'model.glb'), pack({ byteLength: 40 }, 100)); await expect(validateManifest(m, opts)).resolves.toBeTruthy();
    writeFileSync(join(dir, 'model.glb'), pack({ byteLength: 40 }, 301)); await expect(validateManifest(m, opts)).rejects.toThrow(/300/);
    writeFileSync(join(dir, 'model.glb'), pack({ byteOffset: 40, byteLength: 40 }, 100)); await expect(validateManifest(m, opts)).rejects.toThrow(/Invalid model/);
  });
  it('shipped manifest parses and maps tower/troop visuals to imported models', () => {
    const r = createManifestResolver(parseManifest(shipped));
    expect(r.visual('troop.regular').model).toHaveProperty('src');
    // SP03 T4: towers are code-built stacked meshes (block placeholder model, no GLB).
    for (const key of ['tower.small', 'tower.standard', 'tower.large']) expect(r.visual(key)).toMatchObject({ build: 'stacked', model: { primitive: 'box' } });
    expect(shipped.visuals['troop.regular']).toMatchObject({ teamMaterial: 'Shirt', anim: { type: 'bob' } });
  });
});
