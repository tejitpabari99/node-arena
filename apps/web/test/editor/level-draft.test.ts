import { describe, expect, it } from 'vitest';
import { blankDocument } from '../../src/editor/document.js';
import { addAi, aiCount, canAddAi, canApply, canDeleteAi, deleteAi, duplicateColors, ownedCount, toDraft } from '../../src/editor/level-draft.js';

const keys = ['blue', 'red', 'green', 'yellow', 'pink'];
const doc = blankDocument('na-x', 'grass', 'small'); // p1 human blue, p2 ai red

describe('level draft', () => {
  it('adds AI with lowest free id and unused color; caps at 3', () => {
    let d = addAi(toDraft(doc), keys);
    expect(d.players.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(d.players[2]!.colorKey).toBe('green');
    d = addAi(d, keys);
    expect(aiCount(d.players)).toBe(3);
    expect(canAddAi(d.players, keys)).toBe(false);
    expect(addAi(d, keys)).toBe(d);
    expect(d.players[3]!.id).toBe('p4');
  });
  it('never reuses an id deleted in the current draft', () => {
    let d = addAi(toDraft(doc), keys, doc.players); d = deleteAi(d, 'p2');
    expect(d.players.map(p => p.id)).toEqual(['p1', 'p3']);
    expect(addAi(d, keys, doc.players).players.at(-1)!.id).toBe('p4');
    const only = deleteAi(addAi(toDraft(doc), keys, doc.players), 'p2');
    expect(addAi(only, keys, doc.players).players.map(p => p.id)).not.toContain('p2');
  });
  it('last AI and human cannot be deleted', () => {
    expect(canDeleteAi(doc.players, 'p2')).toBe(false);
    expect(deleteAi(toDraft(doc), 'p2').players).toHaveLength(2);
    expect(canDeleteAi(addAi(toDraft(doc), keys).players, 'p1')).toBe(false);
  });
  it('duplicate colors / unchanged / invalid block Apply', () => {
    const dup = { ...toDraft(doc), players: doc.players.map(p => ({ ...p, colorKey: 'red' })) };
    expect(duplicateColors(dup.players)).toEqual(['red']);
    expect(canApply(doc, dup)).toBe(false);
    expect(canApply(doc, toDraft(doc))).toBe(false);
    expect(canApply(doc, { ...toDraft(doc), name: 'New' })).toBe(true);
    expect(canApply(doc, { ...toDraft(doc), name: ' ' })).toBe(false);
    const slow = toDraft(doc); (slow.players[1]!.bot as { actionDelayMs: number }).actionDelayMs = 10;
    expect(canApply(doc, slow)).toBe(false);
  });
  it('counts owned buildings', () => {
    expect(ownedCount({ buildings: [{ owner: 'p2' }, { owner: null }, { owner: 'p2' }] as never }, 'p2')).toBe(2);
  });
});
