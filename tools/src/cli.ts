import { resolve } from 'node:path';
import { validateContent, ContentLoadError, parseContentMeta } from '@node-arena/content';
import { loadFiles, LocatedError, readJson, readText } from './files.js';
import { uncreditedAssets } from './credits.js';
import { checkLock, splitFiles } from './content.js';
import { checkManifest } from './manifest.js';
import { checkRules } from './rules.js';
import { emitReport, type GateReport } from './output.js';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2); const command = args.shift() ?? '';
if (command === 'check:parked') {
  const { runParked } = await import('./parked.js');
  try { process.exitCode = await runParked(args, resolve(root, 'scripts/ci.sh')); }
  catch (error) { console.error((error as Error).message); process.exitCode = 2; }
  process.exit();
}
const report: GateReport = { command, ok: false, errors: [], warnings: [], summary: 'Validation failed.' };
const manifestFile = 'apps/web/assets/manifest.json';
let format: 'md' | 'json' = args[args.indexOf('--format') + 1] === 'json' ? 'json' : 'md';
// Gates whose implementation moved to tools/src/_parked (restored by SP06) until their owner un-parks them.
const PARKED_COMMANDS: Record<string, string> = { 'replay:verify': 'SP06', 'validate:levels': 'SP06', balance: 'SP06' };
async function main(): Promise<void> {
  if (command in PARKED_COMMANDS) throw new LocatedError('arguments', `${command} is parked until ${PARKED_COMMANDS[command]} (implementation in tools/src/_parked)`);
  if (!['validate:content', 'check:manifest', 'check:rules'].includes(command)) throw new LocatedError('arguments', 'Expected validate:content, check:manifest or check:rules');
  const opts: Record<string,string> = {};
  const supported = command === 'check:rules' ? ['--rules', '--packages-dir', '--format'] : ['--dir', '--base', '--format', '--manifest', '--assets-dir', '--credits'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!; const value = args[i + 1];
    if (!supported.includes(key)) throw new LocatedError('arguments', `Unknown option ${key}`);
    if (!value || value.startsWith('--')) throw new LocatedError('arguments', `${key} requires a value`);
    if (key in opts) throw new LocatedError('arguments', `Duplicate option ${key}`);
    opts[key] = value;
  }
  if (opts['--format'] && !['md','json'].includes(opts['--format'])) throw new LocatedError('arguments', '--format must be md or json');
  format = opts['--format'] === 'json' ? 'json' : 'md';
  const dir = resolve(opts['--dir'] ?? resolve(root, 'packages/content'));
  if (command === 'check:rules') {
    const result = await checkRules(resolve(opts['--rules'] ?? resolve(root, 'docs/GAME_RULES.md')), resolve(opts['--packages-dir'] ?? resolve(root, 'packages')));
    report.summary = result.summary; report.errors.push(...result.errors); report.ok = result.errors.length === 0; return;
  }
  const files = await loadFiles(dir);
  const { meta, data } = splitFiles(files);
  parseContentMeta(meta);
  const result = validateContent(data);
  report.errors.push(...result.errors); report.warnings.push(...result.warnings);
  if (report.errors.length) return;
  if (command === 'validate:content') {
    report.summary = await checkLock(files, dir, root, opts['--base'] ?? (process.env.VERSION_GUARD_BASE || 'HEAD'));
  }
  else {
    // Manifest validation lives in @node-arena/content (schema + cross-checks); SP07 adds the v2 asset/budget checks.
    const manifestPath = resolve(opts['--manifest'] ?? resolve(root, manifestFile));
    const issues = checkManifest(await readJson(manifestPath), result.content!);
    if (issues.length) { report.errors.push(...issues.map(issue => ({ ...issue, file: manifestPath }))); return; }
    // Default to the repository CREDITS.md (the default path may be absent; an explicit --credits must exist).
    const credits = opts['--credits'] ? await readText(resolve(opts['--credits'])) : await readText(resolve(root, 'docs/CREDITS.md')).catch(() => '');
    const assetsDir = resolve(opts['--assets-dir'] ?? resolve(root, 'apps/web/assets'));
    const missing = await uncreditedAssets(assetsDir, credits);
    if (missing.length) throw new LocatedError(manifestPath, `Asset files missing from CREDITS.md: ${missing.join(', ')}`);
    report.summary = 'Manifest schema, content cross-checks and credits valid.';
  }
  report.ok = true;
}
try { await main(); }
catch (error) {
  if (error instanceof ContentLoadError) report.errors.push(...error.errors);
  else if (error instanceof LocatedError) report.errors.push({file: error.file, pointer: error.pointer, message: error.message});
  else report.errors.push({file: command, pointer: '', message: (error as Error).message});
}
emitReport(report, format);
