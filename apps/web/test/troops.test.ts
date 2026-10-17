import { expect, it, vi } from 'vitest';
import { Scene, Mesh, Group, BoxGeometry, MeshStandardMaterial, Color, type InstancedBufferAttribute } from 'three';
import type { SimView, TroopBuf } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import manifestJSON from './fixtures/greybox-manifest.json';
import { createTroopRenderer } from '../src/render/troops.js';
import { Disposables } from '../src/render/disposables.js';
function setup(count = 2) {
  const manifest = structuredClone(manifestJSON) as Manifest;
  manifest.models.fixture = { primitive: 'box', size: [1, 1, 1] };
  manifest.visuals['fixture.unit'] = { kind: 'troop', model: 'fixture', scale: 2, yOffset: 3, teamMaterial: 'shirt', tint: '#cccccc', anim: { type: 'bob', hz: 3, amp: .2, sway: 9 } };
  const source = new Group(); const material = new MeshStandardMaterial(); material.name = 'shirt'; source.add(new Mesh(new BoxGeometry(), material));
  const view = { towerStatic: [{ x: 0, y: 0 }, { x: 10000, y: 0 }], players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], kinds: [{ visual: 'fixture.unit', speedPerTick: 1000 }, { visual: 'fixture.unit', speedPerTick: 1000 }], lines: [] } as unknown as SimView;
  let live = count;
  const readTroops = vi.fn((buf: TroopBuf) => { for (let i = 0; i < Math.min(live, buf.channel.length); i++) { buf.channel[i] = i % 2 ? 2 : 1; buf.owner[i] = i % 2; buf.kind[i] = i % 2; buf.seq[i] = i + 7; buf.progress[i] = 99500; } return live; });
  const scope = new Disposables(), scene = new Scene();
  const renderer = createTroopRenderer({ sim: { view, readTroops }, scene, manifest, models: new Map([['fixture', source]]), scope, initialCapacity: 1 });
  return { renderer, readTroops, scene, scope, source, manifest, setLive: (n: number) => { live = n; } };
}
it('grows/rereads immediately, groups shared visuals by owner, and decodes cut channels with integer sim length units', () => {
  const f = setup(6); f.renderer.update(.5, 10);
  expect(f.readTroops).toHaveBeenCalledTimes(2); expect(f.renderer.count).toBe(6); expect(f.renderer.meshes).toHaveLength(2);
  const [a, b] = f.renderer.meshes; expect(a!.count).toBe(3); expect(b!.count).toBe(3);
  expect(a!.geometry.getAttribute('troopPose').array.slice(0, 4)).toEqual(new Float32Array([5, 0, -Math.PI / 2, 7]));
  expect(b!.geometry.getAttribute('troopPose').array.slice(0, 4)).toEqual(new Float32Array([5, 0, Math.PI / 2, 8]));
  expect(a!.geometry.getAttribute('troopPose')).not.toBe(b!.geometry.getAttribute('troopPose'));
  expect(a!.castShadow || a!.receiveShadow || a!.frustumCulled).toBe(false);
  const pose = a!.geometry.getAttribute('troopPose'); f.renderer.update(0, 11); expect(a!.geometry.getAttribute('troopPose')).toBe(pose);
  f.setLive(0); f.renderer.update(0, 12); expect(f.renderer.meshes.every(mesh => mesh.count === 0)).toBe(true);
  f.scope.dispose(); expect(f.scene.children).toHaveLength(0); new Disposables().object(f.source).dispose();
});
it('patches positions and normals, manifest uniforms and masked colours; reduced motion disables animation', () => {
  const f = setup(); f.renderer.update(1, 4); const mesh = f.renderer.meshes[0]!;
  const material = (mesh.material as MeshStandardMaterial[])[0]!;
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
  material.onBeforeCompile(shader as any, {} as any);
  expect(shader.vertexShader).toContain('objectNormal.xz'); expect(shader.vertexShader).toContain('transformed.xz += troopPose.xy');
  expect(shader.fragmentShader).toContain('vTroopTeamMask');
  const uniforms = shader.uniforms as any; expect(uniforms.troopScale.value).toBe(2); expect(uniforms.troopYOffset.value).toBe(3); expect(uniforms.troopHz.value).toBe(3);
  expect(uniforms.troopTeam.value.equals(new Color(f.manifest.palettes.default['player.1']))).toBe(true);
  f.renderer.setReducedMotion(true); expect(uniforms.troopAmp.value).toBe(0); expect(uniforms.troopSway.value).toBe(0);
  f.renderer.setReducedMotion(false); expect(uniforms.troopAmp.value).toBe(.2);
  f.renderer.setPalette('colorblind'); expect(uniforms.troopTeam.value.equals(new Color(f.manifest.palettes.colorblind['player.1']))).toBe(true);
  f.scope.dispose(); new Disposables().object(f.source).dispose();
});
it('disposes replaced buffers and meshes on capacity doubling and clamps endpoint extrapolation', () => {
  const f = setup(2); f.renderer.update(0, 0); const old = f.renderer.meshes[0]!; const meshDispose = vi.spyOn(old, 'dispose'), geometryDispose = vi.spyOn(old.geometry, 'dispose');
  f.setLive(20); f.renderer.update(999, 1); expect(meshDispose).toHaveBeenCalledTimes(1); expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(f.renderer.meshes[0]!.geometry.getAttribute('troopPose').getX(0)).toBe(10);
  f.scope.dispose(); f.renderer.dispose(); new Disposables().object(f.source).dispose();
});
it('resolves pose buffers once per bucket per frame and writes replacement buffers after repeated growth', () => {
  const f = setup(20); f.renderer.update(0, 0);
  for (const [count, alpha] of [[20, .5], [60, 1], [140, .25]] as const) {
    f.setLive(count); f.renderer.update(alpha, 1);
    for (const [owner, mesh] of f.renderer.meshes.entries()) {
      const attribute = mesh.geometry.getAttribute('troopPose') as InstancedBufferAttribute;
      let reads = 0;
      Object.defineProperty(mesh.geometry.attributes, 'troopPose', {
        configurable: true, get() { reads++; return attribute; },
      });
      f.renderer.update(0, 2);
      expect(reads).toBeLessThanOrEqual(1);
      expect(mesh.count).toBe(count / 2);
      expect(attribute.getX(0)).toBeCloseTo(owner ? 5.025 : 4.975);
      expect(attribute.getW(mesh.count - 1)).toBe(count + 5 + owner);
      expect(attribute.updateRanges).toEqual([{ start: 0, count: mesh.count * 4 }]);
      Object.defineProperty(mesh.geometry.attributes, 'troopPose', { configurable: true, writable: true, value: attribute });
    }
  }
  f.scope.dispose(); new Disposables().object(f.source).dispose();
});
it('retains material groups, scope-owned texture wrappers, selective team masks and generic fallback across owners', async () => {
  const { MeshBasicMaterial, DataTexture } = await import('three');
  const f = setup(); f.renderer.dispose();
  const textured = new MeshStandardMaterial({ map: new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) }); textured.name = 'shirt';
  const plain = new MeshBasicMaterial({ color: '#abcdef' }); plain.name = 'body';
  const geometry = new BoxGeometry(); const materials = [textured, plain, plain, plain, plain, plain];
  const source = new Group(); source.add(new Mesh(geometry, materials));
  const textureDispose = vi.spyOn(textured.map!, 'dispose');
  const renderer = createTroopRenderer({ sim: { view: { towerStatic: [{ x: 0, y: 0 }, { x: 10001, y: 12345 }], players: [{ colorKey: 'player.1' }, { colorKey: 'player.2' }], kinds: [{ visual: 'fixture.unit', speedPerTick: 1000 }] } as unknown as SimView,
    readTroops: out => { out.channel[0] = 1; out.owner[0] = 0; out.kind[0] = 0; out.seq[0] = 123; out.progress[0] = 100000; return 1; } },
    scene: f.scene, manifest: f.manifest, models: new Map([['fixture', source]]), scope: f.scope });
  renderer.update(.5, 2);
  const mesh = renderer.meshes[0]!, pose = mesh.geometry.getAttribute('troopPose');
  const length = Math.floor(Math.hypot(10001 * 20, 12345 * 20));
  expect(pose.getX(0)).toBeCloseTo(10.001 * 100500 / length, 5); expect(pose.getY(0)).toBeCloseTo(12.345 * 100500 / length, 5);
  expect(mesh.geometry.groups).toHaveLength(6); const mask = mesh.geometry.getAttribute('teamMask'); expect(mask.getX(0)).toBe(1); expect(mask.getX(6)).toBe(0);
  const copies = mesh.material as MeshStandardMaterial[]; expect(copies[0]!.map).not.toBe(textured.map); expect(copies[0]!.map!.source).toBe(textured.map!.source); const wrapperDispose = vi.spyOn(copies[0]!.map!, 'dispose'); expect(copies[1]!.type).toBe('MeshBasicMaterial');
  expect(copies[0]).not.toBe((renderer.meshes[1]!.material as MeshStandardMaterial[])[0]);
  f.scope.dispose(); expect(wrapperDispose).toHaveBeenCalledTimes(1); expect(textureDispose).not.toHaveBeenCalled(); new Disposables().object(source).dispose(); expect(textureDispose).toHaveBeenCalledTimes(1);
  new Disposables().object(f.source).dispose();
});
