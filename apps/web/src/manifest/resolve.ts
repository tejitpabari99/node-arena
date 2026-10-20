import type { CompiledLevel, Manifest } from '@node-arena/content';

export type LevelVisual = NonNullable<Manifest['levelVisuals']>[string];
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
/** Renderer effect implementations register by these generic identifiers. */
export const BUILTIN_FX = Object.freeze(['pulse', 'puff', 'spark'] as const);
export const PRIMITIVE_SEGMENTS = Object.freeze({ capsule: { cap: 2, radial: 6 }, cylinder: { radial: 8 } });
export function assertAssetPath(src: string): void {
  if (!src || src.startsWith('/') || src.includes('\\') || /[:?#%\x00-\x1f]/.test(src) || src.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ManifestError('path', src, 'Asset path must be a safe relative path');
  }
}
function lookup<T>(map: Record<string,T>, key: string, section: string): T {
  if (!Object.hasOwn(map, key)) throw new ManifestError('key', key, `Unresolved ${section} key`);
  return map[key]!;
}
export function assertManifestReferences(m: Manifest): void {
  const r = createManifestResolver(m);
  for (const model of Object.values(m.models)) if ('src' in model) assertAssetPath(model.src);
  for (const [key, visual] of Object.entries(m.visuals)) { r.visual(key); effect(visual, key); }
  for (const theme of Object.values(m.themes)) for (const prop of theme.props ?? []) r.model(prop.model);
  for (const [key, event] of Object.entries(m.events)) effect(event, key);
  const colors = new Set(['neutral', ...Object.keys(m.palettes.default), ...Object.keys(m.palettes.colorblind)]);
  for (const color of colors) { r.color(color); r.color(color, 'colorblind'); r.marker(color); }
  function effect(value: { fx?: string; sfx?: string }, key: string) {
    if (value.fx && !(BUILTIN_FX as readonly string[]).includes(value.fx)) throw new ManifestError('key', key, `Unresolved fx ${value.fx}`);
    if (value.sfx) assertAssetPath(value.sfx);
  }
}
export function createManifestResolver(manifest: Manifest) {
  return {
    model: (key: string) => lookup(manifest.models, key, 'model'),
    visual(key: string, kind?: 'tower' | 'troop') {
      const visual = lookup(manifest.visuals, key, 'visual');
      if (kind && visual.kind !== kind) throw new ManifestError('key', key, `Expected kind ${kind}`);
      return { ...visual, modelKey: visual.model, model: lookup(manifest.models, visual.model, 'model') };
    },
    theme: (key: string) => lookup(manifest.themes, key, 'theme'),
    color(key: string, palette: keyof Manifest['palettes'] = 'default') {
      if (!Object.hasOwn(manifest.palettes[palette], key)) throw new ManifestError('palette', key, `Missing palette colour in ${palette}`);
      return manifest.palettes[palette][key]!;
    },
    marker: (key: string) => lookup(manifest.teamMarkers, key, 'marker'),
    event: (key: string) => Object.hasOwn(manifest.events, key) ? manifest.events[key] : undefined,
    camera: () => manifest.camera,
    /** Per-level render overrides (empty when the level has none). */
    levelVisual: (levelId: string): LevelVisual => (manifest.levelVisuals && Object.hasOwn(manifest.levelVisuals, levelId) ? manifest.levelVisuals[levelId]! : {}),
    resolveLevelAssets(level: Pick<CompiledLevel, 'visual' | 'towers' | 'kinds' | 'players'>) {
      const theme = lookup(manifest.themes, level.visual, 'theme');
      const visuals = new Set<string>(); const models = new Set<string>(); const audio = new Set<string>();
      for (const tower of level.towers) { this.visual(tower.visual, 'tower'); visuals.add(tower.visual); }
      for (const kind of level.kinds) { this.visual(kind.visual, 'troop'); visuals.add(kind.visual); }
      for (const key of visuals) { const visual = manifest.visuals[key]!; models.add(visual.model); if (visual.sfx) audio.add(visual.sfx); }
      for (const prop of theme.props ?? []) { this.model(prop.model); models.add(prop.model); }
      // Themes with `scatter` load every `prop.*` model (border dressing; see render/props.ts).
      if (theme.scatter) for (const key of Object.keys(manifest.models)) if (key.startsWith('prop.')) models.add(key);
      for (const event of Object.values(manifest.events)) if (event.sfx) audio.add(event.sfx);
      for (const player of level.players) { this.color(player.colorKey); this.color(player.colorKey, 'colorblind'); this.marker(player.colorKey); }
      return { visuals, models, audio, sources: new Set([...models].flatMap(key => { const model = this.model(key); return 'src' in model ? [model.src] : []; }).concat([...audio])) };
    },
  };
}
