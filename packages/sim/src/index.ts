import type { CompiledLevel } from '@node-arena/content';
import { create as createState, type CreateOptions } from './state.js';
import type { Sim } from './read.js';

export { TICK_RATE, idiv, mulDiv, isqrt, Sfc32, mixSeed } from './math.js';

export { type SimState, type CreateOptions } from './state.js';
export { type Sim, type SimView, type TroopBuf, type SimSnapshot } from './read.js';
export { createComponentRegistry, ComponentRegistry, type SimComponent, type ComponentSystem, type ComponentHooks, type Phase } from './registry.js';

export { type Command, type RejectReason, type SimEvent, type GameOver, type Outcome } from './commands.js';

/** Public boundary deliberately hides the internal fixture/state API. */
export function create(level: CompiledLevel, seed: number, options?: CreateOptions): Sim {
  return createState(level, seed, options);
}

export { createReplayRecorder, playReplay, type ReplayMetadata, type ReplayJson, type ReplayRecord, type ReplaySource, type ReplayRecorder, type ReplayResult } from './replay.js';
