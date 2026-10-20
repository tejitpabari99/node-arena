import { Box3, Matrix4, PerspectiveCamera, Vector3, type Object3D } from 'three';
import type { CompiledLevel, Manifest } from '@node-arena/content';
import { createManifestResolver } from '../manifest/resolve.js';
import { MAX_FLOORS, stackHeight, towerWidth } from './tower-mesh.js';

/** Authored extents (milli-units) as a world-unit box centred on the origin, matching tower coordinates. */
export function authoredBounds(level: Pick<CompiledLevel, 'bounds'>): Box3 {
  const hw = level.bounds.w / 2000, hh = level.bounds.h / 2000;
  return new Box3(new Vector3(-hw, 0, -hh), new Vector3(hw, 0, hh));
}

/** The sole sim-to-presentation conversion: compiled coordinates/radii are milli-units.
 * Bounds = tower footprints + scaled model (roof) height only; label height is not part of the fit (labels are not 3D geometry). */
export function levelVisualBounds(level: Pick<CompiledLevel, 'bounds' | 'towers'>, manifest: Manifest, models: ReadonlyMap<string, Object3D>): Box3 {
  const bounds = new Box3(); const resolver = createManifestResolver(manifest);
  for (const tower of level.towers) {
    const x = tower.x / 1000, z = tower.y / 1000, radius = tower.footprintRadius / 1000;
    const visual = resolver.visual(tower.visual, 'tower');
    if (visual.build === 'stacked') { // code-built stack: the visual width (not the footprint disc) and the tallest (5-floor) height frame the camera
      const width = towerWidth(radius, visual.scale), half = width / 2;
      bounds.expandByPoint(new Vector3(x - half, stackHeight(MAX_FLOORS, width), z - half)); bounds.expandByPoint(new Vector3(x + half, 0, z + half)); continue;
    }
    bounds.expandByPoint(new Vector3(x - radius, 0, z - radius));
    bounds.expandByPoint(new Vector3(x + radius, 0, z + radius));
    const model = models.get(visual.modelKey);
    if (!model) throw new Error(`Missing loaded model: ${visual.modelKey}`);
    // Evaluate a clone: updating world matrices must not mutate cached model state.
    const physical = new Box3().setFromObject(model.clone(true));
    physical.applyMatrix4(new Matrix4().makeScale(visual.scale, visual.scale, visual.scale));
    physical.translate(new Vector3(x, visual.yOffset ?? 0, z)); bounds.union(physical);
  }
  return bounds.isEmpty() ? authoredBounds(level) : bounds;
}

/** pitch=0 looks horizontally from +z; pitch=90 looks straight down with north at screen top.
 * Solve perspective inequalities for every padded bounding-box corner, including depth.
 */
export function fitCamera(camera: PerspectiveCamera, bounds: Box3, settings: Manifest['camera'], aspect: number): void {
  const padded = bounds.clone().expandByScalar(settings.margin);
  const center = padded.getCenter(new Vector3()); const pitch = settings.pitchDeg * Math.PI / 180;
  const back = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const up = new Vector3(0, Math.cos(pitch), -Math.sin(pitch));
  const tanY = Math.tan(settings.fov * Math.PI / 360), safeAspect = Math.max(aspect, 1e-6);
  let distance = .1, minDepth = Infinity, maxDepth = -Infinity;
  for (const x of [padded.min.x, padded.max.x]) for (const y of [padded.min.y, padded.max.y]) for (const z of [padded.min.z, padded.max.z]) {
    const p = new Vector3(x, y, z).sub(center); const depth = p.dot(back);
    minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth);
    distance = Math.max(distance, depth + Math.abs(p.x) / (tanY * safeAspect), depth + Math.abs(p.dot(up)) / tanY, depth + .1);
  }
  distance += .01; camera.fov = settings.fov; camera.aspect = safeAspect;
  camera.near = Math.max(.001, (distance - maxDepth) / 2); camera.far = Math.max(camera.near + 1, (distance - minDepth) * 2);
  camera.position.copy(center).addScaledVector(back, distance); camera.up.copy(up); camera.lookAt(center);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
