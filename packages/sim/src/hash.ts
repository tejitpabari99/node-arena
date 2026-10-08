import type { SimState } from './state.js';
import { WordHash } from './math.js';
import { sortedNames } from './registry.js';

/** Length-prefixed sections and UTF-16 strings make the word stream unambiguous. */
export function hashState(state: SimState): string {
  const hash = new WordHash();
  hash.text('sim-state-v1');
  hash.word(state.tick); hash.word(state.drawSeq); hash.word(state.troopSeq);
  hash.words(state.prng.snapshot());
  hash.word(state.over ? 1 : 0);
  if (state.over) { hash.text(state.over.outcome); hash.word(state.over.winnerTeam === null ? 0 : 1); if (state.over.winnerTeam !== null) hash.text(state.over.winnerTeam); }
  hash.words(state.players.team); hash.words(state.players.alive); hash.words(state.players.transit); hash.words(state.eliminated);
  hash.words(state.tower.owner); hash.words(state.tower.team); hash.words(state.tower.slots); hash.words(state.tower.lines);
  const names = sortedNames(state.tower.col);
  hash.word(names.length);
  for (const name of names) { hash.text(name); hash.words(state.tower.col[name]!); }
  hash.word(state.channels.length);
  for (let key = 0; key < state.channels.length; key++) {
    const channel = state.channels[key];
    hash.word(channel ? 1 : 0);
    if (!channel) continue;
    hash.word(channel.key); hash.word(channel.from); hash.word(channel.to); hash.word(channel.length);
    hash.word(channel.drawn); hash.word(channel.drawSeq); hash.word(channel.owner); hash.word(channel.troops.size);
    for (let i = 0; i < channel.troops.size; i++) {
      hash.word(channel.troops.read('p0', i)); hash.word(channel.troops.read('t0', i)); hash.word(channel.troops.read('owner', i));
      hash.word(channel.troops.read('kind', i)); hash.word(channel.troops.read('seq', i)); hash.word(channel.troops.read('value', i));
    }
  }
  return hash.finish();
}
