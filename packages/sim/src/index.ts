// Public surface. Engine internals (state construction, phases, hooks, hashing, invariants) live in
// `./internal` (`@node-arena/sim/internal`), a superset of this file for tests and SP04 seam work.
export { TICK_RATE, idiv, mulDiv, isqrt, Sfc32, mixSeed, fnv1a32 } from './math.js';
export { create, type Sim } from './sim.js';
export { createReplayRecorder, playReplay, type ReplayMetadata, type ReplayJson, type ReplayRecord, type ReplaySource, type ReplayRecorder, type ReplayResult } from './replay.js';
export type { Command, CommandId, RejectReason, SimEvent, EventOf } from '@node-arena/defs';
export type { Outcome, Placement, SeatSetup } from './types.js';
export type { SimModule, SimState, DrawExplanation } from './types.js';
export { createTroopBuffer, type SimView, type TroopBuffer, type SimSnapshot, type ReadColumn } from './read.js';
export { createStreams, purposeId, type Stream, type Streams } from './streams.js';
export { channelEnds, laneLength, hostile } from './state.js';
export { spawnPeriodMt, growPeriodMt, TICK_MT } from './timers.js';
