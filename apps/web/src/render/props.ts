import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, InstancedMesh, Material, Matrix4, MeshStandardMaterial, Quaternion, Scene, TorusGeometry, Vector3, type Object3D } from 'three';
import type { Manifest } from '@node-arena/content';
import type { Disposables } from './disposables.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeModel } from './model.js';
import { fnv1a, mulberry32 } from './rng.js';
import { CORNER_RADIUS, GRASS_PAD } from './ground.js';

/** Border dressing (PRD R4/R5): rim tree clusters on the grass edge, crates/barrels/tyres/stumps in the sand band.
 * Pure placement; no geometry inside the grass interior (SP04 lane contract, y = 0.04). All meshes carry visualRole 'ground'. */
export const PROP_KINDS = ['treePine', 'treeRound', 'crate', 'barrel', 'stump', 'tyre'] as const;
export type PropKind = typeof PROP_KINDS[number];
export interface PropInstance { kind: PropKind; x: number; z: number; rotY: number; scale: number; /** stacked tyre level (0 = ground) */ stack?: number }
export interface ScatterTower { x: number; z: number; radius: number }
export interface ScatterBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface ScatterTheme { seed: number; density: number }

/** Manifest model key per GLB-backed kind (tyres and barrels are code-built). Keys under `prop.` are auto-loaded for themes with `scatter`. */
export const PROP_MODEL: Partial<Record<PropKind, string>> = {
  treePine: 'prop.tree.pine', treeRound: 'prop.tree.round',
  crate: 'prop.crate', stump: 'prop.stump',
};
/** Target world height (u) and collision radius per kind. */
const SPEC: Record<PropKind, { height: number; radius: number }> = {
  treePine: { height: 7.5, radius: 1.6 }, treeRound: { height: 6, radius: 1.8 },
  crate: { height: 2.4, radius: 1.6 }, barrel: { height: 3.4, radius: 1.6 }, stump: { height: 2.2, radius: 1.4 }, tyre: { height: 1.6, radius: 2.2 },
};
const BAND = 13, TREE_BAND = [-1, 3.5] as const, SAND_NEAR = 3.5, TOWER_CLEAR = 3, CORRIDOR = 2.5, NEAR_PAIR = 40;

interface Core { cx: number; cz: number; w: number; h: number }
/** Signed distance (u) from a point to the rounded-rect grass core; negative inside. */
export function rimDistance(x: number, z: number, core: Core): number {
  const r = Math.min(CORNER_RADIUS, core.w / 2, core.h / 2);
  const qx = Math.abs(x - core.cx) - (core.w / 2 - r), qz = Math.abs(z - core.cz) - (core.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
function segmentDistance(px: number, pz: number, a: ScatterTower, b: ScatterTower): { d: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
  const t = Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
  return { d: Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz)), t };
}

