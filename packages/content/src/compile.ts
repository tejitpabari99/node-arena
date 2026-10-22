import { MODULES, type ModuleId } from '@node-arena/defs';
import type { Catalog } from './catalog.js';
import { sha256, canonicalJson } from './hash.js';
import { computeRequires, mergeModules, type ModuleBags, type SeatBot } from './level.js';
import type { NextLevel } from './schemas.js';

export interface CompiledFootprint { shape: 'circle' | 'box'; radius?: number; w?: number; d?: number }
export interface CompiledRules {
  timeLimitSec: number | null;
  stageThresholds: number[];
  aliveCap: number;
  growth: { base: number };
  contactDistance: number;
  laneHalfWidth: number;
}
export interface CompiledPlayer { id: string; kind: 'human' | 'ai'; colorKey: string }
export interface CompiledUnit { id: string; visual: string; speed: number; hp: number; attack: number; defense: number }
export interface CompiledBuilding {
  id: string; archetype: string; x: number; z: number;
  /** Dense player index, -1 = neutral. */
  owner: number;
  level: number; ignoreForWin: boolean; special: boolean;
  footprint: CompiledFootprint; visual: string; modules: ModuleBags;
}
export interface CompiledElement {
  id: string; archetype: string; x: number; z: number; yawMilliDeg: number;
  footprint: CompiledFootprint; visual: string; variant?: string; modules: ModuleBags;
}
export interface CompiledBot { player: number; bot: SeatBot }
export interface CompiledLevel {
  id: string; objective: string; timeLimitSec: number | null;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  theme: string;
  rules: CompiledRules;
  players: CompiledPlayer[];
  /** Referenced units only, sorted by id; array index is the dense unit index. */
  units: CompiledUnit[];
  buildings: CompiledBuilding[];
  elements: CompiledElement[];
  bots: CompiledBot[];
  requires: string[];
  simHash: string;
  /** Keyed `<levelId>#<playerId>`. */
  botHash: Record<string, string>;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new TypeError(`compileLevel: ${what} (validate with loadLevel first)`);
  return value;
}

const footprint = (f: { shape: 'circle' | 'box'; radius?: number; w?: number; d?: number }): CompiledFootprint =>
  f.shape === 'circle' ? { shape: 'circle', radius: must(f.radius, 'circle radius') } : { shape: 'box', w: must(f.w, 'box w'), d: must(f.d, 'box d') };

/** Params tagged `x-presentation` per module (never hashed). */
const PRESENTATION: Record<string, ReadonlySet<string>> = Object.fromEntries(
  (Object.keys(MODULES) as ModuleId[]).map((id) => {
    const props = (MODULES[id].params as unknown as { properties: Record<string, Record<string, unknown>> }).properties;
    return [id, new Set(Object.keys(props).filter((k) => props[k]!['x-presentation'] === true))];
  }),
);
const simModules = (modules: ModuleBags): ModuleBags => Object.fromEntries(
  Object.entries(modules).map(([id, params]) => [id, Object.fromEntries(Object.entries(params).filter(([k]) => !PRESENTATION[id]?.has(k)))]),
);

/**
 * Simulation hash. Excludes name, source, theme, visual, variant, x-presentation params and bots.
 * Array order is semantic (dense indices), so arrays are hashed as authored; bounds are hashed.
 */
export function computeSimHash(level: Omit<CompiledLevel, 'simHash' | 'botHash'>): string {
  return sha256(canonicalJson({
    id: level.id, objective: level.objective, timeLimitSec: level.timeLimitSec, bounds: level.bounds, rules: level.rules,
    players: level.players,
    units: level.units.map(({ visual: _v, ...u }) => u),
    buildings: level.buildings.map(({ visual: _v, modules, ...b }) => ({ ...b, modules: simModules(modules) })),
    elements: level.elements.map(({ visual: _v, variant: _variant, modules, ...e }) => ({ ...e, modules: simModules(modules) })),
    requires: level.requires,
  }));
}

/** Per-seat bot hash input: level id, player id, the seat's bot block. */
export function computeBotHash(levelId: string, playerId: string, bot: CompiledBot['bot']): string {
  return sha256(canonicalJson({ level: levelId, player: playerId, bot }));
}

/** Resolve a validated level against the catalog (archetypes merged with overrides, fx3 as milli-ints). */
export function compileLevel(catalog: Catalog, level: NextLevel): CompiledLevel {
  const playerIndex = new Map(level.players.map((p, i) => [p.id, i]));
  const unitIds = new Set<string>();
  const buildings: CompiledBuilding[] = level.buildings.map((b) => {
    const arch = must(catalog.buildings[b.archetype], `unknown building archetype ${b.archetype}`);
    const modules = mergeModules(arch.modules as ModuleBags, b.params as ModuleBags | undefined);
    const troop = modules.spawns?.troop;
    if (typeof troop === 'string') unitIds.add(troop);
    return {
      id: b.id, archetype: b.archetype, x: b.pos.x, z: b.pos.z,
      owner: b.owner === null ? -1 : must(playerIndex.get(b.owner), `unknown owner ${b.owner}`),
      level: b.level, ignoreForWin: b.ignoreForWin, special: arch.special,
      footprint: footprint(arch.footprint), visual: arch.visual, modules,
    };
  });
  const elements: CompiledElement[] = level.elements.map((e) => {
    const arch = must(catalog.elements[e.archetype], `unknown element archetype ${e.archetype}`);
    return {
      id: e.id, archetype: e.archetype, x: e.pos.x, z: e.pos.z, yawMilliDeg: e.yawDeg,
      footprint: footprint(e.footprint ?? arch.footprint), visual: arch.visual,
      ...(e.variant !== undefined ? { variant: e.variant } : {}),
      modules: mergeModules(arch.modules as ModuleBags, e.params as ModuleBags | undefined),
    };
  });
  const units: CompiledUnit[] = [...unitIds].sort().map((id) => {
    const u = must(catalog.units[id], `unknown unit ${id}`);
    return { id, visual: u.visual, speed: u.speed, hp: u.hp, attack: u.attack, defense: u.defense };
  });
  const bal = catalog.balance;
  const timeLimitSec = level.timeLimitSec ?? null;
  const players: CompiledPlayer[] = level.players.map((p) => ({ id: p.id, kind: p.kind, colorKey: p.colorKey }));
  const bots: CompiledBot[] = [];
  level.players.forEach((p, i) => { if (p.bot) bots.push({ player: i, bot: p.bot as SeatBot }); });
  const base = {
    id: level.id, objective: level.objective, timeLimitSec, bounds: { ...level.bounds }, theme: level.theme,
    rules: {
      timeLimitSec, stageThresholds: [...bal.stageThresholds], aliveCap: bal.spawn.aliveCap,
      growth: { base: bal.growth.base }, contactDistance: bal.contactDistance, laneHalfWidth: bal.laneHalfWidth,
    },
    players, units, buildings, elements, bots, requires: computeRequires(catalog, level),
  };
  const botHash: Record<string, string> = {};
  for (const { player, bot } of bots) { const id = players[player]!.id; botHash[`${level.id}#${id}`] = computeBotHash(level.id, id, bot); }
  return { ...base, simHash: computeSimHash(base), botHash };
}
