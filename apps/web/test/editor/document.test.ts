import { expect, it } from 'vitest';
import { blankDocument, copyDocument } from '../../src/editor/document.js';
it('creates bounded two-player blank drafts with no imported identity', () => {
  const small = blankDocument('na-small', 'green', 'small');
  expect(small.bounds).toEqual({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
  expect(small.players).toMatchObject([{ id: 'p1', kind: 'human' }, { id: 'p2', kind: 'ai' }]);
  expect(small.buildings).toEqual([]); expect(small.elements).toEqual([]);
  expect(small.source).toBeUndefined();
  expect(blankDocument('na-medium', 'snow', 'medium').bounds.maxX).toBe(10);
  expect(blankDocument('na-large', 'snow', 'large').bounds.maxX).toBe(15);
});
it('requires a distinct new custom id for imported and custom copies', () => {
  for (const sourceId of ['levelview-1', 'na-existing']) {
    const source = blankDocument('na-existing', 'green', 'small');
    source.id = sourceId; source.source = { game: 'test', gameVersion: '1', asset: 'level' };
    expect(() => copyDocument(source, sourceId)).toThrow('new id');
    expect(() => copyDocument(source, 'invalid')).toThrow('new id');
    const copy = copyDocument(source, 'na-new');
    expect(copy.id).toBe('na-new'); expect(copy.source).toBeUndefined();
    copy.players[0]!.colorKey = 'red';
    expect(source.players[0]!.colorKey).toBe('blue');
    expect(source.source.asset).toBe('level');
  }
});
it.each(['na-', 'levelview-1', 'na-A', `na-${'a'.repeat(41)}`])('refuses invalid draft id %s', id => {
  expect(() => blankDocument(id, 'green', 'small')).toThrow('na-');
});
