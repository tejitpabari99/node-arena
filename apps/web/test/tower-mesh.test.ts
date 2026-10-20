import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import { Matrix4, Vector3 } from 'three';
import { createTowerMeshes, floorsFor, stackHeight, towerWidth, MAX_FLOORS, LIGHT_GAIN } from '../src/render/tower-mesh.js';

describe('floorsFor (covers R-SP03-R7)', () => {
  it('follows clamp(ceil(5 x count / cap), 1, 5) and spans 1-5 for caps 20/50/80', () => {
    for (const cap of [20, 50, 80]) {
      const seen = new Set<number>();
      for (let count = 0; count <= cap; count++) {
        const f = floorsFor(count, cap); expect(f).toBe(Math.min(5, Math.max(1, Math.ceil(5 * count / cap)))); seen.add(f);
      }
      expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
      expect(floorsFor(0, cap)).toBe(1); expect(floorsFor(cap, cap)).toBe(5);
    }
    expect([floorsFor(5, 63), floorsFor(25, 63), floorsFor(38, 63), floorsFor(44, 63), floorsFor(63, 63)]).toEqual([1, 2, 4, 4, 5]);
  });
  it('shows one floor without a cap', () => { expect(floorsFor(30, null)).toBe(1); expect(floorsFor(30, 0)).toBe(1); });
});

describe('tower meshes', () => {
  const specs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, x: i * 10, z: -i * 3, width: towerWidth(3, .9) }));
  it('width = 2 x footprint radius x scale; stack height grows by the floor pitch', () => {
    expect(towerWidth(3, .9)).toBeCloseTo(5.4); expect(stackHeight(2, 5.4)).toBeGreaterThan(stackHeight(1, 5.4));
  });
  it('14 towers add <= 8 instanced meshes (draws), independent of tower count; roots stay empty', () => {
    const few = createTowerMeshes(specs(2)), many = createTowerMeshes(specs(14));
    expect(many.meshes.length).toBeLessThanOrEqual(8); expect(many.meshes.length).toBe(few.meshes.length);
    expect(many.group.children.length).toBe(many.meshes.length);
    for (const m of many.meshes) { expect(m.userData.visualRole).toBe('tower'); expect(m.userData.towerIds.length).toBeGreaterThanOrEqual(m.count); expect(m.userData.towerIds[0]).toBe('t1'); }
    many.dispose(); few.dispose();
  });
  it('hidden floors are zero-scale instances; visible floors, team colour and neutral grey apply', () => {
    const t = createTowerMeshes(specs(2)), body = t.meshes.find(m => m.name === 'tower-body')!, roof = t.meshes.find(m => m.name === 'tower-roof')!;
    t.setState(0, { floors: 2, color: '#F0313F' }); t.setState(1, { floors: MAX_FLOORS, color: null });
    const scaleY = (m: typeof body, i: number) => new Vector3().setFromMatrixScale(new Matrix4().fromArray(m.instanceMatrix.array as Float32Array, i * 16)).y;
    expect([0, 1, 2, 3, 4].map(k => scaleY(body, k) > 0)).toEqual([true, true, false, false, false]);
    expect([0, 1, 2, 3, 4].map(k => scaleY(body, MAX_FLOORS + k) > 0)).toEqual([true, true, true, true, true]);
    const hex = (i: number) => { const c = roof.instanceColor!.array; return [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!]; };
    expect(hex(0)[0]).toBeGreaterThan(hex(0)[1]! * 3); // saturated red
    expect(new Set(hex(1).map((v, k) => (v / LIGHT_GAIN[k]!).toFixed(3))).size).toBe(1); // neutral grey (r=g=b before the lighting gain)
    expect(t.floors(0)).toBe(2); expect(t.height(1)).toBeCloseTo(stackHeight(5, 5.4));
    t.dispose();
  });
  it('pops animate the instance matrices (150 ms floors, 250 ms capture) and settle', () => {
    const t = createTowerMeshes(specs(1)), body = t.meshes.find(m => m.name === 'tower-body')!;
    t.setState(0, { floors: 1, color: '#2E8BFF' }, 0);
    expect(t.setState(0, { floors: 2, color: '#2E8BFF' }, 1000)).toBe(true);
    expect(t.animate(1075)).toBe(true); expect(t.animate(1200)).toBe(false);
    t.setState(0, { floors: 2, color: '#F0313F' }, 2000, true);
    expect(t.animate(2100)).toBe(true); expect(t.animate(2149)).toBe(true); expect(t.animate(2251)).toBe(false);
    expect(new Matrix4().fromArray(body.instanceMatrix.array as Float32Array, 0).elements[0]).toBeGreaterThan(0);
    t.dispose();
  });
});

describe('towers.visualWidth contract (covers R-SP03-R7)', () => {
  it('sets visualRole/visualWidth/floors on empty roots and towers.visualWidth(id) returns the width', async () => {
    const el = () => ({ dataset: {} as Record<string, string>, style: { cssText: '' } as Record<string, string>, textContent: '', appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, clientWidth: 800, clientHeight: 600, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) });
    vi.stubGlobal('document', { createElement: el }); vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} }); vi.stubGlobal('getComputedStyle', () => ({ position: 'relative' }));
    const { createTowerRenderer } = await import('../src/render/towers.js');
    const { Scene, PerspectiveCamera } = await import('three');
    const { Disposables } = await import('../src/render/disposables.js');
    const manifest = { palettes: { default: { neutral: '#8C8C8C', 'player.1': '#2E8BFF' }, colorblind: { neutral: '#999999', 'player.1': '#0072B2' } }, teamMarkers: { neutral: 'o', 'player.1': 'a' },
      models: { block: { primitive: 'box', size: [4, 6, 4] } }, visuals: { 'tower.standard': { kind: 'tower', model: 'block', build: 'stacked', scale: .9 } } } as unknown as Manifest;
    const view = { ids: { towers: ['a', 'b'] }, players: [{ colorKey: 'player.1' }], towerStatic: [{ x: 0, y: 0, footprintRadius: 3000, visual: 'tower.standard', components: [] }, { x: 20000, y: 0, footprintRadius: 3000, visual: 'tower.standard', components: [] }],
      tower: { owner: [0, -1], col: { 'garrison.count': [30, 5], 'garrison.cap': [50, 50] } } } as unknown as SimView;
    const scene = new Scene(), scope = new Disposables();
    const r = createTowerRenderer({ view, manifest, models: new Map(), scene, camera: new PerspectiveCamera(), parent: el() as unknown as HTMLElement, scope });
    expect(r.visualWidth('a')).toBeCloseTo(5.4); expect(r.visualWidth('zzz')).toBeUndefined();
    const root = r.towers[0]!.group; expect(root.userData).toMatchObject({ visualRole: 'tower', towerIndex: 0, visualWidth: r.visualWidth('a'), floors: 3 });
    expect(r.towers[1]!.group.userData.floors).toBe(1); expect(root.children.every(c => !('isMesh' in c && (c as { visible: boolean }).visible))).toBe(true);
    expect(scene.children.filter(c => c.userData.visualRole === 'tower' && (c as { isInstancedMesh?: boolean }).isInstancedMesh).length).toBe(0);
    expect(scene.children.some(c => c.type === 'Group' && c.children.some(m => (m as { isInstancedMesh?: boolean }).isInstancedMesh))).toBe(true);
    scope.dispose(); vi.unstubAllGlobals();
  });
});
