import type { DrawExplanation, SimModuleFor, SimState } from '../types.js';

/** Stub; SP04 replaces this file. */
export const blocksLines: SimModuleFor<'blocksLines'> = {
  id: 'blocksLines',
  /** Validator slot of the DrawLine check order (after no-slot); SP04 returns blocked-obstacle|blocked-building. */
  hooks: { validateDraw: () => null },
};

/** SP04 seam: blocker explanation for `sim.explainDraw`. Stub: null. Never throws; any input type. */
export function explainDraw(_state: SimState, _player: unknown, _from: unknown, _to: unknown): DrawExplanation | null {
  return null;
}
