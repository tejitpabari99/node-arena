import { expect, it } from 'vitest';
import { pointSegmentDistance, segmentDistance } from '../src/input/geometry.js';
const p = (x: number, y: number) => ({ x, y });
it('point distance handles endpoints and degenerate segments', () => {
  expect(pointSegmentDistance(p(4,3),p(0,0),p(10,0))).toBe(3);
  expect(pointSegmentDistance(p(-3,4),p(0,0),p(10,0))).toBe(5);
  expect(pointSegmentDistance(p(3,4),p(0,0),p(0,0))).toBe(5);
});
it('stroke distance detects crossing, touching, collinear, nearly parallel and zero-length strokes', () => {
  expect(segmentDistance(p(0,0),p(10,0),p(5,-5),p(5,5))).toBe(0);
  expect(segmentDistance(p(0,0),p(10,0),p(10,0),p(15,5))).toBe(0);
  expect(segmentDistance(p(0,0),p(10,0),p(2,0),p(12,0))).toBe(0);
  expect(segmentDistance(p(0,0),p(10,0),p(12,0),p(20,0))).toBe(2);
  expect(segmentDistance(p(0,0),p(10000,.0001),p(0,8),p(10000,8.0001))).toBeCloseTo(8);
  expect(segmentDistance(p(5,8),p(5,8),p(0,0),p(10,0))).toBe(8);
  expect(segmentDistance(p(0,0),p(0,0),p(3,4),p(3,4))).toBe(5);
});
it('screen tolerance remains CSS pixels regardless of coordinate scale', () => {
  for (const scale of [.25, 1, 4]) {
    expect(segmentDistance(p(0,7.99),p(100*scale,7.99),p(0,0),p(100*scale,0))).toBeLessThan(8);
    expect(segmentDistance(p(0,8.01),p(100*scale,8.01),p(0,0),p(100*scale,0))).toBeGreaterThan(8);
  }
});
