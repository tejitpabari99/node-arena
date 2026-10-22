// Internal surface (`@node-arena/sim/internal`): superset of the public index plus engine internals.
// For sim tests, goldens and SP04 seam work; web/bots must stay on the public index.
export * from './index.js';
export { IMPLS } from './modules/index.js';
export { readTroops, snapshotState } from './read.js';
export { evaluateOutcome, winPass } from './win.js';
export { TroopRing } from './ring.js';
export { assertInvariants } from './invariants.js';
export { hashState } from './hash.js';
export { createState, channelKey, getChannel, liveChannels, spawnTroop, killTroop, troopPosition, progressOf, setLevel, freeSlots, type KillCause } from './state.js';
export type { Channel, Counters, Players, Buildings } from './types.js';
export { canDraw, cutLine, runCommands } from './commands.js';
export { crossingPass, exchange, headOnPass, contactsPass, arrivalPass, type ExchangeResult } from './contacts.js';
export { firstDrawRejection, fireLineDrawn, fireLineCut, fireCapture } from './hooks.js';
export { step } from './tick.js';

export * from './geometry.js';
export { checked, compareSumProducts, compareRationalSquares } from './math.js';
