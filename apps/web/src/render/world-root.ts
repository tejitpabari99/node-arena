import { Group } from 'three';

/**
 * Mirrored worldRoot per the 02 Frame contract (BF/02-registry-content-v2/PRD.md "Frame contract").
 * Assets stay RAW (Unity coords, no x-negate, no winding fix); the game owns exactly ONE mirror at the scene root:
 * scale.z = -1 so screen-right = +x, screen-up = +z. three.js flips face winding for negative-determinant parents.
 * Label/text sprites must live OUTSIDE this root. SP08 owns the mirror in the app; the world renderer only uses this
 * helper when no `worldRoot` is passed (capture/validation scenes, tests).
 */
export function createMirroredWorldRoot(): Group {
  const root = new Group();
  root.name = 'worldRoot';
  root.scale.z = -1;
  return root;
}
