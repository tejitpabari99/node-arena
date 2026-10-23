import type { SimView } from '@node-arena/sim';

export interface OverlayValue { text: string; description: string }
export type OverlayReader = (view: SimView, index: number) => OverlayValue | null;
/** Presentation dispatch uses component names only. Future components register here. */
export type OverlayRegistry = Map<string, OverlayReader>;
export function createOverlayRegistry(): OverlayRegistry {
  return new Map<string, OverlayReader>([
    ['level', (view, index) => {
      const level = view.buildings.level[index];
      return level === undefined ? null : { text: String(level), description: `Level ${level}` };
    }],
    ['drawsLines', (view, index) => {
      const lines = view.buildings.lines[index];
      return lines === undefined ? null : { text: String(lines), description: `${lines} active lines` };
    }],
    ['capturable', () => null],
  ]);
}
export function readOverlays(registry: ReadonlyMap<string, OverlayReader>, components: readonly string[], view: SimView, index: number): (OverlayValue & { key: string })[] {
  const values: (OverlayValue & { key: string })[] = [];
  for (const key of components) { const value = registry.get(key)?.(view, index); if (value) values.push({ key, ...value }); }
  return values;
}
