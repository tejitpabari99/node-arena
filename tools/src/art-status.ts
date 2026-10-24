// art:status — report-only to-do list of manifest file fields still pointing at original (non-`art/`) assets.
import { readFile } from 'node:fs/promises';
import type { ManifestV2 } from '@node-arena/content';

export interface ArtField { owner: string; field: string; path: string; label: 'TW' | 'stock' }
export interface ArtStatus { total: number; onArt: number; original: ArtField[] }

const isArt = (p: string): boolean => p === 'art' || p.startsWith('art/');
const labelOf = (p: string): 'TW' | 'stock' => (p.startsWith('models/tw/') || p.startsWith('textures/tw/') ? 'TW' : 'stock');

/** Every file-valued field (scalars like sky/light colours excluded), mirroring manifest-assets references(). */
function fields(m: ManifestV2): Array<{ owner: string; field: string; path: string }> {
  const out: Array<{ owner: string; field: string; path: string }> = [];
  const add = (owner: string, field: string, path: unknown): void => { if (typeof path === 'string') out.push({ owner, field, path }); };
  for (const [id, v] of Object.entries(m.visuals ?? {})) {
    add(id, 'model.parts', v.model?.parts);
    add(id, 'model.lod', v.model?.lod);
    const team = (v.team ?? {}) as { textures?: Record<string, unknown> };
    for (const [k, t] of Object.entries(team.textures ?? {})) add(id, `team.${k}`, t);
    const tint = (v.team ?? {}) as { base?: unknown; mask?: unknown };
    add(id, 'team.base', tint.base); add(id, 'team.mask', tint.mask);
  }
  for (const [id, t] of Object.entries(m.themes ?? {})) {
    const o = `theme ${id}`;
    add(o, 'ground.mesh', t.ground?.mesh); add(o, 'ground.texture', t.ground?.texture);
    add(o, 'obstacle.small', t.obstacle?.small); add(o, 'obstacle.big', t.obstacle?.big); add(o, 'obstacle.texture', t.obstacle?.texture);
  }
  for (const [id, f] of Object.entries(m.fx ?? {})) add(`fx ${id}`, 'texture', f.texture);
  for (const [id, e] of Object.entries(m.events ?? {})) add(`event ${id}`, 'sfx', e.sfx);
  return out;
}

export function artStatus(m: ManifestV2): ArtStatus {
  const all = fields(m);
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
