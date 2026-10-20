import { expect, it } from 'vitest';
import { Scene } from 'three';
import type { SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { Disposables } from '../src/render/disposables.js';
import { createLineRenderer } from '../src/render/lines.js';
import { splitTarget, stepSplit, SPLIT_OMEGA } from '../src/render/lane-split.js';
const DT = 1 / 20, L = 200000;
// covers R-CMB-01 (split target equals the Clash event point progA/L at the clash condition)
it('split target: (fa+fb)/2 from front progress; exactly progA/L at the clash condition; empty/absent sides', () => {
  expect(splitTarget(true, true, 3, 90000, 3, 110000, L)).toBeCloseTo(90000 / L, 12); // progA+progB >= L (clash condition: equal)
  expect(splitTarget(true, true, 1, 100000, 1, 100000, L)).toBeCloseTo(.5, 12);
  expect(splitTarget(true, true, 2, 60000, 1, 50000, L)).toBeCloseTo((.3 + .75) / 2, 12); // no clash yet
  expect(splitTarget(true, true, 0, 0, 2, 40000, L)).toBeCloseTo((0 + .8) / 2, 12); // A empty -> fa = 0
  expect(splitTarget(true, true, 2, 40000, 0, 0, L)).toBeCloseTo((.2 + 1) / 2, 12); // B empty -> fb = 1
  expect(splitTarget(false, true, 0, 0, 5, 1, L)).toBe(0); expect(splitTarget(true, false, 5, 1, 0, 0, L)).toBe(1); // absent side -> other end
});
it('spring: critically damped (no overshoot), omega 14/s, converges well inside 1.5 s, zero dt is identity', () => {
  const out = new Float64Array(1); let s = .5, v = 0; const seen: number[] = [];
  for (let k = 0; k < 40; k++) { s = stepSplit(s, v, 0, DT, out); v = out[0]!; seen.push(s); }
  for (let k = 1; k < seen.length; k++) { expect(seen[k]!).toBeLessThanOrEqual(seen[k - 1]!); expect(seen[k]!).toBeGreaterThanOrEqual(0); }
  expect(seen[0]!).toBeCloseTo((.5 + (0 + SPLIT_OMEGA * .5) * DT) * Math.exp(-SPLIT_OMEGA * DT), 12);
  expect(seen[9]!).toBeLessThan(.01); // 0.5 s
  out[0] = 7; expect(stepSplit(.3, 2, 1, 0, out)).toBe(.3); expect(out[0]).toBe(2);
  expect(Number.isFinite(stepSplit(.3, 0, .9, 100, out))).toBe(true); // huge dt clamped to 0.25 s
});
function setup(reducedMotion = false) {
  const lines: { channel: number; from: number; to: number; owner: number; drawSeq: number }[] = [];
  const view = { towerStatic: [{ x: 0, y: 0, visual: 'tower.standard' }, { x: 10000, y: 0, visual: 'tower.small' }], tower: { owner: new Int32Array([0, 1]) }, players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], lines } as unknown as SimView;
  const scene = new Scene(), scope = new Disposables(), r = createLineRenderer({ view, manifest: structuredClone(manifestJSON) as Manifest, scene, scope, reducedMotion });
  return { lines, r, scope };
}
type F = ReturnType<typeof setup>;
const draw = (f: F, from: number) => { f.lines.push({ channel: from === 0 ? 1 : 2, from, to: 1 - from, owner: from, drawSeq: f.lines.length + 1 }); f.r.consumeEvents([{ type: 'LineDrawn', tick: 1, channel: from === 0 ? 1 : 2, owner: from } as never]); };
const fronts = (a: [number, number], b: [number, number]) => { const p = new Int32Array(4), c = new Int32Array(4); p[1] = a[0]; c[1] = a[1]; p[2] = b[0]; c[2] = b[1]; return { frontProgress: p, channelCount: c }; };
it('head-on: one lane, split starts at target, moves smoothly toward a changed target, settle() snaps, update never snaps', () => {
  const f = setup(); draw(f, 0); draw(f, 1); expect(f.r.meshes).toHaveLength(1);
  const mesh = f.r.meshes[0]!, u = mesh.material.uniforms; f.r.update(10, fronts([60000, 2], [60000, 2])); // target (0.3 + 0.7)/2 = 0.5
  expect(u.split!.value).toBeCloseTo(.5, 9); expect(mesh.userData.splitWorld).toBeCloseTo(5, 6);
  const t = fronts([140000, 2], [60000, 2]); // target (0.7 + 0.7)/2 = 0.7
  f.r.update(10 + DT, t); const first = u.split!.value as number; expect(first).toBeGreaterThan(.5); expect(first).toBeLessThan(.7);
  let prev = first; for (let k = 2; k <= 6; k++) { f.r.update(10 + k * DT, t); const s = u.split!.value as number; expect(s).toBeGreaterThanOrEqual(prev); expect(s - prev).toBeLessThan(.07); prev = s; }
  expect(prev).toBeLessThan(.7); f.r.settle(); expect(u.split!.value).toBeCloseTo(.7, 9);
  f.r.update(10 + 7 * DT, fronts([60000, 2], [60000, 2])); expect(u.split!.value as number).toBeGreaterThan(.6); // not snapped by update
  f.scope.dispose();
});
it('head-on: cutting one side slides the split to that end and collapses to a single-direction lane within 1.5 s', () => {
  const f = setup(); draw(f, 0); draw(f, 1); const mesh = f.r.meshes[0]!, u = mesh.material.uniforms; f.r.update(5, fronts([0, 0], [0, 0])); f.r.update(5.5, fronts([0, 0], [0, 0]));
  expect(mesh.userData.splitWorld).not.toBeNull();
  f.lines.splice(0, 1); f.r.consumeEvents([{ type: 'LineCut', tick: 9, channel: 1, reason: 'player' } as never]);
  let t = 6, collapsed = -1; f.r.update(t, fronts([0, 0], [0, 0])); let prev = u.split!.value as number;
  for (let k = 1; k <= 30; k++) { t = 6 + k * DT; f.r.update(t, fronts([0, 0], [0, 0])); const s = u.split!.value as number; if (f.r.meshes.length) { expect(s).toBeLessThanOrEqual(prev + 1e-9); prev = s; if (mesh.userData.splitWorld === null && collapsed < 0) collapsed = k * DT; } }
  expect(collapsed).toBeGreaterThan(0); expect(collapsed).toBeLessThanOrEqual(1.5); expect(u.split!.value).toBe(0); expect(mesh.userData.splitWorld).toBeNull();
  f.scope.dispose();
});
it('single-direction lanes have no split point; a new head-on pair is created at its target; reduced motion snaps', () => {
  const f = setup(); draw(f, 0); f.r.update(1); expect(f.r.meshes[0]!.userData.splitWorld).toBeNull(); expect(f.r.meshes[0]!.material.uniforms.split!.value).toBe(1);
  f.scope.dispose();
  const g = setup(); draw(g, 0); g.r.update(1, fronts([30000, 1], [150000, 1])); draw(g, 1); expect(g.r.meshes[0]!.material.uniforms.split!.value).toBeCloseTo((.15 + 1 - .75) / 2, 9); g.scope.dispose();
  const h = setup(true); draw(h, 0); draw(h, 1); h.r.update(1, fronts([0, 0], [0, 0])); h.r.update(1 + DT, fronts([140000, 2], [60000, 2])); expect(h.r.meshes[0]!.material.uniforms.split!.value).toBeCloseTo(.7, 9); h.scope.dispose();
});
