import { describe,expect,it,vi } from 'vitest';
import { Group,Mesh,BoxGeometry,MeshBasicMaterial } from 'three';
import { ModelCache } from '../src/render/gltf-cache';
describe('v2 decoded model cache',()=>{
 it('coalesces concurrent source/node loads and reuses decoded objects',async()=>{
  const scene=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.name='house';scene.add(mesh);
  const load=vi.fn(async()=>({scene})),cache=new ModelCache(load);
  expect(await Promise.all([cache.resolve('house.glb#house'),cache.resolve('house.glb#house')])).toEqual([mesh,mesh]);
  expect(await cache.resolve('house.glb')).toBe(scene);expect(load).toHaveBeenCalledTimes(1);expect(cache.loadedFiles).toBe(1);cache.dispose();
 });
 it('evicts rejected loads for retry and reports missing named nodes',async()=>{
  const load=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({scene:new Group()});const cache=new ModelCache(load);
  await expect(cache.resolve('a.glb')).rejects.toThrow('offline');await expect(cache.resolve('a.glb#absent')).rejects.toThrow('not found');expect(load).toHaveBeenCalledTimes(2);cache.dispose();
 });
 it('disposes loaded and late arriving geometries after cancellation',async()=>{
  let finish!:(value:{scene:Group})=>void;const cache=new ModelCache(()=>new Promise(resolve=>{finish=resolve;}));
  const scene=new Group(),geometry=new BoxGeometry(),dispose=vi.spyOn(geometry,'dispose');scene.add(new Mesh(geometry,new MeshBasicMaterial()));
  const pending=cache.file('a.glb');cache.dispose();finish({scene});await pending;await Promise.resolve();expect(dispose).toHaveBeenCalledOnce();expect(cache.loadedFiles).toBe(0);
 });
});
