import type { SimModuleFor } from '../types.js';

/** Stub; SP04 replaces this file. */
export const blocksLines: SimModuleFor<'blocksLines'> = {
  id: 'blocksLines',
  /** Validator slot of the DrawLine check order (after no-slot); SP04 returns blocked-obstacle|blocked-building. */
  hooks: { validateDraw: () => null },
};
