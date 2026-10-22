import type { RenderKind } from '@node-arena/defs';
import type { ManifestV2 } from '@node-arena/content';
import { defaultRegistry, type RendererRegistry } from '../render/registry.js';
import { parseModelRef } from './model-ref.js';

export type Manifest = ManifestV2;
export type ManifestErrorCode = 'schema' | 'key' | 'palette' | 'path' | 'file' | 'credits' | 'budget' | 'asset';
export class ManifestError extends Error {
  constructor(public readonly code: ManifestErrorCode, public readonly key: string, message: string, options?: ErrorOptions) {
    super(`${key}: ${message}`, options); this.name = 'ManifestError';
  }
}
export class AssetError extends ManifestError {
  constructor(key: string, public readonly src: string, cause: unknown) {
    super('asset', key, `Failed to load ${src}`, { cause }); this.name = 'AssetError';
  }
}
export const PRIMITIVE_SEGMENTS = Object.freeze({ capsule: { cap: 2, radial: 6 }, cylinder: { radial: 8 } });
/** Safe relative path; a single `#node` fragment is allowed on model refs only (`allowFragment`). */
export function assertAssetPath(src: string, allowFragment = false): void {
  let file = src;
  if (allowFragment) {
    try { file = parseModelRef(src).file; } catch { throw new ManifestError('path', src, 'Invalid model ref'); }
  }
  if (!file || file.startsWith('/') || file.includes('\\') || /[:?#%\x00-\x1f]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ManifestError('path', src, 'Asset path must be a safe relative path');
  }
}
function lookup<T>(map: Record<string, T>, key: string, section: string): T {
  if (!Object.hasOwn(map, key)) throw new ManifestError('key', key, `Unresolved ${section} key`);
  return map[key]!;
}
/** Open visual kinds are validated against the renderer registry (no closed built-in sets). */
export function assertManifestReferences(m: Manifest, registry: Pick<RendererRegistry, 'has'> = defaultRegistry): void {
  for (const [key, v] of Object.entries(m.visuals)) {
    if (!registry.has(v.kind)) throw new ManifestError('key', key, `No renderer registered for kind ${v.kind}`);
    assertAssetPath(v.model.parts, true);
    for (const t of Object.values(v.team?.textures ?? {})) if (t) assertAssetPath(t);
    if (v.fx && !Object.hasOwn(m.fx, v.fx)) throw new ManifestError('key', key, `Unresolved fx ${v.fx}`);
    if (v.sfx) assertAssetPath(v.sfx);
  }
  for (const [key, t] of Object.entries(m.themes)) {
    assertAssetPath(t.ground.mesh, true); assertAssetPath(t.ground.texture); assertAssetPath(t.obstacle.texture);
    assertAssetPath(t.obstacle.small, true); assertAssetPath(t.obstacle.big, true);
    for (const f of t.fx ?? []) if (!Object.hasOwn(m.fx, f)) throw new ManifestError('key', key, `Unresolved fx ${f}`);
  }
  for (const f of Object.values(m.fx)) assertAssetPath(f.texture);
  for (const [key, e] of Object.entries(m.events)) {
    if (e.fx && !Object.hasOwn(m.fx, e.fx)) throw new ManifestError('key', key, `Unresolved fx ${e.fx}`);
    if (e.sfx) assertAssetPath(e.sfx);
  }
}
export function createManifestResolver(manifest: Manifest) {
  return {
    visual(key: string, kind?: RenderKind) {
      const visual = lookup(manifest.visuals, key, 'visual');
      if (kind && visual.kind !== kind) throw new ManifestError('key', key, `Expected kind ${kind}`);
      return { ...visual, modelRef: parseModelRef(visual.model.parts) };
    },
    theme: (key: string) => lookup(manifest.themes, key, 'theme'),
    fx: (key: string) => lookup(manifest.fx, key, 'fx'),
    color: (key: string) => lookup(manifest.palettes as Record<string, string>, key, 'palette colour'),
    event: (key: string) => Object.hasOwn(manifest.events, key) ? manifest.events[key] : undefined,
    camera: () => manifest.camera,
  };
}
