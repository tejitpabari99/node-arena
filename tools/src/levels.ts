import { loadContent, canonicalJson, type CompiledLevel, type ContentFiles } from '@node-arena/content';
import { TICK_RATE } from '@node-arena/sim';
import { createSeatBot, runMatch, HUMAN_PROXY, type MatchController, type MatchResult } from '@node-arena/bots';
import { LocatedError } from './files.js';
import type { UnsolvedEntry } from './unsolved.js';
import { checkSymmetry, type SymmetryKind } from './pvp-symmetry.js';

/** Safety cap for untimed levels (1000 s), as in the 06 proxy spike. */
export const DEFAULT_MAX_TICKS = 20000;
/** 06 R6 (c): solvable = any win over these proxy action delays (faster = stronger). */
export const SOLVE_DELAYS = [500, 1000, 2000] as const;
/** The canonical proxy for (a) and the determinism lock. */
export const LOCK_DELAY = 2000;

export interface LevelRunReport { seed: number; proxy: string; outcome: string; winner: number | null; won: boolean; truncated: boolean; ticks: number; finalHash: string; rejected: number }
export interface LevelReport {
  id: string; position?: number; seeds: number; humanSeat?: number;
  /** pvp levels only: outcome per `seed/delay` run (every seat a human-proxy bot) and the symmetry transforms verified. */
  pvp?: { symmetry: string; outcomes: Record<string, string> };
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
export function validateLevel(level: CompiledLevel, position: number | undefined = undefined, seeds = 4, unsolved: UnsolvedEntry | null = null, maxTicks = DEFAULT_MAX_TICKS, runProxy: typeof playProxy = playProxy): LevelReport {
  if (position === undefined ? !level.id.startsWith('na-') : !Number.isSafeInteger(position) || position < 1) throw new RangeError('A positive campaign position is required for Common levels');
  const seat = humanSeat(level);
  const report: LevelReport = { id: level.id, ...(position === undefined ? {} : { position }), seeds, humanSeat: seat, idleWins: 0, wins: {}, totalWins: 0, runs: 0, truncated: 0, solvable: false, unsolved, deterministic: false, ok: false, errors: [], warnings: [], lock: { outcome: '', ticks: 0, finalHash: '' } };
  const fail = (what: string, error: unknown) => report.errors.push(`${what}: ${(error as Error).message}`);
  let first: LevelRunReport | undefined;
  for (let seed = 1; seed <= seeds; seed++) {
    try {
      const idle = runProxy(level, seed, 'idle', maxTicks);
      if (idle.won) report.idleWins++;
      if (idle.rejected) report.errors.push(`idle seed ${seed}: ${idle.rejected} rejected commands`);
    } catch (error) { fail(`idle seed ${seed}`, error); }
    for (const ad of SOLVE_DELAYS) {
      try {
        const run = runProxy(level, seed, ad, maxTicks);
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
    try { const again = runProxy(level, 1, LOCK_DELAY, maxTicks); report.deterministic = again.finalHash === first.finalHash && again.ticks === first.ticks; }
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
/** Margin (ticks) past the authored time limit before a pvp run counts as non-terminating. */
export const PVP_CAP_MARGIN = 100;
export const PVP_DELAYS = [1000, 2000] as const;
export interface PvpRunReport { outcome: string; ticks: number; finalHash: string }
export type PlayPvp = (level: CompiledLevel, seed: number, actionDelayMs: number | 'idle', maxTicks: number) => PvpRunReport;
/** Every seat of a pvp level is driven alike: idle, or a human-proxy bot at the given delay. Never consults humanSeat(). */
export function playPvp(level: CompiledLevel, seed: number, actionDelayMs: number | 'idle', maxTicks: number): PvpRunReport {
  const controllers = level.players.map((_, seat) => proxyController(level, seed, seat, actionDelayMs));
  const result = runMatch({ level, seed, maxTicks, controllers, record: false });
  return { outcome: result.outcome.outcome, ticks: result.ticks, finalHash: result.stats.finalHash };
}
/** 03 R8: pvp branch. Symmetry (sidecar), idle seed 1 = draw, seeds x PVP_DELAYS all-seat proxy matches terminate with no rejects, seed-1/2000 lock + rerun. */
export function validatePvpLevel(level: CompiledLevel, position: number | undefined, seeds: number, symmetry: SymmetryKind | undefined, runPvp: PlayPvp = playPvp, maxTicksFallback = DEFAULT_MAX_TICKS): LevelReport {
  const outcomes: Record<string, string> = {};
  const report: LevelReport = { id: level.id, ...(position === undefined ? {} : { position }), seeds, pvp: { symmetry: symmetry ?? 'missing', outcomes }, idleWins: 0, wins: {}, totalWins: 0, runs: 0, truncated: 0, solvable: true, unsolved: null, deterministic: false, ok: false, errors: [], warnings: [], lock: { outcome: '', ticks: 0, finalHash: '' } };
  const fail = (what: string, error: unknown) => report.errors.push(`${what}: ${(error as Error).message}`);
  const cap = (level.timeLimitSec === null ? maxTicksFallback : level.timeLimitSec * TICK_RATE) + PVP_CAP_MARGIN;
  if (!symmetry) report.errors.push(`${level.id}: no entry in tools/pvp-symmetry.json; add one (d2 or d4)`);
  else {
    try { const sym = checkSymmetry(level, symmetry); if (!sym.ok) report.errors.push(`Symmetry ${symmetry} fails under ${sym.transform} at ${sym.offender}: ${sym.reason}`); }
    catch (error) { fail('symmetry', error); }
  }
  try {
    const idle = runPvp(level, 1, 'idle', cap);
    if (idle.outcome !== 'draw') report.errors.push(`Idle seats seed 1 ended ${idle.outcome}; expected draw`);
  } catch (error) { fail('idle seed 1', error); }
  let first: PvpRunReport | undefined;
  for (let seed = 1; seed <= seeds; seed++) {
    for (const ad of PVP_DELAYS) {
      try {
        const run = runPvp(level, seed, ad, cap);
        report.runs++; outcomes[`${seed}/${ad}`] = run.outcome;
        if (run.outcome === 'truncated') { report.truncated++; report.errors.push(`proxy-${ad} seed ${seed}: did not terminate within ${cap} ticks`); }
        if (seed === 1 && ad === LOCK_DELAY) first = run;
      } catch (error) { fail(`proxy-${ad} seed ${seed}`, error); }
    }
  }
  if (first) {
    report.lock = { outcome: first.outcome, ticks: first.ticks, finalHash: first.finalHash };
    try { const again = runPvp(level, 1, LOCK_DELAY, cap); report.deterministic = again.finalHash === first.finalHash && again.ticks === first.ticks; }
    catch (error) { fail('seed 1 rerun', error); }
    if (!report.deterministic) report.errors.push('Seed 1 rerun final hash differs');
  }
  report.ok = report.errors.length === 0; return report;
}
export interface CampaignLevel { id: string; position: number }
/** Common only; every level file must be listed exactly once across Common, custom and pvp. */
export function campaignLevels(data: ContentFiles): CampaignLevel[] {
  const loaded = loadContent(data);
  const entries = [...loaded.catalog.campaigns['common']!.entries].sort((a, b) => a.position - b.position).map(e => ({ id: e.level, position: e.position }));
  const files = Object.keys(data).filter(name => /^data\/levels\/[^/]+\.json$/.test(name)).map(name => name.slice('data/levels/'.length, -'.json'.length)).sort();
  const listed = [...entries.map(e => e.id), ...(loaded.catalog.campaigns['custom']?.entries ?? []).map(e => e.level), ...(loaded.catalog.campaigns['pvp']?.entries ?? []).map(e => e.level)].sort();
  if (canonicalJson(files) !== canonicalJson(listed)) throw new LocatedError('data/campaigns/common.json', `Common + custom + pvp campaign entries (${listed.length}) differ from data/levels files (${files.length})`);
  return entries;
}
export function customLevels(data: ContentFiles): CampaignLevel[] {
  return [...(loadContent(data).catalog.campaigns['custom']?.entries ?? [])].sort((a, b) => a.position - b.position).map(e => ({ id: e.level, position: e.position }));
}
export function pvpLevels(data: ContentFiles): CampaignLevel[] {
  return [...(loadContent(data).catalog.campaigns['pvp']?.entries ?? [])].sort((a, b) => a.position - b.position).map(e => ({ id: e.level, position: e.position }));
}
export function selectLevels(data: ContentFiles, selected = 'all'): { levels: CampaignLevel[]; compiled: Record<string, CompiledLevel> } {
  const levels = [...campaignLevels(data), ...customLevels(data)];
  const chosen = selected === 'all' ? levels : levels.filter(l => l.id === selected);
  if (!chosen.length) throw new LocatedError('arguments', `Unknown or empty level selection: ${selected}`);
  return { levels: chosen, compiled: loadContent(data).compiled };
}
/** `symmetry` is the tools/pvp-symmetry.json sidecar; pvp levels are validated by the pvp branch, never the campaign one. */
export function validateLevels(data: ContentFiles, unsolved: readonly UnsolvedEntry[], selected = 'all', seeds = 4, maxTicks = DEFAULT_MAX_TICKS, symmetry: Record<string, SymmetryKind> = {}): LevelReport[] {
  if (!Number.isSafeInteger(seeds) || seeds < 1) throw new RangeError('Seeds must be a positive integer');
  const pvp = pvpLevels(data);
  const pvpChosen = selected === 'all' ? pvp : pvp.filter(l => l.id === selected);
  const { levels, compiled } = pvpChosen.length && selected !== 'all' ? { levels: [] as CampaignLevel[], compiled: loadContent(data).compiled } : selectLevels(data, selected);
  const known = new Set([...campaignLevels(data), ...customLevels(data)].map(l => l.id));
  for (const entry of unsolved) if (!known.has(entry.id)) throw new LocatedError('tools/unsolved-by-proxy.json', `Unknown level ${entry.id}`);
  const byId = new Map(unsolved.map(e => [e.id, e]));
  return [...levels.map(l => validateLevel(compiled[l.id]!, l.position, seeds, byId.get(l.id) ?? null, maxTicks)),
    ...pvpChosen.map(l => validatePvpLevel(compiled[l.id]!, l.position, seeds, symmetry[l.id]))];
}
/** Seed-1 determinism lock over Common, custom and pvp levels (levels:lock writes it, validate:levels checks it). */
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

/** A merge must refuse a missing/malformed baseline rather than silently erase untouched entries. */
export function parseLevelsLock(value: unknown): LevelsLock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocatedError('tools/levels-lock.json', 'Invalid levels lock: expected an object');
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'finalHash,outcome,ticks' ||
        !['won', 'draw', 'lost', 'truncated', 'victory', 'timeLimit'].includes(entry.outcome) || !Number.isSafeInteger(entry.ticks) || entry.ticks < 0 || typeof entry.finalHash !== 'string' || !/^[0-9a-f]{16}$/.test(entry.finalHash)) {
      throw new LocatedError('tools/levels-lock.json', `Invalid levels lock entry: ${id}`);
    }
  }
  return value as LevelsLock;
}
