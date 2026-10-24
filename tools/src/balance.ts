import { generateHashes, loadContent, parseContentMeta, type ContentFiles } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import { runBalancePool } from './balance-pool.js';
import type { BalanceObservation, BalanceProfile, BalanceTask } from './balance-match.js';
import { campaignLevels, humanSeat, selectLevels } from './levels.js';
import { LocatedError } from './files.js';
export interface BalanceRow {
  level: string; position: number; profile: string; matches: number; observations: number;
  winPct: number; medianSecondsToWin: number | null; timeoutPct: number; medianTowers: number;
}
export interface BalanceReport {
  header: {rulesVersion:string;contentVersion:string;botHash:Record<string,string>;BOT_VERSION:string};
  mode: 'campaign'|'arena'; seeds: number; profiles: string[]; rows: BalanceRow[];
}
export interface BalanceOptions {levels?:string;proxy?:string;seeds?:number;jobs?:number;mode?:'campaign'|'arena'}
function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a,b)=>a-b); const middle = Math.floor(values.length/2);
  return values.length % 2 ? values[middle]! : (values[middle-1]!+values[middle]!)/2;
}
/** `1000,2000,4000,idle`: tw proxy action delays in ms (06 R6) plus the idle control. */
export const DEFAULT_PROXY = '1000,2000,4000,idle';
function parseProfiles(spec: string): BalanceProfile[] {
  const out = new Map<string, BalanceProfile>();
  for (const token of spec.split(',')) {
    if (token === 'idle') out.set('idle',{id:'idle',ad:null});
    else if (/^[1-9][0-9]*$/.test(token)) out.set(`proxy-${token}`,{id:`proxy-${token}`,ad:Number(token)});
    else throw new LocatedError('arguments',`Unknown proxy: ${token} (expected action delay in ms or idle)`);
  }
  return [...out.values()].sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export async function balance(data: ContentFiles, meta: string | object, options: BalanceOptions = {}): Promise<BalanceReport> {
  const seeds = options.seeds ?? 20, jobs = options.jobs ?? 2, mode = options.mode ?? 'campaign';
  if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 4294967295) throw new LocatedError('arguments','--seeds must be an integer in 1..4294967295');
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new LocatedError('arguments','--jobs must be a positive safe integer');
  if (mode !== 'campaign' && mode !== 'arena') throw new LocatedError('arguments','--mode must be campaign or arena');
  const profiles = parseProfiles(options.proxy ?? DEFAULT_PROXY);
  const { levels, compiled } = !options.levels || options.levels === 'all'
    ? { levels: campaignLevels(data), compiled: loadContent(data).compiled }
    : selectLevels(data, options.levels);
  const tasks: BalanceTask[] = [];
  for (const entry of levels) {
    const level = compiled[entry.id]!;
    const human = mode === 'campaign' ? humanSeat(level) : -1;
    for (let seed = 1; seed <= seeds; seed++) {
      for (let rotation = 0; rotation < profiles.length; rotation++) {
        // Campaign: the proxy replaces the human seat, authored bots stay. Arena: every seat is driven by a rotating tw proxy.
        const seats = mode === 'campaign' ? [{player:human,profile:profiles[rotation]!}] :
          level.players.map((_,seat)=>({player:seat,profile:profiles[(seat+rotation)%profiles.length]!}));
        tasks.push({level,seed,rotation,seats});
      }
    }
  }
  const matches = await runBalancePool(tasks,jobs);
  const rows: BalanceRow[] = [];
  for (const entry of levels) for (const profile of profiles) {
    const observations: BalanceObservation[] = [];
    let matchCount = 0;
    for (const match of matches) if (match.level === entry.id) {
      const own = match.observations.filter(observation=>observation.profile === profile.id);
      if (own.length) matchCount++;
      observations.push(...own);
    }
    const count = observations.length;
    rows.push({level:entry.id,position:entry.position,profile:profile.id,matches:matchCount,observations:count,
      winPct:100*observations.filter(o=>o.won).length/count,
      medianSecondsToWin:median(observations.filter(o=>o.won).map(o=>o.seconds)),
      timeoutPct:100*observations.filter(o=>o.timeout).length/count,
      medianTowers:median(observations.map(o=>o.towers))!});
  }
  const metadata = parseContentMeta(meta);
  return {header:{rulesVersion:metadata.rulesVersion,contentVersion:metadata.contentVersion,botHash:generateHashes(loadContent(data)).bots,BOT_VERSION},mode,seeds,profiles:profiles.map(p=>p.id),rows};
}
