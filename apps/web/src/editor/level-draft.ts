import type { SeatBot } from '@node-arena/content';
import type { LevelDoc } from './document.js';
import type { LevelProperties } from './model.js';
import { firstUnusedColor, nextPlayerId } from './labels.js';

type Player = LevelDoc['players'][number];
export const MAX_AI = 3, MIN_DELAY = 50;

export const toDraft = (doc: LevelDoc): LevelProperties => structuredClone({ name: doc.name, theme: doc.theme, timeLimitSec: doc.timeLimitSec ?? null, players: doc.players });
export const aiCount = (players: readonly Player[]) => players.filter(p => p.kind !== 'human').length;
export const canAddAi = (players: readonly Player[], paletteKeys: readonly string[]) => aiCount(players) < MAX_AI && firstUnusedColor([...players], paletteKeys) !== undefined;
export const canDeleteAi = (players: readonly Player[], id: string) => aiCount(players) > 1 && players.some(p => p.id === id && p.kind !== 'human');

/** Extra reserved ids support callers composing several player operations. */
export function addAi(draft: LevelProperties, paletteKeys: readonly string[], docPlayers: readonly Player[] = []): LevelProperties {
  if (!canAddAi(draft.players, paletteKeys)) return draft;
  const colorKey = firstUnusedColor(draft.players, paletteKeys)!;
  const bot: SeatBot = { kind: 'tw', actionDelayMs: 4000, behavior: 'full' };
  return { ...draft, players: [...draft.players, { id: nextPlayerId([...docPlayers, ...draft.players]), kind: 'ai', colorKey, bot } as Player] };
}
export const deleteAi = (draft: LevelProperties, id: string): LevelProperties => canDeleteAi(draft.players, id) ? { ...draft, players: draft.players.filter(p => p.id !== id) } : draft;
export const duplicateColors = (players: readonly Player[]) => [...new Set(players.map(p => p.colorKey).filter((key, i, all) => all.indexOf(key) !== i))];
export const ownedCount = (doc: Pick<LevelDoc, 'buildings'>, id: string) => doc.buildings.filter(b => b.owner === id).length;
export const delayValid = (p: Player) => p.kind === 'human' || Number.isInteger((p.bot as SeatBot | undefined)?.actionDelayMs) && (p.bot as SeatBot).actionDelayMs >= MIN_DELAY && (p.bot as SeatBot).actionDelayMs <= 2147483647;
