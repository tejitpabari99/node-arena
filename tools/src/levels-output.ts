import type { LevelReport } from './levels.js';
export function levelsMarkdown(levels: readonly LevelReport[]): string {
  const rows = levels.map(l => `| ${l.position} | ${l.id} | ${l.ok ? 'PASS' : 'FAIL'} | ${Object.keys(l.wins).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))).map(k => `${k.replace('proxy-', '')}:${l.wins[k]}/${l.seeds}`).join(' ')} | ${l.totalWins}/${l.runs} | ${l.solvable ? 'yes' : l.unsolved ? 'no (allowlisted)' : 'NO'} | ${l.idleWins}/${l.seeds} | ${l.truncated}/${l.runs} | ${l.deterministic} |`);
  return `| Pos | Level | Result | Proxy wins by action delay (ms) | Any-win | Solvable | Idle wins | Capped | Deterministic |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}`;
}
