import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { ManifestV2 } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import type { WorldRenderer } from './world.js';

export interface HudPadding { left: number; right: number; top: number; bottom: number }
export interface CameraViewport { width: number; height: number; padding: HudPadding }
/** Pixels reserved for the landscape top bar and bottom controls. */
export const HUD_PADDING: Readonly<HudPadding> = { left: 36, right: 36, top: 104, bottom: 64 };

/** Bounds/anchors are data-frame units; this is the camera's equivalent of worldRoot.scale.z=-1.
 * Anchor radius and label height conservatively enclose the building without loading any models.
 */
export function levelVisualBounds(view: Pick<SimView, 'bounds'>, buildingIds: readonly string[], anchors: WorldRenderer['anchors']): Box3 {
  const b = view.bounds;
  const bounds = new Box3(new Vector3(b.minX / 1000, 0, -b.maxZ / 1000), new Vector3(b.maxX / 1000, 0, -b.minZ / 1000));
  for (const id of buildingIds) {
    const a = anchors.building(id); if (!a) continue;
    const r = a.radius;
    bounds.expandByPoint(new Vector3(a.pos.x - r, a.pos.y, -a.pos.z - r));
    bounds.expandByPoint(new Vector3(a.pos.x + r, Math.max(a.pos.y, a.labelPos.y) + r, -a.pos.z + r));
    bounds.expandByPoint(new Vector3(a.labelPos.x - r, a.labelPos.y, -a.labelPos.z - r));
    bounds.expandByPoint(new Vector3(a.labelPos.x + r, a.labelPos.y + r, -a.labelPos.z + r));
  }
  return bounds;
}

/** Fixed unrotated TW camera. Solve perspective inequalities at every 3D box corner. */
export function fitCamera(camera: PerspectiveCamera, bounds: Box3, settings: ManifestV2['camera'], aspect: number, viewport?: CameraViewport): void {
  camera.clearViewOffset();
  let fractionX = 1, fractionY = 1;
  if (viewport) {
    const width = Math.max(1,viewport.width), height = Math.max(1,viewport.height), p = viewport.padding;
    // A collapsed/transient host still needs a valid frustum. Scale margins down only when they consume the host.
    const sx = Math.min(1,width * .9 / Math.max(1,p.left+p.right));
    const sy = Math.min(1,height * .9 / Math.max(1,p.top+p.bottom));
    fractionX = (width-(p.left+p.right)*sx)/width;
    fractionY = (height-(p.top+p.bottom)*sy)/height;
    camera.setViewOffset(width,height,(p.right-p.left)*sx/2,(p.bottom-p.top)*sy/2,width,height);
  }
  const padded = bounds.clone().expandByScalar(settings.margin);
  const center = padded.getCenter(new Vector3()), pitch = settings.pitchDeg * Math.PI / 180;
  const back = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const up = new Vector3(0, Math.cos(pitch), -Math.sin(pitch));
  const tanY = Math.tan(settings.fov * Math.PI / 360), safeAspect = Math.max(aspect, 1e-6);
  let distance = .1, minDepth = Infinity, maxDepth = -Infinity;
  for (const x of [padded.min.x, padded.max.x]) for (const y of [padded.min.y, padded.max.y]) for (const z of [padded.min.z, padded.max.z]) {
    const p = new Vector3(x,y,z).sub(center), depth = p.dot(back);
    minDepth = Math.min(minDepth,depth); maxDepth = Math.max(maxDepth,depth);
    distance = Math.max(distance,depth + Math.abs(p.x)/(tanY*safeAspect*fractionX),depth + Math.abs(p.dot(up))/(tanY*fractionY),depth+.1);
  }
  distance += .01; camera.fov = settings.fov; camera.aspect = safeAspect;
  camera.near = Math.max(.001,(distance-maxDepth)/2); camera.far = Math.max(camera.near+1,(distance-minDepth)*2);
  camera.position.copy(center).addScaledVector(back,distance); camera.up.copy(up); camera.lookAt(center);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
