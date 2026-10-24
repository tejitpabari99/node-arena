import { resolve } from 'node:path';
import { validateContent, ContentLoadError, parseContentMeta } from '@node-arena/content';
import { loadFiles, LocatedError, readJson, readText } from './files.js';
import { uncreditedAssets } from './credits.js';
import { checkLock, splitFiles } from './content.js';
import { checkManifest } from './manifest.js';
import { checkManifestAssets } from './manifest-assets.js';
import { artErrors } from './assets-tw/art-patch.js';
import { checkRules } from './rules.js';
import { emitReport, type GateReport } from './output.js';
import { writeFile } from 'node:fs/promises';
import { PARKED_COMMANDS } from './parked-commands.js';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2); const command = args.shift() ?? '';
if (command === 'check:parked') {
  const { runParked } = await import('./parked.js');
  try { process.exitCode = await runParked(args, resolve(root, 'scripts/ci.sh')); }
  catch (error) { console.error((error as Error).message); process.exitCode = 2; }
  process.exit();
}
if (command === 'art:status') {
  const { runArtStatusFile } = await import('./art-status.js');
  try { process.exitCode = await runArtStatusFile(resolve(root, 'apps/web/assets/manifest.json'), args); }
  catch (error) { console.error((error as Error).message); process.exitCode = 2; }
  process.exit();
}
if (command === 'import:tw' || command === 'check:import') process.exit(await (await import('./import-tw/cli.js')).run(command, args));
const report: GateReport = { command, ok: false, errors: [], warnings: [], summary: 'Validation failed.' };
const manifestFile = 'apps/web/assets/manifest.json';
let format: 'md' | 'json' = args[args.indexOf('--format') + 1] === 'json' ? 'json' : 'md';
async function main(): Promise<void> {
  if (command in PARKED_COMMANDS) throw new LocatedError('arguments', `${command} is parked until ${PARKED_COMMANDS[command]} (implementation in tools/src/_parked)`);
  if (!['validate:content', 'validate:levels', 'levels:lock', 'balance', 'check:manifest', 'check:rules', 'replay:verify', 'check:docs'].includes(command)) throw new LocatedError('arguments', 'Expected validate:content, validate:levels, levels:lock, balance, check:manifest, check:rules, replay:verify or check:docs');
  const target = command === 'replay:verify' && args[0] && !args[0].startsWith('--') ? args.shift() : undefined;
  const opts: Record<string,string> = {};
  const supported = command === 'check:docs' ? ['--dir', '--format'] : command === 'balance' ? ['--dir', '--format', '--levels', '--proxy', '--seeds', '--jobs', '--mode'] : command === 'validate:levels' ? ['--dir', '--base', '--format', '--levels', '--seeds', '--max-ticks', '--lock', '--unsolved'] : command === 'levels:lock' ? ['--dir', '--format', '--lock', '--unsolved', '--max-ticks', '--levels'] : command === 'check:rules' ? ['--rules', '--packages-dir', '--format'] : command === 'replay:verify' ? ['--dir', '--format'] : ['--dir', '--base', '--format', '--manifest', '--assets-dir', '--credits', '--lock'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!; const value = args[i + 1];
    if (!supported.includes(key)) throw new LocatedError('arguments', `Unknown option ${key}`);
    if (!value || value.startsWith('--')) throw new LocatedError('arguments', `${key} requires a value`);
    if (key in opts) throw new LocatedError('arguments', `Duplicate option ${key}`);
    opts[key] = value;
  }
  if (opts['--format'] && !['md','json'].includes(opts['--format'])) throw new LocatedError('arguments', '--format must be md or json');
  format = opts['--format'] === 'json' ? 'json' : 'md';
  if (command === 'check:docs') {
    const { checkDocs } = await import('./docs-check.js');
    const result = await checkDocs(resolve(opts['--dir'] ?? root));
    report.summary = result.summary; report.errors.push(...result.errors); report.ok = result.errors.length === 0; return;
  }
  const dir = resolve(opts['--dir'] ?? resolve(root, 'packages/content'));
  if (command === 'check:rules') {
    const result = await checkRules(resolve(opts['--rules'] ?? resolve(root, 'docs/GAME_RULES.md')), resolve(opts['--packages-dir'] ?? resolve(root, 'packages')));
    report.summary = result.summary; report.errors.push(...result.errors); report.ok = result.errors.length === 0; return;
  }
  if (command === 'replay:verify') {
    if (!target) throw new LocatedError('arguments', 'replay:verify requires a file, directory or golden');
    const { verifyReplays } = await import('./replay.js');
    const result = await verifyReplays(target, dir, root);
    report.summary = result.summary; report.errors.push(...result.errors); report.ok = result.errors.length === 0; return;
  }
  const files = await loadFiles(dir);
  const { meta, data } = splitFiles(files);
  parseContentMeta(meta);
  const result = validateContent(data);
  report.errors.push(...result.errors); report.warnings.push(...result.warnings);
  if (report.errors.length) return;
  const positive = (key: string, dflt: string): number => {
    const raw = opts[key] ?? dflt;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new LocatedError('arguments', `${key} must be a positive integer`);
    return Number(raw);
  };
  if (command === 'balance') {
    const { balance } = await import('./balance.js');
    report.balance = await balance(data, meta, { levels: opts['--levels'] ?? 'all', ...(opts['--proxy'] ? { proxy: opts['--proxy'] } : {}), seeds: positive('--seeds', '20'), jobs: positive('--jobs', '2'), mode: (opts['--mode'] ?? 'campaign') as 'campaign' | 'arena' });
    report.ok = true; report.summary = `${report.balance.rows.length} balance rows (report only, no targets).`; return;
  }
  if (command === 'validate:levels' || command === 'levels:lock') {
    const { validateLevels, buildLock, checkLevelsLock, parseLevelsLock, DEFAULT_MAX_TICKS } = await import('./levels.js');
    const { readUnsolved } = await import('./unsolved.js');
    const lockPath = resolve(opts['--lock'] ?? resolve(root, 'tools/levels-lock.json'));
    const unsolved = await readUnsolved(resolve(opts['--unsolved'] ?? resolve(root, 'tools/unsolved-by-proxy.json')));
    const maxTicks = positive('--max-ticks', String(DEFAULT_MAX_TICKS));
    if (command === 'levels:lock') {
      const selected = opts['--levels'] ?? 'all';
      const previous = selected === 'all' ? {} : parseLevelsLock(await readJson(lockPath, 'tools/levels-lock.json'));
      report.levels = validateLevels(data, unsolved, selected, 1, maxTicks);
      const broken = report.levels.filter(level => !level.deterministic || level.errors.some(e => /rejected|rerun|Idle/.test(e)));
      for (const level of broken) report.errors.push({ file: `data/levels/${level.id}.json`, pointer: '', message: level.errors.join('; ') });
      if (broken.length) return;
      await writeFile(lockPath, `${JSON.stringify({ ...previous, ...buildLock(report.levels) }, null, 2)}\n`);
      report.summary = `Wrote ${lockPath} (${report.levels.length} levels, seed 1).`; report.ok = true; return;
    }
    report.summary = await checkLock(files, dir, root, opts['--base'] ?? (process.env.VERSION_GUARD_BASE || 'HEAD'));
    const seeds = positive('--seeds', '4');
    report.levels = validateLevels(data, unsolved, opts['--levels'] ?? 'all', seeds, maxTicks);
    for (const level of report.levels) {
      for (const message of level.errors) report.errors.push({ file: `data/levels/${level.id}.json`, pointer: '', message });
      for (const message of level.warnings) report.warnings.push({ file: `data/levels/${level.id}.json`, pointer: '', message });
    }
    const lock = parseLevelsLock(await readJson(lockPath, 'tools/levels-lock.json'));
    for (const message of checkLevelsLock(report.levels, lock)) report.errors.push({ file: 'tools/levels-lock.json', pointer: '', message });
    report.summary += ` ${report.levels.filter(level => level.ok).length}/${report.levels.length} levels passed (${seeds} seeds); ${report.levels.filter(level => !level.solvable).length} unsolved by proxy.`;
    if (report.errors.length) return;
    report.ok = true; return;
  }
  if (command === 'validate:content') {
    report.summary = await checkLock(files, dir, root, opts['--base'] ?? (process.env.VERSION_GUARD_BASE || 'HEAD'));
  }
  else {
    // Manifest validation lives in @node-arena/content (schema + cross-checks); SP07 adds the v2 asset/budget checks.
    const manifestPath = resolve(opts['--manifest'] ?? resolve(root, manifestFile));
    const manifest = await readJson(manifestPath);
    const issues = checkManifest(manifest, result.content!);
    const assetsDir = resolve(opts['--assets-dir'] ?? resolve(root, 'apps/web/assets'));
    if (issues.length) {
      // Art patch errors are the likelier cause of schema issues; report them too (checkManifestAssets below would otherwise be skipped).
      report.errors.push(...issues.map(issue => ({ ...issue, file: manifestPath })), ...artErrors(assetsDir).map(message => ({ file: manifestPath, pointer: '', message })));
      return;
    }
    // Asset files, lock hashes of committed outputs (no TW_EXTRACT needed), budgets, textures, fragment merge. A custom --assets-dir skips the repo lock unless --lock is given.
    const lockPath = opts['--lock'] ? resolve(opts['--lock']) : opts['--assets-dir'] ? undefined : resolve(root, 'tools/assets/tw-extract.lock.json');
    const assetWarnings: string[] = [];
    const assetIssues = await checkManifestAssets(manifest as Parameters<typeof checkManifestAssets>[0], assetsDir, lockPath, assetWarnings);
    report.warnings.push(...assetWarnings.map(message => ({ file: manifestPath, pointer: '', message })));
    if (assetIssues.length) { report.errors.push(...assetIssues.map(message => ({ file: manifestPath, pointer: '', message }))); return; }
    // Default to the repository CREDITS.md (the default path may be absent; an explicit --credits must exist).
    const credits = opts['--credits'] ? await readText(resolve(opts['--credits'])) : await readText(resolve(root, 'docs/CREDITS.md')).catch(() => '');
    const missing = await uncreditedAssets(assetsDir, credits);
    // Owner-made art needs no credit (R6/D8): uncredited files warn, never fail.
    if (missing.length) report.warnings.push({ file: manifestPath, pointer: '', message: `Asset files missing from CREDITS.md: ${missing.join(', ')}` });
    report.summary = 'Manifest schema, content cross-checks, asset files/hashes/budgets valid (credits warn only).';
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
