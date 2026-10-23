import { describe, expect, it } from 'vitest';
import { ownership, type OwnershipView } from '../../src/ui/ownership.js';

function view(owners: number[], levels: number[], colors = ['blue', 'red']): OwnershipView {
  return {
    players: Object.freeze(colors.map(colorKey => Object.freeze({ kind: 'ai' as const, colorKey }))),
    buildings: Object.freeze({ owner: Int32Array.from(owners), level: Int32Array.from(levels) }),
  };
}

describe('ownership bar', () => {
  it('weights building levels, excludes neutrals and orders two colours by player index', () => {
    expect(ownership(view([1, -1, 0, 0], [10, 1000, 20, 10]))).toEqual([
      { player: 0, colorKey: 'blue', permille: 750 },
      { player: 1, colorKey: 'red', permille: 250 },
    ]);
  });

  it('shows four distinct player segments in player order', () => {
    expect(ownership(view([3, 1, 0, 2], [4, 2, 1, 3], ['blue', 'red', 'green', 'yellow']))).toEqual([
      { player: 0, colorKey: 'blue', permille: 100 },
      { player: 1, colorKey: 'red', permille: 200 },
      { player: 2, colorKey: 'green', permille: 300 },
      { player: 3, colorKey: 'yellow', permille: 400 },
    ]);
  });

  it('floors permille and gives the final owner the entire rounding remainder', () => {
    expect(ownership(view([0, 1, 2], [1, 1, 1], ['blue', 'red', 'green', 'yellow']))).toEqual([
      { player: 0, colorKey: 'blue', permille: 333 },
      { player: 1, colorKey: 'red', permille: 333 },
      { player: 2, colorKey: 'green', permille: 334 },
    ]);
  });

  it('omits owners with no positive level sum and gives a sole owner the whole bar', () => {
    expect(ownership(view([1, 0, -1], [20, 0, 40]))).toEqual([
      { player: 1, colorKey: 'red', permille: 1000 },
    ]);
  });

  it.each([
    { owners: [], levels: [] },
    { owners: [-1, -1], levels: [30, 10] },
    { owners: [0, 1], levels: [0, 0] },
  ])('returns no segments for zero owned total ($owners)', ({ owners, levels }) => {
    expect(ownership(view(owners, levels))).toEqual([]);
  });

  it('reads only public owner/level/player data and never mutates its input', () => {
    const input = view([0, 1], [3, 2]);
    // Other sim data, including in-flight troop definitions, must not affect the HUD.
    const guarded = Object.freeze({
      ...input,
      get units(): never { throw new Error('ownership must ignore troops'); },
      get control(): never { throw new Error('ownership must not use view.control'); },
    });
    const before = { owner: [...input.buildings.owner], level: [...input.buildings.level], players: [...input.players] };
    const segments = ownership(guarded);
    expect(segments).toEqual([
      { player: 0, colorKey: 'blue', permille: 600 },
      { player: 1, colorKey: 'red', permille: 400 },
    ]);
    expect({ owner: [...input.buildings.owner], level: [...input.buildings.level], players: [...input.players] }).toEqual(before);
  });

  it('recomputes from the current owner columns after a capture', () => {
    const owners = Int32Array.from([0, 1]);
    const input = { ...view([], []), buildings: { owner: owners, level: Int32Array.from([3, 2]) } };
    expect(ownership(input).map(s => s.permille)).toEqual([600, 400]);
    owners[1] = 0;
    expect(ownership(input)).toEqual([{ player: 0, colorKey: 'blue', permille: 1000 }]);
  });
});
