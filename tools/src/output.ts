export interface Diagnostic { file: string; pointer: string; message: string }
/** `levels` / `balance` report payloads return with the parked level and balance gates (tools/src/_parked, SP06). */
export interface GateReport { command: string; ok: boolean; errors: Diagnostic[]; warnings: Diagnostic[]; summary: string }
export function emitReport(report: GateReport, format: 'md' | 'json'): void {
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else {
    const escape = (text: string) => text.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    console.log(`# ${report.command}: ${report.ok ? 'PASS' : 'FAIL'}\n\n${report.summary}`);
    if (report.errors.length || report.warnings.length) {
      console.log('\n| Severity | File | Pointer | Message |\n| --- | --- | --- | --- |');
      for (const [severity, items] of [['error', report.errors], ['warning', report.warnings]] as const) for (const item of items) console.log(`| ${severity} | ${escape(item.file)} | ${escape(item.pointer)} | ${escape(item.message)} |`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}
