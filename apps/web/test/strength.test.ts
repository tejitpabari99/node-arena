import { describe, expect, it } from 'vitest';
import type { SimView } from '@node-arena/sim';
import { strength } from '../src/ui/strength';
import { HUD_TOKENS, contrastRatio } from '../src/ui/tokens';

interface P { team?: string; transit?: number }
function fake(players: P[], owners: number[], counts: number[]): SimView {
  return {
    players: players.map((p, i) => ({ team: p.team ?? `t${i + 1}`, colorKey: `player.${i + 1}`, transit: p.transit ?? 0 })),
    tower: { owner: Int32Array.from(owners), col: { 'garrison.count': Int32Array.from(counts) } },
  } as unknown as SimView;
}

describe('strength()', () => {
  it('sums garrisons and in-transit, neutrals excluded', () => {
    const s = strength(fake([{ transit: 2 }, { transit: 0 }], [0, 1, -1], [20, 20, 99]));
    expect(s.segments.map(x => x.troops)).toEqual([22, 20]);
    expect(s.total).toBe(42);
    expect(s.ariaText).toBe('Blue 52%, Red 48%');
  });
  it('zero total gives equal split', () => {
    const s = strength(fake([{}, {}], [0, 1, -1], [0, 0, 50]));
    expect(s.segments.map(x => x.pct)).toEqual([50, 50]);
    expect(s.ariaText).toBe('Blue 50%, Red 50%');
  });
  it('handles N teams and sums to 100', () => {
    const s = strength(fake([{}, {}, {}], [0, 1, 2], [1, 1, 1]));
    expect(s.segments.reduce((a, x) => a + x.pct, 0)).toBe(100);
    expect(s.segments.map(x => x.pct).sort()).toEqual([33, 33, 34]);
    const four = strength(fake([{}, {}, {}, {}], [0, 1, 2, 3], [7, 11, 13, 17]));
    expect(four.segments.reduce((a, x) => a + x.pct, 0)).toBe(100);
    expect(four.ariaText).toMatch(/^Blue \d+%, Red \d+%, Yellow \d+%, Green \d+%$/);
  });
  it('neutral-only towers -> equal split, no neutral segment', () => {
    const s = strength(fake([{}, {}], [-1, -1], [40, 40]));
    expect(s.total).toBe(0);
    expect(s.segments.map(x => x.pct)).toEqual([50, 50]);
  });
  it('rounding always sums to 100', () => {
    for (let a = 0; a < 40; a++) for (let b = 0; b < 40; b++) {
      const s = strength(fake([{}, {}, {}], [0, 1, 2], [a, b, 7]));
      expect(s.segments.reduce((x, y) => x + y.pct, 0)).toBe(100);
    }
  });
  it('merges players on the same team', () => {
    const s = strength(fake([{ team: 'a' }, { team: 'a' }, { team: 'b' }], [0, 1, 2], [10, 10, 20]));
    expect(s.segments.map(x => [x.team, x.pct])).toEqual([['a', 50], ['b', 50]]);
  });
  it('colourblind palette names in aria text', () => {
    const s = strength(fake([{}, {}], [0, 1], [30, 10]), { colorblind: true });
    expect(s.ariaText).toBe('Blue 75%, Vermillion 25%');
  });
  it('empty players -> empty', () => {
    expect(strength(fake([], [], [])).ariaText).toBe('');
  });
});

describe('HUD pill tokens', () => {
  it('pill text vs background contrast >= 4.5:1', () => {
    expect(contrastRatio(HUD_TOKENS.pillText, HUD_TOKENS.pillBg)).toBeGreaterThanOrEqual(4.5);
  });
  it('contrast helper sanity', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });
});
