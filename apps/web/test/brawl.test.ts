import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import type { SimEvent, SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { Disposables } from '../src/render/disposables.js';
import { createLineRenderer } from '../src/render/lines.js';
import { BRAWLS, BURST_PUFFS, PUFFS_PER_BRAWL, brawlSeed, createBrawlRenderer, fighterCount, hash01, intensityOf, markerScale, pairHash, puffRate, stepClashEma, drawCloud, drawSwords } from '../src/render/brawl.js';
const DT = 1 / 20;
function fakeCanvas() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => k in t ? t[k] : (..._a: unknown[]) => { calls.push(k); return { addColorStop() {} }; }, set: (t, k: string, v) => { t[k] = v; return true; } });
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, calls };
}
function setup(owners: [number, number] = [0, 1]) {
  const lines: { channel: number; from: number; to: number; owner: number; drawSeq: number }[] = [];
  const view = { towerStatic: [{ x: 0, y: 0, visual: 'tower.standard' }, { x: 10000, y: 0, visual: 'tower.small' }], tower: { owner: new Int32Array(owners) }, players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], lines } as unknown as SimView;
  const scene = new Scene(), scope = new Disposables(), manifest = structuredClone(manifestJSON) as Manifest, camera = new PerspectiveCamera(); camera.position.set(0, 40, 30); camera.lookAt(5, 0, 0); camera.updateMatrixWorld();
  const l = createLineRenderer({ view, manifest, scene, scope });
  const draw = (from: number, owner: number) => { lines.push({ channel: from === 0 ? 1 : 2, from, to: 1 - from, owner, drawSeq: lines.length + 1 }); l.consumeEvents([{ type: 'LineDrawn', tick: 1, channel: from === 0 ? 1 : 2, owner } as never]); };
  draw(0, owners[0]); draw(1, owners[1]);
  const r = createBrawlRenderer({ view, manifest, scene, scope, lines: l, figureHeight: 5, createCanvas: () => fakeCanvas().canvas });
  const fronts = (a: number, b: number) => { const p = new Int32Array(4), c = new Int32Array(4); p[1] = 60000; c[1] = a; p[2] = 60000; c[2] = b; return { frontProgress: p, channelCount: c }; };
  const clash = (tick: number): SimEvent => ({ type: 'Clash', tick, channel: 1, progA: 100000, progB: 100000, value: 1 });
  const tick = (t: number, a = 2, b = 2) => { const fr = fronts(a, b); l.update(t, fr); r.update(t, camera, fr); };
  return { l, r, scene, scope, camera, clash, tick };
}
describe('brawl pure helpers (covers R-SP04-R7)', () => {
  it('EMA tau 2 s: converges to the event rate, decays, zero dt is identity', () => {
    let e = 0; for (let k = 0; k < 400; k++) e = stepClashEma(e, 1, 1 / 20 / 1 * 1); // 1 event per 0.05 s = 20/s
    expect(e).toBeGreaterThan(19); expect(stepClashEma(5, 0, 0)).toBe(5);
    expect(stepClashEma(1, 0, 2)).toBeCloseTo(Math.exp(-1), 12); // one tau
    expect(stepClashEma(0, 2, 1)).toBeCloseTo(2 * (1 - Math.exp(-.5)), 12);
  });
  it('intensity maps: fighters 2-6, puff rate 2-10/s, marker scale 0.8-1.2', () => {
    expect([fighterCount(0), fighterCount(.5), fighterCount(1), fighterCount(9)]).toEqual([2, 4, 6, 6]);
    expect([puffRate(0), puffRate(1), puffRate(5)]).toEqual([2, 10, 10]); expect([markerScale(0), markerScale(1)].map(x => +x.toFixed(6))).toEqual([.8, 1.2]);
    expect([intensityOf(-1), intensityOf(.3), intensityOf(4)]).toEqual([0, .3, 1]);
  });
  it('hash is a pure function of (pair, tick): same -> same, different tick/pair -> different, range [0,1)', () => {
    const a = brawlSeed(pairHash('a-b'), 120), b = brawlSeed(pairHash('a-b'), 120);
    expect(a).toBe(b); expect(hash01(a, 3)).toBe(hash01(b, 3)); expect(brawlSeed(pairHash('a-b'), 121)).not.toBe(a); expect(brawlSeed(pairHash('a-c'), 120)).not.toBe(a);
    for (let k = 0; k < 200; k++) { const v = hash01(a, k); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('textures draw with plain canvas calls (no asset)', () => {
    const c = fakeCanvas(); drawCloud(c.canvas.getContext('2d')!, 128); expect(c.calls.filter(x => x === 'fillRect').length).toBeGreaterThan(2);
    const s = fakeCanvas(); drawSwords(s.canvas.getContext('2d')!, 128); expect(s.calls.filter(x => x === 'stroke').length).toBeGreaterThanOrEqual(4);
  });
});
describe('brawl renderer', () => {
  it('3 instanced meshes (draw-call budget); fighters, puffs and marker appear for a hostile head-on lane with both fronts', () => {
    const f = setup(); expect(f.r.meshes).toHaveLength(3); f.tick(10); f.tick(10 + DT); f.tick(10.5);
    expect(f.r.fighterCount).toBe(2); expect(f.r.markerCount).toBe(1); expect(f.r.puffCount).toBeGreaterThan(0); expect(f.r.activeBrawls).toBe(1);
    expect(f.r.meshes[0]!.instanceColor).not.toBeNull(); f.scope.dispose(); expect(f.scene.children).toHaveLength(0);
  });
  it('no brawl without both fronts, without a Clash, or for allied (same-owner) lanes', () => {
    const f = setup(); f.tick(10, 2, 0); f.tick(10.5, 2, 0); expect(f.r.fighterCount).toBe(0); expect(f.r.markerCount).toBe(0); f.scope.dispose();
    const g = setup([0, 0]); g.tick(10); g.tick(10.5); g.r.consumeEvents([g.clash(210)]); g.tick(10.6); expect(g.r.fighterCount).toBe(0); expect(g.r.puffCount).toBe(0); g.scope.dispose();
  });
  it('a Clash alone keeps the brawl for 1.2 s, then it fades out; burst = 6 puffs', () => {
    const f = setup(); f.tick(10, 0, 0); f.r.consumeEvents([f.clash(200)]); f.tick(10 + DT, 0, 0);
    expect(f.r.activeBrawls).toBe(1); expect(f.r.fighterCount).toBeGreaterThanOrEqual(2); // one clash in 0.05 s = 20/s into a tau-2 EMA
    let burst = 0; for (const s of f.r.slots) for (let k = 0; k < BURST_PUFFS; k++) if (s.burstBorn[k]! > -Infinity) burst++; expect(burst).toBe(BURST_PUFFS);
    for (let k = 2; k <= 16; k++) f.tick(10 + k * DT, 0, 0); expect(f.r.fighterCount).toBeGreaterThanOrEqual(2); // 0.8 s
    for (let k = 17; k <= 50; k++) f.tick(10 + k * DT, 0, 0); expect(f.r.fighterCount).toBe(0); expect(f.r.activeBrawls).toBe(0); expect(f.r.puffCount).toBe(0);
    f.scope.dispose();
  });
  it('intensity from the clash rate raises fighters (<= 6) and the pool never exceeds 6 brawls x 12 puffs', () => {
    const f = setup(); let t = 10; f.tick(t);
    for (let k = 0; k < 120; k++) { t += DT; f.r.consumeEvents([f.clash(Math.round(t * 20))]); f.r.consumeEvents([f.clash(Math.round(t * 20))]); f.tick(t); expect(f.r.puffCount).toBeLessThanOrEqual(BRAWLS * PUFFS_PER_BRAWL); }
    expect(f.r.fighterCount).toBe(6); expect(f.r.meshes[0]!.count).toBe(6); expect(f.r.meshes[1]!.instanceMatrix.count).toBe(BRAWLS * PUFFS_PER_BRAWL); f.scope.dispose();
  });
  it('determinism: identical event/frame sequence -> identical instance matrices; no new GPU objects while running', () => {
    const run = () => {
      const f = setup(); f.tick(10); f.r.consumeEvents([f.clash(205)]); const geoms = f.r.meshes.map(m => m.geometry), children = f.scene.children.length; const out: number[] = [];
      for (let k = 1; k <= 30; k++) { f.tick(10 + k * DT); out.push(...f.r.meshes[0]!.instanceMatrix.array.slice(0, 16 * f.r.fighterCount), ...f.r.meshes[1]!.instanceMatrix.array.slice(0, 16 * f.r.puffCount)); }
      expect(f.r.meshes.map(m => m.geometry)).toEqual(geoms); expect(f.scene.children.length).toBe(children); f.scope.dispose(); return out;
    };
    const a = run(), b = run(); expect(a.length).toBeGreaterThan(100); expect(b).toEqual(a);
  });
  it('ambient puffs move smoothly while intensity changes every frame on a long clock (no per-frame teleports)', () => {
    const f = setup(); let t = 60; f.tick(t); for (let k = 0; k < 20; k++) { t += DT; f.r.consumeEvents([f.clash(Math.round(t * 20))]); f.tick(t); }
    for (let k = 0; k < 200; k++) { t += DT; f.tick(t); } // bursts expired; clash EMA still decaying (intensity changes each frame)
    const pos = () => { const m = f.r.meshes[1]!.instanceMatrix.array, a = (f.r.meshes[1]!.geometry.getAttribute('aAlpha') as { array: Float32Array }).array, out: { x: number; y: number; z: number; a: number }[] = []; for (let i = 0; i < f.r.puffCount; i++) out.push({ x: m[i * 16 + 12]!, y: m[i * 16 + 13]!, z: m[i * 16 + 14]!, a: a[i]! }); return out; };
    let prev = pos(), checked = 0, last = -1;
    for (let k = 0; k < 160; k++) {
      t += DT; f.tick(t); const cur = pos(), ema = f.r.slots[0]!.ema; expect(ema).not.toBe(last); last = ema; expect(ema).toBeLessThan(1);
      for (const p of cur) { /* puffs with alpha < .7 are just restarted (age < ~2 frames) and may appear anywhere */ if (p.a < .7) continue; let best = Infinity; for (const q of prev) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)); expect(best).toBeLessThan(.6); checked++; }
      prev = cur;
    }
    expect(checked).toBeGreaterThan(20); f.scope.dispose();
  });
});
