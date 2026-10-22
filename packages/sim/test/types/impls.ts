// Type test (checked by tsconfig.golden.json via `pnpm typecheck:sim`): IMPLS must bind every defs module exactly.
import type { ModuleId } from '@node-arena/defs';
import { IMPLS } from '../../src/modules/index.js';
import type { SimModule } from '../../src/types.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <_T extends true>(): void => {};

assertType<Equal<keyof typeof IMPLS, ModuleId>>();
// @ts-expect-error a missing or extra module key breaks the binding
assertType<Equal<keyof typeof IMPLS, ModuleId | 'bogus'>>();

const { level: _drop, ...missingLevel } = IMPLS;
// @ts-expect-error missing key `level`
export const incomplete = missingLevel satisfies Record<ModuleId, SimModule>;
// @ts-expect-error unknown module key
export const extra = { ...IMPLS, bogus: IMPLS.level } satisfies Record<ModuleId, SimModule>;
// @ts-expect-error module id must be a defs ModuleId
export const badId = { id: 'bogus' } satisfies SimModule;
