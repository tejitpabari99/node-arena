import { AmbientLight, DirectionalLight, Group, Vector3 } from 'three';
import type { ManifestV2 } from '@node-arena/content';

/** three >=r155 has no legacy-light pi factor: Lambert divides irradiance by pi, so Unity (legacy, pi-free) intensities must be multiplied by pi. */
export const UNITY_LIGHT_SCALE = Math.PI;
export type ThemeLight = ManifestV2['themes'][string]['light'];
export interface LightRig { group: Group; directional: DirectionalLight; ambient?: AmbientLight }

/**
 * Builds the theme light rig (Task 2 decision: TW rig = directional white 0.2 + flat ambient 0.896; no extra tonemapping).
 * `light.dir` points TOWARD the light in the data frame (the frame the rig lives in; the asset pipeline rotates the raw Unity direction). The directional light sits `distance` along it, targeting the origin.
 * Expects renderer.outputColorSpace = SRGBColorSpace (three default; owned by SP08) and textures tagged SRGB (materials.ts).
 */
export function buildLightRig(light: ThemeLight, distance = 50): LightRig {
  const group = new Group(); group.name = 'light-rig';
  const directional = new DirectionalLight(light.color, light.intensity * UNITY_LIGHT_SCALE);
  directional.position.copy(new Vector3(...(light.dir as [number, number, number])).normalize().multiplyScalar(distance));
  group.add(directional, directional.target);
  const rig: LightRig = { group, directional };
  if (light.ambient) { rig.ambient = new AmbientLight(light.ambient.color, light.ambient.intensity * UNITY_LIGHT_SCALE); group.add(rig.ambient); }
  return rig;
}
