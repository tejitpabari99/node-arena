import { levelsMarkdown } from './levels-output.js';
import { balanceMarkdown } from './balance-output.js';
import type { BalanceReport } from './balance.js';
import type { LevelReport } from './levels.js';
export interface Diagnostic { file: string; pointer: string; message: string }
export interface GateReport { command: string; ok: boolean; errors: Diagnostic[]; warnings: Diagnostic[]; summary: string; levels?: LevelReport[]; balance?: BalanceReport }
export function emitReport(report: GateReport, format: 'md' | 'json'): void {
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else {
    const escape = (text: string) => text.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    console.log(`# ${report.command}: ${report.ok ? 'PASS' : 'FAIL'}\n\n${report.summary}`);
    if (report.balance) console.log(`\n${balanceMarkdown(report.balance)}`);
    if (report.levels) console.log(`\n${levelsMarkdown(report.levels)}`);
    if (report.errors.length || report.warnings.length) {
      console.log('\n| Severity | File | Pointer | Message |\n| --- | --- | --- | --- |');
      for (const [severity, items] of [['error', report.errors], ['warning', report.warnings]] as const) for (const item of items) console.log(`| ${severity} | ${escape(item.file)} | ${escape(item.pointer)} | ${escape(item.message)} |`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}
