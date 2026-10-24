// The optional art patch (`manifest.art.json`): loading + schema validation (library module; the CLI lives in merge-cli.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAjv, ManifestArtSchema } from '@node-arena/content';
import { ART_PATH } from './manifest-fragment.js';

const validateArt = createAjv().compile(JSON.parse(JSON.stringify(ManifestArtSchema)));

/** The optional art patch (`manifest.art.json`) for `assetsRoot`, schema-validated (closed whitelist, no nulls); undefined when absent. */
export function loadArt(assetsRoot: string): Record<string, unknown> | undefined {
  const file = join(assetsRoot, ART_PATH);
  if (!existsSync(file)) return undefined;
  const art = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (!validateArt(art)) throw new Error(`${ART_PATH} invalid: ${(validateArt.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params['additionalProperty'] ? ` (${String(e.params['additionalProperty'])})` : ''}`).join('; ')}`);
  return art;
}
