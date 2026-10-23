import { Group, Mesh, MirroredRepeatWrapping, RepeatWrapping, type BufferGeometry, type Object3D } from 'three';
import type { ManifestV2 } from '@node-arena/content';
import { registerRenderer, type Renderer, type RendererContext } from './registry.js';
import { MILLI_TO_WORLD } from './unit-renderer.js';

export type ThemeDef = ManifestV2['themes'][string];
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Default extra ground beyond `view.bounds` (scene units): camera framing (margin 3) plus FOV/pitch overscan. */
export const GROUND_MARGIN = 12;

/** Prefab facts read from the ground GLB (raw Unity frame: node scale x/z, plane size, uv tiling). */
export interface GroundPrefab { scaleX: number; scaleZ: number; meshSize: number; uvRepeat: readonly [number, number]; uvOffset: readonly [number, number] }
export interface GroundPlan {
  /** Half extents in the data frame (x, z), ground centred on the level origin like the prefab. */
  halfX: number; halfZ: number;
  /** Texture repeat over the whole plane along local u (data z) and local v (data x): constant prefab tile size. */
  repeatU: number; repeatV: number;
}

/**
 * Pure sizing: the ground covers max(prefab footprint, `bounds` + margin) on every side (so rotated landscape
 * bounds never show void) and keeps the prefab's texel density. Prefab is raw (portrait: x 60, z 100); the level
 * import's (x,z)->(z,-x) quarter turn maps prefab z to data x and prefab x to data z.
 * `bounds` are sim milli-units.
 */
export function planGround(bounds: Bounds, prefab: GroundPrefab, margin = GROUND_MARGIN, worldScale = MILLI_TO_WORLD): GroundPlan {
  const reach = (a: number, b: number) => Math.max(Math.abs(a), Math.abs(b)) * worldScale + margin;
  const prefabHalfX = (prefab.scaleZ * prefab.meshSize) / 2, prefabHalfZ = (prefab.scaleX * prefab.meshSize) / 2;
  const halfX = Math.max(prefabHalfX, reach(bounds.minX, bounds.maxX)), halfZ = Math.max(prefabHalfZ, reach(bounds.minZ, bounds.maxZ));
  const tileZ = (prefab.scaleX * prefab.meshSize) / prefab.uvRepeat[0], tileX = (prefab.scaleZ * prefab.meshSize) / prefab.uvRepeat[1];
  return { halfX, halfZ, repeatU: (2 * halfZ) / tileZ, repeatV: (2 * halfX) / tileX };
}

/** Reads the prefab facts + the plane geometry from a loaded ground GLB scene. */
export function readGroundPrefab(scene: Object3D): { prefab: GroundPrefab; geometry: BufferGeometry } {
  let mesh: Mesh | undefined; let extras: Record<string, unknown> | undefined;
  scene.traverse(o => {
    if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    if (!extras && (o.userData as { family?: string }).family === 'ground') extras = o.userData;
  });
  if (!mesh || !extras) throw new Error('Ground GLB has no mesh or ground extras');
  const pair = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length === 2 ? [Number(v[0]), Number(v[1])] : d);
  return {
    geometry: mesh.geometry,
    prefab: { scaleX: mesh.scale.x, scaleZ: mesh.scale.z, meshSize: Number(extras['meshSize'] ?? 10), uvRepeat: pair(extras['uvRepeat'], [3, 3]), uvOffset: pair(extras['uvOffset'], [0, 0]) },
  };
}

export interface GroundRenderer extends Renderer {
  root: Group;
  /** Builds the diorama ground for `theme` sized to `bounds` (sim milli-units). Replaces any previous ground. */
  setLevel(bounds: Bounds, theme: ThemeDef, margin?: number): Promise<GroundPlan>;
  readonly plan: GroundPlan | null;
}

export function createGroundRenderer(ctx: RendererContext): GroundRenderer {
  const root = new Group(); root.name = 'ground';
  let mesh: Mesh | null = null; let plan: GroundPlan | null = null;
  const r: GroundRenderer = {
    root,
    get plan() { return plan; },
    async setLevel(bounds, theme, margin = GROUND_MARGIN) {
      const { scene } = await ctx.models.file(theme.ground.mesh);
      const { prefab, geometry } = readGroundPrefab(scene);
      plan = planGround(bounds, prefab, margin);
      const tex = ctx.materials.texture(theme.ground.texture);
      // u edges differ in shade (not tileable along u): mirror u so repeats have no seam; v (grass/sand bands) stays plain repeat.
      tex.wrapS = MirroredRepeatWrapping; tex.wrapT = RepeatWrapping;
      tex.repeat.set(plan.repeatU, plan.repeatV);
      // GLB uv is v-down (flipY=false); the Unity offset was authored v-up, so the sign flips.
      tex.offset.set(prefab.uvOffset[0], -prefab.uvOffset[1]);
      if (tex.image) tex.needsUpdate = true;
      if (mesh) root.remove(mesh);
      // Local x -> data z, local z -> data x after the quarter turn (rotation.y = +90 deg maps (x,z) -> (z,-x)).
      mesh = new Mesh(geometry, ctx.materials.material('ground', theme.ground.mesh, theme.ground.texture));
      mesh.name = 'ground-plane'; mesh.rotation.y = Math.PI / 2;
      mesh.scale.set((2 * plan.halfZ) / prefab.meshSize, 1, (2 * plan.halfX) / prefab.meshSize);
      root.add(mesh);
      return plan;
    },
    dispose() { if (mesh) root.remove(mesh); mesh = null; plan = null; },
  };
  return r;
}

registerRenderer('ground', ctx => createGroundRenderer(ctx));
