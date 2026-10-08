import type { CompiledTower } from '@node-arena/content';
import type { SimState, Troop } from './state.js';
import type { DrawValidation } from './commands.js';
import { generate, depart, refreshSlots, validateLine } from './economy.js';
import { capturableHit, garrisonArrive } from './combat.js';

/** Fixed rule phases; order within a phase is explicit, then component name. */
export const PHASES = ['commands', 'generation', 'departures', 'clash', 'arrivals', 'slots', 'win'] as const;
export type Phase = typeof PHASES[number];
export interface ComponentSystem {
  readonly order: number;
  readonly run: (state: SimState, towers: Int32Array) => void;
}
export interface ComponentHooks {
  readonly validateDraw?: (state: SimState, player: number, from: number, to: number) => DrawValidation;
  readonly onCapture?: (state: SimState, tower: number) => void;
  readonly onArrive?: (state: SimState, tower: number, troop: Troop) => void;
  readonly onHit?: (state: SimState, tower: number, troop: Troop) => void;
}
export interface SimComponent {
  readonly name: string;
  readonly state: Readonly<Record<string, number>>;
  readonly setup?: (state: SimState, towers: Int32Array) => void;
  readonly initialize?: (tower: CompiledTower, columns: Record<string, Int32Array>, index: number) => void;
  readonly systems?: Partial<Readonly<Record<Phase, ComponentSystem>>>;
  readonly hooks?: ComponentHooks;
}
export const compareNames = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function sortedNames(object: object): string[] {
  return Object.keys(object).sort(compareNames);
}
export class ComponentRegistry {
  private readonly entries = new Map<string, SimComponent>();

  registerComponent(component: SimComponent): void {
    if (this.entries.has(component.name)) throw new Error(`Duplicate component: ${component.name}`);
    for (const name of sortedNames(component.state)) {
      const value = component.state[name]!;
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError('Component state must be int32');
    }
    this.entries.set(component.name, { ...component, state: { ...component.state }, systems: { ...component.systems }, hooks: { ...component.hooks } });
  }

  definitions(): SimComponent[] {
    return [...this.entries.values()].sort((a, b) => compareNames(a.name, b.name));
  }

  assertParity(contentNames: readonly string[]): void {
    const actual = this.definitions().map(component => component.name);
    const expected = [...contentNames].sort(compareNames);
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`Component registry parity mismatch: sim [${actual.join(',')}] content [${expected.join(',')}]`);
    }
  }
}

/** V1 components own their columns and registered mechanics. */
export function createComponentRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  registry.registerComponent({ name: 'garrison', state: { count: 0, cap: 0 }, hooks: { onArrive: garrisonArrive }, initialize(tower, col, i) {
    col['garrison.count']![i] = tower.garrison;
    col['garrison.cap']![i] = tower.components.garrison!.cap!;
  } });
  registry.registerComponent({ name: 'generates', state: { acc: 0, ratePerSec: 0, troop: 0 }, systems: { generation: { order: 0, run: generate } }, hooks: { onCapture(state, tower) { state.tower.col['generates.acc']![tower] = 0; } }, initialize(tower, col, i) {
    col['generates.ratePerSec']![i] = tower.components.generates!.ratePerSec!;
    col['generates.troop']![i] = tower.components.generates!.troop!;
  } });
  registry.registerComponent({ name: 'drawsLines', state: { cursor: -1 }, setup: refreshSlots, systems: { generation: { order: 1, run: refreshSlots }, departures: { order: 0, run: depart } }, hooks: { validateDraw: validateLine, onCapture(state, tower) { state.tower.col['drawsLines.cursor']![tower] = -1; } } });
  registry.registerComponent({ name: 'capturable', state: {}, hooks: { onHit: capturableHit } });
  return registry;
}
