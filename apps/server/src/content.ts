import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RULES_VERSION, listPvpMaps, loadContent, parseContentMeta, type CompiledLevel, type ContentFiles, type LoadedContent } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import type { Versions } from '@node-arena/net';

export interface ServerContent {
  loaded: LoadedContent;
  /** Compiled levels, deep-frozen; shared read-only across rooms. */
  compiled: Readonly<Record<string, CompiledLevel>>;
  /** Every level with `objective === 'pvp'`: pvp.json order first (default = first), then others by id. */
  pvpLevelIds: readonly string[];
  /** Exactly what `checkHello` compares. */
  versions: Versions;
}

export interface LoadServerContentOpts {
  /** Test-only: extra level JSON strings, keyed by level id (added as `data/levels/<id>.json`). */
  extraLevels?: Record<string, string>;
}

function walk(dir: string, base: string, out: ContentFiles): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${ent.name}`;
    if (ent.isDirectory()) walk(join(dir, ent.name), rel, out);
    else if (ent.name.endsWith('.json')) out[rel] = readFileSync(join(dir, ent.name), 'utf8');
  }
}

/** Same key shape as web's `contentFiles()`: `data/<...>.json` -> raw string. */
export function readContentFiles(contentDir: string): ContentFiles {
  const files: ContentFiles = {};
  walk(contentDir, 'data', files);
  return files;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function readMeta(contentDir: string): string {
  for (const p of [join(contentDir, 'content.json'), join(dirname(contentDir), 'content.json')]) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(`content.json not found in ${contentDir} or its parent`);
}

/** Throws on any read/validation error; the boot helper turns that into exit 1. */
export function loadServerContent(contentDir: string, opts: LoadServerContentOpts = {}): ServerContent {
  const files = readContentFiles(contentDir);
  for (const [id, src] of Object.entries(opts.extraLevels ?? {})) files[`data/levels/${id}.json`] = src;
  const loaded = loadContent(files);
  const meta = parseContentMeta(readMeta(contentDir));
  const compiled = deepFreeze(loaded.compiled);
  // Shipped maps in campaigns/pvp.json order (first = default room level), then any other pvp level (test fixtures) by id.
  const shipped = listPvpMaps(loaded).map((m) => m.id);
  const pvpLevelIds = [...shipped, ...Object.values(compiled).filter((l) => l.objective === 'pvp' && !shipped.includes(l.id)).map((l) => l.id).sort()];
  return {
    loaded, compiled, pvpLevelIds: Object.freeze(pvpLevelIds),
    versions: { rules: RULES_VERSION, schema: meta.schemaVersion, content: meta.contentVersion, bot: BOT_VERSION },
  };
}

export function loadServerContentOrExit(
  contentDir: string,
  exit: (code: number) => never = (c) => process.exit(c),
  err: (msg: string) => void = (m) => process.stderr.write(`${m}\n`),
  opts: LoadServerContentOpts = {},
): ServerContent {
  try {
    return loadServerContent(contentDir, opts);
  } catch (e) {
    err(`Content load failed: ${e instanceof Error ? `${e.message}${'errors' in e ? ` ${JSON.stringify((e as { errors: unknown }).errors)}` : ''}` : String(e)}`);
    return exit(1);
  }
}
