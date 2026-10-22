import type { BalanceReport } from './balance.js';
export function balanceMarkdown(report: BalanceReport): string {
  const h = report.header;
  return `Rules ${h.rulesVersion}; content ${h.contentVersion}; BOT_VERSION ${h.BOT_VERSION}.\n\nbotHash: ${JSON.stringify(h.botHash)}\n\nMode ${report.mode}; seeds 1..${report.seeds}; profiles ${report.profiles.join(', ')}. Report only: no targets, no flags.\n\n| Pos | Level | Proxy | Matches | Seat observations | Win % | Median seconds to win | Timeout % | Median towers |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${report.rows.map(row=>`| ${row.position} | ${row.level} | ${row.profile} | ${row.matches} | ${row.observations} | ${row.winPct} | ${row.medianSecondsToWin ?? '—'} | ${row.timeoutPct} | ${row.medianTowers} |`).join('\n')}`;
}