/** Pure, deterministic scatter: same (levelId, bounds, towers, theme) always yields the same list. */
export function scatterProps(levelId: string, bounds: ScatterBounds, towers: readonly ScatterTower[], theme: ScatterTheme): PropInstance[] {
  const rand = mulberry32((fnv1a(levelId) ^ Math.imul(theme.seed | 0, 0x9e3779b1)) | 0);
  const core: Core = { cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minZ + bounds.maxZ) / 2, w: bounds.maxX - bounds.minX + 2 * GRASS_PAD, h: bounds.maxZ - bounds.minZ + 2 * GRASS_PAD };
  const perimeter = 2 * (core.w + core.h), out: PropInstance[] = [];
  if (theme.density <= 0) return out;
  const pairs: [ScatterTower, ScatterTower][] = [];
  for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++)
    if (Math.hypot(towers[i]!.x - towers[j]!.x, towers[i]!.z - towers[j]!.z) < NEAR_PAIR) pairs.push([towers[i]!, towers[j]!]);
  const blocked = (x: number, z: number, pad: number) => {
    for (const t of towers) if (Math.hypot(x - t.x, z - t.z) < t.radius + TOWER_CLEAR + pad) return true;
    for (const [a, b] of pairs) { const s = segmentDistance(x, z, a, b); if (s.d < CORRIDOR + pad && s.t > 0 && s.t < 1) return true; }
    return false;
  };
  const free = (x: number, z: number, kind: PropKind) => {
    if (blocked(x, z, 0)) return false;
    for (const o of out) if (Math.hypot(o.x - x, o.z - z) < SPEC[kind].radius + SPEC[o.kind].radius) return false;
    return true;
  };
  const add = (kind: PropKind, x: number, z: number, scaleLo: number, scaleHi: number) => {
    if (!free(x, z, kind)) return false;
    const item: PropInstance = { kind, x, z, rotY: rand() * Math.PI * 2, scale: scaleLo + rand() * (scaleHi - scaleLo) }; out.push(item);
    // Tyres come in stacks of 1-3 (ref: black stacked pairs).
    if (kind === 'tyre') for (let level = 1, more = rand() < .7; more && level < 3; level++, more = rand() < .35) out.push({ ...item, rotY: rand() * Math.PI * 2, stack: level });
    return true;
  };
  const ringPoint = (d: number, off: number): [number, number] => {
    d = ((d % perimeter) + perimeter) % perimeter; const hw = core.w / 2 + off, hh = core.h / 2 + off;
    if (d < core.w) return [core.cx - core.w / 2 + d, core.cz - hh];
    if (d < core.w + core.h) return [core.cx + hw, core.cz - core.h / 2 + (d - core.w)];
    if (d < 2 * core.w + core.h) return [core.cx + core.w / 2 - (d - core.w - core.h), core.cz + hh];
    return [core.cx - hw, core.cz + core.h / 2 - (d - 2 * core.w - core.h)];
  };

  // Tree clusters hugging the grass rim.
  const trees: PropKind[] = ['treePine', 'treePine', 'treeRound'];
  const clusters = Math.max(1, Math.round(perimeter / 18));
  for (let c = 0; c < clusters; c++) {
    const [cx, cz] = ringPoint((c + rand()) / clusters * perimeter, 0.5 + rand() * 1.5), n = 3 + Math.floor(rand() * 4);
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const a = rand() * Math.PI * 2, r = rand() * 5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const sd = rimDistance(x, z, core); if (sd < TREE_BAND[0] || sd > TREE_BAND[1]) continue;
      if (add(trees[Math.floor(rand() * trees.length)]!, x, z, 0.85, 1.3)) k++;
    }
  }
  // Sand-band groups: crates, barrels, tyres, stumps.
  const sand: PropKind[] = ['crate', 'crate', 'barrel', 'barrel', 'tyre', 'tyre', 'stump', 'stump'];
  const ringArea = perimeter * (BAND - SAND_NEAR) / 1;
  const groups = Math.round(theme.density * ringArea / 1000 / 2.5);
  for (let g = 0; g < groups; g++) {
    let gx = 0, gz = 0, ok = false;
    for (let t = 0; t < 20 && !ok; t++) { [gx, gz] = ringPoint(rand() * perimeter, SAND_NEAR + 1 + rand() * (BAND - SAND_NEAR - 2)); ok = rimDistance(gx, gz, core) >= SAND_NEAR && !blocked(gx, gz, 0); }
    if (!ok) continue;
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const a = rand() * Math.PI * 2, r = k === 0 && tries === 0 ? 0 : 1.2 + rand() * 2.2, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r;
      if (rimDistance(x, z, core) < SAND_NEAR) continue;
      if (add(sand[Math.floor(rand() * sand.length)]!, x, z, 0.9, 1.25)) k++;
    }
  }
  return out;
}

