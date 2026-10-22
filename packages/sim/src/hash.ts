import { WordHash } from './math.js';
import { liveChannels } from './state.js';
import type { SimState } from './types.js';

/** Domain `sim-state-v2` (03 R7). Globals, building and seat columns, sorted module columns, live channels (ascending key), all stream states. */
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
  hash.word(state.players.n); hash.words(state.players.kind);
  const live = liveChannels(state);
  hash.word(live.length);
  for (const ch of live) {
    hash.word(ch.key); hash.word(ch.drawn); hash.word(ch.drawSeq); hash.word(ch.timer);
    const r = ch.troops;
    hash.word(r.len);
    for (let i = 0; i < r.len; i++) { hash.word(r.p0[i]!); hash.word(r.t0[i]!); hash.word(r.owner[i]!); hash.word(r.kind[i]!); hash.word(r.seq[i]!); hash.word(r.hp[i]!); }
  }
  for (const stream of state.fwd) for (const w of stream.snapshot()) hash.word(w);
  return hash.finish();
}
