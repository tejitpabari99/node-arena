import type { CompiledLevel } from '@node-arena/content';
import { createSeatBot, runMatch, HUMAN_PROXY, type MatchController } from '@node-arena/bots';
import { TICK_RATE } from '@node-arena/sim';
import { DEFAULT_MAX_TICKS } from './levels.js';
/** `ad` is the tw action delay in ms; null = idle (no commands). */
export interface BalanceProfile { id: string; ad: number | null }
export interface BalanceTask {
  level: CompiledLevel; seed: number; rotation: number;
  seats: {player:number;profile:BalanceProfile}[];
}
export interface BalanceObservation {
  profile: string; player: number; won: boolean; timeout: boolean; draw: boolean; seconds: number; towers: number;
}
export interface BalanceMatch {
  level: string; seed: number; rotation: number; finalHash: string; observations: BalanceObservation[];
}
export function runBalanceMatch(task: BalanceTask): BalanceMatch {
  const controllers: MatchController[] = task.seats.map(seat => seat.profile.ad === null ? {player:seat.player,commands:[]} :
    createSeatBot(task.level,task.seed,seat.player,{...HUMAN_PROXY,actionDelayMs:seat.profile.ad}));
  const match = runMatch({level:task.level,seed:task.seed,maxTicks:DEFAULT_MAX_TICKS,controllers,record:false});
  if (match.stats.rejected !== 0) throw new Error(`Match rejected ${match.stats.rejected} commands`);
  // A capped (truncated) untimed match counts as a timeout: nobody won within the cap.
  const timeout = match.outcome.outcome === 'timeout' || match.outcome.outcome === 'truncated';
  return {level:task.level.id,seed:task.seed,rotation:task.rotation,finalHash:match.stats.finalHash,
    observations:task.seats.map(seat => {
      const stats = match.stats.players.find(player=>player.player === task.level.players[seat.player]!.id);
      if (!stats) throw new Error(`Missing stats for seat ${seat.player}`);
      return {profile:seat.profile.id,player:seat.player,
        won:match.outcome.outcome === 'won' && match.outcome.winner === seat.player,
        timeout,draw:false,seconds:match.ticks/TICK_RATE,towers:stats.buildings};
    })};
}
