// `import:tw` / `check:import` (PRD 05 R5). Never touches content.json or the lock; prints the reminder instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { requireTwExtract, twExtractRoot } from './env.js';
import { DEFAULT_RANGE, defaultContentDir, runImport, type ImportResult } from './run.js';

export const REMINDER = 'Reminder: run `pnpm content:lock` and bump `contentVersion` in packages/content/content.json (importer never edits either).';

export interface Parsed { range: [number, number]; only: string[]; skipBlocked: boolean; check: boolean }

export function parseArgs(args: readonly string[]): Parsed {
  const p: Parsed = { range: [...DEFAULT_RANGE], only: [], skipBlocked: false, check: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--skip-blocked') p.skipBlocked = true;
    else if (a === '--check') p.check = true;
    else if (a === '--range' || a === '--only') {
      const v = args[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} requires a value`);
      if (a === '--only') p.only.push(...v.split(',').filter(Boolean));
      else {
        const m = /^(\d+)-(\d+)$/.exec(v);
        if (!m) throw new Error('--range expects A-B (e.g. 4-23)');
        p.range = [Number(m[1]), Number(m[2])];
      }
    } else throw new Error(`Unknown option ${a}`);
  }
  return p;
}

export function report(r: ImportResult): string[] {
  const out = [`levels: ${r.rows.length} considered, ${r.rows.length - r.blocked.length} importable, ${r.blocked.length} blocked`];
  for (const b of r.blocked) out.push(`BLOCKED ${b.id} (position ${b.position}): ${b.reasons.join('; ')}`);
  for (const row of r.rows) if (row.result.level && row.result.gate.dropped.length) out.push(`dropped ${row.slug}: ${row.result.gate.dropped.join(', ')}`);
  out.push(`campaign common: ${r.campaign.length} entries${r.campaign.length ? '' : ' (not written)'}`);
  return out;
}

export async function run(command: 'import:tw' | 'check:import', args: readonly string[]): Promise<number> {
  let parsed: Parsed;
  try { parsed = parseArgs(args); } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return 2; }
  const check = command === 'check:import' || parsed.check;
  if (check && twExtractRoot() === null) {
    console.log('check:import skipped (TW_EXTRACT unset)');
    if (process.env['GITHUB_ACTIONS']) console.log('::notice::check:import skipped (TW_EXTRACT unset)');
    return 0;
  }
  const extractRoot = requireTwExtract();
  const contentDir = defaultContentDir();
  let result: ImportResult;
  try {
    result = await runImport({ extractRoot, contentDir, range: parsed.range, only: parsed.only, skipBlocked: parsed.skipBlocked });
  } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return 2; }
  for (const line of report(result)) console.log(line);
  if (check) {
    const stale: string[] = [];
    for (const [path, bytes] of result.files) {
      let disk: string | null = null;
      try { disk = readFileSync(join(contentDir, path), 'utf8'); } catch { /* missing */ }
      if (disk !== bytes) stale.push(`${path}${disk === null ? ' (missing)' : ''}`);
    }
    if (stale.length) { console.error(`check:import: out of date: ${stale.join(', ')}`); return 1; }
    console.log(`check:import: ${result.files.size} files up to date`);
    return 0;
  }
  let changed = 0;
  for (const [path, bytes] of result.files) {
    const file = join(contentDir, path);
    let disk: string | null = null;
    try { disk = readFileSync(file, 'utf8'); } catch { /* new */ }
    if (disk === bytes) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    changed++;
  }
  console.log(`wrote ${changed} file(s), ${result.files.size - changed} unchanged`);
  if (changed > 0) console.log(REMINDER);
  return 0;
}
