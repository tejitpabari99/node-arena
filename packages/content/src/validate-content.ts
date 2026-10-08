import type { Archetype, Balance, Level } from './core.schema.js';
import type { Troop } from './troop.schema.js';
import type { BotProfile } from './bot.schema.js';
import { ManifestSchema, type Manifest } from './manifest.schema.js';
import { COMPONENT_REGISTRY, validateComponents, validateTroopValue, type ComponentRegistry } from './component-registry.js';
import { ContentLoadError, escapePointerSegment as esc, type ContentIssue } from './fixed-point.js';
import { parseContent, issueForSchemaError, type ContentFileMap, type LoadedContent } from './parse-content.js';
import { resolveArchetypes } from './resolve-archetypes.js';
import { resolveProfiles } from './resolve-profiles.js';
import { resolveLevelOverrides } from './resolve-overrides.js';
import { createAjv } from './validate.js';

export interface ValidationResult { errors: ContentIssue[]; warnings: ContentIssue[] }
export interface ValidateContentOptions { manifest?: object; registry?: ComponentRegistry }
const validateManifest = createAjv().compile<Manifest>(ManifestSchema);

/** Semantic stage consumes only schema-valid loaded entities; it never parses or imports the loader. */
export function validateLoadedContent(files: LoadedContent, opts: ValidateContentOptions = {}): ValidationResult & { files: LoadedContent } {
  const errors: ContentIssue[] = []; const warnings: ContentIssue[] = [];
  const registry = opts.registry ?? COMPONENT_REGISTRY;
  const add = (file: string, pointer: string, message: string) => errors.push({ file, pointer, message });
  const entries = Object.entries(files);
  const archetypeFiles = Object.fromEntries(entries.filter((entry): entry is [string, Archetype] => 'components' in entry[1]));
  const resolved = resolveArchetypes(archetypeFiles, registry, errors);
  const resolvedFiles = { ...files, ...resolved };
  const archetypes = new Map(Object.values(resolved).map(entity => [entity.id, entity]));
  const troops = entries.filter((entry): entry is [string, Troop] => 'speed' in entry[1]);
  const troopIds = new Set(troops.map(([, t]) => t.id));
  const bots = entries.filter((entry): entry is [string, BotProfile] => 'kind' in entry[1] && 'params' in entry[1]);
  const botIds = new Set(bots.map(([, b]) => b.id));
  const levels = entries.filter((entry): entry is [string, Level] => 'towers' in entry[1]);
  const balances = entries.filter((entry): entry is [string, Balance] => 'defaults' in entry[1]);
  function unique<T extends { id: string }>(items: [string, T][], label: string) {
    const seen = new Set<string>();
    for (const [file, entity] of items) { if (seen.has(entity.id)) add(file, '/id', `Duplicate ${label} id`); seen.add(entity.id); }
  }
  unique(troops, 'troop'); unique(levels, 'level');
  for (const type of ['contentVersion', 'defaults'] as const) {
    let seen = false;
    for (const [file, entity] of entries) if (type in entity) { if (seen) add(file, '', 'Duplicate singleton content file'); seen = true; }
  }
  try { resolveProfiles(files); } catch (error) { if (!(error instanceof ContentLoadError)) throw error; errors.push(...error.errors); }

  function checkArchetype(archetype: Archetype, file: string, prefix: string, referencedTroops: Set<string>, level?: Level) {
    const patch = level?.overrides.archetypes?.[archetype.id]?.components;
    errors.push(...validateComponents(patch ?? archetype.components, file, registry, level !== undefined, `${prefix}/components`));
    const generates = archetype.components.generates;
    if ((!level || Object.hasOwn(patch?.generates ?? {}, 'troop')) && generates && typeof generates.troop === 'string' && !referencedTroops.has(generates.troop)) add(file, `${prefix}/components/generates/troop`, 'Unknown troop reference');
    const cap = archetype.components.garrison?.cap;
    const thresholds = archetype.components.drawsLines?.extraSlotAbove;
    if ((!level || Object.hasOwn(patch?.garrison ?? {}, 'cap') || Object.hasOwn(patch?.drawsLines ?? {}, 'extraSlotAbove')) && typeof cap === 'number' && Array.isArray(thresholds) && thresholds.length && typeof thresholds.at(-1) === 'number' && thresholds.at(-1)! >= cap) {
      let warningFile = file; let pointer = `${prefix}/components/drawsLines/extraSlotAbove/${thresholds.length - 1}`;
      if (level) {
        if (!Object.hasOwn(patch?.drawsLines ?? {}, 'extraSlotAbove') && Object.hasOwn(patch?.garrison ?? {}, 'cap')) pointer = `${prefix}/components/garrison/cap`;
      } else {
        const authored = archetypeFiles[file];
        if (authored?.extends && !Object.hasOwn(authored.components.drawsLines ?? {}, 'extraSlotAbove')) {
          const base = Object.entries(archetypeFiles).find(([, value]) => value.id === authored.extends);
          if (base) warningFile = base[0];
        }
      }
      warnings.push({ file: warningFile, pointer, message: 'Highest line threshold is at or above garrison cap' });
    }
  }
  for (const [file, archetype] of Object.entries(resolved)) checkArchetype(archetype, file, '', troopIds);
  for (const [file, troop] of troops) errors.push(...validateTroopValue(troop.value, file, registry));

  let manifest: Manifest | undefined;
  if (opts.manifest !== undefined) {
    if (!validateManifest(opts.manifest)) errors.push(...(validateManifest.errors ?? []).map(e => issueForSchemaError('manifest.json', e)));
    else manifest = opts.manifest;
  }
  const visual = (file: string, pointer: string, key: string, kind: 'tower' | 'troop') => {
    if (manifest && (!Object.hasOwn(manifest.visuals, key) || manifest.visuals[key]?.kind !== kind)) add(file, pointer, `Unknown or incompatible ${kind} visual key`);
  };
  const theme = (file: string, pointer: string, key: string) => {
    if (manifest && !Object.hasOwn(manifest.themes, key)) add(file, pointer, 'Unknown theme key');
  };
  for (const [file, archetype] of Object.entries(resolved)) visual(file, '/visual', archetype.visual, 'tower');
  for (const [file, troop] of troops) visual(file, '/visual', troop.visual, 'troop');
  for (const [file, balance] of balances) theme(file, '/defaults/theme', balance.defaults.theme);

  for (const [file, level] of levels) {
    const effective = resolveLevelOverrides(resolvedFiles, level, file, errors);
    for (const id of Object.keys(level.overrides.archetypes ?? {})) {
      if (effective.archetypes[id]) checkArchetype(effective.archetypes[id]!, file, `/overrides/archetypes/${esc(id)}`, new Set(Object.keys(effective.troops)), level);
    }
    for (const id of Object.keys(level.overrides.troops ?? {})) {
      if (effective.troops[id]) errors.push(...validateTroopValue(effective.troops[id]!.value, file, registry, `/overrides/troops/${esc(id)}/value`));
    }
    if (level.visual !== undefined) theme(file, '/visual', level.visual);
    const players = new Set<string>(); const teams = new Set<string>();
    const humans = level.players.filter(p => p.kind === 'human').length;
    const botCount = level.players.filter(p => p.kind === 'bot').length;
    if (humans !== 1 || botCount < 1 || botCount > 3) add(file, '/players', 'V1 needs exactly one human and one to three bots');
    for (let i = 0; i < level.players.length; i++) {
      const player = level.players[i]!; const pointer = `/players/${i}`;
      if (players.has(player.id)) add(file, `${pointer}/id`, 'Duplicate player id'); players.add(player.id);
      const team = player.team ?? player.id;
      if (teams.has(team)) add(file, `${pointer}/team`, 'V1 teams must be distinct'); teams.add(team);
      if (player.team !== undefined && !level.players.some(p => p.id === player.team)) add(file, `${pointer}/team`, 'Unknown team reference');
      if (player.kind === 'bot' && (player.botProfile === undefined || !botIds.has(player.botProfile))) add(file, `${pointer}/botProfile`, 'Unknown or missing bot profile');
      else if (player.botProfile !== undefined && !botIds.has(player.botProfile)) add(file, `${pointer}/botProfile`, 'Unknown bot profile');
      if (player.botProfile === 'reference' || player.botProfile === 'human-proxy') add(file, `${pointer}/botProfile`, 'Tooling-only bot profiles cannot be referenced by levels');
      if (manifest && Object.values(manifest.palettes).some(p => !Object.hasOwn(p, player.colorKey))) add(file, `${pointer}/colorKey`, 'Color key must exist in every palette');
    }
    const towerIds = new Set<string>(); const owners = new Set<string>();
    const geometry: { pointer: string; x: number; y: number; radius: number }[] = [];
    const addGeometry = (pointer: string, x: number, y: number, radius: number) => {
      if (2 * (Math.abs(x) + radius) > level.bounds.w) add(file, `${pointer}/pos/x`, 'Footprint exceeds map bounds');
      if (2 * (Math.abs(y) + radius) > level.bounds.h) add(file, `${pointer}/pos/y`, 'Footprint exceeds map bounds');
      for (const other of geometry) {
        const dx = x - other.x; const dy = y - other.y; const sum = radius + other.radius;
        // Coincident towers overlap even at radius 0, which would otherwise yield zero-length lines.
        if ((dx === 0 && dy === 0) || dx * dx + dy * dy < sum * sum) add(file, `${pointer}/pos`, `Footprint overlaps ${other.pointer}`);
      }
      geometry.push({ pointer, x, y, radius });
    };
    for (let i = 0; i < level.towers.length; i++) {
      const tower = level.towers[i]!; const pointer = `/towers/${i}`;
      if (towerIds.has(tower.id)) add(file, `${pointer}/id`, 'Duplicate tower id'); towerIds.add(tower.id);
      if (tower.owner !== null) { if (!players.has(tower.owner)) add(file, `${pointer}/owner`, 'Unknown owner reference'); else owners.add(tower.owner); }
      const archetype = effective.archetypes[tower.archetype] ?? archetypes.get(tower.archetype);
      if (!archetype) { add(file, `${pointer}/archetype`, 'Unknown archetype reference'); continue; }
      const cap = archetype.components.garrison?.cap;
      if (typeof cap !== 'number') add(file, `${pointer}/garrison`, 'Tower requires a garrison capacity');
      else if (tower.garrison > cap) add(file, `${pointer}/garrison`, 'Garrison exceeds effective cap');
      addGeometry(pointer, tower.pos.x, tower.pos.y, archetype.footprintRadius);
    }
    for (let i = 0; i < level.players.length; i++) if (!owners.has(level.players[i]!.id)) add(file, `/players/${i}/id`, 'Every player must own a tower');
    if (owners.size < 2) add(file, '/towers', 'At least two owners must own towers');
    for (const name of ['obstacles', 'mapObjects'] as const) for (let i = 0; i < level[name].length; i++) {
      const object = level[name][i]!; const pointer = `/${name}/${i}`;
      add(file, pointer, `${name} are not implemented in v1`);
      if (object.pos !== undefined && object.footprintRadius !== undefined) addGeometry(pointer, object.pos.x, object.pos.y, object.footprintRadius);
    }
    // Reachability hook: all tower pairs are reachable in obstacle-free v1.
  }
  const campaign = levels.filter(([file]) => /(?:^|\/)data\/levels\/\d{2}-[^/]+\.json$/.test(file));
  const orders = new Set<number>();
  const sorted = [...campaign].sort((a, b) => a[1].order - b[1].order);
  for (let i = 0; i < sorted.length; i++) {
    const [file, level] = sorted[i]!;
    if (orders.has(level.order) || level.order !== i + 1 || level.order > 20) add(file, '/order', 'Campaign order must be unique and contiguous from 1 through at most 20');
    orders.add(level.order);
  }
  return { errors, warnings, files: resolvedFiles };
}

/** Pure shared browser/server validator: schema/numeric checks precede semantic checks. */
export function validateContent(fileMap: ContentFileMap, opts: ValidateContentOptions = {}): ValidationResult {
  const parsed = parseContent(fileMap);
  const result = validateLoadedContent(parsed.files, opts);
  return { errors: [...parsed.errors, ...result.errors], warnings: result.warnings };
}
