// `assets:manifest` / `assets:manifest --check`: merge apps/web/assets/manifest.tw.json into the single apps/web/assets/manifest.json
// (deterministic, idempotent; hand-owned parts such as palettes, camera and event sfx are kept). Needs no TW_EXTRACT.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAjv, ManifestArtSchema } from '@node-arena/content';
import { ART_PATH, FRAGMENT_PATH, mergeManifest, stringify, type Fragment } from './manifest-fragment.js';

const ASSETS = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'apps/web/assets');

const validateArt = createAjv().compile(JSON.parse(JSON.stringify(ManifestArtSchema)));

/** The optional art patch (`manifest.art.json`) for `assetsRoot`, schema-validated (closed whitelist, no nulls); undefined when absent. */
export function loadArt(assetsRoot: string): Record<string, unknown> | undefined {
  const file = join(assetsRoot, ART_PATH);
  if (!existsSync(file)) return undefined;
  const art = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (!validateArt(art)) throw new Error(`${ART_PATH} invalid: ${(validateArt.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params['additionalProperty'] ? ` (${String(e.params['additionalProperty'])})` : ''}`).join('; ')}`);
  return art;
}

/** Merged manifest text for `assetsRoot`, plus whether the committed manifest.json already equals it. */
export function mergeFiles(assetsRoot: string): { text: string; current: boolean } {
  const base = JSON.parse(readFileSync(join(assetsRoot, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const fragment = JSON.parse(readFileSync(join(assetsRoot, FRAGMENT_PATH), 'utf8')) as Fragment;
  const text = stringify(mergeManifest(base, fragment, loadArt(assetsRoot)));
  return { text, current: text === readFileSync(join(assetsRoot, 'manifest.json'), 'utf8') };
}

export function main(args: readonly string[], assetsRoot: string = ASSETS): number {
  const check = args.includes('--check');
  for (const a of args) if (a !== '--check') { process.stderr.write(`Unknown option ${a}\n`); return 2; }
  if (!existsSync(join(assetsRoot, FRAGMENT_PATH))) { process.stderr.write(`assets:manifest: ${FRAGMENT_PATH} missing (run \`pnpm assets:tw\` with TW_EXTRACT)\n`); return 1; }
  const world = mergeFiles(assetsRoot);
  // SP08 has a separate presentation namespace: the closed world manifest schema has no UI fields.
  const uiFragment = join(assetsRoot, 'manifest.ui.json');
  const uiPath = join(assetsRoot, 'ui/manifest.json');
  const uiText = existsSync(uiFragment) ? stringify(JSON.parse(readFileSync(uiFragment, 'utf8'))) : undefined;
  const uiCurrent = uiText === undefined || (existsSync(uiPath) && readFileSync(uiPath, 'utf8') === uiText);
  const { text } = world;
  const current = world.current && uiCurrent;
  if (check) {
    process.stdout.write(current ? 'assets:manifest:check OK (world + optional UI fragments)\n' : 'assets:manifest:check FAIL: world or UI manifest differs from its fragment; run `pnpm assets:manifest`\n');
    return current ? 0 : 1;
  }
  if (!world.current) writeFileSync(join(assetsRoot, 'manifest.json'), text);
  if (!uiCurrent && uiText !== undefined) {
    mkdirSync(dirname(uiPath), { recursive: true });
    writeFileSync(uiPath, uiText);
  }
  process.stdout.write(`assets:manifest: ${current ? 'already up to date' : 'wrote manifest.json'}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
