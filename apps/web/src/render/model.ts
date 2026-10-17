import { Box3, BoxGeometry, BufferGeometry, BufferAttribute, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Manifest } from '@node-arena/content';
import { PRIMITIVE_SEGMENTS } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
type Primitive = Extract<Manifest['models'][string], { primitive: string }>;
export function createPrimitiveModel(model: Primitive): Group {
  const [a, b, c] = model.size as [number, number, number];
  const geometry = model.primitive === 'box' ? new BoxGeometry(a, b, c) : model.primitive === 'capsule'
    ? new CapsuleGeometry(a, b, PRIMITIVE_SEGMENTS.capsule.cap, PRIMITIVE_SEGMENTS.capsule.radial)
    : new CylinderGeometry(a, c, b, PRIMITIVE_SEGMENTS.cylinder.radial);
  geometry.computeBoundingBox(); geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  const group = new Group(); group.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff }))); return group;
}
/** Wrap rather than rewriting mesh coordinates: shared scene remains usable by tower clones. */
export function normalizeModel(scene: Object3D): Group {
  const group = new Group(); group.add(scene); const bounds = new Box3().setFromObject(group);
  if (!bounds.isEmpty()) { const centre = bounds.getCenter(new Vector3()); scene.position.sub(new Vector3(centre.x, bounds.min.y, centre.z)); }
  group.updateMatrixWorld(true); return group;
}
type Wrappers = { geometries: Map<BufferGeometry, BufferGeometry>; textures: Map<Texture, Texture> };
// Weak keys and explicit deletion keep disposed level scopes out of application lifetime.
const scopeWrappers = new WeakMap<Disposables, Wrappers>();
function wrappers(scope: Disposables): Wrappers {
  let cached = scopeWrappers.get(scope);
  if (!cached) {
    cached = { geometries: new Map(), textures: new Map() }; scopeWrappers.set(scope, cached);
    scope.defer(() => scopeWrappers.delete(scope));
  }
  return cached;
}
function cloneMaterial(material: Material, scope: Disposables): Material {
  const copy = material.clone(), textures = wrappers(scope).textures;
  for (const [name, value] of Object.entries(material)) if (value instanceof Texture) {
    let texture = textures.get(value);
    // Texture.clone shares the decoded Source/image, but owns its renderer listeners.
    if (!texture) { texture = scope.add(value.clone()); textures.set(value, texture); }
    Object.assign(copy, { [name]: texture });
  }
  return copy;
}
/** CPU templates never render directly. Geometry/texture wrappers are shared within this level scope. */
export function cloneModel(source: Object3D, scope: Disposables): Object3D {
  const clone = source.clone(true), materials = new Map<Material, Material>(), geometries = wrappers(scope).geometries;
  clone.traverse(node => { if (node instanceof Mesh) {
    let geometry = geometries.get(node.geometry);
    if (!geometry) { const owned: BufferGeometry = scope.add(node.geometry.clone()); geometries.set(node.geometry, owned); geometry = owned; }
    node.geometry = geometry;
    const copy = (m: Material) => { if (!materials.has(m)) materials.set(m, cloneMaterial(m, scope)); return materials.get(m)!; };
    node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
  } });
  scope.object(clone, { geometry: false, textures: false }); return clone;
}
/** Static GLTF primitives flattened into a single instancing geometry. Groups preserve textures/materials. */
export function mergeModel(source: Object3D, teamMaterial: string | undefined, scope: Disposables): { geometry: BufferGeometry; materials: Material[]; hasTeamMaterial: boolean } {
  const uvNames = new Set(['uv']); let colorSize = 3;
  source.traverse(node => { if (node instanceof Mesh) {
    for (const name of ['uv1', 'uv2', 'uv3']) if (node.geometry.hasAttribute(name)) uvNames.add(name);
    colorSize = Math.max(colorSize, node.geometry.getAttribute('color')?.itemSize ?? 3);
  } });
  source.updateMatrixWorld(true); const parts: BufferGeometry[] = []; const materials: Material[] = []; let hasTeamMaterial = false;
  try {
    source.traverse(node => {
      if (!(node instanceof Mesh)) return;
      if ('isSkinnedMesh' in node && node.isSkinnedMesh) throw new Error('Skinned models are unsupported');
      const original = node.geometry; const nonindexed = original.index ? original.toNonIndexed() : original.clone();
      if (!nonindexed.hasAttribute('normal')) nonindexed.computeVertexNormals();
      nonindexed.applyMatrix4(node.matrixWorld);
      const mirrored = node.matrixWorld.determinant() < 0;
      try {
      const count = nonindexed.getAttribute('position').count;
      const meshMaterials = Array.isArray(node.material) ? node.material : [node.material];
      const groups = Array.isArray(node.material) && original.groups.length ? original.groups : [{ start: 0, count, materialIndex: 0 }];
      for (const group of groups) {
        const material = meshMaterials[group.materialIndex ?? 0]; if (!material) throw new Error('Missing model material');
        const part = new BufferGeometry();
        const start = Math.max(group.start, original.drawRange.start); const end = Math.min(group.start + group.count, count, original.drawRange.start + original.drawRange.count);
        if (end <= start) { part.dispose(); continue; }
        for (const name of ['position', 'normal', ...uvNames, 'color']) {
          const input = nonindexed.getAttribute(name); const size = uvNames.has(name) ? 2 : name === 'color' ? colorSize : 3; const values = new Float32Array((end - start) * size);
          for (let i = start; i < end; i++) for (let axis = 0; axis < size; axis++) values[(i - start) * size + axis] = input && axis < input.itemSize ? input.getComponent(i, axis) : name === 'color' ? 1 : 0;
          part.setAttribute(name, new BufferAttribute(values, size));
        }
        const mask = material.name === teamMaterial ? 1 : 0; hasTeamMaterial ||= mask === 1;
        part.setAttribute('teamMask', new BufferAttribute(new Float32Array(end - start).fill(mask), 1));
        // Baking a reflection removes WebGL's object-level front-face correction.
        // Swap complete vertices so UVs, normals, colours and masks remain associated.
        if (mirrored) for (const attribute of Object.values(part.attributes)) {
          for (let i = 0; i + 2 < attribute.count; i += 3) for (let axis = 0; axis < attribute.itemSize; axis++) {
            const value = attribute.getComponent(i + 1, axis);
            attribute.setComponent(i + 1, axis, attribute.getComponent(i + 2, axis));
            attribute.setComponent(i + 2, axis, value);
          }
        }
        parts.push(part); const copy = cloneMaterial(material, scope); copy.vertexColors = true; materials.push(copy);
      }
      } finally { nonindexed.dispose(); }
    });
    if (!parts.length) throw new Error('Model has no renderable primitives');
    const geometry = mergeGeometries(parts, true); if (!geometry) throw new Error('Cannot merge model geometry');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); scope.add(geometry); for (const material of materials) scope.material(material, false);
    return { geometry, materials, hasTeamMaterial };
  } catch (error) { for (const material of materials) material.dispose(); throw error; }
  finally { for (const part of parts) part.dispose(); }
}
