import { expect, it } from 'vitest';
import { Scene } from 'three';
import type { SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { Disposables } from '../src/render/disposables.js';
import { createLineRenderer } from '../src/render/lines.js';
const DT = 1 / 20;
function setup(reducedMotion = false) {
  const lines: { channel: number; from: number; to: number; owner: number; length: number }[] = [];
  const view = { towerStatic: [{ x: 0, y: 0, visual: 'tower.standard' }, { x: 10000, y: 0, visual: 'tower.small' }], tower: { owner: new Int32Array([0, 1]) }, players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], lines } as unknown as SimView;
  const scene = new Scene(), scope = new Disposables(), r = createLineRenderer({ view, manifest: structuredClone(manifestJSON) as Manifest, scene, scope, reducedMotion });
  return { lines, r, scene, scope };
}
const draw = (f: ReturnType<typeof setup>, from = 0) => { f.lines.push({ channel: from === 0 ? 1 : 2, from, to: 1 - from, owner: from, length: 200000 }); f.r.consumeEvents([{ type: 'LineDrawn', tick: 1, channel: from === 0 ? 1 : 2, from, to: 1 - from, owner: from }]); };
it('build-out grows buildT 0 -> 1 from the source over 0.35 s (ease-out) with a fixed dt, and is instant under reduced motion', () => {
  const f = setup(); f.r.update(10); draw(f, 1); const u = f.r.meshes[0]!.material.uniforms;
  expect(u.buildSrc!.value).toBe(1); f.r.update(10); expect(u.buildT!.value).toBe(0); // anchored at the last rendered clock
  const seen: number[] = []; for (let k = 1; k <= 8; k++) { f.r.update(10 + k * DT); seen.push(u.buildT!.value); }
  expect(seen[0]).toBeCloseTo(1 - (1 - DT / .35) ** 2, 6); expect(seen[2]).toBeCloseTo(1 - (1 - 3 * DT / .35) ** 2, 6);
  for (let k = 1; k < seen.length; k++) expect(seen[k]!).toBeGreaterThanOrEqual(seen[k - 1]!);
  expect(seen[0]!).toBeGreaterThan(.25); expect(seen[2]!).toBeLessThan(1); expect(seen[7]).toBe(1);
  const g = setup(true); draw(g); g.r.update(1); expect(g.r.meshes[0]!.material.uniforms.buildT!.value).toBe(1);
  f.scope.dispose(); g.scope.dispose();
});
it('cut: 80 ms white flash, 0.3 s retract toward the source, 4 pooled puffs, lane removed afterwards; troops keep a draining half', () => {
  const f = setup(); draw(f); f.r.update(5); f.r.update(5 + .5); const mesh = f.r.meshes[0]!, u = mesh.material.uniforms; expect(u.buildT!.value).toBe(1);
  f.lines.length = 0; f.r.consumeEvents([{ type: 'LineCut', tick: 120, channel: 1, reason: 'player' }]);
  expect(f.r.meshes).toHaveLength(1); expect(f.r.puffs.activeCount).toBe(4);
  const t0 = 6; f.r.update(t0); expect(u.flashA!.value).toBe(1); expect(u.retractA!.value).toBe(0);
  f.r.update(t0 + DT); expect(u.flashA!.value).toBe(1); expect(u.retractA!.value).toBeCloseTo(DT / .3);
  f.r.update(t0 + 3 * DT); expect(u.flashA!.value).toBe(0); expect(u.retractA!.value).toBeCloseTo(.5);
  expect(f.r.puffs.activeCount).toBe(4);
  f.r.update(t0 + .3 + 1e-6); expect(f.r.meshes).toHaveLength(0); f.r.update(t0 + 1); expect(f.r.puffs.activeCount).toBe(0);
  // cut channel that still carries troops: after the retract it stays as a faded draining half until empty
  const g = setup(); draw(g); g.r.update(5); g.r.update(6); g.lines.length = 0; const counts = new Int32Array(4); counts[1] = 2;
  g.r.consumeEvents([{ type: 'LineCut', tick: 9, channel: 1, reason: 'player' }]); g.r.update(7, { frontProgress: new Int32Array(4), channelCount: counts });
  g.r.update(7.4, { frontProgress: new Int32Array(4), channelCount: counts }); expect(g.r.meshes).toHaveLength(1); expect(g.r.meshes[0]!.material.uniforms.drainA!.value).toBe(1);
  { const gu = g.r.meshes[0]!.material.uniforms; expect(gu.retractA!.value).toBe(1); expect(gu.keepA!.value).toBe(1); } // bright part fully retracted; faded base stays under the troops
  g.r.update(7.7, { frontProgress: new Int32Array(4), channelCount: new Int32Array(4) }); expect(g.r.meshes).toHaveLength(0);
  f.scope.dispose(); g.scope.dispose();
});
it('settle() snaps animations; update() never settles; reduced motion cuts instantly without puffs', () => {
  const f = setup(); f.r.update(1); draw(f); f.r.update(1 + DT); const u = f.r.meshes[0]!.material.uniforms; expect(u.buildT!.value).toBeLessThan(1);
  f.r.settle(); expect(u.buildT!.value).toBe(1);
  f.lines.length = 0; f.r.consumeEvents([{ type: 'LineCut', tick: 3, channel: 1, reason: 'player' }]); f.r.update(2); f.r.update(2 + DT); expect(f.r.meshes).toHaveLength(1);
  f.r.settle(); expect(f.r.meshes).toHaveLength(0); expect(f.r.puffs.activeCount).toBe(0);
  const g = setup(true); draw(g); g.lines.length = 0; g.r.consumeEvents([{ type: 'LineCut', tick: 3, channel: 1, reason: 'player' }]); expect(g.r.meshes).toHaveLength(0); expect(g.r.puffs.activeCount).toBe(0);
  f.scope.dispose(); g.scope.dispose();
});
