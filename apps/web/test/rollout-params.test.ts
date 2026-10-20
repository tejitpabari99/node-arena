import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest/load.js';
import { createManifestResolver } from '../src/manifest/resolve.js';
import { cameraSettingsFor } from '../src/render/camera.js';
import { NUMBER_PX } from '../src/render/roof-texture.js';
import { troopSizeFactor } from '../src/render/troops.js';

const LEVELS = path.resolve(__dirname, '../../../packages/content/data/levels');
const manifestJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/manifest.json'), 'utf8'));
const levelIds = fs.readdirSync(LEVELS).filter(f => /^\d{2}-.*\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(LEVELS, f), 'utf8')).id as string);

// SP05 Task 8 + review fix: per-level render-param overrides live in the manifest (`levelVisuals`), validated, never in render code.
describe('rollout render params (manifest levelVisuals)', () => {
  it('every levelVisuals key is a real level id and the manifest validates', () => {
    const manifest = parseManifest(manifestJson);
    const keys = Object.keys(manifest.levelVisuals ?? {});
    expect(keys.length).toBeGreaterThan(0);
    expect(levelIds).toHaveLength(20);
    for (const key of keys) expect(levelIds, key).toContain(key);
  });
  it('schema rejects out-of-range or unknown override fields', () => {
    const bad = (levelVisuals: unknown) => () => parseManifest({ ...manifestJson, levelVisuals });
    expect(bad({ x: { cameraMargin: -3 } })).toThrow(); expect(bad({ x: { cameraMargin: 6 } })).toThrow();
    expect(bad({ x: { troopScale: 0 } })).toThrow(); expect(bad({ x: { junk: 1 } })).toThrow();
    expect(bad({ x: { cameraMargin: -1, troopScale: 0.9 } })).not.toThrow();
  });
  it('resolver returns overrides per level, empty otherwise', () => {
    const r = createManifestResolver(parseManifest(manifestJson));
    expect(r.levelVisual('09-chain-link')).toEqual({ cameraMargin: -1, troopScale: 0.9 });
    expect(r.levelVisual('10-two-foes')).toEqual({}); expect(r.levelVisual('toString')).toEqual({});
  });
  it('camera margin override applies only when present (negative allowed)', () => {
    const base = { pitchDeg: 65, fov: 35, margin: 3 };
    expect(cameraSettingsFor({}, base)).toBe(base);
    expect(cameraSettingsFor({ cameraMargin: -1 }, base)).toEqual({ ...base, margin: -1 });
  });
  it('roof number size is one global value', () => { expect(NUMBER_PX).toBe(44); });
  it('troop size factor: 1 for normal boards, shrinks for small starting towers, manifest troopScale', () => {
    expect(troopSizeFactor([4.3, 5, 6])).toBe(1);
    expect(troopSizeFactor([2.88, 2.88, 4])).toBeCloseTo(0.72, 5);
    expect(troopSizeFactor([4.5], { troopScale: 0.9 })).toBeCloseTo(0.9, 5);
    expect(troopSizeFactor([])).toBe(1);
  });
  it('no level-id literals in render code', () => {
    const dir = path.resolve(__dirname, '../src/render');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.ts')) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/['"]\d{2}-[a-z]+(-[a-z]+)*['"]/);
  });
});
