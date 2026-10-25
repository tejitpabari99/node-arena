// Read-only access to the Tower War extract (TW_EXTRACT). Every file read is hashed (sha256) so the lock file
// records exactly which inputs produced the committed assets. Paths are posix and relative to the extract root.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ASSETS_DIR = 'assets/defaultlocalgroup_assets';
export const SCENES_DIR = 'assets/defaultlocalgroup_scenes';

/** Integers above 2^53 (Unity pathIDs) would lose precision as numbers: keep their exact digits as strings. */
export function parseJsonExact(text: string): unknown {
  const reviver = function (this: unknown, _key: string, value: unknown, context?: { source?: string }): unknown {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source !== undefined) return context.source;
    return value;
  };
  return (JSON.parse as (t: string, r: typeof reviver) => unknown)(text, reviver);
}

export class Extract {
  /** Input path -> sha256 hex, for every file read through this object. */
  readonly inputs = new Map<string, string>();
  constructor(readonly root: string) {}

  read(rel: string): Buffer {
    const bytes = readFileSync(join(this.root, rel));
    this.inputs.set(rel, createHash('sha256').update(bytes).digest('hex'));
    return bytes;
  }
  text(rel: string): string { return this.read(rel).toString('utf8'); }
  json<T>(rel: string): T { return parseJsonExact(this.text(rel)) as T; }
  /** Sorted file names (not hashed: only file contents are inputs). */
  list(relDir: string): string[] { return readdirSync(join(this.root, relDir)).sort(); }
  exists(rel: string): boolean { try { statSync(join(this.root, rel)); return true; } catch { return false; } }
}

/** Pid -> relative OBJ path for a Mesh directory (`name_<pid>.obj` or `name_<pid>@sh.obj`). */
export function meshIndex(ex: Extract, dir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of ex.list(`${dir}/Mesh`)) {
    const m = /_(-?\d+)(?:@sh)?\.obj$/.exec(f);
    if (!m) continue;
    const pid = m[1]!;
    if (map.has(pid)) throw new Error(`duplicate mesh pid ${pid} in ${dir}/Mesh`);
    map.set(pid, `${dir}/Mesh/${f}`);
  }
  return map;
}

/** The single `<base>_<pid>.png` in a Texture2D directory. */
export function textureByName(ex: Extract, dir: string, base: string): string {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_-?\\d+\\.png$`);
  const hits = ex.list(`${dir}/Texture2D`).filter((f) => re.test(f));
  if (hits.length !== 1) throw new Error(`expected exactly one texture ${base} in ${dir}/Texture2D, found ${hits.length}`);
  return `${dir}/Texture2D/${hits[0]!}`;
}
