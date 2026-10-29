import { describe, expect, it } from 'vitest';
import { blankDocument } from '../../src/editor/document.js';
import { firstUnusedColor, itemLabels, nextPlayerId, playerLabel } from '../../src/editor/labels.js';

const ai = (id: string, colorKey: string) => ({ id, kind: 'ai' as const, colorKey, bot: { kind: 'tw' as const, actionDelayMs: 4000, behavior: 'full' as const } });
function fixture() {
  const doc = blankDocument('na-labels', 'green', 'medium');
  doc.players.push(ai('p3', 'green'));
  const b = (id: string, archetype: 'house-wt1' | 'house-wt2' | 'tower', owner: string | null) => ({ id, archetype, pos: { x: 0, z: 0 }, owner, level: 1, ignoreForWin: false });
  doc.buildings = [b('b0', 'tower', 'p1'), b('b1', 'house-wt1', 'p2'), b('b2', 'house-wt2', 'p2'), b('b3', 'tower', 'p3'), b('b4', 'house-wt1', null), b('b5', 'tower', 'p3')];
  doc.elements = [
    { id: 'e0', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0, variant: 'small' },
    { id: 'e1', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0, variant: 'big' },
    { id: 'e2', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0, variant: 'small' },
    { id: 'e3', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0 },
  ];
  return doc;
}

describe('labels', () => {
  it('labels players Human / AI{k} by position', () => {
    const { players } = fixture();
    expect(players.map(p => playerLabel(players, p.id))).toEqual(['Human', 'AI1', 'AI2']);
  });
  it('renumbers AIs after deleting one while ids stay', () => {
    const doc = fixture(); doc.players = doc.players.filter(p => p.id !== 'p2');
    expect(playerLabel(doc.players, 'p3')).toBe('AI1');
  });
  it('counts per owner and noun in doc order; obstacles per variant', () => {
    const labels = itemLabels(fixture());
    expect([...labels.values()]).toEqual(['Human tower 1', 'AI1 house 1', 'AI1 house 2', 'AI2 tower 1', 'Neutral house 1', 'AI2 tower 2',
      'Small row 1', 'Big row 1', 'Small row 2', 'Obstacle 1']);
  });
  it('relabels after an owner change (renumbered in the new group)', () => {
    const doc = fixture(); doc.buildings[2] = { ...doc.buildings[2]!, owner: null };
    const labels = itemLabels(doc);
    expect(labels.get('b1')).toBe('AI1 house 1'); expect(labels.get('b2')).toBe('Neutral house 1'); expect(labels.get('b4')).toBe('Neutral house 2');
  });
  it('relabels owners after an AI is deleted', () => {
    const doc = fixture(); doc.players = doc.players.filter(p => p.id !== 'p2'); doc.buildings = doc.buildings.map(x => x.owner === 'p2' ? { ...x, owner: null } : x);
    expect(itemLabels(doc).get('b3')).toBe('AI1 tower 1');
  });
  it('nextPlayerId is the lowest unused pN, N >= 2', () => {
    const doc = fixture();
    expect(nextPlayerId(doc.players)).toBe('p4');
    expect(nextPlayerId(doc.players.filter(p => p.id !== 'p2'))).toBe('p2');
    expect(nextPlayerId([doc.players[0]!])).toBe('p2');
  });
  it('firstUnusedColor picks the first unused palette key', () => {
    const { players } = fixture(); // blue, red, green
    expect(firstUnusedColor(players, ['blue', 'red', 'green', 'yellow', 'purple'])).toBe('yellow');
    expect(firstUnusedColor(players.slice(0, 1), ['red', 'blue', 'green'])).toBe('red');
    expect(firstUnusedColor(players, ['blue', 'red', 'green'])).toBeUndefined();
  });
});

import { playerLabel as pl } from '../../src/editor/labels.js';
import { toDraft as draftOf } from '../../src/editor/level-draft.js';
import { blankDocument as blank } from '../../src/editor/document.js';
it('pvp labels players Seat N; toDraft keeps objective and team', () => {
  const d = { ...blank('na-t', 'grass', 'small'), objective: 'pvp' as const };
  d.players = d.players.map((p, i) => ({ ...p, team: i })) as typeof d.players;
  expect(pl(d.players, 'p2', 'pvp')).toBe('Seat 2');
  expect(pl(d.players, 'p2')).toBe('AI1');
  const draft = draftOf(d);
  expect(draft.objective).toBe('pvp');
  expect(draft.players.map(p => p.team)).toEqual([0, 1]);
});
