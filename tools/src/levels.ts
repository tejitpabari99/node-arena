import { loadContent, canonicalJson, type CompiledLevel, type ContentFiles } from '@node-arena/content';
import { createSeatBot, runMatch, HUMAN_PROXY, type MatchController, type MatchResult } from '@node-arena/bots';
import { LocatedError } from './files.js';
import type { UnsolvedEntry } from './unsolved.js';

/** Safety cap for untimed levels (1000 s), as in the 06 proxy spike. */
export const DEFAULT_MAX_TICKS = 20000;
/** 06 R6 (c): solvable = any win over these proxy action delays (faster = stronger). */
export const SOLVE_DELAYS = [500, 1000, 2000] as const;
/** The canonical proxy for (a) and the determinism lock. */
export const LOCK_DELAY = 2000;

export interface LevelRunReport { seed: number; proxy: string; outcome: string; winner: number | null; won: boolean; truncated: boolean; ticks: number; finalHash: string; rejected: number }
export interface LevelReport {
  id: string; position: number; seeds: number; humanSeat: number;
  idleWins: number; wins: Record<string, number>; totalWins: number; runs: number; truncated: number;
  solvable: boolean; unsolved: UnsolvedEntry | null; deterministic: boolean;
  ok: boolean; errors: string[]; warnings: string[]; lock: LockEntry;
}
export interface LockEntry { outcome: string; ticks: number; finalHash: string }
export type LevelsLock = Record<string, LockEntry>;

