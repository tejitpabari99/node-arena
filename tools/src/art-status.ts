// art:status — report-only to-do list of manifest file fields still pointing at original (non-`art/`) assets.
import { readFile } from 'node:fs/promises';
import type { ManifestV2 } from '@node-arena/content';
import { fileFields } from './manifest-assets.js';

export interface ArtField { owner: string; field: string; path: string; label: 'TW' | 'stock' }
export interface ArtStatus { total: number; onArt: number; original: ArtField[] }

const isArt = (p: string): boolean => p === 'art' || p.startsWith('art/');
const labelOf = (p: string): 'TW' | 'stock' => (p.startsWith('models/tw/') || p.startsWith('textures/tw/') ? 'TW' : 'stock');

export function artStatus(m: ManifestV2): ArtStatus {
  const all = fileFields(m).map(({ owner, field, path }) => ({ owner, field, path }));
  const original = all.filter(f => !isArt(f.path)).map(f => ({ ...f, label: labelOf(f.path) }));
  return { total: all.length, onArt: all.length - original.length, original };
}

export function formatArtStatus(s: ArtStatus): string {
  const w = (k: 'owner' | 'field' | 'path'): number => Math.max(0, ...s.original.map(f => f[k].length)) + 2;
  const [o, f, p] = [w('owner'), w('field'), w('path')];
  const lines = s.original.map(x => `${x.owner.padEnd(o)}${x.field.padEnd(f)}${x.path.padEnd(p)}${x.label}`);
  lines.push(`${s.onArt} of ${s.total} fields on art/ (${s.original.length} original)`);
  return lines.join('\n');
}

export function runArtStatus(m: ManifestV2, args: string[]): number {
  const unknown = args.filter(a => a !== '--strict');
  if (unknown.length) { console.error(`Unknown option ${unknown[0]}`); return 2; }
  const s = artStatus(m);
  console.log(formatArtStatus(s));
  if (args.includes('--strict') && s.original.length) { console.log(`art:status --strict failed: ${s.original.length} original field(s) remain`); return 1; }
  return 0;
}

export async function runArtStatusFile(manifestPath: string, args: string[]): Promise<number> {
  return runArtStatus(JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestV2, args);
}
