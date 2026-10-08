import type { CompiledLevel, CompiledPlayer, CompiledTower, CompiledComponents } from '@node-arena/content';
import { step, validateDraw, type Command, type RejectReason, type SimEvent } from './commands.js';
import { TICK_RATE, isqrt, Sfc32 } from './math.js';
import { ComponentRegistry, createComponentRegistry, PHASES, sortedNames, compareNames, type Phase, type SimComponent, type ComponentSystem } from './registry.js';

export interface Troop { p0: number; t0: number; owner: number; kind: number; seq: number; value: number }
const troopColumns = ['p0', 't0', 'owner', 'kind', 'seq', 'value'] as const;
/** FIFO SoA ring. Remaining value belongs to each entry, so tank fronts survive partial clashes. */
export class TroopRing {
  private col: Record<typeof troopColumns[number], Int32Array> = { p0: new Int32Array(1), t0: new Int32Array(1), owner: new Int32Array(1), kind: new Int32Array(1), seq: new Int32Array(1), value: new Int32Array(1) };
  private head = 0;
  size = 0;

  push(troop: Troop): void {
    if (this.size === this.col.p0.length) {
      for (const name of troopColumns) {
        const old = this.col[name];
        const next = new Int32Array(old.length * 2);
        for (let i = 0; i < this.size; i++) next[i] = old[(this.head + i) % old.length]!;
        this.col[name] = next;
      }
      this.head = 0;
    }
    const index = (this.head + this.size) % this.col.p0.length;
    for (const name of troopColumns) this.col[name][index] = troop[name];
    this.size++;
  }

  front(): Troop | undefined {
    if (this.size === 0) return undefined;
    const i = this.head;
    return { p0: this.col.p0[i]!, t0: this.col.t0[i]!, owner: this.col.owner[i]!, kind: this.col.kind[i]!, seq: this.col.seq[i]!, value: this.col.value[i]! };
  }

  shift(): void {
    if (this.size === 0) return;
    this.head = (this.head + 1) % this.col.p0.length;
    this.size--;
  }

  consumeFront(value: number): number {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('Expected nonnegative integer value');
    if (this.size === 0) return 0;
    const removed = Math.min(value, this.col.value[this.head]!);
    this.col.value[this.head] = this.col.value[this.head]! - removed;
    if (this.col.value[this.head] === 0) this.shift();
    return removed;
  }
}
export interface Channel { key: number; from: number; to: number; length: number; drawn: number; drawSeq: number; owner: number; troops: TroopRing }
export interface PlayerState {
  team: Int32Array; alive: Int32Array; transit: Int32Array;
  kind: CompiledPlayer['kind'][]; colorKey: string[];
  stats: { generated: Int32Array; overflowLost: Int32Array; kills: Int32Array; captures: Int32Array };
}
export interface TowerState { owner: Int32Array; team: Int32Array; slots: Int32Array; lines: Int32Array; col: Record<string, Int32Array> }
export interface ScheduledSystem extends ComponentSystem { readonly component: string }
export interface SimState {
  tick: number;
  over: { outcome: string; winnerTeam: number | null } | null;
  rejected: number;
  drawSeq: number;
  troopSeq: number;
  pendingDepartures: Int32Array;
  events: SimEvent[] | null;
  step(commands: readonly Command[], options?: { events?: boolean }): readonly SimEvent[];
  canDraw(player: string, from: string, to: string): RejectReason | null;
  resetOnCapture(tower: number): void;
  timeLimitTicks: number;
  visual: string;
  ids: { players: string[]; towers: string[] };
  players: PlayerState;
  tower: TowerState;
  towerStatic: { x: number; y: number; archetype: string; visual: string; footprintRadius: number; components: string[] }[];
  towerParams: CompiledComponents[];
  kinds: { id: string; value: number; speedPerTick: number; visual: string }[];
  /** Indexed from*N+to. All lengths are precomputed, channels remain lazy. */
  lengths: Int32Array;
  channels: (Channel | undefined)[];
  componentTowers: Map<string, Int32Array>;
  components: readonly SimComponent[];
  systems: Record<Phase, ScheduledSystem[]>;
  prng: Sfc32;
  ensureChannel(from: number, to: number): Channel;
}
export interface CreateOptions { readonly registry?: ComponentRegistry }

