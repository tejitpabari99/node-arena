// `import:tw` / `check:import` (PRD 05 R5). Never touches content.json or the lock; prints the reminder instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { requireTwExtract, twExtractRoot } from './env.js';
import { defaultContentDir, runImport, type ImportResult } from './run.js';

export const REMINDER = 'Reminder: run `pnpm content:lock` and bump `contentVersion` in packages/content/content.json (importer never edits either).';

export interface Parsed { /** undefined = default (4-23 to import; the whole committed campaign to check). */ range?: [number, number]; only: string[]; skipBlocked: boolean; check: boolean }

export function parseArgs(args: readonly string[]): Parsed {
  const p: Parsed = { only: [], skipBlocked: false, check: false };
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

const q = (v: unknown): string => JSON.stringify(v);

export function report(r: ImportResult): string[] {
  const out = [`levels: ${r.rows.length} considered, ${r.rows.length - r.blocked.length} importable, ${r.blocked.length} blocked`];
  // ids / reasons come from the extract: quote them so control characters cannot forge report lines
  for (const b of r.blocked) out.push(`BLOCKED ${q(b.id)} (position ${b.position}): ${b.reasons.map(q).join('; ')}`);
  for (const row of r.rows) {
    if (!row.result.level) continue;
    if (row.result.gate.dropped.length) out.push(`dropped ${q(row.slug)}: ${row.result.gate.dropped.map(q).join(', ')}`);
    if (row.result.inactiveIds.length) out.push(`inactive obstacle children ${q(row.slug)}: ${row.result.inactiveIds.length} (${row.result.inactiveIds.join(', ')})`);
    if (row.result.outside.length) out.push(`out of bounds ${q(row.slug)}: ${row.result.outside.length} (${row.result.outside.join(', ')})`);
  }
  out.push(`campaign common: ${r.campaign.length} entries${r.campaign.length ? '' : ' (not written)'}`);
  for (const f of r.orphans) out.push(`ORPHAN ${q(f)}: not produced by the importer and not hand-authored`);
  return out;
}

/** Absolute target inside contentDir, or throws (never write outside the content package). */
export function safeTarget(contentDir: string, path: string): string {
  const root = resolve(contentDir);
  const file = resolve(root, path);
  const rel = relative(root, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`refusing to write outside the content dir: ${q(path)}`);
  return file;
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
    result = await runImport({ extractRoot, contentDir, ...(parsed.range ? { range: parsed.range } : {}), only: parsed.only, skipBlocked: parsed.skipBlocked, check });
  } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return 2; }
  for (const line of report(result)) console.log(line);
  try {
    return write(result, contentDir, check);
  } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return 2; }
}

function write(result: ImportResult, contentDir: string, check: boolean): number {
  if (check) {
    const stale: string[] = [];
    for (const [path, bytes] of result.files) {
      let disk: string | null = null;
      try { disk = readFileSync(join(contentDir, path), 'utf8'); } catch { /* missing */ }
      if (disk !== bytes) stale.push(`${path}${disk === null ? ' (missing)' : ''}`);
    }
    for (const f of result.orphans) stale.push(`${f} (orphan: not produced by the importer, not hand-authored)`);
    if (stale.length) { console.error(`check:import: out of date: ${stale.join(', ')}`); return 1; }
    console.log(`check:import: ${result.files.size} files up to date`);
    return 0;
  }
  let changed = 0;
  for (const path of result.files.keys()) safeTarget(contentDir, path); // validate every target before writing any
  for (const [path, bytes] of result.files) {
    const file = safeTarget(contentDir, path);
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
