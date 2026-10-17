import type { SimView } from '@node-arena/sim';

export interface OverlayValue { text: string; description: string }
export type OverlayReader = (view: SimView, index: number) => OverlayValue | null;
/** Presentation dispatch uses component names only. Future components register here. */
export type OverlayRegistry = Map<string, OverlayReader>;
export function createOverlayRegistry(): OverlayRegistry {
  return new Map<string, OverlayReader>([
    ['garrison', (view, index) => {
      const count = view.tower.col['garrison.count']?.[index];
      return count === undefined ? null : { text: String(count), description: `Garrison ${count}` };
    }],
    ['drawsLines', (view, index) => {
      const slots = view.tower.slots[index] ?? 0, lines = view.tower.lines[index] ?? 0;
      return { text: '●'.repeat(Math.max(0, Math.min(lines, slots))) + '○'.repeat(Math.max(0, slots - lines)), description: `Lines ${lines} of ${slots} slots` };
    }],
    ['capturable', () => null],
  ]);
}
export function readOverlays(registry: ReadonlyMap<string, OverlayReader>, components: readonly string[], view: SimView, index: number): (OverlayValue & { key: string })[] {
  const values: (OverlayValue & { key: string })[] = [];
  for (const key of components) { const value = registry.get(key)?.(view, index); if (value) values.push({ key, ...value }); }
  return values;
}
