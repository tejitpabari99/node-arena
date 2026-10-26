/**
 * Canonical key order of level / campaign JSON (PRD 05 R5). Single source: the importer's serializer
 * (tools/src/import-tw/serialize.ts) and the content parity test both import it.
 * Known keys first in this order, unknown keys after in insertion order.
 */
export const KEY_ORDER = {
  level: ['$schema', 'schemaVersion', 'id', 'name', 'editorVersion', 'source', 'theme', 'bounds', 'objective', 'timeLimitSec', 'players', 'buildings', 'elements', 'requires'],
  source: ['game', 'gameVersion', 'asset', 'campaignPosition', 'dialect', 'dropped'],
  bounds: ['minX', 'maxX', 'minZ', 'maxZ'],
  player: ['id', 'kind', 'colorKey', 'bot'],
  bot: ['kind', 'actionDelayMs', 'startDelayMs', 'behavior', 'script'],
  building: ['id', 'archetype', 'pos', 'owner', 'level', 'ignoreForWin', 'params'],
  element: ['id', 'archetype', 'pos', 'yawDeg', 'footprint', 'variant', 'params'],
  pos: ['x', 'z'],
  campaign: ['$schema', 'schemaVersion', 'id', 'entries'],
  entry: ['level', 'position'],
} as const;
