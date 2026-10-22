import { readFileSync, readdirSync } from 'node:fs';
import type { ContentFiles } from '../src/index.js';

const root = new URL('../', import.meta.url);
/** Real authored dataset as parsed, mutable objects: `content.json` plus `data/**` (path-keyed). */
export function hashFixture(): Record<string, any> {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8')) as object;
  const files: Record<string, any> = { 'content.json': read('content.json'), 'data/balance.json': read('data/balance.json') };
  for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
    for (const name of readdirSync(new URL(`data/${dir}/`, root)).sort()) files[`data/${dir}/${name}`] = read(`data/${dir}/${name}`);
  }
  return files;
}
/** The catalog-loadable subset (`content.json` is metadata, not a catalog file). */
export const dataOnly = (files: Record<string, any>): ContentFiles =>
  Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('data/')));
