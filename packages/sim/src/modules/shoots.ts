import type { SimModuleFor, SimState } from '../types.js';

/** Stub; SP04 replaces this file. */
export const shoots: SimModuleFor<'shoots'> = {
  id: 'shoots',
  state: { cooldown: 0 },
};

/**
 * SP04 seam (engine-side; the public `sim.towerRadiusMilli(view, i)` binds `state`): tower attack radius in milli world units at the tower's current stage (R-TWR-01
 * `idiv((attackRadius + radiusUpByLevel x (stage - 1)) x radiusUnit, 1000)`). Stub returns 0 = not a tower / no ring;
 * SP04 fills it from the `shoots` params.
 */
export function towerRadiusMilli(_state: SimState, _building: number): number {
  return 0;
}
