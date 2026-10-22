import { blocksLinesDef } from './modules/blocksLines.def.js';
import { drawsLinesDef } from './modules/drawsLines.def.js';
import { growsDef } from './modules/grows.def.js';
import { levelDef } from './modules/level.def.js';
import { shootsDef } from './modules/shoots.def.js';
import { spawnsDef } from './modules/spawns.def.js';
import { BOT_KINDS, type BotKindId } from './bot-kinds.js';
import { OBJECTIVES, type ObjectiveId } from './objectives.js';
import type { Static } from 'typebox';

/** The single explicit module list. Adding a module = one line here + one in each consumer binding map. */
export const MODULES = {
  level: levelDef,
  drawsLines: drawsLinesDef,
  spawns: spawnsDef,
  grows: growsDef,
  shoots: shootsDef,
  blocksLines: blocksLinesDef,
} as const;

export type ModuleId = keyof typeof MODULES;
export type ModuleParams<K extends ModuleId> = Static<(typeof MODULES)[K]['params']>;

export type Capability = ModuleId | `bot:${BotKindId}` | `objective:${ObjectiveId}`;

/** Everything this build can run; a level is playable iff its `requires` is a subset. */
export const CAPABILITIES: readonly Capability[] = [
  ...(Object.keys(MODULES) as ModuleId[]),
  ...(Object.keys(BOT_KINDS) as BotKindId[]).map((k): Capability => `bot:${k}`),
  ...(Object.keys(OBJECTIVES) as ObjectiveId[]).map((k): Capability => `objective:${k}`),
];

export { defineModule, type ModuleDef } from './modules/define.js';
export { fx3, count, unitId, noParams } from './params.js';
export { PHASES, type Phase } from './phases.js';
export { COMMANDS, type CommandId, type CommandOf, type Command, type RejectReason } from './commands.js';
export { EVENTS, type EventId, type EventOf, type EventPayload, type SimEvent } from './events.js';
export { OBJECTIVES, type ObjectiveId } from './objectives.js';
export { BOT_KINDS, TwBotParams, type BotKindId, type TwBot } from './bot-kinds.js';
export { VISUAL, RENDER_KINDS, ANIM_MODES, TEAM_MODES, FX_KINDS, BUDGET_CLASSES, type RenderKind, type AnimMode, type TeamMode, type FxKind, type BudgetClass } from './visual.js';