/** The human seat is the one player with no authored bot. */
export function humanSeat(level: CompiledLevel): number {
  const botSeats = new Set(level.bots.map(b => b.player));
  const seats = level.players.map((_, i) => i).filter(i => !botSeats.has(i));
  if (seats.length !== 1) throw new Error(`Expected exactly one human seat, found ${seats.length}`);
  return seats[0]!;
}
export function proxyController(level: CompiledLevel, seed: number, seat: number, actionDelayMs: number | 'idle'): MatchController {
  return actionDelayMs === 'idle' ? { player: seat, commands: [] } : createSeatBot(level, seed, seat, { ...HUMAN_PROXY, actionDelayMs });
}
export function playProxy(level: CompiledLevel, seed: number, actionDelayMs: number | 'idle', maxTicks = DEFAULT_MAX_TICKS): LevelRunReport {
  const seat = humanSeat(level);
  const result: MatchResult = runMatch({ level, seed, maxTicks, controllers: [proxyController(level, seed, seat, actionDelayMs)], record: false });
  const winner = result.outcome.winner ?? null;
  return { seed, proxy: actionDelayMs === 'idle' ? 'idle' : `proxy-${actionDelayMs}`, outcome: result.outcome.outcome, winner,
    won: result.outcome.outcome === 'won' && winner === seat, truncated: result.outcome.outcome === 'truncated',
    ticks: result.ticks, finalHash: result.stats.finalHash, rejected: result.stats.rejected };
}
/** Validates one level against 06 R6 (a)-(c); `unsolved` is the allowlist entry for this level, if any. */
export function validateLevel(level: CompiledLevel, position: number, seeds: number, unsolved: UnsolvedEntry | null, maxTicks = DEFAULT_MAX_TICKS): LevelReport {
  const seat = humanSeat(level);
  const report: LevelReport = { id: level.id, position, seeds, humanSeat: seat, idleWins: 0, wins: {}, totalWins: 0, runs: 0, truncated: 0, solvable: false, unsolved, deterministic: false, ok: false, errors: [], warnings: [], lock: { outcome: '', ticks: 0, finalHash: '' } };
  const fail = (what: string, error: unknown) => report.errors.push(`${what}: ${(error as Error).message}`);
  let first: LevelRunReport | undefined;
  for (let seed = 1; seed <= seeds; seed++) {
    try {
      const idle = playProxy(level, seed, 'idle', maxTicks);
      if (idle.won) report.idleWins++;
      if (idle.rejected) report.errors.push(`idle seed ${seed}: ${idle.rejected} rejected commands`);
    } catch (error) { fail(`idle seed ${seed}`, error); }
    for (const ad of SOLVE_DELAYS) {
      try {
        const run = playProxy(level, seed, ad, maxTicks);
        report.runs++; report.wins[run.proxy] = (report.wins[run.proxy] ?? 0) + (run.won ? 1 : 0);
        if (run.won) report.totalWins++;
        if (run.truncated) report.truncated++;
        if (run.rejected) report.errors.push(`${run.proxy} seed ${seed}: ${run.rejected} rejected commands`);
        if (seed === 1 && ad === LOCK_DELAY) first = run;
      } catch (error) { fail(`proxy-${ad} seed ${seed}`, error); }
    }
  }
  if (first) {
    report.lock = { outcome: first.outcome, ticks: first.ticks, finalHash: first.finalHash };
    try { const again = playProxy(level, 1, LOCK_DELAY, maxTicks); report.deterministic = again.finalHash === first.finalHash && again.ticks === first.ticks; }
    catch (error) { fail('seed 1 rerun', error); }
    if (!report.deterministic) report.errors.push('Seed 1 rerun final hash differs');
  }
  if (report.idleWins) report.errors.push(`Idle human won ${report.idleWins}/${seeds}; expected zero wins`);
  report.solvable = report.totalWins > 0;
  if (!report.solvable && !unsolved) report.errors.push(`Unsolvable by proxy: 0/${report.runs} wins over action delays ${SOLVE_DELAYS.join('/')}; fix the level or add it to tools/unsolved-by-proxy.json`);
  if (!report.solvable && unsolved) report.warnings.push(`Unsolved by proxy (allowlisted, owner sign-off ${unsolved.ownerSignOff ?? 'pending'}): ${unsolved.reason}`);
  if (report.solvable && unsolved) report.warnings.push(`Now solvable by proxy (${report.totalWins}/${report.runs} wins); remove it from tools/unsolved-by-proxy.json`);
  report.ok = report.errors.length === 0; return report;
}
export interface CampaignLevel { id: string; position: number }
/** The common campaign's level list; must match data/levels exactly. */
export function campaignLevels(data: ContentFiles): CampaignLevel[] {
  const loaded = loadContent(data);
  const entries = [...loaded.catalog.campaigns['common']!.entries].sort((a, b) => a.position - b.position).map(e => ({ id: e.level, position: e.position }));
  const files = Object.keys(data).filter(name => /^data\/levels\/[^/]+\.json$/.test(name)).map(name => name.slice('data/levels/'.length, -'.json'.length)).sort();
  const listed = entries.map(e => e.id).sort();
  if (canonicalJson(files) !== canonicalJson(listed)) throw new LocatedError('data/campaigns/common.json', `Campaign entries (${listed.length}) differ from data/levels files (${files.length})`);
  return entries;
}
export function selectLevels(data: ContentFiles, selected = 'all'): { levels: CampaignLevel[]; compiled: Record<string, CompiledLevel> } {
  const levels = campaignLevels(data);
  const chosen = selected === 'all' ? levels : levels.filter(l => l.id === selected);
  if (!chosen.length) throw new LocatedError('arguments', `Unknown or empty level selection: ${selected}`);
  return { levels: chosen, compiled: loadContent(data).compiled };
}
export function validateLevels(data: ContentFiles, unsolved: readonly UnsolvedEntry[], selected = 'all', seeds = 4, maxTicks = DEFAULT_MAX_TICKS): LevelReport[] {
  if (!Number.isSafeInteger(seeds) || seeds < 1) throw new RangeError('Seeds must be a positive integer');
  const { levels, compiled } = selectLevels(data, selected);
  const known = new Set(campaignLevels(data).map(l => l.id));
  for (const entry of unsolved) if (!known.has(entry.id)) throw new LocatedError('tools/unsolved-by-proxy.json', `Unknown level ${entry.id}`);
  const byId = new Map(unsolved.map(e => [e.id, e]));
  return levels.map(l => validateLevel(compiled[l.id]!, l.position, seeds, byId.get(l.id) ?? null, maxTicks));
}
/** Seed-1 determinism lock over the whole campaign (levels:lock writes it, validate:levels checks it). */
export function buildLock(reports: readonly LevelReport[]): LevelsLock {
  return Object.fromEntries([...reports].sort((a, b) => a.id < b.id ? -1 : 1).map(r => [r.id, r.lock]));
}
export function checkLevelsLock(reports: readonly LevelReport[], lock: LevelsLock): string[] {
  const errors: string[] = [];
  for (const r of reports) {
    const want = lock[r.id];
    if (!want) errors.push(`${r.id}: missing from tools/levels-lock.json; run pnpm levels:lock`);
    else if (canonicalJson(want) !== canonicalJson(r.lock)) errors.push(`${r.id}: seed-1 result ${JSON.stringify(r.lock)} differs from tools/levels-lock.json ${JSON.stringify(want)}; determinism broke or behaviour changed (bump versions, then pnpm levels:lock)`);
  }
  return errors;
}
