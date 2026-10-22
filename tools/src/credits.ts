import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isCredited } from '@node-arena/content';
/** Shipped asset folders whose every file must have a CREDITS.md row, even when no manifest key references it. */
export const CREDITED_DIRS = ['models', 'textures', 'fx', 'audio', 'fonts'] as const;
async function walk(base: string, prefix: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(resolve(base, prefix), { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(base, path)); else if (entry.isFile() && !entry.name.startsWith('.')) out.push(path);
  }
  return out;
}
/** Asset files on disk (models/, audio/) with no CREDITS.md row. */
export async function uncreditedAssets(assetsDir: string, credits: string): Promise<string[]> {
  const files = (await Promise.all(CREDITED_DIRS.map(dir => walk(assetsDir, dir)))).flat();
  return files.filter(file => !isCredited(file, credits));
}
