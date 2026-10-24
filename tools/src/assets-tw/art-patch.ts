// The optional art patch (`manifest.art.json`): loading + schema validation (library module; the CLI lives in merge-cli.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAjv, ManifestArtSchema } from '@node-arena/content';
import { ART_PATH, FRAGMENT_PATH, type Fragment } from './manifest-fragment.js';

/** Art-owned manifest paths live under this prefix; exempt from the importer lock walk. */
export const ART_DIR = 'art';
/** Directories wholly produced by `assets:tw` (every file must be in the lock's `outputs`). */
export const OWNED = ['models/tw', 'textures/tw', 'fx'] as const;

const validateArt = createAjv().compile(JSON.parse(JSON.stringify(ManifestArtSchema)));

/** The optional art patch (`manifest.art.json`) for `assetsRoot`, schema-validated (closed whitelist, no nulls); undefined when absent. */
export function loadArt(assetsRoot: string): Record<string, unknown> | undefined {
  const file = join(assetsRoot, ART_PATH);
  if (!existsSync(file)) return undefined;
  const art = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (!validateArt(art)) throw new Error(`${ART_PATH} invalid: ${(validateArt.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params['additionalProperty'] ? ` (${String(e.params['additionalProperty'])})` : ''}`).join('; ')}`);
  return art;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every leaf (scalar or array) of an art patch as a key path; objects recurse. */
function leaves(v: unknown, at: string[] = []): Array<{ at: string[]; value: unknown }> {
  if (!isObj(v)) return [{ at, value: v }];
  return Object.entries(v).flatMap(([k, c]) => (at.length === 0 && (k === '$schema' || k === 'schemaVersion') ? [] : leaves(c, [...at, k])));
}
const hasPath = (root: unknown, at: string[]): boolean => at.every((k) => { if (!isObj(root) || !Object.hasOwn(root, k)) return false; root = root[k]; return true; });

const PATH_KEYS = new Set(['parts', 'lod', 'base', 'mask', 'texture', 'mesh', 'small', 'big', 'sfx']);
const MODEL_REF_KEYS = new Set(['parts', 'lod', 'mesh', 'small', 'big']);
/** Mirrors apps/web assertAssetPath: a safe relative path (no `..`/`.`/empty segment, leading `/`, `\\`, `:?#%` or control chars). */
const unsafePath = (p: string): boolean => !p || p.startsWith('/') || p.includes('\\') || /[:?#%\x00-\x1f]/.test(p) || p.split('/').some((part) => !part || part === '.' || part === '..');

/** Art patch rules: safe paths, no references into importer-owned dirs, and every patched field must still exist in the importer output. */
export function checkArt(art: Obj, fragment: Fragment): string[] {
  const errors: string[] = [];
  // A `visuals.<id>.team` patch whose `mode` differs from the importer's replaces the whole team object (see deepMerge), so the target is
  // `team` itself and its leaves (e.g. tintMask `base`/`mask`) have no importer counterpart.
  const switched: string[][] = [];
  for (const [id, v] of Object.entries((art['visuals'] ?? {}) as Obj)) {
    const team = isObj(v) ? v['team'] : undefined;
    const base = (fragment.visuals as Record<string, unknown>)[id];
    const baseTeam = isObj(base) ? base['team'] : undefined;
    if (isObj(team) && typeof team['mode'] === 'string' && (!isObj(baseTeam) || team['mode'] !== baseTeam['mode'])) switched.push(['visuals', id, 'team']);
  }
  const under = (at: string[], prefix: string[]): boolean => prefix.every((k, i) => at[i] === k);
  for (const prefix of switched) if (!hasPath(fragment, prefix)) errors.push(`art: ${prefix.join('.')} targets a field the importer no longer produces`);
  // A visual/theme/fx id the importer does not produce is one error naming the patch, not one per field (a partial entry would corrupt manifest.json).
  const unknown = new Set<string>();
  for (const section of ['visuals', 'themes', 'fx']) {
    for (const id of Object.keys((art[section] ?? {}) as Obj)) if (!hasPath(fragment, [section, id])) unknown.add(`${section}.${id}`);
  }
  for (const u of unknown) errors.push(`art: ${u} is not a ${u.startsWith('visuals.') ? 'visual' : u.startsWith('themes.') ? 'theme' : 'fx entry'} the importer produces (${ART_PATH})`);
  for (const { at, value } of leaves(art)) {
    if (at.length > 1 && unknown.has(`${at[0]}.${at[1]}`)) continue;
    const name = at.join('.');
    const last = at[at.length - 1] ?? '';
    if (typeof value === 'string' && (PATH_KEYS.has(last) || at.includes('textures'))) {
      const file = MODEL_REF_KEYS.has(last) ? value.split('#')[0]! : value;
      if (unsafePath(file)) { errors.push(`art: ${name} is not a safe relative path (${value})`); continue; }
    }
    if (typeof value === 'string') {
      const dir = OWNED.find((d) => value.startsWith(`${d}/`));
      if (dir) errors.push(`art: ${name} points into importer-owned ${dir}/ (${value}); art files must live under ${ART_DIR}/`);
    }
    // events: only `sfx` is patchable and comes from importer defaults (art may add custom events), so there is no fragment target.
    if (switched.some((p) => under(at, p))) continue;
    if (at[0] !== 'events' && !hasPath(fragment, at)) errors.push(`art: ${name} targets a field the importer no longer produces`);
  }
  return errors;
}

/** Art patch errors for `assetsRoot` (none when there is no patch or no fragment to check it against). */
export function artErrors(assetsRoot: string): string[] {
  const art = loadArt(assetsRoot);
  const file = join(assetsRoot, FRAGMENT_PATH);
  return art && existsSync(file) ? checkArt(art, JSON.parse(readFileSync(file, 'utf8')) as Fragment) : [];
}
