import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { mergeModel } from '../src/render/model.js';
import { Disposables } from '../src/render/disposables.js';

function triangle(normals = true) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3));
  if (normals) geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return geometry;
}
describe('static GLB merge regressions', () => {
  it.each([true, false])('preserves exterior winding and every vertex association on mirrored nodes (authored normals: %s)', normals => {
    const geometry = triangle(normals);
    geometry.setAttribute('color', new BufferAttribute(new Float32Array([1, 0, 0, .2, 0, 1, 0, .4, 0, 0, 1, .6]), 4));
    for (let channel = 1; channel <= 3; channel++) geometry.setAttribute(`uv${channel}`, new BufferAttribute(new Float32Array([.1, .2, .3, .4, .5, .6]), 2));
    const source = new Group(), material = new MeshStandardMaterial(); material.name = 'Team';
    const mesh = new Mesh(geometry, material); mesh.scale.x = -1; source.add(mesh);
    const original = Array.from(geometry.getAttribute('position').array), dispose = vi.spyOn(geometry, 'dispose');
    const scope = new Disposables(), merged = mergeModel(source, 'Team', scope);
    const position = merged.geometry.getAttribute('position'), normal = merged.geometry.getAttribute('normal');
    const a = new Vector3().fromBufferAttribute(position, 0), b = new Vector3().fromBufferAttribute(position, 1), c = new Vector3().fromBufferAttribute(position, 2);
    expect(b.sub(a).cross(c.sub(a)).dot(new Vector3(0, 0, 1))).toBeGreaterThan(0);
    expect(normal.getZ(0)).toBeCloseTo(1);
    expect(Array.from(merged.geometry.getAttribute('uv').array)).toEqual([0, 0, 0, 1, 1, 0]);
    for (let channel = 1; channel <= 3; channel++) {
      const uv = merged.geometry.getAttribute(`uv${channel}`);
      expect(uv).toBeDefined(); expect(Array.from(uv.array)).toEqual(Array.from(new Float32Array([.1, .2, .5, .6, .3, .4])));
    }
    expect(Array.from(merged.geometry.getAttribute('color').array)).toEqual(Array.from(new Float32Array([1, 0, 0, .2, 0, 0, 1, .6, 0, 1, 0, .4])));
    expect(Array.from(merged.geometry.getAttribute('teamMask').array)).toEqual([1, 1, 1]);
    scope.dispose(); expect(dispose).not.toHaveBeenCalled(); expect(Array.from(geometry.getAttribute('position').array)).toEqual(original);
    geometry.dispose(); material.dispose();
  });
  it('pads secondary UV channels across groups and meshes while preserving materials, draw ranges and ownership', () => {
    const source = new Group(), texture = new Texture(); texture.channel = 1;
    const material = new MeshStandardMaterial({ map: texture }); material.name = 'Team';
    const first = triangle(); first.setAttribute('uv1', new BufferAttribute(new Float32Array([.25, .75, .5, .75, .75, .25]), 2));
    first.setIndex([0, 1, 2, 0, 2, 1]); first.addGroup(0, 3, 0); first.addGroup(3, 3, 1); first.setDrawRange(0, 3);
    const second = triangle(); second.setAttribute('uv3', new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1]), 2));
    source.add(new Mesh(first, [material, material]), new Mesh(second, material));
    const textureDispose = vi.spyOn(texture, 'dispose'), materialDispose = vi.spyOn(material, 'dispose'), geometryDispose = vi.spyOn(first, 'dispose');
    const scope = new Disposables(), merged = mergeModel(source, 'Team', scope);
    expect(merged.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }]);
    expect(Array.from(merged.geometry.getAttribute('uv1').array)).toEqual([.25, .75, .5, .75, .75, .25, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(merged.geometry.getAttribute('uv3').array)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(merged.materials.every(copy => copy !== material && (copy as MeshStandardMaterial).map !== texture && (copy as MeshStandardMaterial).map!.source === texture.source)).toBe(true);
    expect(texture.channel).toBe(1);
    const mergedDispose = vi.spyOn(merged.geometry, 'dispose'), copiesDispose = merged.materials.map(copy => vi.spyOn(copy, 'dispose'));
    scope.dispose(); scope.dispose(); expect(mergedDispose).toHaveBeenCalledTimes(1); copiesDispose.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
    expect(textureDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    first.dispose(); second.dispose(); material.dispose(); texture.dispose();
  });
});
