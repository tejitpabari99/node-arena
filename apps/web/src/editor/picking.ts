import { Matrix4, Plane, Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { CompiledElement } from '@node-arena/content';
export interface Point { x: number; z: number }
export interface ViewRect { left: number; top: number; width: number; height: number }
export type Selection = { kind: 'building' | 'obstacle'; id: string };
export const roundCoordinate = (value: number): number => Math.round(value * 100) / 100 || 0;

/** D10: copied from game groundAt, with client rect offsets and the root inverse explicit. */
export function groundAt(x: number, y: number, rect: ViewRect, camera: PerspectiveCamera, root: Object3D): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  camera.updateMatrixWorld(); root.updateWorldMatrix(true, false);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
  const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
  if (!hit) return null;
  hit.applyMatrix4(new Matrix4().copy(root.matrixWorld).invert());
  return { x: roundCoordinate(hit.x), z: roundCoordinate(hit.z) };
}

/** D6: closest centre among footprints containing the ground hit; no renderer pick objects added. */
export function pickObstacle(point: Point, elements: readonly Pick<CompiledElement, 'id' | 'x' | 'z' | 'yawMilliDeg' | 'footprint'>[]): string | null {
  let id: string | null = null, nearest = Infinity;
  for (const e of elements) {
    const dx = point.x - e.x / 1000, dz = point.z - e.z / 1000, f = e.footprint;
    const angle = e.yawMilliDeg * Math.PI / 180000;
    // Inverse of the renderer's rotation about +Y.
    const x = Math.cos(angle) * dx - Math.sin(angle) * dz;
    const z = Math.sin(angle) * dx + Math.cos(angle) * dz;
    const inside = f.shape === 'circle' ? Math.hypot(dx, dz) <= (f.radius ?? 0) / 1000
      : Math.abs(x) <= (f.w ?? 0) / 2000 && Math.abs(z) <= (f.d ?? 0) / 2000;
    const distance = dx * dx + dz * dz;
    if (inside && distance < nearest) { id = e.id; nearest = distance; }
  }
  return id;
}
