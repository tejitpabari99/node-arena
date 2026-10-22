import type { CompiledLevel } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';
import type { Bot } from './index.js';

export interface BotDriver {
  /** Call before step. Further calls at the same tick emit nothing. */
  commands(sim: Sim): Command[];
}

/** STUB (06-ai-port Task 1): v1 utility bots removed; rewritten in Task 4. Emits no commands. */
export function createProfileBot(_level: CompiledLevel, _matchSeed: number, player: string, _profile: unknown): Bot {
  return { player, decide: () => [] };
}

/** STUB (06-ai-port Task 1): returns no commands until Task 4. */
export function createBotDriver(_level: CompiledLevel, _matchSeed: number): BotDriver {
  return { commands: () => [] };
}
