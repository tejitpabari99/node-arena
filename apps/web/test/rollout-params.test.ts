import { describe, expect, it } from 'vitest';
import { cameraSettingsFor, CAMERA_MARGIN_OVERRIDE } from '../src/render/camera.js';
import { NUMBER_PX, NUMBER_PX_LARGE, roofNumberPx } from '../src/render/roof-texture.js';
import { troopSizeFactor } from '../src/render/troops.js';

// SP05 Task 8: per-level render-param overrides (render only; level JSON / sim untouched).
describe('rollout render params', () => {
  it('camera margin override applies only to listed levels', () => {
    const base = { pitchDeg: 65, fov: 35, margin: 3 };
    expect(cameraSettingsFor('10-two-foes', base)).toBe(base);
    for (const [id, margin] of Object.entries(CAMERA_MARGIN_OVERRIDE)) expect(cameraSettingsFor(id, base)).toEqual({ ...base, margin });
  });
  it('roof number size: L1 keeps the slice-gate size, others use the large size', () => {
    expect(roofNumberPx('01-first-steps')).toBe(NUMBER_PX); expect(roofNumberPx('10-two-foes')).toBe(NUMBER_PX_LARGE);
  });
  it('troop size factor: 1 for normal boards, shrinks for small starting towers, per-level override', () => {
    expect(troopSizeFactor('10-two-foes', [4.3, 5, 6])).toBe(1);
    expect(troopSizeFactor('12-underdog', [2.88, 2.88, 4])).toBeCloseTo(0.72, 5);
    expect(troopSizeFactor('09-chain-link', [4.5])).toBeCloseTo(0.9, 5);
    expect(troopSizeFactor('x', [])).toBe(1);
  });
});
