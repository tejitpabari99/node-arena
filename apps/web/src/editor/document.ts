import type { NextLevel } from '@node-arena/content';

export type LevelDoc = NextLevel;
export type SizePreset = 'small' | 'medium' | 'large';
export const isDraftId = (id: string): boolean => /^na-[a-z0-9-]{1,40}$/.test(id);

export function blankDocument(id: string, theme: string, size: SizePreset): LevelDoc {
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
    buildings: [], elements: [], requires: [],
  };
}

export function copyDocument(source: LevelDoc, id: string): LevelDoc {
  if (!isDraftId(id) || id === source.id) throw new Error('Choose a new id for this copy (na- followed by 1–40 lowercase letters, digits or hyphens).');
  const copy = structuredClone(source);
  copy.id = id;
  delete copy.source;
  return copy;
}
