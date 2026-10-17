import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LocatedError } from './files.js';

const excluded = new Set(['node_modules', 'dist', '.git', '.worktrees', 'coverage', 'test-results', 'playwright-report']);
/** Stable traversal never follows symlinks or generated/dependency directories. */
export async function walkFiles(path: string, include: (file: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  async function walk(file: string): Promise<void> {
    try {
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new LocatedError(file, 'Symlinks are unsupported');
      if (stat.isDirectory()) {
        for (const entry of (await readdir(file)).sort()) if (!excluded.has(entry)) await walk(join(file, entry));
      } else if (stat.isFile() && include(file)) files.push(file);
    } catch (error) {
      if (error instanceof LocatedError) throw error;
      throw new LocatedError(file, (error as Error).message);
    }
  }
  await walk(path); return files;
}
