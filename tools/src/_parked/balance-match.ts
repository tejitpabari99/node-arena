import type { CompiledLevel, ResolvedBotProfile } from '@node-arena/content';
import { createProfileBot, runMatch } from '@node-arena/bots';
import { TICK_RATE } from '@node-arena/sim';
export interface BalanceTask {
  level: CompiledLevel; seed: number; rotation: number;
  seats: {player:string;profile:ResolvedBotProfile}[];
}
export interface BalanceObservation {
  profile: string; player: string; won: boolean; timeout: boolean; draw: boolean; seconds: number; towers: number;
}
export interface BalanceMatch {
  level: string; seed: number; rotation: number; finalHash: string; observations: BalanceObservation[];
}
export function runBalanceMatch(task: BalanceTask): BalanceMatch {
  const controllers = task.seats.map(seat => createProfileBot(task.level,task.seed,seat.player,seat.profile));
  const match = runMatch({level:task.level,seed:task.seed,controllers,record:false});
  if (match.outcome.outcome === 'truncated') throw new Error('Match did not terminate');
  if (match.stats.rejected !== 0) throw new Error(`Match rejected ${match.stats.rejected} commands`);
  const timeout = match.outcome.outcome === 'timeout', draw = match.outcome.outcome === 'draw';
  return {level:task.level.id,seed:task.seed,rotation:task.rotation,finalHash:match.stats.finalHash,
    observations:task.seats.map(seat => {
      const stats = match.stats.players.find(player=>player.player === seat.player);
      if (!stats) throw new Error(`Missing stats for ${seat.player}`);
      return {profile:seat.profile.id,player:seat.player,
        won:!timeout && !draw && match.outcome.winnerTeam === stats.team,
        timeout,draw,seconds:match.ticks/TICK_RATE,towers:stats.towers};
    })};
}
