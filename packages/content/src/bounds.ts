/**
 * Landscape frame rule (PRD 02 R4 / 05 R3): bounds = AABB of building positions (post-rotation)
 * plus this pad, floored/ceiled outward to integers. Single exported constant; 05's `rotate.ts`
 * and the content tests import it, nobody repeats the literal.
 */
export const BOUNDS_PAD = 2.0;

export interface Point { x: number; z: number }
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** Authored units (not milli). */
export function boundsFromPositions(points: readonly Point[], pad: number = BOUNDS_PAD): Bounds {
  if (points.length === 0) throw new RangeError('bounds need at least one position');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: Math.floor(minX - pad), maxX: Math.ceil(maxX + pad), minZ: Math.floor(minZ - pad), maxZ: Math.ceil(maxZ + pad) };
}
