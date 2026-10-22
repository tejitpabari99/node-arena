import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ContentFiles } from '@node-arena/content';
export class LocatedError extends Error {
  constructor(public readonly file: string, message: string, public readonly pointer = '') { super(message); }
}
export async function readText(file: string, label = file): Promise<string> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { throw new LocatedError(label, (error as Error).message); }
}
export async function readJson(file: string, label = file): Promise<unknown> {
  const text = await readText(file, label);
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new LocatedError(label, `Invalid JSON: ${(error as Error).message}`); }
}
export async function loadFiles(dir: string): Promise<ContentFiles> {
  const files: ContentFiles = { 'content.json': await readText(resolve(dir, 'content.json'), 'content.json') };
  const root = await realpath(dir);
  async function walk(prefix: string): Promise<void> {
    const directory = await realpath(resolve(dir, prefix));
    const rel = relative(root, directory);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new LocatedError(prefix, 'Content directory escapes root');
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new LocatedError(path, 'Content symlinks are unsupported');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) files[path] = await readText(resolve(dir, path), path);
    }
  }
  await walk('data'); return files;
}
