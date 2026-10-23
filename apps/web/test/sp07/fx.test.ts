import { describe, expect, it } from 'vitest';
import { Texture, Mesh, Sprite, AdditiveBlending, type Object3D } from 'three';
import type { SimEvent } from '@node-arena/defs';
import type { ManifestV2 } from '@node-arena/content';
import { createFxFactory, COMPANIONS, STAGE_UP_FX, STAGE_UP_ALPHA, type FxRenderer } from '../../src/render/fx-pool.js';
import { MaterialCache } from '../../src/render/materials.js';
import { ModelCache } from '../../src/render/gltf-cache.js';
import { RendererRegistry, type VisualDef } from '../../src/render/registry.js';
import manifestJson from '../../assets/manifest.json';

const manifest = manifestJson as unknown as ManifestV2;
const materials = new MaterialCache(() => new Texture());
const models = new ModelCache(async () => ({ scene: null as never }));
const CAP = { sprites: 24, rings: 4, beams: 4 };

function make(capacity = CAP, m: Pick<ManifestV2, 'fx' | 'events' | 'palettes'> = manifest): FxRenderer {
  const reg = new RendererRegistry(); reg.register('fx', createFxFactory({ manifest: m, capacity }));
  const visual = manifest.visuals['fx.projectile'] as VisualDef;
  const r = reg.get('fx')({ visualId: 'fx', visual, materials, models }) as FxRenderer;
  r.setBuildings([{ index: 0, x: 0, z: 0 }, { index: 1, x: 4000, z: 2000 }]);
  return r;
}
const players = [{ colorKey: 'blue' }, { colorKey: 'red' }];
const frame = (stage: number[]) => ({ view: { players, buildings: { stage } } });
const clash: SimEvent = { type: 'Clash', kind: 'headon', a: { channel: 0, seq: 0, owner: 0 }, b: { channel: 1, seq: 0, owner: 1 }, x: 1000, z: 2000 };
const died: SimEvent = { type: 'TroopDied', channel: 0, seq: 0, owner: 0, kind: 'soldier', cause: 'clash', x: 500, z: -500 };
const shot: SimEvent = { type: 'TowerShot', tower: 1, target: { kind: 'house', building: 0 }, x: 0, z: 0 };
const captured: SimEvent = { type: 'BuildingCaptured', building: 0, from: -1, to: 1 };
const visibleOf = (r: FxRenderer, C: typeof Mesh | typeof Sprite) => r.root.children.filter(o => o instanceof C && o.visible);

describe('fx: event -> fx mapping (manifest-driven)', () => {
  it('manifest maps only the 03 events to defined fx ids of the three kinds', () => {
    for (const id of ['BuildingCaptured', 'Clash', 'TowerShot', 'TroopDied']) expect(manifest.fx[manifest.events[id]!.fx!]).toBeDefined();
    expect(manifest.fx[manifest.events['TowerShot']!.fx!]!.kind).toBe('beam');
    expect(manifest.fx[manifest.events['BuildingCaptured']!.fx!]!.kind).toBe('ring');
  });
  it('Clash spawns spark burst + glow at the event position (milli -> scene)', () => {
    const r = make(); r.update(null, [clash], 16);
    const sp = visibleOf(r, Sprite);
    expect(sp).toHaveLength(manifest.fx['clash-spark']!.params['count']! + manifest.fx['clash-glow']!.params['count']!);
    expect(sp[0]!.position.x).toBeCloseTo(1, 1); expect(sp[0]!.position.z).toBeCloseTo(2, 1);
    expect(COMPANIONS['clash-spark']).toContain('clash-glow');
  });
  it('TroopDied spawns smoke + spark at x,z', () => {
    const r = make(); r.update(null, [died], 16);
    expect(visibleOf(r, Sprite)).toHaveLength(manifest.fx['death-smoke']!.params['count']! + manifest.fx['clash-spark']!.params['count']!);
    expect(r.stats.rings.active).toBe(0);
  });
  it('TowerShot draws a beam from the tower to the target; skipped for unknown tower', () => {
    const r = make(); r.update(null, [shot], 16);
    const [b] = visibleOf(r, Mesh) as Mesh[];
    expect(r.stats.beams.active).toBe(1);
    expect(b!.position.x).toBeCloseTo(2, 5); expect(b!.position.z).toBeCloseTo(1, 5); // midpoint of (4,2)->(0,0)
    expect(b!.scale.x).toBeCloseTo(Math.hypot(4, 2), 5);
    r.update(null, [{ ...shot, tower: 9 }], 16); expect(r.stats.beams.active).toBe(1);
  });
  it('BuildingCaptured spawns ring (+star) at the building tinted by the new owner; neutral = gray', () => {
    const r = make(); r.update(frame([1, 1]), [captured], 16);
    expect(r.stats.rings.active).toBe(1);
    const ring = (visibleOf(r, Mesh) as Mesh[])[0]!;
    expect(ring.position.x).toBe(0);
    expect((ring.material as unknown as { color: { getHexString(): string } }).color.getHexString()).toBe(manifest.palettes.red.replace('#', '').toLowerCase());
    expect(r.stats.sprites.active).toBe(manifest.fx['capture-star']!.params['count']);
  });
  it('stage increase spawns the pale stage-up ring once; first frame, same stage and decreases do not', () => {
    const r = make();
    r.update(frame([1, 1]), [], 16); expect(r.activeCount).toBe(0);
    r.update(frame([1, 1]), [], 16); expect(r.activeCount).toBe(0);
    r.update(frame([2, 1]), [], 16); expect(r.stats.rings.active).toBe(1);
    const ring = (visibleOf(r, Mesh) as Mesh[])[0]!;
    expect((ring.material as { opacity: number }).opacity).toBeLessThanOrEqual(STAGE_UP_ALPHA + 1e-9);
    expect(manifest.fx[STAGE_UP_FX]!.kind).toBe('ring');
    r.update(frame([2, 1]), [], 16); expect(r.stats.rings.active).toBe(1);
    r.update(frame([1, 1]), [], 16); expect(r.stats.rings.active).toBe(1);
  });
  it('unmapped events and events with no fx are ignored', () => {
    const r = make(); r.update(null, [{ type: 'LineCut', from: 0, to: 1, reason: 'player' }, { type: 'MatchOver', outcome: 'won', winner: 0 }], 16);
    expect(r.activeCount).toBe(0);
  });
});

