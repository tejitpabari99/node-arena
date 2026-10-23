import { Group } from 'three';
import type { ManifestV2 } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import { buildLightRig, type LightRig } from './light-rig.js';
import { createGroundRenderer, type GroundRenderer, type Bounds } from './ground-renderer.js';
import { createElementRenderer, type ElementInstance, type ElementRenderer } from './element-renderer.js';
import { createLaneRenderer, type LaneRenderer } from './lane-renderer.js';
import type { MaterialCache } from './materials.js';
import type { ModelCache } from './gltf-cache.js';

export interface EnvironmentLevel { bounds: Bounds; elements: readonly ElementInstance[] }

/**
 * Ground + obstacles + lanes + theme light for one level (the Task 9 slice of `createWorldRenderer`, R5).
 * Add `root` to the mirrored worldRoot (SP08) so everything shares the data frame; `light.group` may live anywhere.
 */
export interface Environment {
  root: Group;
  ground: GroundRenderer; elements: ElementRenderer; lanes: LaneRenderer;
  readonly light: LightRig | null;
  setLevel(level: EnvironmentLevel, themeId: string): Promise<void>;
  update(view: Pick<SimView, 'lines' | 'buildingStatic' | 'players'>, dtMs: number): void;
  dispose(): void;
}

export function createEnvironment(manifest: ManifestV2, materials: MaterialCache, models: ModelCache, obstacleVisualId = 'element.obstacle'): Environment {
  const base = { materials, models };
  const mk = (id: string) => ({ ...base, visualId: id, visual: manifest.visuals[id]! });
  const ground = createGroundRenderer(mk('ground')), elements = createElementRenderer(mk(obstacleVisualId));
  const lanes = createLaneRenderer(mk('lane'), { palettes: manifest.palettes, ...beamStyle(manifest) });
  const root = new Group(); root.name = 'environment'; root.add(ground.root, elements.root, lanes.root);
  let light: LightRig | null = null;
  const env: Environment = {
    root, ground, elements, lanes,
    get light() { return light; },
    async setLevel(level, themeId) {
      const theme = manifest.themes[themeId]; if (!theme) throw new Error(`Unresolved theme ${themeId}`);
      if (light) light.group.removeFromParent();
      light = buildLightRig(theme.light); root.add(light.group);
      await Promise.all([ground.setLevel(level.bounds, theme), elements.setLevel(level.elements, theme.obstacle, themeId)]);
    },
    update: (view, dtMs) => lanes.update(view, dtMs),
    dispose() { ground.dispose(); elements.dispose(); lanes.dispose(); },
  };
  return env;
}

/** Lane ribbon params from the manifest `lane-wave` beam fx entry (texture, tile; width/alpha come from LANE_WIDTH/LANE_ALPHA). */
function beamStyle(manifest: ManifestV2) {
  const fx = manifest.fx['lane-wave'];
  if (!fx) return {};
  const p = fx.params as { tile?: number };
  return { texture: fx.texture, ...(p.tile !== undefined && { tile: p.tile }) };
}
