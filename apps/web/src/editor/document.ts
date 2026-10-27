import type { NextLevel } from '@node-arena/content';
import { BASE_HOUSE } from './houses.js';

export type LevelDoc = NextLevel;
export type SizePreset = 'small' | 'medium' | 'large';
export const isDraftId = (id: string): boolean => /^na-[a-z0-9-]{1,40}$/.test(id);

const MARGIN = 2, GAP = 1.5;
/** Human gets a house in the left zone, AI1 one in the right zone: inside bounds by MARGIN and at least 2*GAP apart, so 1.5-wide footprints never touch. */
function baseHouses(half: number, random: () => number): LevelDoc['buildings'] {
  const span = (lo: number, hi: number) => Math.round((lo + random() * (hi - lo)) * 100) / 100;
  const at = (id: string, owner: string, x: number) => ({ id, archetype: BASE_HOUSE, pos: { x, z: span(-half + MARGIN, half - MARGIN) }, owner, level: 1, ignoreForWin: false });
  return [at('b0', 'p1', span(-half + MARGIN, -GAP)), at('b1', 'p2', span(GAP, half - MARGIN))] as LevelDoc['buildings'];
}

/** `random` is injectable (defaults to Math.random) so tests can pin base-house positions. */
export function blankDocument(id: string, theme: string, size: SizePreset, random: () => number = Math.random): LevelDoc {
  if (!isDraftId(id)) throw new Error('Choose a new id: na- followed by 1–40 lowercase letters, digits or hyphens.');
  const half = { small: 6, medium: 10, large: 15 }[size];
  return {
    $schema: '../../schemas/level.schema.json', schemaVersion: '2.0.0', id, name: id,
    theme, bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
    objective: 'captureAll', timeLimitSec: null,
    players: [
      { id: 'p1', kind: 'human', colorKey: 'blue' },
      { id: 'p2', kind: 'ai', colorKey: 'red', bot: { kind: 'tw', actionDelayMs: 4000, behavior: 'full', script: [] } },
    ],
    buildings: baseHouses(half, random), elements: [], requires: [],
  };
}

export function copyDocument(source: LevelDoc, id: string): LevelDoc {
  if (!isDraftId(id) || id === source.id) throw new Error('Choose a new id for this copy (na- followed by 1–40 lowercase letters, digits or hyphens).');
  const copy = structuredClone(source);
  copy.id = id;
  delete copy.source;
  delete copy.editorVersion;
  return copy;
}
