import { WordHash } from './math.js';
import type { SimState } from './types.js';

/** Domain `sim-state-v2` (03 R7). Skeleton covers globals and building columns; channels and streams join with later tasks. */
export function hashState(state: SimState): string {
  const hash = new WordHash();
  hash.text('sim-state-v2');
  hash.word(state.tick); hash.word(state.drawSeq); hash.word(state.troopSeq);
  hash.word(state.over ? 1 : 0);
  if (state.over) { hash.text(state.over.outcome); hash.word(state.over.winner === null ? -1 : state.over.winner); }
  const b = state.buildings;
  hash.words(b.owner); hash.words(b.level); hash.words(b.maxLevel); hash.words(b.lines); hash.words(b.alive); hash.words(b.ignoreForWin);
  const names = Object.keys(b.col).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  hash.word(names.length);
  for (const name of names) { hash.text(name); hash.words(b.col[name]!); }
  return hash.finish();
}