/** Staged constructor through arrivals/capture; outcome/view/hash follow in later tasks. */
export function create(level: CompiledLevel, seed: number, options: CreateOptions = {}): SimState {
  const registry = options.registry ?? createComponentRegistry();
  registry.assertParity(level.componentNames);
  const components = registry.definitions();
  const names = new Set(components.map(component => component.name));
  const n = level.towers.length;
  const p = level.players.length;
  const column = () => new Int32Array(n);
  const playerColumn = () => new Int32Array(p);
  const players: PlayerState = { team: playerColumn(), alive: playerColumn(), transit: playerColumn(), kind: level.players.map(player => player.kind), colorKey: level.players.map(player => player.colorKey), stats: { generated: playerColumn(), overflowLost: playerColumn(), kills: playerColumn(), captures: playerColumn() } };
  const teams = new Map<string, number>();
  for (let i = 0; i < p; i++) {
    const team = level.players[i]!.team;
    if (!teams.has(team)) teams.set(team, teams.size);
    players.team[i] = teams.get(team)!;
  }
  const tower: TowerState = { owner: column(), team: column(), slots: column(), lines: column(), col: Object.create(null) as Record<string, Int32Array> };
  const componentTowers = new Map<string, Int32Array>();
  const systems: Record<Phase, ScheduledSystem[]> = { commands: [], generation: [], departures: [], clash: [], arrivals: [], slots: [], win: [] };
  for (const component of components) {
    const indices: number[] = [];
    for (let i = 0; i < n; i++) if (Object.hasOwn(level.towers[i]!.components, component.name)) indices.push(i);
    componentTowers.set(component.name, Int32Array.from(indices));
    for (const name of sortedNames(component.state)) {
      const col = column();
      for (const i of indices) col[i] = component.state[name]!;
      tower.col[`${component.name}.${name}`] = col;
    }
    for (const i of indices) component.initialize?.(level.towers[i]!, tower.col, i);
    for (const phase of PHASES) {
      const system = component.systems?.[phase];
      if (system) systems[phase].push({ ...system, component: component.name });
    }
  }
  for (const phase of PHASES) systems[phase].sort((a, b) => a.order - b.order || compareNames(a.component, b.component));
  for (let i = 0; i < n; i++) {
    const source = level.towers[i]!;
    for (const name of sortedNames(source.components)) if (!names.has(name)) throw new Error(`Unknown component: ${name}`);
    tower.owner[i] = source.owner;
    tower.team[i] = source.owner === -1 ? -1 : players.team[source.owner]!;
    if (source.owner !== -1) players.alive[source.owner] = 1;
  }
  const lengths = new Int32Array(n * n);
  for (let from = 0; from < n; from++) for (let to = from + 1; to < n; to++) {
    const dx = (level.towers[to]!.x - level.towers[from]!.x) * TICK_RATE;
    const dy = (level.towers[to]!.y - level.towers[from]!.y) * TICK_RATE;
    const length = isqrt(dx * dx + dy * dy);
    lengths[from * n + to] = length;
    lengths[to * n + from] = length;
  }
  const channels: (Channel | undefined)[] = Array.from({ length: n * n }, () => undefined);
  const state: SimState = { tick: 0, over: null, rejected: 0, drawSeq: 0, troopSeq: 0, pendingDepartures: column(), events: null,
    step(commands, options) { return step(state, commands, options); },
    canDraw(player, from, to) { return validateDraw(state, player, from, to).reason; },
    resetOnCapture(tower) {
      for (const component of components) if (Object.hasOwn(state.towerParams[tower]!, component.name)) component.hooks?.onCapture?.(state, tower);
    }, timeLimitTicks: level.timeLimitSec * TICK_RATE, visual: level.visual, ids: { players: level.players.map(player => player.id), towers: level.towers.map(tower => tower.id) }, players, tower,
    towerStatic: level.towers.map((tower: CompiledTower) => ({ x: tower.x, y: tower.y, archetype: tower.archetype, visual: tower.visual, footprintRadius: tower.footprintRadius, components: sortedNames(tower.components) })),
    towerParams: level.towers.map(tower => Object.fromEntries(sortedNames(tower.components).map(name => [name, Object.fromEntries(Object.entries(tower.components[name]!).sort(([a], [b]) => compareNames(a, b)).map(([param, value]) => {
      return [param, Array.isArray(value) ? [...value] : value];
    }))]))),
    kinds: level.kinds.map(kind => ({ id: kind.id, value: kind.value, speedPerTick: kind.speedMilli, visual: kind.visual })), lengths, channels, componentTowers, components, systems, prng: new Sfc32(seed),
    ensureChannel(from, to) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || from === to) throw new RangeError('Invalid channel pair');
      const key = from * n + to;
      return channels[key] ??= { key, from, to, length: lengths[key]!, drawn: 0, drawSeq: 0, owner: -1, troops: new TroopRing() };
    },
  };
  for (const component of components) component.setup?.(state, componentTowers.get(component.name)!);
  return state;
}
