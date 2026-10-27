import { TICK_RATE } from '@node-arena/sim';
import type { ContentIssue } from '@node-arena/content';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { isOwnershipIssue } from './ownership.js';

/** Presentation-only helpers for Check details; nothing here changes sim, bot or report data. */
export type CheckRun = Extract<EditorProxyEvent, { type: 'progress' }>['run'];
export type CheckReport = Extract<EditorProxyEvent, { type: 'result' }>['report'];

/** Game time at the sim tick rate, as m:ss. */
export function formatGameTime(ticks: number): string {
  const seconds = Math.round(ticks / TICK_RATE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Short row label for a run kind (`idle`, `proxy-<ms>`). */
export function runKindLabel(proxy: string): string {
  if (proxy === 'idle') return 'Do-nothing baseline';
  const ms = /^proxy-(\d+)$/.exec(proxy)?.[1];
  if (!ms) return proxy;
  const delay = Number(ms), pace = delay <= 500 ? 'fast' : delay <= 1000 ? 'medium' : 'slow';
  return `Auto-player (${pace}, every ${delay / 1000} s)`;
}

/** The winner is the human seat in this engine; label it "You" when the seat is known or unknown. */
export function winnerLabel(winner: number | null, humanSeat: number | undefined): string {
  if (winner === null) return 'nobody';
  return humanSeat === undefined || winner === humanSeat ? 'You' : `Player ${winner + 1}`;
}

/** Past-tense outcome with the reason, e.g. `Lost (time ran out)`. */
export function outcomeText(run: CheckRun, humanSeat?: number): string {
  if (run.won) return 'Won';
  if (run.outcome === 'won') return `Won by ${winnerLabel(run.winner, humanSeat)}`;
  if (run.outcome === 'lost') return 'Lost';
  if (run.outcome === 'timeout') return 'Lost (time ran out)';
  if (run.truncated || run.outcome === 'truncated') return 'Stopped (hit the 1000 s safety cap)';
  return run.outcome;
}

/** One full sentence-style line, e.g. `Auto-player (fast, every 0.5 s) · start 1 · Won in 1:25`. */
export function formatRunLine(run: CheckRun, humanSeat?: number): string {
  return `${runKindLabel(run.proxy)} · start ${run.seed} · ${outcomeText(run, humanSeat)} in ${formatGameTime(run.ticks)}`;
}

/**
 * The worker re-runs proxy-2000 seed 1 as a determinism check, so the stream repeats that run.
 * Keep the first run per (kind, seed).
 */
export function uniqueRuns(events: readonly EditorProxyEvent[]): CheckRun[] {
  const seen = new Set<string>(), runs: CheckRun[] = [];
  for (const event of events) {
    if (event.type !== 'progress') continue;
    const key = `${event.run.proxy}|${event.run.seed}`;
    if (!seen.has(key)) { seen.add(key); runs.push(event.run); }
  }
  return runs;
}

export interface RunTable { seeds: number[]; rows: { proxy: string; label: string; cells: Map<number, CheckRun> }[] }

/** Rows = run kind (idle first, then fastest auto-player), columns = start numbers. */
export function runTable(runs: readonly CheckRun[]): RunTable {
  const seeds = [...new Set(runs.map(run => run.seed))].sort((a, b) => a - b);
  const order = (proxy: string) => proxy === 'idle' ? -1 : Number(/^proxy-(\d+)$/.exec(proxy)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const kinds = [...new Set(runs.map(run => run.proxy))].sort((a, b) => order(a) - order(b));
  return { seeds, rows: kinds.map(proxy => ({ proxy, label: runKindLabel(proxy), cells: new Map(runs.filter(run => run.proxy === proxy).map(run => [run.seed, run])) })) };
}

/** Headline: `Auto-player won 12 of 12 test games. Level data is valid.` */
export function summaryLine(report: Pick<CheckReport, 'totalWins' | 'runs' | 'ok'>): string {
  return `Auto-player won ${report.totalWins} of ${report.runs} test games. ${report.ok ? 'Level data is valid.' : 'Some checks failed; see below.'}`;
}

const PLAIN_HINT = 'A hint, not proof: auto-player wins do not guarantee the level can be beaten, and no wins do not mean it is impossible. You still need to play it yourself and sign off.';
export const CHECK_LEGEND = {
  hint: PLAIN_HINT,
  kinds: [
    'Do-nothing baseline: you give no orders at all; a good level should not win by itself.',
    'Auto-player: a built-in bot plays your side like a person would, issuing orders every 0.5, 1 or 2 seconds (smaller = faster, stronger).',
    'Start 1 to 4: different random starting conditions for the same level.',
    'Times are game time (m:ss).',
  ],
} as const;

const TOP_LEVEL = new Set(['buildings', 'elements', 'players']);
function words(pointer: string): string {
  const parts = pointer.split('/').filter(Boolean);
  if (!parts.length) return 'Level';
  return parts.map(part => /^\d+$/.test(part) ? `#${Number(part) + 1}` : part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()).join(' › ');
}
/** Plain wording for common Ajv messages; unknown messages pass through. */
function plainMessage(message: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^must have required property '(.+)'$/.exec(message))) return `${m[1]} is required`;
  if ((m = /^must NOT have fewer than (\d+) items?$/.exec(message))) return `needs at least ${m[1]} item${m[1] === '1' ? '' : 's'}`;
  if ((m = /^must NOT have more than (\d+) items?$/.exec(message))) return `allows at most ${m[1]} item${m[1] === '1' ? '' : 's'}`;
  if ((m = /^must be >= (.+)$/.exec(message))) return `must be at least ${m[1]}`;
  if ((m = /^must be <= (.+)$/.exec(message))) return `must be at most ${m[1]}`;
  if ((m = /^must be > (.+)$/.exec(message))) return `must be greater than ${m[1]}`;
  if ((m = /^must be < (.+)$/.exec(message))) return `must be less than ${m[1]}`;
  if ((m = /^must NOT have additional properties/.exec(message))) return 'has an unknown setting';
  if (message === 'must be equal to one of the allowed values') return 'is not one of the allowed choices';
  if ((m = /^must be (string|number|integer|boolean|object|array)$/.exec(message))) return `must be a${m[1] === 'integer' || m[1] === 'object' || m[1] === 'array' ? 'n' : ''} ${m[1]}`;
  return message;
}

/** Display text for an issue plus the raw text for a tooltip/details. `label` is the editor's item label for the pointer. */
export function formatIssue(issue: ContentIssue, label?: string): { text: string; raw: string } {
  const raw = `${label ?? issue.pointer}: ${issue.message}`;
  if (issue.pointer === '/buildings' && (/fewer than 1 item/.test(issue.message) || /^add at least one building/i.test(issue.message))) return { text: 'Add at least one building', raw };
  if (isOwnershipIssue(issue)) return { text: issue.message, raw };
  const where = label && !label.startsWith('/') ? label : TOP_LEVEL.has(issue.pointer.slice(1)) || label === undefined || label.startsWith('/') ? words(issue.pointer) : label;
  const message = plainMessage(issue.message);
  return { text: message === issue.message && !issue.message.startsWith('must') ? `${label ?? issue.pointer}: ${issue.message}` : `${where}: ${message}`, raw };
}
