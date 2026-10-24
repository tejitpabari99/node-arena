import { ContentLoadError, computeRequires, loadLevel, parseAndConvert, type Catalog, type NextLevel } from '@node-arena/content';

/** Browser-safe, synchronous validation shared by Save and future editor jobs. Values remain authored units. */
export function validateEditorDocument(catalog: Catalog, input: unknown, id: string, copy = false) {
  const file = `data/levels/${id}.json`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentLoadError([{ file, pointer: '', message: 'Level must be an object' }]);
  const authored = structuredClone(input) as NextLevel;
  authored.id = id;
  if (copy) delete authored.source;
  authored.requires = [];
  // Pointer movement can introduce floating point tails: round before fx3 validation.
  const round = (value: unknown): unknown => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
  for (const key of ['buildings', 'elements'] as const) {
    if (!Array.isArray(authored[key])) continue;
    for (const item of authored[key]) {
      if (!item || typeof item !== 'object') continue;
      if (item.pos && typeof item.pos === 'object') { item.pos.x = round(item.pos.x) as number; item.pos.z = round(item.pos.z) as number; }
      if ('yawDeg' in item) item.yawDeg = round(item.yawDeg) as number;
    }
  }
  const shape = parseAndConvert<NextLevel>(file, authored, 'level');
  if (!shape.value) throw new ContentLoadError(shape.issues);
  authored.requires = computeRequires(catalog, authored);
  const loaded = loadLevel(catalog, authored, file);
  return { level: authored, warnings: loaded.warnings };
}
