import { describe, expect, it } from 'vitest';
import { compileLevel, loadContent } from '@node-arena/content';
import shipped from '../assets/manifest.json';
import { parseManifest } from '../src/manifest/load.js';
import { scatterProps, type PropKind } from '../src/render/props.js';
import { levelVisualBounds } from '../src/render/camera.js';

// SP05 Task 8 R3 (rollout probe): for every authored level, no scatter prop overlaps a tower footprint disc or the corridor of any tower pair (full segment, not only NEAR_PAIR).
const raw = import.meta.glob<string>(['../../../packages/content/content.json', '../../../packages/content/data/**/*.json'], { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../packages/content/', ''), value]));
const PROP_RADIUS: Record<PropKind, number> = { treePine: 1.6, treeRound: 1.8, crate: 1.6, barrel: 1.6, stump: 1.4, tyre: 2.2 }; // mirrors props.ts SPEC (collision radii)
const LANE_HALF_WIDTH = 1.2; // widest lane ~2.3 u across (probe widthWorld)
const manifest = parseManifest(shipped), content = loadContent(files);
const ids = Object.keys(files).filter(p => /^data\/levels\/\d{2}-/.test(p)).map(p => p.replace(/^data\/levels\/|\.json$/g, '')).sort();

describe('rollout R3: props vs tower footprints and lane corridors (all 20 levels)', () => {
  it('finds the 20 authored levels', () => { expect(ids).toHaveLength(20); });
  for (const id of ids) it(`${id}: 0 overlaps`, () => {
    const level = compileLevel(content, id), theme = manifest.themes[level.visual]!;
    const b = levelVisualBounds(level, manifest, new Map());
    const towers = level.towers.map(t => ({ x: t.x / 1000, z: t.y / 1000, radius: t.footprintRadius / 1000 }));
    const props = scatterProps(level.id, { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z }, towers, theme.scatter!);
    let overlaps = 0;
    for (const p of props) {
      const r = PROP_RADIUS[p.kind] * p.scale;
      for (const t of towers) if (Math.hypot(p.x - t.x, p.z - t.z) < t.radius + r) overlaps++;
      for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++) {
        const a = towers[i]!, c = towers[j]!, dx = c.x - a.x, dz = c.z - a.z, len2 = dx * dx + dz * dz || 1;
        const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2; if (t <= 0 || t >= 1) continue;
        if (Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)) < LANE_HALF_WIDTH + r) overlaps++;
      }
    }
    expect(props.length).toBeGreaterThan(0); expect(overlaps).toBe(0);
  });
});
