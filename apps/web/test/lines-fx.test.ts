import { expect, it, vi } from 'vitest';
import { Scene, Vector3, PerspectiveCamera, Color } from 'three';
import type { SimView, SimEvent } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { Disposables } from '../src/render/disposables.js';
import { createLineRenderer } from '../src/render/lines.js';
import { createFxRenderer } from '../src/render/fx.js';
function setup() {
  const view = { towerStatic: [{ x: 0, y: 0, visual: 'tower.standard' }, { x: 10000, y: 0, visual: 'tower.small' }], tower: { owner: new Int32Array([0, 1]) }, players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], lines: [{ channel: 1, from: 0, to: 1, owner: 0, length: 200000 }, { channel: 2, from: 1, to: 0, owner: 1, length: 200000 }] } as unknown as SimView;
  const manifest = structuredClone(manifestJSON) as Manifest, scene = new Scene(), scope = new Disposables();
  return { view, manifest, scene, scope };
}
it('builds one pair ribbon lane for opposite lines, scrolls without rebuilding, projects centre lines, highlights and drains', () => {
  const f = setup(), r = createLineRenderer({ ...f, visualWidth: id => (id === '0' ? 6 : 6) });
  expect(r.meshes).toHaveLength(1); const mesh = r.meshes[0]!, u = mesh.material.uniforms;
  expect(mesh.userData).toMatchObject({ visualRole: 'lane', from: 0, to: 1, pair: '0-1', widthWorld: expect.closeTo(2.1) }); expect(mesh.renderOrder).toBeGreaterThanOrEqual(1);
  expect(r.segments).toHaveLength(2); expect(r.segments[0]!.start.z).toBe(r.segments[1]!.end.z); expect(r.segments[0]!.end.x).toBe(10); expect(r.segments[1]!.end.x).toBe(0);
  expect(u.laneLen!.value).toBe(10); expect(u.laneW!.value).toBeCloseTo(2.1); expect(u.split!.value).toBe(.5); expect(u.buildT!.value).toBe(1);
  expect(mesh.material.transparent).toBe(true); expect(mesh.material.depthWrite).toBe(false); expect(mesh.material.polygonOffset).toBe(true);
  const dispose = vi.spyOn(mesh.geometry, 'dispose');
  r.update(4); r.consumeEvents([{ type: 'Clash', tick: 1, channel: 1, progA: 100000, progB: 100000, value: 1 }]);
  expect(r.meshes[0]).toBe(mesh); expect(u.time!.value).toBe(4); expect(dispose).not.toHaveBeenCalled();
  r.highlight(1, 0); expect(u.hoverA!.value).toBe(1); expect(u.hoverB!.value).toBe(0); r.highlight(1, 1); expect(u.hoverA!.value).toBe(0); r.highlight(null);
  const camera = new PerspectiveCamera(); camera.position.set(5, 20, 15); camera.lookAt(5, 0, 0); camera.updateMatrixWorld();
  const projected = r.projectSegments(camera, 800, 600); expect(projected).toHaveLength(2); for (const seg of projected) expect(seg.halfWidthPx).toBeGreaterThan(0); expect(projected[0]!.start.x).toBeCloseTo((r.segments[0]!.start.clone().project(camera).x + 1) * 400);
  r.setPalette('colorblind'); expect(u.colA!.value.equals(new Color(f.manifest.palettes.colorblind['player.1']))).toBe(true); expect(u.team!.value).toBe(u.colA!.value);
  // Cut only B->A: the lane stays single-direction A->B; cut channel with troops keeps a draining half until empty.
  const lines = f.view.lines as unknown as { channel: number }[]; const kept = lines[0]!; lines.length = 0; lines.push(kept);
  const counts = new Int32Array(4); counts[2] = 3; r.consumeEvents([{ type: 'LineCut', tick: 2, channel: 2, reason: 'player' }]);
  expect(r.meshes[0]).toBe(mesh); expect(u.split!.value).toBe(.5); expect(u.drainB!.value).toBe(0); // B half retracts first (Task 3)
  r.update(5, { frontProgress: new Int32Array(4), channelCount: counts }); r.update(5.4, { frontProgress: new Int32Array(4), channelCount: counts }); expect(u.drainB!.value).toBe(1); expect(u.split!.value).toBe(.5);
  lines.length = 0; r.consumeEvents([{ type: 'LineCut', tick: 3, channel: 1, reason: 'player' }]); expect(r.meshes).toHaveLength(1); expect(u.drainA!.value).toBe(0);
  r.update(6, { frontProgress: new Int32Array(4), channelCount: new Int32Array(4) }); r.update(6.4, { frontProgress: new Int32Array(4), channelCount: new Int32Array(4) }); expect(r.meshes).toHaveLength(0);
  f.scope.dispose(); expect(f.scene.children).toHaveLength(0);
});
it('uses exact fixed-point progA on canonical clash channel, manifest effects and bounded reusable pool', () => {
  const f = setup(); f.manifest.events.Clash!.fx = 'spark'; f.manifest.events.TroopSpawned = { fx: 'puff' };
  const r = createFxRenderer({ ...f, capacity: 2 }); const meshes = [...r.meshes];
  const clash: SimEvent = { type: 'Clash', tick: 1, channel: 1, progA: 50000, progB: 150000, value: 1 };
  r.consumeEvents([clash]); expect(r.activeCount).toBe(1); expect(r.meshes[0]!.position.x).toBe(2.5); expect(r.meshes[0]!.visible).toBe(true); expect(r.slots[0]!.effect).toBe('spark');
  r.consumeEvents([{ type: 'Captured', tick: 2, tower: 1, from: 1, to: 0 }]); expect(r.meshes[1]!.position.x).toBe(10); expect(r.slots[1]!.effect).toBe('pulse');
  r.update(.15); expect(r.meshes[0]!.material.opacity).toBeLessThan(1); r.consumeEvents([{ type: 'TroopSpawned', tick: 3, channel: 2, seq: 9, owner: 1 }]); expect(r.activeCount).toBe(2); expect(r.meshes).toEqual(meshes);
  r.update(2); expect(r.activeCount).toBe(0); r.consumeEvents([clash]); r.setReducedMotion(true); r.update(2.3); expect(r.activeCount).toBe(0);
  f.scope.dispose(); expect(f.scene.children).toHaveLength(0); r.dispose();
});
it('uses tower visual capture fallback, generic locators, and floored diagonal sim length', () => {
  const f = setup(); delete f.manifest.events.Captured; f.manifest.visuals['tower.small']!.fx = 'puff';
  (f.view.towerStatic[1] as { x: number; y: number }).x = 10001; (f.view.towerStatic[1] as { y: number }).y = 12345;
  f.manifest.events.GameOver = { fx: 'pulse' };
  const r = createFxRenderer({ ...f, capacity: 3, eventLocators: { GameOver: (_event, _view, target) => { target.set(9, 1, 8); return -1; } } });
  r.consumeEvents([{ type: 'Clash', tick: 0, channel: 1, progA: 100000, progB: 1, value: 1 }, { type: 'Captured', tick: 0, tower: 1, from: 1, to: 0 }, { type: 'GameOver', tick: 0, outcome: 'won', winnerTeam: 'a' }]);
  const length = Math.floor(Math.hypot(10001 * 20, 12345 * 20)); expect(r.meshes[0]!.position.x).toBeCloseTo(10.001 * 100000 / length); expect(r.meshes[0]!.position.z).toBeCloseTo(12.345 * 100000 / length);
  expect(r.slots[1]!.effect).toBe('puff'); expect(r.meshes[2]!.position).toEqual(new Vector3(9, 1, 8)); f.scope.dispose();
});
