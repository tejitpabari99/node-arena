import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileLevel, loadContent } from '@node-arena/content';
import shipped from '../assets/manifest.json';
import { parseManifest } from '../src/manifest/load.js';
import { createManifestResolver } from '../src/manifest/resolve.js';
import { validateManifest } from '../src/manifest/validate.js';

const THEMES = ['city.day', 'city.dusk', 'city.overcast', 'city.night'];
const KEYS = ['neutral', 'player.1', 'player.2', 'player.3', 'player.4'];
const raw = import.meta.glob<string>(['../../../packages/content/content.json', '../../../packages/content/data/**/*.json'], { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../packages/content/', ''), value]));

describe('palettes and team markers', () => {
  const m = parseManifest(shipped);
  it('has every key in both palettes with the PRD colours', () => {
    for (const palette of ['default', 'colorblind'] as const) expect(Object.keys(m.palettes[palette]).sort()).toEqual([...KEYS].sort());
    expect(m.palettes.default).toMatchObject({ 'player.1': '#2E86FF', 'player.2': '#FF4D4D', 'player.3': '#FFC933', 'player.4': '#35C46B', neutral: '#A0A7B0' });
    expect(m.palettes.colorblind).toMatchObject({ 'player.1': '#0072B2', 'player.2': '#D55E00', 'player.3': '#F0E442', 'player.4': '#009E73', neutral: '#999999' });
  });
  it('gives each key a distinct marker glyph', () => {
    expect(Object.keys(m.teamMarkers).sort()).toEqual([...KEYS].sort());
    expect(new Set(Object.values(m.teamMarkers)).size).toBe(KEYS.length);
  });
});

describe('city themes', () => {
  const m = parseManifest(shipped);
  const level = compileLevel(loadContent(files), 'sample');
  it('defines four distinct themes that only reference existing models and share one model set', () => {
    const sets = THEMES.map(key => {
      const theme = m.themes[key]!; expect(theme, key).toBeDefined(); expect(theme.fog, key).toBeDefined();
      const models = new Set((theme.props ?? []).map(p => p.model)); expect(models.size).toBeGreaterThan(0);
      for (const model of models) expect(Object.hasOwn(m.models, model), `${key}:${model}`).toBe(true);
      return [...models].sort().join();
    });
    expect(new Set(sets).size).toBe(1);
    for (const field of ['ground', 'sky'] as const) expect(new Set(THEMES.map(k => m.themes[k]![field])).size).toBe(4);
    expect(new Set(THEMES.map(k => m.themes[k]!.light.intensity)).size).toBe(4);
    expect(new Set(THEMES.map(k => JSON.stringify(m.themes[k]!.fog))).size).toBe(4);
  });
  it('keeps the default-theme fallback key defined', () => { expect(m.themes['city.day']).toBeDefined(); });
  it.each(THEMES)('resolves %s with identical model assets', key => {
    const assets = createManifestResolver(m).resolveLevelAssets({ ...level, visual: key });
    expect([...assets.models].sort()).toEqual([...createManifestResolver(m).resolveLevelAssets({ ...level, visual: THEMES[0]! }).models].sort());
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
