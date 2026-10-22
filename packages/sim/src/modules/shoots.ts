import type { SimView } from '../read.js';
import type { SimModuleFor } from '../types.js';

/** Stub; SP04 replaces this file. */
export const shoots: SimModuleFor<'shoots'> = {
  id: 'shoots',
  state: { cooldown: 0 },
};

/**
 * SP04 seam: tower attack radius in milli world units at the tower's current stage (R-TWR-01
 * `idiv((attackRadius + radiusUpByLevel x (stage - 1)) x radiusUnit, 1000)`). Stub: 0 until SP04 exposes the
 * `shoots` params to the view.
 */
export function towerRadiusMilli(_view: SimView, _building: number): number {
  return 0;
}
