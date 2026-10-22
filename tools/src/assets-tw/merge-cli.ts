// `assets:manifest` / `assets:manifest --check`: merge apps/web/assets/manifest.tw.json into the single apps/web/assets/manifest.json
// (deterministic, idempotent; hand-owned parts such as palettes, camera and event sfx are kept). Needs no TW_EXTRACT.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAGMENT_PATH, mergeManifest, stringify, type Fragment } from './manifest-fragment.js';

const ASSETS = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'apps/web/assets');

/** Merged manifest text for `assetsRoot`, plus whether the committed manifest.json already equals it. */
export function mergeFiles(assetsRoot: string): { text: string; current: boolean } {
  const base = JSON.parse(readFileSync(join(assetsRoot, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const fragment = JSON.parse(readFileSync(join(assetsRoot, FRAGMENT_PATH), 'utf8')) as Fragment;
  const text = stringify(mergeManifest(base, fragment));
  return { text, current: text === readFileSync(join(assetsRoot, 'manifest.json'), 'utf8') };
}

export function main(args: readonly string[], assetsRoot: string = ASSETS): number {
  const check = args.includes('--check');
  for (const a of args) if (a !== '--check') { process.stderr.write(`Unknown option ${a}\n`); return 2; }
  if (!existsSync(join(assetsRoot, FRAGMENT_PATH))) { process.stderr.write(`assets:manifest: ${FRAGMENT_PATH} missing (run \`pnpm assets:tw\` with TW_EXTRACT)\n`); return 1; }
  const { text, current } = mergeFiles(assetsRoot);
  if (check) {
    process.stdout.write(current ? 'assets:manifest:check OK (manifest.json = base + manifest.tw.json)\n' : 'assets:manifest:check FAIL: manifest.json is not the merge of itself and manifest.tw.json; run `pnpm assets:manifest`\n');
    return current ? 0 : 1;
  }
  if (!current) writeFileSync(join(assetsRoot, 'manifest.json'), text);
  process.stdout.write(`assets:manifest: ${current ? 'already up to date' : 'wrote manifest.json'}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
