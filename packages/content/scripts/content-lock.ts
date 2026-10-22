import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, checkContentVersion, checkRulesVersion, generateHashes, loadContent, parseContentMeta, readBaselineVersion, type ContentBaseline, type ContentFiles, type HashesLock } from '../src/index.js';

import { checkBotVersion, readBotVersion } from './bot-version.js';

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
async function optionalRead(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function dataFiles(dir: string, prefix = 'data'): Promise<ContentFiles> {
  let entries;
  try { entries = await readdir(join(dir, prefix), { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const files: ContentFiles = {};
  for (const entry of entries.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await dataFiles(dir, name));
    else if (entry.isFile() && entry.name.endsWith('.json')) files[name] = await readFile(join(dir, name), 'utf8');
  }
  return files;
}
function readBaseline(dir: string, ref: string): ContentBaseline | undefined {
  const git = (...argv: string[]) => execFileSync('git', ['-C', dir, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const root = git('rev-parse', '--show-toplevel');
  const prefix = relative(root, dir).replaceAll('\\', '/');
  const path = (name: string) => prefix ? `${prefix}/${name}` : name;
  // Verify the revision first; missing history must never silently bypass the gate.
  git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
  const names = new Set(git('ls-tree', '--full-tree', '-r', '--name-only', '--end-of-options', ref, '--', path('content.json'), path('hashes.lock.json')).split('\n'));
  if (!names.has(path('content.json'))) {
    if (names.has(path('hashes.lock.json'))) {
      const lock = JSON.parse(git('show', '--end-of-options', `${ref}:${path('hashes.lock.json')}`)) as HashesLock;
      if (canonicalJson(lock) !== canonicalJson({ levels: {}, bots: {} })) throw new Error('Baseline has hashes but no content.json');
    }
    return undefined; // Pre-content revision, including 656d0ca.
  }
  if (!names.has(path('hashes.lock.json'))) throw new Error('Baseline content.json exists but hashes.lock.json is missing');
  const raw = git('show', '--end-of-options', `${ref}:${path('content.json')}`);
  const metadata = readBaselineVersion(raw);
  const hashes = JSON.parse(git('show', '--end-of-options', `${ref}:${path('hashes.lock.json')}`)) as HashesLock;
  return { metadata, hashes };
}
async function main() {
  const dir = resolve(option('--dir', fileURLToPath(new URL('..', import.meta.url))));
  const rules = await readFile(resolve(option('--rules', fileURLToPath(new URL('../../../docs/GAME_RULES.md', import.meta.url)))), 'utf8');
  const check = args.includes('--check');
  const baseline = check ? readBaseline(dir, option('--base', process.env.VERSION_GUARD_BASE || 'HEAD')) : undefined;
  const files = await dataFiles(dir);
  const metadataRaw = await optionalRead(join(dir, 'content.json'));
  if (metadataRaw === null) throw new Error('content.json missing');
  const metadata = parseContentMeta(metadataRaw);
  checkRulesVersion(rules, metadata.rulesVersion);
  const hashes: HashesLock = generateHashes(loadContent(files));
  // Check freshness before the baseline gate so stale locks receive an actionable error.
  if (check) {
    const lock = await optionalRead(join(dir, 'hashes.lock.json'));
    if (lock === null || canonicalJson(JSON.parse(lock)) !== canonicalJson(hashes)) throw new Error('hashes.lock.json is stale or missing; run pnpm content:lock');
    checkContentVersion(metadata, hashes, baseline);
    const root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    checkBotVersion(hashes.bots, baseline?.hashes.bots, readBotVersion(root), readBotVersion(root, option('--base', process.env.VERSION_GUARD_BASE || 'HEAD')));
  }
  const destination = join(dir, 'hashes.lock.json');
  if (check) {
    const lock = await optionalRead(destination);
    if (lock === null || canonicalJson(JSON.parse(lock)) !== canonicalJson(hashes)) throw new Error('hashes.lock.json is stale or missing; run pnpm content:lock');
    console.log(`Content hashes current (${Object.keys(hashes.levels).length} levels, ${Object.keys(hashes.bots).length} bots); rules/content/BOT_VERSION gates agree`);
  } else {
    await writeFile(destination, `${JSON.stringify(hashes, null, 2)}\n`);
    console.log(`Generated hashes.lock.json (${Object.keys(hashes.levels).length} levels, ${Object.keys(hashes.bots).length} bots)`);
  }
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
