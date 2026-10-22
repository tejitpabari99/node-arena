import { crossCheckManifest, createAjv, ManifestSchema, type ContentIssue, type LoadedContent, type ManifestCatalog, type ManifestV2 } from '@node-arena/content';

const validate = createAjv().compile<ManifestV2>(ManifestSchema);

/** Project loaded content into the shape `crossCheckManifest` takes. */
export function manifestCatalog(content: LoadedContent): ManifestCatalog {
  const { catalog, levels } = content;
  return {
    archetypes: Object.values(catalog.buildings).map(b => ({ id: b.id, visual: b.visual })),
    units: Object.values(catalog.units).map(u => ({ id: u.id, visual: u.visual })),
    elements: Object.values(catalog.elements).map(e => ({ id: e.id, visual: e.visual })),
    levels: Object.values(levels).map(({ level }) => ({ id: level.id, theme: level.theme, colorKeys: [...new Set(level.players.map(p => p.colorKey))] })),
    stageThresholds: catalog.balance.stageThresholds,
  };
}
/** Schema + content cross-checks (visual kinds, themes, colour keys, stages, fx, events). Asset-file and budget checks arrive with SP07. */
export function checkManifest(manifest: unknown, content: LoadedContent): ContentIssue[] {
  if (!validate(manifest)) return (validate.errors ?? []).map(error => ({ file: 'manifest', pointer: error.instancePath, message: error.message ?? 'invalid' }));
  return crossCheckManifest(manifest, manifestCatalog(content)).map(message => ({ file: 'manifest', pointer: '', message }));
}
