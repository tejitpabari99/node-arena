import { describe, expect, it } from 'vitest';
import { createBootState } from '../src/app/boot';

describe('web workspace boot', () => {
  it('loads authored content and constructs a deterministic simulation via public APIs', () => {
    const boot = createBootState();
    const again = createBootState();
    expect(boot.screen).toBe('boot');
    expect(boot.schemaVersion).toBe('1.0.0');
    expect(boot.threeRevision).toBe('186');
    expect(boot.sim.view.towerStatic).toHaveLength(5);
    expect(boot.sim.tick).toBe(0);
    expect(boot.sim.hash()).toBe(again.sim.hash());
    boot.sim.step([]);
    expect(boot.sim.tick).toBe(1);
    expect(boot.sim.hash()).not.toBe(again.sim.hash());
  });
});
