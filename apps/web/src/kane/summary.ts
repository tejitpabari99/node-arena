import type { SimEvent, SimView } from '@node-arena/sim';
import type { CommandSubmission, Speed } from '../driver';
import type { KaneSnapshot } from './controller';
import { buildingLetter, pairKey } from './pairs';

/** Event owners are retained because LineCut itself has no owner/player field. */
export function humanActivity(events: readonly SimEvent[], commands: readonly CommandSubmission[], initialOwners: ReadonlyMap<string, number>) {
  const owners = new Map(initialOwners);
  let drawn = 0, cut = 0;
  const rejected: { command: string; reason: string }[] = [];
  for (const event of events) {
    if (event.type === 'LineDrawn') {
      owners.set(pairKey(event.from, event.to), event.owner);
      if (event.owner === 0) drawn++;
    } else if (event.type === 'LineCut') {
      const key = pairKey(event.from, event.to);
      if (event.reason === 'player' && owners.get(key) === 0) cut++;
      owners.delete(key);
    } else if (event.type === 'CommandRejected' && event.player === 0) {
      rejected.push({ command: event.command, reason: event.reason });
    }
  }
  return { commands: commands.filter(row => row.cmd.player === 0), drawn, cut, rejected };
}

export function kaneSummary(view: SimView | undefined, speed: Speed, controls: KaneSnapshot | undefined,
  events: readonly SimEvent[], commands: readonly CommandSubmission[], initialOwners: ReadonlyMap<string, number>) {
  const over = view?.over ? { ...view.over } : null;
  return {
    tick: view?.tick ?? 0, speed, over, result: over?.outcome ?? null,
    letters: view?.ids.buildings.map((id, index) => ({ letter: buildingLetter(index), index, id,
      owner: view.buildings.owner[index]!, level: view.buildings.level[index]! })) ?? [],
    human: humanActivity(events, commands, initialOwners),
    banner: controls?.banner ? { text: controls.banner.text, reason: controls.banner.reason } : null,
    pairs: controls?.groups.flatMap(group => group.pairs.map(pair => ({ from: pair.fromLetter, to: pair.toLetter,
      state: pair.state, reason: pair.reason, text: pair.text }))) ?? [],
  };
}