type Theme = Manifest['themes'][string];
const TYRE_COLOR = '#2B2B2B', BARREL_COLOR = '#8E959C', TYRE_THICKNESS = 1.1;
/** Builds one InstancedMesh per prop model part (<= ~12 draw calls). Trees cast shadows; props never do otherwise. Returns a shadow toggle for quality tiers. */
export function createProps(options: { scene: Scene; scope: Disposables; theme: Theme; models: ReadonlyMap<string, Object3D>; placements: readonly PropInstance[] }) {
  const { scene, scope, theme, models, placements } = options;
  const palette = theme.palette ?? {};
  const meshes: { mesh: InstancedMesh; casts: boolean }[] = [];
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  for (const kind of PROP_KINDS) {
    // Every kind always gets one mesh (a zero-scale placeholder when unused) so the GPU resource count is level-independent.
    const used = placements.filter(i => i.kind === kind), list = used.length ? used : [{ kind, x: 0, z: 0, rotY: 0, scale: 0 }];
    let geometry: BufferGeometry, materials: Material | Material[], baseScale: number, lift = 0;
    const key = PROP_MODEL[kind], model = key ? models.get(key) : undefined;
    if (kind === 'barrel') {
      // Grey drum with a dark lid and band so it reads as a barrel (not a boulder) from above; flat vertex colours, one draw call.
      const body = new CylinderGeometry(.85, .85, 1.7, 8), lid = new CylinderGeometry(.6, .6, .1, 8), band = new CylinderGeometry(.9, .9, .25, 8);
      lid.translate(0, 1.72, 0); band.translate(0, .85, 0); body.translate(0, .85, 0);
      const paint = (g: BufferGeometry, hex: string) => { const c = new Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new BufferAttribute(a, 3)); return g; };
      geometry = mergeGeometries([paint(body.toNonIndexed(), BARREL_COLOR), paint(lid.toNonIndexed(), '#3F454C'), paint(band.toNonIndexed(), '#5C636B')])!;
      body.dispose(); lid.dispose(); band.dispose(); scope.add(geometry); geometry.computeBoundingBox();
      materials = scope.add(new MeshStandardMaterial({ vertexColors: true, flatShading: true })); baseScale = SPEC.barrel.height / 1.82;
    } else if (kind === 'tyre') {
      geometry = scope.add(new TorusGeometry(1.2, .55, 6, 14)); geometry.rotateX(Math.PI / 2); geometry.computeBoundingBox();
      materials = scope.add(new MeshStandardMaterial({ color: TYRE_COLOR, flatShading: true })); baseScale = 1; lift = .55;
    } else {
      if (!model) continue; // manifest without this prop model (e.g. primitive-only greybox): skip the kind, never fail the level
      const merged = mergeModel(model, undefined, scope); geometry = merged.geometry; materials = merged.materials;
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); baseScale = SPEC[kind].height / Math.max(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y, 1e-3);
      const colors = merged.materials.map(material => {
        const color = (material as MeshStandardMaterial).color.clone();
        if (/leaf/i.test(material.name) && kind.startsWith('tree') && palette.tree) color.set(palette.tree).lerp(new Color('#6BE060'), .4);
        return color;
      });
      if (!merged.materials.some(material => (material as MeshStandardMaterial).map)) {
        // Flat-colour model: bake material colours into vertex colours so each model is ONE draw call (draw-call budget, M13).
        const position = geometry.getAttribute('position'), attr = new BufferAttribute(new Float32Array(position.count * 3), 3);
        for (const g of geometry.groups) for (let i = g.start; i < g.start + g.count; i++) colors[g.materialIndex ?? 0]!.toArray(attr.array as Float32Array, i * 3);
        geometry.setAttribute('color', attr); geometry.clearGroups();
        // Small emissive lift keeps shadow-side faces (hemisphere light only) off near-black.
        materials = scope.add(new MeshStandardMaterial({ vertexColors: true, emissive: kind.startsWith('tree') ? '#0C2A10' : '#2A1A10', flatShading: true }));
      }
    }
    const mesh = new InstancedMesh(geometry, materials, list.length);
    list.forEach((item, i) => {
      q.setFromAxisAngle(up, item.rotY); p.set(item.x, (lift + (item.stack ?? 0) * TYRE_THICKNESS) * item.scale, item.z); s.setScalar(baseScale * item.scale);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true; mesh.userData.visualRole = 'ground'; mesh.userData.propKind = kind;
    mesh.frustumCulled = false;
    scene.add(mesh); scope.object(mesh, { geometry: false, materials: false }); meshes.push({ mesh, casts: kind.startsWith('tree') });
  }
  /** Quality `low` (no shadow map) disables prop shadows; trees are the only prop casters. */
  const setShadows = (enabled: boolean) => { for (const e of meshes) e.mesh.castShadow = enabled && e.casts; };
  setShadows(true);
  return { meshes: meshes.map(e => e.mesh), setShadows, count: placements.length };
}
