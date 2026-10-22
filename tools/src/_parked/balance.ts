import { compileLevel, generateHashes, loadContent, resolveProfiles, type ContentFileMap, type Content, type Level } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import { runBalancePool } from './balance-pool.js';
import type { BalanceObservation, BalanceTask } from './balance-match.js';
import type { BalanceTargets } from './balance-targets.js';
import { LocatedError } from '../files.js';
export interface BalanceRow {
  level: string; band: number; profile: string; matches: number; observations: number;
  winPct: number; medianSecondsToWin: number | null; timeoutPct: number; drawPct: number; medianTowers: number;
  flags: string[];
}
export interface BalanceReport {
  header: {rulesVersion:string;contentVersion:string;botHash:Record<string,string>;BOT_VERSION:string};
  mode: 'campaign'|'arena'; seeds: number; profiles: string[];
  targets: {status:'absent'} | {status:'loaded';bands:BalanceTargets['bands']};
  overrides: {level:string;overrides:Level['overrides']}[];
  rows: BalanceRow[];
}
export interface BalanceOptions {levels?:string;proxy?:string;seeds?:number;jobs?:number;mode?:'campaign'|'arena';targets?:BalanceTargets}
function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a,b)=>a-b); const middle = Math.floor(values.length/2);
  return values.length % 2 ? values[middle]! : (values[middle-1]!+values[middle]!)/2;
}
function compare(a: string,b: string): number {return a < b ? -1 : a > b ? 1 : 0;}
export async function balance(files: ContentFileMap, options: BalanceOptions = {}): Promise<BalanceReport> {
  const seeds = options.seeds ?? 200, jobs = options.jobs ?? 2, mode = options.mode ?? 'campaign';
  if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 4294967295) throw new LocatedError('arguments','--seeds must be an integer in 1..4294967295');
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new LocatedError('arguments','--jobs must be a positive safe integer');
  if (mode !== 'campaign' && mode !== 'arena') throw new LocatedError('arguments','--mode must be campaign or arena');
  const loaded = loadContent(files), metadata = loaded['content.json'] as Content;
  const allProfiles = new Map(Object.values(resolveProfiles(loaded)).map(profile=>[profile.id,profile]));
  const profiles = [...new Set((options.proxy ?? 'reference,human-proxy,idle').split(','))].sort(compare);
  for (const id of profiles) if (!allProfiles.has(id)) throw new LocatedError('arguments',`Unknown proxy profile: ${id}`);
  const levels = Object.values(loaded).filter((value): value is Level => 'towers' in value).sort((a,b)=>compare(a.id,b.id));
  const selection = options.levels ?? 'all';
  const selected = selection === 'all' ? levels : levels.filter(level=>level.id === selection);
  if (!selected.length) throw new LocatedError('arguments',`Unknown or empty level selection: ${selection}`);
  const tasks: BalanceTask[] = [];
  for (const authored of selected) {
    const level = compileLevel(loaded,authored.id);
    const humans = level.players.filter(player=>player.kind === 'human');
    if (mode === 'campaign' && humans.length !== 1) throw new LocatedError(authored.id,'Expected exactly one human seat');
    for (let seed = 1; seed <= seeds; seed++) {
      for (let rotation = 0; rotation < profiles.length; rotation++) {
        const seats = mode === 'campaign' ? [{player:humans[0]!.id,profile:allProfiles.get(profiles[rotation]!)!}] :
          level.players.map((player,seat)=>({player:player.id,profile:allProfiles.get(profiles[(seat+rotation)%profiles.length]!)!}));
        tasks.push({level,seed,rotation,seats});
      }
    }
  }
  const matches = await runBalancePool(tasks,jobs);
  const rows: BalanceRow[] = [];
  for (const authored of selected) for (const profile of profiles) {
    const observations: BalanceObservation[] = [];
    let matchCount = 0;
    for (const match of matches) if (match.level === authored.id) {
      const own = match.observations.filter(observation=>observation.profile === profile);
      if (own.length) matchCount++;
      observations.push(...own);
    }
    const count = observations.length;
    const row: BalanceRow = {level:authored.id,band:authored.band,profile,matches:matchCount,observations:count,
      winPct:100*observations.filter(o=>o.won).length/count,
      medianSecondsToWin:median(observations.filter(o=>o.won).map(o=>o.seconds)),
      timeoutPct:100*observations.filter(o=>o.timeout).length/count,drawPct:100*observations.filter(o=>o.draw).length/count,
      medianTowers:median(observations.map(o=>o.towers))!,flags:[]};
    const target = options.targets?.bands[String(authored.band) as keyof BalanceTargets['bands']];
    if (target) {
      if (profile === 'reference' && row.winPct < target.referenceWinMin) row.flags.push(`Reference win ${row.winPct}% < ${target.referenceWinMin}%`);
      if (profile === 'human-proxy' && (row.winPct < target.humanProxyWin[0] || row.winPct > target.humanProxyWin[1])) row.flags.push(`Human-proxy win ${row.winPct}% outside ${target.humanProxyWin[0]}..${target.humanProxyWin[1]}%`);
      if (profile === 'idle' && row.winPct > target.idleWinMax) row.flags.push(`Idle win ${row.winPct}% > ${target.idleWinMax}%`);
      if (row.timeoutPct > target.timeoutMaxPct) row.flags.push(`Timeout ${row.timeoutPct}% > ${target.timeoutMaxPct}%`);
    }
    rows.push(row);
  }
  return {header:{rulesVersion:metadata.rulesVersion,contentVersion:metadata.contentVersion,botHash:generateHashes(loaded).bots,BOT_VERSION},mode,seeds,profiles,
    targets:options.targets ? {status:'loaded',bands:options.targets.bands} : {status:'absent'},
    overrides:selected.filter(level=>Object.values(level.overrides).some(value=>value && Object.keys(value).length)).map(level=>({level:level.id,overrides:level.overrides})),rows};
}
