import { describe, expect, it } from 'vitest';
import { scatterProps, rimDistance, PROP_KINDS, type ScatterTower } from '../src/render/props.js';
import { GRASS_PAD } from '../src/render/ground.js';

const bounds = { minX: -50, maxX: 50, minZ: -30, maxZ: 30 };
const towers: ScatterTower[] = [{ x: -40, z: 0, radius: 3 }, { x: 40, z: 0, radius: 3 }, { x: -35, z: 5, radius: 3 }, { x: 0, z: 20, radius: 3 }];
const theme = { seed: 1, density: 6 };
const core = { cx: 0, cz: 0, w: 100 + 2 * GRASS_PAD, h: 60 + 2 * GRASS_PAD };

describe('scatterProps (covers R-SP03-R5)', () => {
  it('is deterministic per level id and differs between levels', () => {
    const a = scatterProps('l01', bounds, towers, theme), b = scatterProps('l01', bounds, towers, theme), c = scatterProps('l02', bounds, towers, theme);
    expect(a).toEqual(b); expect(a.length).toBeGreaterThanOrEqual(20); expect(c).not.toEqual(a);
  });
  it('uses several kinds, trees only at the grass rim, sand props outside the rim zone', () => {
    const list = scatterProps('l01', bounds, towers, theme);
    expect(new Set(list.map(p => p.kind)).size).toBeGreaterThanOrEqual(5);
    for (const p of list) {
      expect(PROP_KINDS).toContain(p.kind);
      const sd = rimDistance(p.x, p.z, core);
      if (p.kind.startsWith('tree')) expect(sd).toBeGreaterThanOrEqual(-1.01); else expect(sd).toBeGreaterThanOrEqual(3);
      expect(sd).toBeGreaterThan(-3); // nothing deep in the grass interior (lanes z-fight guard)
    }
  });
  it('respects the tower disc (footprint + 3 u) and the 2.5 u corridor for near pairs only', () => {
    // Bounds deliberately tight so the rim and the towers' keep-out discs overlap.
    const tight = { minX: -10, maxX: 10, minZ: -6, maxZ: 6 };
    const near: ScatterTower[] = [{ x: -9, z: 0, radius: 4 }, { x: 9, z: 0, radius: 4 }, { x: 0, z: 14, radius: 4 }];
    const list = scatterProps('keepout', tight, near, { seed: 3, density: 40 });
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      for (const t of near) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThanOrEqual(t.radius + 3);
      // pair (-9,0)-(9,0) is 18 u apart (< 40): corridor |z| >= 2.5 between them
      if (p.x > -9 && p.x < 9) expect(Math.abs(p.z)).toBeGreaterThanOrEqual(2.5);
    }
    // A pair >= 40 u apart reserves no corridor (only its two discs); the grass interior stays empty by zone rules, so the board is not emptied.
    const far: ScatterTower[] = [{ x: -45, z: 0, radius: 3 }, { x: 45, z: 0, radius: 3 }];
    const farList = scatterProps('keepout', { minX: -48, maxX: 48, minZ: -4, maxZ: 4 }, far, { seed: 3, density: 40 });
    expect(farList.length).toBeGreaterThan(0);
    for (const p of farList) for (const t of far) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThanOrEqual(t.radius + 3);
  });
  it('density 0 yields no sand props and no instances beyond tree clusters', () => {
    expect(scatterProps('l01', bounds, towers, { seed: 1, density: 0 })).toEqual([]);
  });
});
