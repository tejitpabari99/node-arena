import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { CompiledFootprint, ManifestV2 } from '@node-arena/content';
import { parseModelRef } from '../manifest/model-ref.js';
import { type Renderer, type RendererContext } from './registry.js';
import { MILLI_TO_WORLD } from './scale.js';

export type ObstacleTheme = ManifestV2['themes'][string]['obstacle'];
export type ObstacleVariant = 'small' | 'big';
/** The subset of `CompiledLevel['elements'][number]` the renderer reads. */
export interface ElementInstance { id: string; x: number; z: number; yawMilliDeg: number; visual: string; variant?: string; footprint?: CompiledFootprint }
export interface ChildExtra { index: number; variant: ObstacleVariant; scale: readonly [number, number, number] }

/** Child index `k` from the level element id `o<cluster>-<k>`. */
export function childIndex(id: string): number | undefined {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

export interface ObstaclePlacement { variant: ObstacleVariant; x: number; z: number; yaw: number; scale: readonly [number, number, number] }
/**
 * Pure placement: which mesh variant, world pose and prefab child scale for each element of this visual.
 * Inactive children (S[k] false) are never emitted into the level, so they simply have no element and no instance.
 */
export function placeObstacles(elements: readonly ElementInstance[], visualId: string, children: readonly ChildExtra[], worldScale = MILLI_TO_WORLD): ObstaclePlacement[] {
  const out: ObstaclePlacement[] = [];
  for (const e of elements) {
    if (e.visual !== visualId) continue;
    const k = childIndex(e.id), child = k === undefined ? undefined : children.find(c => c.index === k);
    const variant: ObstacleVariant = (e.variant === 'small' || e.variant === 'big' ? e.variant : child?.variant) ?? 'big';
    const yaw = (e.yawMilliDeg / 1000) * (Math.PI / 180);
    const tiles = Math.max(1, Math.round((e.footprint?.shape === 'box' ? e.footprint.w ?? 713 : 713) / 713));
    for (let tile = 0; tile < tiles; tile++) {
      const offset = (tile - (tiles - 1) / 2) * 713;
      out.push({ variant, x: (e.x + offset * Math.cos(yaw)) * worldScale, z: (e.z - offset * Math.sin(yaw)) * worldScale, yaw, scale: child?.scale ?? [1, 1, 1] });
    }
  }
  return out;
}

export interface ElementRenderer extends Renderer {
  root: Group;
  /** Replaces all obstacles for `theme` (manifest `themes.<id>.obstacle`). Instances: one InstancedMesh per variant. */
  setLevel(elements: readonly ElementInstance[], theme: ObstacleTheme, themeId: string): Promise<void>;
  readonly counts: Readonly<Record<ObstacleVariant, number>>;
  /** Draw calls = variants with >= 1 instance. */
  readonly drawCalls: number;
}

function findMesh(node: Object3D): Mesh | undefined {
  let found: Mesh | undefined;
  node.traverse(o => { if (!found && (o as Mesh).isMesh) found = o as Mesh; });
  return found;
}

export function createElementRenderer(ctx: RendererContext): ElementRenderer {
  const root = new Group(); root.name = `elements:${ctx.visualId}`;
  const counts: Record<ObstacleVariant, number> = { small: 0, big: 0 };
  let meshes: InstancedMesh[] = [], gen = 0;
  const clear = () => { for (const m of meshes) { root.remove(m); m.dispose(); } meshes = []; counts.small = counts.big = 0; };
  const m4 = new Matrix4(), qt = new Quaternion(), up = new Vector3(0, 1, 0), pos = new Vector3(), scl = new Vector3();
  const r: ElementRenderer = {
    root, counts,
    get drawCalls() { return meshes.filter(m => m.count > 0).length; },
    async setLevel(elements, theme, themeId) {
      const mine = ++gen; // a newer setLevel (or dispose) supersedes this one: stale results are dropped, never applied
      const { file } = parseModelRef(theme.small);
      const { scene } = await ctx.models.file(file);
      if (mine !== gen) return;
      scene.updateMatrixWorld(true);
      let children: ChildExtra[] = [];
      scene.traverse(o => { const c = (o.userData as { children?: unknown }).children; if (Array.isArray(c) && c.length > 0 && 'index' in (c[0] as object)) children = c as ChildExtra[]; });
      const placements = placeObstacles(elements, ctx.visualId, children);
      const material = ctx.materials.material('obstacle', themeId, theme.texture);
      const built: InstancedMesh[] = [], builtCounts: Record<ObstacleVariant, number> = { small: 0, big: 0 };
      for (const variant of ['small', 'big'] as const) {
        const list = placements.filter(p => p.variant === variant);
        builtCounts[variant] = list.length;
        if (list.length === 0) continue;
        const node = await ctx.models.resolve(theme[variant]);
        if (mine !== gen) { for (const m of built) m.dispose(); return; }
        node.updateMatrixWorld(true);
        const mesh = findMesh(node); if (!mesh) throw new Error(`Obstacle node "${theme[variant]}" has no mesh`);
        const geometry: BufferGeometry = mesh.geometry;
        const im = new InstancedMesh(geometry, material, list.length); im.name = `obstacle:${variant}`;
        im.instanceMatrix.setUsage(DynamicDrawUsage); im.frustumCulled = false;
        list.forEach((p, i) => {
          qt.setFromAxisAngle(up, p.yaw); pos.set(p.x, 0, p.z); scl.set(p.scale[0], p.scale[1], p.scale[2]);
          m4.compose(pos, qt, scl).multiply(mesh.matrixWorld);
          im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
        built.push(im);
      }
      if (mine !== gen) { for (const m of built) m.dispose(); return; }
      clear();
      for (const im of built) { root.add(im); meshes.push(im); }
      counts.small = builtCounts.small; counts.big = builtCounts.big;
    },
    dispose() { gen++; clear(); },
  };
  return r;
}
