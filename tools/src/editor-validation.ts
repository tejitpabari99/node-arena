import { ContentLoadError, computeRequires, loadLevel, parseAndConvert, type Catalog, type NextLevel } from '@node-arena/content';
import { playerLabel } from '../../apps/web/src/editor/labels.js';

/** Playability check for editor Check/Finalize only; incomplete drafts remain saveable. */
export function assertPlayersHaveHouses(catalog: Catalog, level: NextLevel): void {
  const owners = new Set(level.buildings.filter(building => catalog.buildings[building.archetype]?.modules.drawsLines !== undefined).map(building => building.owner));
  const errors = level.players.flatMap((player, index) => owners.has(player.id) ? [] : [{
    file: `data/levels/${level.id}.json`, pointer: `/players/${index}`, message: `${playerLabel(level.players, player.id)} has no starting house`,
  }]);
  if (errors.length) throw new ContentLoadError(errors);
}

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
  if (!shape.value) {
    // A fresh blank draft has no buildings yet; say so plainly instead of the raw schema message.
    const friendly = shape.issues.map(issue => issue.pointer === '/buildings' && /fewer than 1/.test(issue.message) ? { ...issue, message: 'Add at least one building' } : issue);
    throw new ContentLoadError(friendly);
  }
  authored.requires = computeRequires(catalog, authored);
  const loaded = loadLevel(catalog, authored, file);
  return { level: authored, warnings: loaded.warnings };
}
