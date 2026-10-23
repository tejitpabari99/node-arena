import { expect, it } from 'vitest';
import { create, createTroopBuffer } from '@node-arena/sim';
import levels from '../../../../tools/assets/capture/fixtures/levels.json';
import type { CompiledLevel } from '@node-arena/content';
import { createOverlayRegistry, readOverlays } from '../../src/render/overlays.js';
it('reads level and lines from the public building columns', () => {
  const sim = create(levels['l4-green'] as unknown as CompiledLevel, 11);
  const before = sim.hash();
  expect(readOverlays(createOverlayRegistry(), ['level','drawsLines'],sim.view,0)).toEqual([
    { key:'level',text:'20',description:'Level 20' },
    { key:'drawsLines',text:'0',description:'0 active lines' },
  ]);
  expect(sim.hash()).toBe(before);
  expect(sim.readTroops(createTroopBuffer(4))).toBe(0);
});
