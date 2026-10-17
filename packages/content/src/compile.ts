import type { Archetype, Balance, Level } from './core.schema.js';
import type { BotProfile } from './bot.schema.js';
import type { BotParams } from './bot-params.js';
import type { LoadedContent } from './parse-content.js';
import { COMPONENT_REGISTRY } from './component-registry.js';
import { ContentLoadError } from './fixed-point.js';
import { resolveLevelOverrides } from './resolve-overrides.js';
import { hashBotProfile, hashCompiledLevel } from './hash.js';
import { resolveProfiles } from './resolve-profiles.js';

/** Flat loaded-unit params; generates.troop is a dense index into kinds. */
export type CompiledComponentParams = Omit<Archetype['components'][string], 'troop'> & { troop?: number };
export type CompiledComponents = Record<string, CompiledComponentParams>;
export interface CompiledTower {
  id: string;
  archetype: string;
  x: number;
  y: number;
  owner: number;
  garrison: number;
  visual: string;
  footprintRadius: number;
  components: CompiledComponents;
}
export interface CompiledPlayer {
  id: string;
  kind: Level['players'][number]['kind'];
  colorKey: string;
  team: string;
}
export interface CompiledTroopKind {
  id: string;
  value: number;
  speedMilli: number;
  visual: string;
}
/** Inheritance/schema metadata is absent; all fx3 params are already integers. */
export interface ResolvedBotProfile {
  id: string;
  kind: BotProfile['kind'];
  params: Omit<BotParams, 'extends'>;
}
export interface CompiledBot { player: number; profile: ResolvedBotProfile }

/** Only compiler output crosses the sim boundary. Numeric fields use loaded units:
 * coordinates/radii/rates/speeds and bot fx3 params are milli-units; counts,
 * durations and dense indices are unscaled integers. Visual keys pass through.
 */
export interface CompiledLevel {
  /** Authoritative registry names, for type-only consumers to assert parity. */
  componentNames: readonly string[];
  id: string;
  timeLimitSec: number;
  visual: string;
  bounds: Level['bounds'];
  globals: Balance['defaults'];
  towers: CompiledTower[];
  players: CompiledPlayer[];
  /** Referenced troop kinds only, sorted by id; generates.troop indexes this array. */
  kinds: CompiledTroopKind[];
  bots: CompiledBot[];
  /** Identity of resolved simulation inputs, excluding presentation and bots. */
  simHash: string;
  /** Separate identities of referenced resolved bot profiles. */
  botHash: Record<string, string>;
}

const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Compile validated, path-keyed loadContent output without rescaling or mutation.
 * Overrides operate on resolved archetypes; profiles resolve in the same loaded units.
 */
export function compileLevel(content: LoadedContent, levelId: string): CompiledLevel {
  const entry = Object.entries(content).find((entry): entry is [string, Level] => 'towers' in entry[1] && entry[1].id === levelId);
  if (!entry) throw new ContentLoadError([{ file: levelId, pointer: '/id', message: 'Unknown level id' }]);
  const [file, level] = entry;
  const { archetypes, troops, globals } = resolveLevelOverrides(content, level, file);
  const timeLimitSec = level.timeLimitSec ?? globals.timeLimitSec;
  if (!Number.isInteger(timeLimitSec) || timeLimitSec < 1 || timeLimitSec > 107374182) {
    const balanceFile = Object.entries(content).find(([, entity]) => 'defaults' in entity)?.[0] ?? file;
    const explicit = level.timeLimitSec !== undefined;
    const overridden = level.overrides.globals?.timeLimitSec !== undefined;
    throw new ContentLoadError([{ file: explicit || overridden ? file : balanceFile, pointer: explicit ? '/timeLimitSec' : overridden ? '/overrides/globals/timeLimitSec' : '/defaults/timeLimitSec', message: 'Duration must resolve to positive int32 ticks (maximum 107374182 seconds)' }]);
  }
  const players: CompiledPlayer[] = [...level.players].sort(byId).map(player => ({ id: player.id, kind: player.kind, colorKey: player.colorKey, team: player.team ?? player.id }));
  const playerIndices = new Map(players.map((player, index) => [player.id, index]));
  const sourceTowers = [...level.towers].sort(byId);
  const referencedTroops = new Set(sourceTowers.flatMap(tower => {
    const troop = archetypes[tower.archetype]!.components.generates?.troop;
    return troop === undefined ? [] : [troop];
  }));
  const kinds: CompiledTroopKind[] = [...referencedTroops].map(id => troops[id]!).sort(byId).map(troop => ({ id: troop.id, value: troop.value, speedMilli: troop.speed, visual: troop.visual }));
  const kindIndices = new Map(kinds.map((kind, index) => [kind.id, index]));
  const towers: CompiledTower[] = sourceTowers.map(tower => {
    const archetype = archetypes[tower.archetype]!;
    const components: CompiledComponents = {};
    for (const name of Object.keys(archetype.components).sort()) {
      const { troop, ...params } = structuredClone(archetype.components[name]!);
      components[name] = { ...params, ...(troop === undefined ? {} : { troop: kindIndices.get(troop)! }) };
    }
    return { id: tower.id, archetype: tower.archetype, x: tower.pos.x, y: tower.pos.y, owner: tower.owner === null ? -1 : playerIndices.get(tower.owner)!, garrison: tower.garrison, visual: archetype.visual, footprintRadius: archetype.footprintRadius, components };
  });
  const profiles = new Map(Object.values(resolveProfiles(content)).map(profile => [profile.id, profile]));
  const bots: CompiledBot[] = [...level.players].sort(byId).flatMap((player, index) => {
    if (player.kind !== 'bot') return [];
    const profile = profiles.get(player.botProfile!)!;
    const params = structuredClone(profile.params);
    delete params.extends;
    return [{ player: index, profile: { id: profile.id, kind: profile.kind, params } }];
  });
  const compiled = { componentNames: Object.keys(COMPONENT_REGISTRY.components).sort((a, b) => a < b ? -1 : a > b ? 1 : 0), id: level.id, timeLimitSec, visual: level.visual ?? globals.theme, bounds: structuredClone(level.bounds), globals, towers, players, kinds, bots };
  return { ...compiled, simHash: hashCompiledLevel(compiled), botHash: Object.fromEntries(bots.map(bot => [bot.profile.id, hashBotProfile(bot.profile)])) };
}