describe('fx: lifecycle per kind', () => {
  it('ring: grows radiusFrom -> radiusTo, fades, is hidden and released at duration', () => {
    const p = manifest.fx['capture-ring']!.params, r = make();
    r.spawn('capture-ring', 0, 0);
    const ring = (visibleOf(r, Mesh) as Mesh[])[0]!, op = () => (ring.material as { opacity: number }).opacity;
    expect(ring.scale.x / 2).toBeCloseTo(p['radiusFrom']!, 5); expect(op()).toBeCloseTo(p['alpha']!, 5);
    r.update(null, [], p['duration']! * 500); const mid = ring.scale.x / 2;
    expect(mid).toBeGreaterThan(p['radiusFrom']!); expect(mid).toBeLessThan(p['radiusTo']!); expect(op()).toBeLessThan(p['alpha']!);
    r.update(null, [], p['duration']! * 600);
    expect(ring.visible).toBe(false); expect(r.stats.rings.active).toBe(0);
  });
  it('sprite-burst: spreads outward, rises, fades, then releases every particle', () => {
    const p = manifest.fx['death-smoke']!.params, r = make();
    r.spawn('death-smoke', 0, 0);
    const sp = visibleOf(r, Sprite) as Sprite[]; expect(sp).toHaveLength(p['count']!);
    const y0 = sp[0]!.position.y; r.update(null, [], p['duration']! * 500);
    expect(Math.hypot(sp[0]!.position.x, sp[0]!.position.z)).toBeGreaterThan(0); expect(sp[0]!.position.y).toBeGreaterThan(y0);
    expect(sp[0]!.material.opacity).toBeLessThan(0.9);
    r.update(null, [], p['duration']! * 600); expect(r.stats.sprites.active).toBe(0); expect(sp.every(s => !s.visible)).toBe(true);
  });
  it('beam: visible for duration then released; additive blending on glow textures', () => {
    const r = make(); r.spawn('tower-shot', 0, 0, null, 1, 3000, 0);
    const b = (visibleOf(r, Mesh) as Mesh[])[0]!; expect((b.material as { blending: number }).blending).toBe(AdditiveBlending);
    r.update(null, [], manifest.fx['tower-shot']!.params['duration']! * 1000 + 1); expect(r.stats.beams.active).toBe(0); expect(b.visible).toBe(false);
  });
  it('unknown fx id is a no-op', () => { const r = make(); r.spawn('nope', 0, 0); expect(r.activeCount).toBe(0); });
});

describe('fx: pool never grows', () => {
  it('thousands of events over many frames: object count and stats.created fixed, active <= cap, oldest recycled', () => {
    const r = make(), n0 = r.root.children.length, ids = new Set<Object3D>(r.root.children);
    expect(n0).toBe(CAP.sprites + CAP.rings + CAP.beams);
    for (let f = 0; f < 2000; f++) {
      r.update(frame([1 + (f % 3), 1]), [clash, died, shot, captured], 16);
      expect(r.stats.sprites.active).toBeLessThanOrEqual(CAP.sprites);
      expect(r.stats.rings.active).toBeLessThanOrEqual(CAP.rings); expect(r.stats.beams.active).toBeLessThanOrEqual(CAP.beams);
    }
    expect(r.root.children.length).toBe(n0);
    for (const c of r.root.children) expect(ids.has(c)).toBe(true);
    expect(r.stats.sprites.created).toBe(CAP.sprites); expect(r.stats.rings.created).toBe(CAP.rings); expect(r.stats.beams.created).toBe(CAP.beams);
  });
  it('overflow recycles the oldest slot and keeps the newest', () => {
    const r = make({ sprites: 4, rings: 2, beams: 2 });
    for (let i = 0; i < 2; i++) r.spawn('capture-ring', i * 1000, 0);
    const rings = visibleOf(r, Mesh) as Mesh[]; expect(rings.map(x => x.position.x)).toEqual([0, 1]);
    r.update(null, [], 50); r.spawn('capture-ring', 9000, 0); // pool full: recycles slot 0 (oldest)
    expect(r.stats.rings.active).toBe(2); expect(rings.map(x => x.position.x)).toEqual([9, 1]);
  });
  it('steady state: idle frames spawn nothing and release everything', () => {
    const r = make(); r.update(null, [clash, died, shot, captured], 16);
    for (let f = 0; f < 200; f++) r.update(null, [], 16);
    expect(r.activeCount).toBe(0); expect(visibleOf(r, Mesh).length + visibleOf(r, Sprite).length).toBe(0);
  });
  it('dispose empties the root', () => { const r = make(); r.dispose(); expect(r.root.children).toHaveLength(0); });
});
