import type { CompiledLevel } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';

/** SP04 owns decision logic. Web passes the sim directly and never reads profiles. */
export interface BotDriver { commands(sim: Sim): readonly Command[] }
export type CreateBotDriver = (level: CompiledLevel, matchSeed: number) => BotDriver;

/** SP04 supplies the default match-local factory; injection remains available. */
export { createBotDriver } from '@node-arena/bots';
