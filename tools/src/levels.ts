import { lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { compileLevel, loadContent, resolveProfiles, type CompiledLevel, type ContentFileMap, type Level, type ResolvedBotProfile } from '@node-arena/content';
import { createProfileBot, runMatch, type MatchResult, type MatchOutcome } from '@node-arena/bots';
import { playReplay, type ReplayMetadata, type ReplayRecord, type Command } from '@node-arena/sim';
import { readJson, LocatedError } from './files.js';

export interface LevelRunReport {
  seed: number; ticks: number; outcome: MatchOutcome; finalHash: string; rejected: number;
  players: MatchResult['stats']['players']; towers: MatchResult['stats']['towers'];
}
export interface LevelReport {
  id: string; band: number; seeds: number; requiredWins: number; referenceWins: number; idleWins: number;
  ok: boolean; deterministic: boolean; errors: string[];
  reference: LevelRunReport[]; idle: LevelRunReport[];
  solution?: { file: string; ok: boolean; finalHash?: string };
}
export function requiredWins(band: number, seeds: number): number {
  if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 4294967295) throw new RangeError('Seeds must be an integer in 1..4294967295');
  if (!Number.isInteger(band) || band < 1 || band > 4) throw new RangeError('Level band must be in 1..4');
  // Deliberately K-1, including zero at K=1, per the authored band-four rule.
  return band === 4 ? seeds - 1 : seeds;
}
export function isHumanWin(outcome: MatchOutcome, team: string): boolean {
  return outcome.outcome === 'won' && outcome.winnerTeam === team;
}
function checked(result: MatchResult): void {
  if (result.outcome.outcome === 'truncated') throw new Error('Match did not terminate');
  if (result.stats.rejected !== 0) throw new Error(`Match rejected ${result.stats.rejected} commands`);
}
function row(seed: number, result: MatchResult): LevelRunReport {
  return {seed, ticks:result.ticks, outcome:result.outcome, finalHash:result.stats.finalHash, rejected:result.stats.rejected, players:result.stats.players, towers:result.stats.towers};
}
export interface ValidateLevelOptions {
  level: CompiledLevel; authored: Pick<Level, 'band'>; metadata: ReplayMetadata;
  reference: ResolvedBotProfile; idle: ResolvedBotProfile; seeds: number;
  solutionPath?: string;
}
export async function validateLevel(options: ValidateLevelOptions): Promise<LevelReport> {
  const {level, authored, seeds, metadata, reference, idle, solutionPath} = options;
  const report: LevelReport = {id:level.id,band:authored.band,seeds,requiredWins:requiredWins(authored.band,seeds),referenceWins:0,idleWins:0,ok:false,deterministic:false,errors:[],reference:[],idle:[]};
  const humans = level.players.filter(p => p.kind === 'human');
  if (humans.length !== 1) { report.errors.push('Expected exactly one human seat'); return report; }
  const human = humans[0]!;
  function match(profile: ResolvedBotProfile, seed: number) {
    const result = runMatch({level,seed,controllers:[createProfileBot(level,seed,human.id,profile)],record:false}); checked(result); return result;
  }
  for (let seed = 1; seed <= seeds; seed++) {
    for (const [name, profile] of [['reference',reference],['idle',idle]] as const) {
      try {
        const result = match(profile,seed); report[name].push(row(seed,result));
        if (isHumanWin(result.outcome,human.team)) name === 'reference' ? report.referenceWins++ : report.idleWins++;
      } catch (error) { report.errors.push(`${name} seed ${seed}: ${(error as Error).message}`); }
    }
  }
  try {
    const rerun = match(reference,1);
    report.deterministic = report.reference[0]?.seed === 1 && rerun.stats.finalHash === report.reference[0].finalHash;
    if (!report.deterministic) report.errors.push('Seed 1 rerun final hash differs');
  } catch (error) { report.errors.push(`Seed 1 rerun: ${(error as Error).message}`); }
  if (report.idleWins) report.errors.push(`Idle proxy won ${report.idleWins}/${seeds}; expected zero wins`);
  if (report.referenceWins < report.requiredWins) {
    let solved = false;
    if (authored.band === 4 && solutionPath) {
      report.solution = {file:solutionPath,ok:false};
      try {
        // Only a standalone record for this exact level is accepted, never bundles or wrappers.
        const replay = await readJson(solutionPath) as ReplayRecord;
        const playback = playReplay({metadata,level},replay);
        if (!playback.ok) throw new Error(`Replay mismatch; first diverging tick: ${playback.divergingTick}`);
        if (playback.sim.rejected !== 0 || !replay.outcome || !isHumanWin(replay.outcome,human.team)) throw new Error('Solution replay is not a legal human-team win');
        // Replay bot commands are evidence only. Recompute authored opponents while
        // running only the human's script: a foreign controller cannot manufacture a win.
        const commands = replay.commands.filter(entry => (entry.cmd as {player?: string} | null)?.player === human.id)
          .map(entry => ({tick:entry.tick,cmd:entry.cmd as unknown as Command}));
        const result = runMatch({level,seed:replay.header.seed,controllers:[{player:human.id,commands}],record:false}); checked(result);
        if (!isHumanWin(result.outcome,human.team) || result.stats.finalHash !== replay.finalHash || result.ticks !== replay.finalTick) throw new Error('Solution script does not reproduce a win against authored opponents');
        solved = true; report.solution.ok = true; report.solution.finalHash = result.stats.finalHash;
      } catch (error) { report.errors.push(`Invalid solution: ${(error as Error).message}`); }
    }
    if (!solved) report.errors.push(`Reference won ${report.referenceWins}/${seeds}; band ${authored.band} requires ${report.requiredWins}`);
  }
  report.ok = report.errors.length === 0; return report;
}
export async function validateLevels(files: ContentFileMap, root: string, selected = 'all', seeds = 4): Promise<LevelReport[]> {
  requiredWins(1,seeds);
  const loaded = loadContent(files);
  const metadata = loaded['content.json'] as ReplayMetadata;
  const profiles = new Map(Object.values(resolveProfiles(loaded)).map(profile => [profile.id,profile]));
  const reference = profiles.get('reference'), idle = profiles.get('idle');
  if (!reference || !idle) throw new LocatedError('data/bots', 'Missing reference or idle tooling profile');
  const levels = Object.values(loaded).filter((value): value is Level => 'towers' in value).sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const chosen = selected === 'all' ? levels : levels.filter(level => level.id === selected);
  if (!chosen.length) throw new LocatedError('arguments', `Unknown or empty level selection: ${selected}`);
  const reports: LevelReport[] = [];
  for (const authored of chosen) {
    const solution = resolve(root,'tools/solutions',`${authored.id}.replay.json`);
    let solutionPath: string | undefined;
    try {
      const stat = await lstat(solution);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new LocatedError(solution,'Solution must be a regular committed replay file');
      try { execFileSync('git',['-C',root,'ls-files','--error-unmatch','--',relative(root,solution)],{stdio:'pipe'}); }
      catch { throw new LocatedError(solution,'Solution replay must be committed'); }
      // Reject tracked-but-modified/uncommitted data as well as merely staged files.
      const committed = execFileSync('git',['-C',root,'show',`HEAD:${relative(root,solution)}`],{encoding:'utf8',stdio:'pipe'});
      const current = JSON.stringify(await readJson(solution));
      if (JSON.stringify(JSON.parse(committed)) !== current) throw new LocatedError(solution,'Solution replay differs from committed HEAD');
      solutionPath = solution;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    reports.push(await validateLevel({level:compileLevel(loaded,authored.id),authored,metadata,reference,idle,seeds,...(solutionPath ? {solutionPath} : {})}));
  }
  return reports;
}
