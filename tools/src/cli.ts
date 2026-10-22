import { resolve } from 'node:path';
import { validateContent, ContentLoadError } from '@node-arena/content';
import { validateManifest } from '../../apps/web/src/manifest/validate.js';
import { ManifestError } from '../../apps/web/src/manifest/resolve.js';
import { loadFiles, LocatedError, readJson, readText } from './files.js';
import { uncreditedAssets } from './credits.js';
import { checkLock } from './content.js';
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
let manifestFile = 'apps/web/assets/manifest.json';
let format: 'md' | 'json' = args[args.indexOf('--format') + 1] === 'json' ? 'json' : 'md';
async function main(): Promise<void> {
  if (!['validate:content', 'check:manifest', 'check:rules', 'replay:verify', 'validate:levels', 'balance'].includes(command)) throw new LocatedError('arguments', 'Expected validate:content, validate:levels, balance, check:manifest, check:rules or replay:verify');
  const target = command === 'replay:verify' && args[0] && !args[0].startsWith('--') ? args.shift() : undefined;
  const opts: Record<string,string> = {};
  const supported = command === 'balance' ? ['--dir', '--format', '--levels', '--proxy', '--seeds', '--jobs', '--mode', '--targets'] : command === 'validate:levels' ? ['--dir', '--base', '--format', '--levels', '--seeds'] : command === 'check:rules' ? ['--rules', '--packages-dir', '--format'] : command === 'replay:verify' ? ['--dir', '--format'] : ['--dir', '--base', '--format', '--manifest', '--assets-dir', '--credits'];
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
  if (command === 'check:rules' || command === 'replay:verify') {
    const verifyReplays = command === 'replay:verify' ? (await import('./replay.js')).verifyReplays : undefined;
    if (command === 'replay:verify' && !target) throw new LocatedError('arguments', 'replay:verify requires a file, directory or golden');
    const result = command === 'check:rules' ? await checkRules(resolve(opts['--rules'] ?? resolve(root, 'docs/GAME_RULES.md')), resolve(opts['--packages-dir'] ?? resolve(root, 'packages'))) : await verifyReplays!(target!, dir, root);
    report.summary = result.summary; report.errors.push(...result.errors); report.ok = result.errors.length === 0; return;
  }
  const files = await loadFiles(dir);
  if (command === 'balance') {
    const {balance} = await import('./balance.js');
    const {readBalanceTargets} = await import('./balance-targets.js');
    const targets = await readBalanceTargets(resolve(opts['--targets'] ?? resolve(root,'tools/balance-targets.json')), !opts['--targets']);
    report.balance = await balance(files,{levels:opts['--levels'] ?? 'all',proxy:opts['--proxy'] ?? 'reference,human-proxy,idle',seeds:Number(opts['--seeds'] ?? '200'),jobs:Number(opts['--jobs'] ?? '2'),mode:(opts['--mode'] ?? 'campaign') as 'campaign'|'arena',...(targets ? {targets} : {})});
    report.ok = true; report.summary = `${report.balance.rows.length} balance rows; ${report.balance.rows.filter(row=>row.flags.length).length} flagged.`; return;
  }
  const manifestPath = resolve(opts['--manifest'] ?? resolve(root, 'apps/web/assets/manifest.json'));
  if (opts['--manifest']) manifestFile = manifestPath;
  const manifest = command === 'check:manifest' ? await readJson(manifestPath) : undefined;
  const result = validateContent(files, manifest === undefined ? {} : { manifest: manifest as object });
  report.errors.push(...result.errors); report.warnings.push(...result.warnings);
  if (report.errors.length) return;
  if (command === 'validate:content' || command === 'validate:levels') {
    report.summary = await checkLock(files, dir, root, opts['--base'] ?? (process.env.VERSION_GUARD_BASE || 'HEAD'));
    if (command === 'validate:levels') {
      const rawSeeds = opts['--seeds'] ?? '4';
      if (!/^[1-9][0-9]*$/.test(rawSeeds)) throw new LocatedError('arguments', '--seeds must be a positive integer');
      const {validateLevels} = await import('./levels.js');
      report.levels = await validateLevels(files,root,opts['--levels'] ?? 'all',Number(rawSeeds));
      for (const level of report.levels) for (const message of level.errors) report.errors.push({file:`data/levels/${level.id}.json`,pointer:'',message});
      report.summary += ` ${report.levels.filter(level=>level.ok).length}/${report.levels.length} levels passed.`;
      if (report.errors.length) return;
    }
  }
  else {
    // Default to the repository CREDITS.md (the default path may be absent; an explicit --credits must exist).
    const credits = opts['--credits'] ? await readText(resolve(opts['--credits'])) : await readText(resolve(root, 'docs/CREDITS.md')).catch(() => '');
    const assetsDir = resolve(opts['--assets-dir'] ?? resolve(root, 'apps/web/assets'));
    await validateManifest(manifest, { assetsDir, credits });
    // Orphan files (shipped but unreferenced by the manifest) still need a licence row.
    const missing = await uncreditedAssets(assetsDir, credits);
    if (missing.length) throw new ManifestError('credits', missing[0]!, `Asset files missing from CREDITS.md: ${missing.join(', ')}`);
    report.summary = 'Content visual/theme/palette keys and manifest asset/credits/budgets valid.';
  }
  report.ok = true;
}
try { await main(); }
catch (error) {
  if (error instanceof ContentLoadError) report.errors.push(...error.errors);
  else if (error instanceof LocatedError) report.errors.push({file: error.file, pointer: error.pointer, message: error.message});
  else if (error instanceof ManifestError) report.errors.push({file: manifestFile, pointer: '', message: error.message});
  else report.errors.push({file: command, pointer: '', message: (error as Error).message});
}
emitReport(report, format);
