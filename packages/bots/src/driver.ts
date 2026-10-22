import type { CompiledLevel } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';

export interface BotDriver {
  /** Call before step. Further calls at the same tick emit nothing. */
  commands(sim: Sim): Command[];
}

/** STUB (06-ai-port Task 1): returns no commands until Task 4. */
export function createBotDriver(_level: CompiledLevel, _matchSeed: number): BotDriver {
  return { commands: () => [] };
}
