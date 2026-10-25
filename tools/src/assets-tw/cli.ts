// `assets:tw` / `assets:tw:check` (PRD 07 R3). Both skip cleanly (exit 0) when TW_EXTRACT is unset: regeneration needs the source extract.
//   TW_EXTRACT=/path/to/_extract pnpm --filter @node-arena/tools assets:tw          regenerate committed assets + lock
//   TW_EXTRACT=/path/to/_extract pnpm --filter @node-arena/tools assets:tw:check    regenerate to a temp dir, byte-diff vs committed
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { twExtractRoot } from '../import-tw/env.js';
import { main as mergeMain } from './merge-cli.js';
import { runImport, type ImportResult } from './run.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../../..');
export const ASSETS_ROOT = join(REPO, 'apps/web/assets');
export const LOCK_FILE = join(REPO, 'tools/assets/tw-extract.lock.json');
/** Directories wholly owned by the importer: files in them that the importer did not produce are stale. */
export const OWNED_DIRS = ['models/tw', 'textures/tw'] as const;
export const SKIP_MESSAGE = 'TW_EXTRACT is not set (or not a directory); skipping (needs the Tower War extract).';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 12);

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).split('\\').join('/')]);
}

export function writeResult(r: ImportResult, assetsRoot: string, lockFile: string, pruneStale: boolean): void {
  if (pruneStale) {
    for (const d of OWNED_DIRS) for (const f of walk(join(assetsRoot, d), assetsRoot)) if (!r.files.has(f)) rmSync(join(assetsRoot, f), { force: true });
  }
  for (const [p, bytes] of r.files) {
    const file = join(assetsRoot, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, r.lock);
}

/** Differences between a fresh result and what is on disk; empty = byte-identical. */
export function diffResult(r: ImportResult, assetsRoot: string, lockFile: string): string[] {
  const problems: string[] = [];
  for (const [p, bytes] of r.files) {
    const file = join(assetsRoot, p);
    if (!existsSync(file)) { problems.push(`missing: ${p}`); continue; }
    const disk = readFileSync(file);
    if (Buffer.compare(disk, Buffer.from(bytes)) !== 0) problems.push(`differs: ${p} (committed ${sha(disk)}, regenerated ${sha(bytes)})`);
  }
  for (const d of OWNED_DIRS) for (const f of walk(join(assetsRoot, d), assetsRoot)) if (!r.files.has(f)) problems.push(`stale (not produced by importer): ${f}`);
  if (!existsSync(lockFile)) problems.push('missing: tools/assets/tw-extract.lock.json');
  else if (readFileSync(lockFile, 'utf8') !== r.lock) problems.push('differs: tools/assets/tw-extract.lock.json');
  return problems;
}

export async function main(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const check = args.includes('--check');
  for (const a of args) if (a !== '--check') { process.stderr.write(`Unknown option ${a}\n`); return 2; }
  const root = twExtractRoot(env);
  if (root === null || !existsSync(root) || !statSync(root).isDirectory()) {
    process.stdout.write(`${check ? 'assets:tw:check' : 'assets:tw'}: ${SKIP_MESSAGE}\n`);
    return 0;
  }
  const result = await runImport(root);
  const total = [...result.files.values()].reduce((n, b) => n + b.length, 0);
  if (!check) {
    writeResult(result, ASSETS_ROOT, LOCK_FILE, true);
    if (mergeMain([], ASSETS_ROOT) !== 0) return 1; // fold manifest.tw.json into manifest.json
    process.stdout.write(`assets:tw: wrote ${result.files.size} files (${total} bytes) + tw-extract.lock.json\n`);
    return 0;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'assets-tw-'));
  try {
    writeResult(result, join(tmp, 'assets'), join(tmp, 'tw-extract.lock.json'), false);
    // Compare the temp copy (what a clean run writes) with the committed tree.
    const fresh: ImportResult = {
      files: new Map(walk(join(tmp, 'assets')).map((p) => [p, readFileSync(join(tmp, 'assets', p))])),
      lock: readFileSync(join(tmp, 'tw-extract.lock.json'), 'utf8'),
    };
    const problems = diffResult(fresh, ASSETS_ROOT, LOCK_FILE);
    if (problems.length) {
      process.stdout.write(`assets:tw:check: FAIL\n${problems.map((p) => `  ${p}`).join('\n')}\nRun \`pnpm assets:tw\` and commit the result.\n`);
      return 1;
    }
    process.stdout.write(`assets:tw:check: OK (${fresh.files.size} files byte-identical, lock identical)\n`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; });
}
