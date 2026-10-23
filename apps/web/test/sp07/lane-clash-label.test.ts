import { describe, expect, it } from 'vitest';
import { clashEnd, hasOpposite, LANE_COLORS } from '../../src/render/lane-renderer.js';
import { isMaxLevel, labelText } from '../../src/render/building-label.js';

describe('lane clash', () => {
  it('detects opposing lines only', () => {
    const lines = [{ from: 0, to: 1 }, { from: 1, to: 0 }, { from: 0, to: 2 }];
    expect(hasOpposite(lines, 0)).toBe(true);
    expect(hasOpposite(lines, 1)).toBe(true);
    expect(hasOpposite(lines, 2)).toBe(false);
  });
  it('opposed lines end at midpoint, others at target', () => {
    const a = { x: 0, z: 0 }, b = { x: 10, z: 4 };
    expect(clashEnd(a, b, true, { x: 0, z: 0 })).toEqual({ x: 5, z: 2 });
    expect(clashEnd(a, b, false, { x: 0, z: 0 })).toEqual({ x: 10, z: 4 });
  });
  it('line colours are darker than the originals', () => {
    expect(LANE_COLORS['blue']).toBe('#1458C8');
    expect(LANE_COLORS['green']).toBe('#1C7A2C');
  });
});

describe('MAX label', () => {
  it('shows MAX only at maxLevel', () => {
    expect(isMaxLevel(64, 64)).toBe(true);
    expect(isMaxLevel(34, 34)).toBe(true);
    expect(isMaxLevel(33, 34)).toBe(false);
    expect(isMaxLevel(5, 0)).toBe(false);
    expect(labelText(64, true)).toBe('MAX');
    expect(labelText(12, false)).toBe('12');
  });
});
