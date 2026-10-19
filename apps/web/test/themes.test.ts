import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileLevel, loadContent } from '@node-arena/content';
import shipped from '../assets/manifest.json';
import { parseManifest } from '../src/manifest/load.js';
import { createManifestResolver } from '../src/manifest/resolve.js';
import { validateManifest } from '../src/manifest/validate.js';

const THEMES = ['grass'];
const KEYS = ['neutral', 'player.1', 'player.2', 'player.3', 'player.4'];
const raw = import.meta.glob<string>(['../../../packages/content/content.json', '../../../packages/content/data/**/*.json'], { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../packages/content/', ''), value]));

describe('palettes and team markers', () => {
  const m = parseManifest(shipped);
  it('has every key in both palettes with the PRD colours', () => {
    for (const palette of ['default', 'colorblind'] as const) expect(Object.keys(m.palettes[palette]).sort()).toEqual([...KEYS].sort());
    expect(m.palettes.default).toMatchObject({ 'player.1': '#2E8BFF', 'player.2': '#F0313F', 'player.3': '#FDC534', 'player.4': '#35B84A', neutral: '#8C8C8C' });
    expect(m.palettes.colorblind).toMatchObject({ 'player.1': '#0072B2', 'player.2': '#D55E00', 'player.3': '#F0E442', 'player.4': '#009E73', neutral: '#999999' });
  });
  it('gives each key a distinct marker glyph', () => {
    expect(Object.keys(m.teamMarkers).sort()).toEqual([...KEYS].sort());
    expect(new Set(Object.values(m.teamMarkers)).size).toBe(KEYS.length);
  });
});

describe('grass theme', () => {
  const m = parseManifest(shipped);
  const level = compileLevel(loadContent(files), 'sample');
  it('is the only shipped theme: Tower War palette tokens, sand clear colour, no fog, no road/light/cone props', () => {
    expect(Object.keys(m.themes)).toEqual(['grass']);
    const theme = m.themes.grass!;
    expect(theme.ground).toBe('#A3D419'); expect(theme.sky).toBe('#FFE1B3'); expect(theme.fog).toBeUndefined();
    expect(theme.palette).toMatchObject({ grass: '#A3D419', grassAlt: '#9DCB10', sand: '#FFE1B3', sandShade: '#FFCF8D', rock: '#BC5439', tree: '#028C1D', crate: '#FD8539' });
    expect(theme.scatter).toEqual({ seed: 1, density: 24 });
    expect(theme.props ?? []).toEqual([]);
    expect(Object.keys(m.models).filter(key => key.startsWith('prop.')).sort()).toEqual(['prop.barrel', 'prop.crate', 'prop.stump', 'prop.tree.pine', 'prop.tree.pine.round', 'prop.tree.round']);
  });
  it('steep camera: pitch 65, fov 35', () => { expect(m.camera).toMatchObject({ pitchDeg: 65, fov: 35 }); });
  it('keeps the default-theme fallback key defined', () => { expect(m.themes.grass).toBeDefined(); });
  it('resolves the sample level assets', () => {
    const assets = createManifestResolver(m).resolveLevelAssets({ ...level, visual: 'grass' });
    expect([...assets.models].sort()).toEqual(['building.small', 'building.standard', 'character.regular', 'prop.barrel', 'prop.crate', 'prop.stump', 'prop.tree.pine', 'prop.tree.pine.round', 'prop.tree.round']);
  });
});

describe('model swap by manifest only', () => {
  it('shipped manifest with every glTF replaced by a primitive validates and resolves with only audio sources', async () => {
    const swapped = structuredClone(shipped) as unknown as { models: Record<string, unknown> };
    for (const [key, model] of Object.entries(swapped.models)) if ('src' in (model as object)) swapped.models[key] = { primitive: 'box', size: [1, 1, 1] };
    // Real assets dir and CREDITS: the audio files are still referenced and must stay credited.
    const credits = readFileSync(fileURLToPath(new URL('../../../docs/CREDITS.md', import.meta.url)), 'utf8');
    const m = await validateManifest(swapped, { assetsDir: fileURLToPath(new URL('../assets', import.meta.url)), credits });
    for (const key of THEMES) {
      const assets = createManifestResolver(m).resolveLevelAssets({ ...compileLevel(loadContent(files), 'sample'), visual: key });
      expect([...assets.sources].filter(src => !src.startsWith('audio/')), key).toEqual([]); expect(assets.models.size).toBeGreaterThan(0);
    }
  });
});
