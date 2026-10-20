import { describe, expect, it } from 'vitest';
import type { SimView } from '@node-arena/sim';
import { createOverlayRegistry, readOverlays } from '../src/render/overlays.js';

const view = { tower: { slots: new Int32Array([3]), lines: new Int32Array([2]), col: { 'garrison.count': new Int32Array([19]) } } } as unknown as SimView;
describe('component overlay boundary', () => {
  it('uses count and slots/lines columns only for registered components', () => {
    const registry = createOverlayRegistry();
    expect(readOverlays(registry, ['unknown', 'capturable'], view, 0)).toEqual([]);
    expect(readOverlays(registry, ['garrison', 'drawsLines'], view, 0)).toEqual([
      { key: 'garrison', text: '19', description: 'Garrison 19' },
      { key: 'drawsLines', text: '●●○', description: 'Lines 2 of 3 slots' },
    ]);
  });
  it('supports a future component in one registration and no tower-specific dispatch', () => {
    const registry = createOverlayRegistry();
    registry.set('fixture.component', () => ({ text: 'ring', description: 'Range indicator' }));
    expect(readOverlays(registry, ['fixture.component'], view, 0)).toEqual([{ key: 'fixture.component', text: 'ring', description: 'Range indicator' }]);
    expect(readOverlays(registry, ['garrison'], { tower: { col: {} } } as unknown as SimView, 0)).toEqual([]);
  });
});
