import type { ContentIssue } from '@node-arena/content';
import type { LevelDoc } from './document.js';
import { playerLabel } from './labels.js';

/** Plain-language issue for each player (Human, AI1, ...) that owns no troop-generating building. Not a schema rule: drafts stay saveable. */
export function ownershipIssues(doc: Pick<LevelDoc, 'id' | 'players' | 'buildings'> & { objective?: string }, troopArchetypes: ReadonlySet<string>): ContentIssue[] {
  const owners = new Set(doc.buildings.filter(building => troopArchetypes.has(building.archetype)).map(building => building.owner));
  return doc.players.flatMap((player, index) => {
    if (owners.has(player.id)) return [];
    const label = playerLabel(doc.players, player.id, doc.objective);
    return [{ file: `data/levels/${doc.id}.json`, pointer: `/players/${index}`, message: `${label} has no troop building — add a house and set its owner to ${label}` }];
  });
}
export const isOwnershipIssue = (issue: ContentIssue): boolean => /^\/players\/\d+$/.test(issue.pointer) && / has no troop building — /.test(issue.message);

/** Issues shown to the author: schema/validation issues plus ownership ones. Zero buildings is reported per player instead of the generic message. */
export function combineIssues(validation: ContentIssue[], ownership: ContentIssue[]): ContentIssue[] {
  const base = ownership.length ? validation.filter(issue => !(issue.pointer === '/buildings' && /fewer than 1 item|add at least one building/i.test(issue.message))) : validation;
  return [...base, ...ownership];
}
