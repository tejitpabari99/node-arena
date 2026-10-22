import type { ModuleId } from '@node-arena/defs';
import type { SimModuleFor } from '../types.js';
import { blocksLines } from './blocksLines.js';
import { drawsLines } from './drawsLines.js';
import { grows } from './grows.js';
import { level } from './level.js';
import { shoots } from './shoots.js';
import { spawns } from './spawns.js';

/** One explicit binding per defs module: a missing/extra key or a mismatched `id` is a compile error (no runtime check). */
export const IMPLS = { level, drawsLines, spawns, grows, shoots, blocksLines } satisfies { [K in ModuleId]: SimModuleFor<K> };

/** Module ids in sorted order: the fixed iteration order inside a phase. */
export const MODULE_ORDER: readonly ModuleId[] = (Object.keys(IMPLS) as ModuleId[]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
