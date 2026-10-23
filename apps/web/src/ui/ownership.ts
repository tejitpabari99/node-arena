import type { SimView } from '@node-arena/sim';

export type OwnershipView = Pick<SimView, 'players'> & {
  readonly buildings: Pick<SimView['buildings'], 'owner' | 'level'>;
};

export interface OwnershipSegment {
  readonly player: number;
  readonly colorKey: string;
  readonly permille: number;
}

/** Building-level shares only: neutral buildings and in-flight units contribute nothing. */
export function ownership(view: OwnershipView): OwnershipSegment[] {
  const sums = new Array<number>(view.players.length).fill(0);
  for (let i = 0; i < view.buildings.owner.length; i++) {
    const player = view.buildings.owner[i]!;
    if (player >= 0) sums[player] = sums[player]! + view.buildings.level[i]!;
  }
  const total = sums.reduce((sum, level) => sum + level, 0);
  if (total === 0) return [];

  const segments: OwnershipSegment[] = [];
  let assigned = 0;
  for (let player = 0; player < sums.length; player++) {
    if (sums[player]! <= 0) continue;
    const permille = Math.floor(sums[player]! * 1000 / total);
    segments.push({ player, colorKey: view.players[player]!.colorKey, permille });
    assigned += permille;
  }
  const last = segments.length - 1;
  segments[last] = { ...segments[last]!, permille: segments[last]!.permille + 1000 - assigned };
  return segments;
}
