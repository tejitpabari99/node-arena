// R3: Frame contract (PRD 02): data frame = Unity coords rotated (x,z) -> (z,-x), yaw (Y+90); assets RAW, 08 owns the mirror.
// The bounds pad is NOT repeated here: single source is BOUNDS_PAD/boundsFromPositions in @node-arena/content.
import { BOUNDS_PAD, boundsFromPositions, type Bounds, type Point } from '@node-arena/content';

export { BOUNDS_PAD };

const nz = (v: number): number => (v === 0 ? 0 : v); // normalise -0

/** Unity (x, z) -> data (z, -x). Exact (negation only). */
export function rotatePos(x: number, z: number): Point {
  return { x: nz(z), z: nz(-x) };
}

/** Unity yaw Y -> `(Y + 90) mod 360` in [0, 360), 2 dp. */
export function rotateYaw(y: number): number {
  const v = Math.round((((y + 90) % 360) + 360) % 360 * 100) / 100;
  return v >= 360 ? 0 : nz(v);
}

/** AABB of building positions (post-rotation) + pad, integer outward. */
export function levelBounds(buildingPositions: readonly Point[]): Bounds {
  return boundsFromPositions(buildingPositions);
}

/** Elements outside `bounds` are allowed; callers only log them. */
export function outOfBounds<T extends { id: string; pos: Point }>(bounds: Bounds, elements: readonly T[]): string[] {
  return elements
    .filter((e) => e.pos.x < bounds.minX || e.pos.x > bounds.maxX || e.pos.z < bounds.minZ || e.pos.z > bounds.maxZ)
    .map((e) => e.id);
}
