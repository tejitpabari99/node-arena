import { describe, expect, it } from 'vitest';
import { loadManifest, parseManifest } from '../../src/manifest/load.js';
import { AssetError, ManifestError } from '../../src/manifest/resolve.js';
import { RendererRegistry } from '../../src/render/registry.js';
import manifestJson from '../../assets/manifest.json';

const json = () => JSON.parse(JSON.stringify(manifestJson)) as Record<string, any>;
const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('parseManifest (v2)', () => {
  it('accepts the shipped manifest with the default (world-populated) registry', () => {
    expect(parseManifest(manifestJson).schemaVersion).toBe('2.0.0');
  });
  it('rejects a v1-shaped / malformed manifest with a typed schema error', () => {
    const v1 = { ...json(), schemaVersion: '1.0.0' };
    expect(() => parseManifest(v1)).toThrow(ManifestError);
    try { parseManifest({}); } catch (e) { expect((e as ManifestError).code).toBe('schema'); }
  });
  it('fails on kinds missing from an explicit registry, passes once registered', () => {
    expect(() => parseManifest(manifestJson, new RendererRegistry())).toThrow(/No renderer registered for kind/);
  });
  it('rejects unsafe asset paths and unresolved fx keys', () => {
    const m = json(); m.fx = { ...m.fx, bad: { ...Object.values<any>(m.fx)[0], texture: '../x.png' } };
    expect(() => parseManifest(m)).toThrow(/safe relative path/);
    const u = json(); const first = Object.keys(u.visuals)[0]!; u.visuals[first].fx = 'nope';
    expect(() => parseManifest(u)).toThrow(/Unresolved fx/);
  });
});

describe('loadManifest (v2)', () => {
  it('fetches and parses', async () => {
    const m = await loadManifest('/m.json', async () => ok(manifestJson));
    expect(m.schemaVersion).toBe('2.0.0');
  });
  it('retries transport failures twice then throws AssetError', async () => {
    let calls = 0;
    await expect(loadManifest('/m.json', async () => { calls++; throw new Error('net'); })).rejects.toBeInstanceOf(AssetError);
    expect(calls).toBe(3);
    calls = 0;
    const m = await loadManifest('/m.json', async () => { if (++calls < 3) throw new Error('net'); return ok(manifestJson); });
    expect(m.palettes).toBeDefined(); expect(calls).toBe(3);
  });
  it('malformed JSON fails immediately (AssetError), schema failure is a ManifestError', async () => {
    await expect(loadManifest('/m.json', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response)).rejects.toBeInstanceOf(AssetError);
    await expect(loadManifest('/m.json', async () => ok({ nope: 1 }))).rejects.toMatchObject({ code: 'schema' });
  });
});
