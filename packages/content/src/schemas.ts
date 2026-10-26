import Type, { type TObject, type TSchema } from 'typebox';
import { ManifestSchema } from './manifest.schema.js';
import { ManifestArtSchema } from './manifest-art.schema.js';
import { BOT_KINDS, MODULES, OBJECTIVES, count, fx3, type ModuleId } from '@node-arena/defs';

/** Content v2 schemas live beside v1 (`../core.schema.ts`); nothing here replaces the old game's data model. */
export const SCHEMA_VERSION = '2.0.0';

const idPattern = '^[a-z0-9][a-z0-9-]*$';
const id = () => Type.String({ pattern: idPattern });
const visual = () => Type.String({ minLength: 1, 'x-presentation': true });
const envelope = { $schema: Type.String({ minLength: 1 }), schemaVersion: Type.Literal(SCHEMA_VERSION) };
const options = (name: string) => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://node-arena.local/schemas/${name}.schema.json`,
  title: name,
  additionalProperties: false,
});

type ModuleSelect = 'building' | 'element';
const moduleIds = (appliesTo: ModuleSelect) => (Object.keys(MODULES) as ModuleId[]).filter((k) => MODULES[k].appliesTo === appliesTo);

/** Type.Partial drops `additionalProperties`; re-close the object so unknown params stay errors. */
const strictPartial = (params: TObject): TObject => Type.Object(Type.Partial(params).properties, { additionalProperties: false });

/**
 * Module bags keyed by module id, built from the defs registry. `full` = archetype (complete params),
 * otherwise Type.Partial per module (instance overrides). Every fx3 param stays under `properties`,
 * never under oneOf/anyOf, so `convertFixedPoint` scales overrides exactly like archetype values.
 */
function moduleBags(appliesTo: ModuleSelect, full: boolean): TObject {
  const shape: Record<string, TSchema> = {};
  for (const key of moduleIds(appliesTo)) {
    const params = MODULES[key].params;
    shape[key] = Type.Optional(full ? params : strictPartial(params));
  }
  return Type.Object(shape, { additionalProperties: false });
}

/**
 * Footprint: a flat object (fx3 fields must stay under `properties`, not `oneOf`, because the
 * walker does not descend combinators). Shape-specific required fields use if/then, which adds
 * validation without hiding properties from the walker.
 */
const dim = () => fx3({ exclusiveMinimum: 0, maximum: 100 });
export const FootprintSchema = Type.Object({
  shape: Type.Union([Type.Literal('circle'), Type.Literal('box')]),
  radius: Type.Optional(dim()),
  w: Type.Optional(dim()),
  d: Type.Optional(dim()),
}, {
  additionalProperties: false,
  if: { properties: { shape: { const: 'circle' } } },
  then: { required: ['radius'], properties: { radius: {}, w: false, d: false } },
  else: { required: ['w', 'd'], properties: { w: {}, d: {}, radius: false } },
});

export const UnitSchema = Type.Object({
  ...envelope, id: id(), visual: visual(),
  speed: fx3({ exclusiveMinimum: 0 }),
  hp: count({ minimum: 1 }), attack: count({ minimum: 1 }), defense: count({ minimum: 1 }),
}, options('unit'));

export const BuildingSchema = Type.Object({
  ...envelope, id: id(),
  kind: Type.Union([Type.Literal('house'), Type.Literal('tower')]),
  visual: visual(), footprint: FootprintSchema, special: Type.Boolean(),
  modules: moduleBags('building', true),
}, options('building'));

export const ElementSchema = Type.Object({
  ...envelope, id: id(), visual: visual(), footprint: FootprintSchema,
  modules: moduleBags('element', true),
  variants: Type.Optional(Type.Array(Type.Union([Type.Literal('small'), Type.Literal('big')]), { minItems: 1, uniqueItems: true })),
}, options('element'));

export const BalanceSchema = Type.Object({
  ...envelope,
  stageThresholds: Type.Array(count({ minimum: 1 }), { minItems: 2, maxItems: 2 }),
  spawn: Type.Object({ aliveCap: count({ minimum: 1, maximum: 1000 }) }, { additionalProperties: false }),
  growth: Type.Object({ base: fx3({ exclusiveMinimum: 0 }) }, { additionalProperties: false }),
  contactDistance: fx3({ exclusiveMinimum: 0 }),
  laneHalfWidth: fx3({ exclusiveMinimum: 0 }),
}, options('balance'));

/** `content.json`: version metadata for the whole dataset (not a catalog entity). */
export const ContentSchema = Type.Object({
  ...envelope,
  contentVersion: Type.String({ pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' }),
  rulesVersion: Type.String({ pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' }),
}, options('content'));
export type ContentMeta = Type.Static<typeof ContentSchema>;

export const CampaignSchema = Type.Object({
  ...envelope, id: id(),
  entries: Type.Array(Type.Object({ level: id(), position: count({ minimum: 1 }) }, { additionalProperties: false }), { minItems: 1 }),
}, options('campaign'));

/** Seat `bot` block: validated against the registry's kinds (no fx3 inside, so a union is safe). */
const botKinds = Object.values(BOT_KINDS).map((k) => k.params as TSchema);
const BotBlock: TSchema = botKinds.length === 1 ? botKinds[0]! : Type.Union(botKinds);

const pos = () => Type.Object({
  x: fx3({ minimum: -500, maximum: 500 }), z: fx3({ minimum: -500, maximum: 500 }),
}, { additionalProperties: false });
const coord = () => fx3({ minimum: -500, maximum: 500 });

const objectiveIds = Object.keys(OBJECTIVES).map((k) => Type.Literal(k));

export const LevelSchema = Type.Object({
  ...envelope, id: id(), name: Type.String({ minLength: 1, 'x-presentation': true }),
  editorVersion: Type.Optional(Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$', 'x-presentation': true })),
  source: Type.Optional(Type.Object({
    game: Type.String({ minLength: 1 }), gameVersion: Type.String({ minLength: 1 }), asset: Type.String({ minLength: 1 }),
    campaignPosition: Type.Optional(count({ minimum: 1 })),
    dialect: Type.Optional(Type.String({ minLength: 1 })),
    dropped: Type.Optional(Type.Array(Type.String())),
  }, { additionalProperties: false })),
  theme: visual(),
  bounds: Type.Object({ minX: coord(), maxX: coord(), minZ: coord(), maxZ: coord() }, { additionalProperties: false }),
  objective: objectiveIds.length === 1 ? objectiveIds[0]! : Type.Union(objectiveIds),
  timeLimitSec: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 107374182 }), Type.Null()])),
  players: Type.Array(Type.Object({
    id: id(), kind: Type.Union([Type.Literal('human'), Type.Literal('ai')]), colorKey: visual(),
    bot: Type.Optional(BotBlock),
  }, { additionalProperties: false }), { minItems: 2 }),
  buildings: Type.Array(Type.Object({
    id: id(), archetype: id(), pos: pos(), owner: Type.Union([id(), Type.Null()]),
    level: count({ minimum: 1 }), ignoreForWin: Type.Boolean(),
    params: Type.Optional(moduleBags('building', false)),
  }, { additionalProperties: false }), { minItems: 1 }),
  elements: Type.Array(Type.Object({
    id: id(), archetype: id(), pos: pos(), yawDeg: fx3({ minimum: -360, maximum: 360 }),
    /** Per-instance footprint override (e.g. 05's per-child collider box); defaults to the archetype footprint. */
    footprint: Type.Optional(FootprintSchema),
    variant: Type.Optional(Type.Union([Type.Literal('small'), Type.Literal('big')])),
    params: Type.Optional(moduleBags('element', false)),
  }, { additionalProperties: false })),
  requires: Type.Array(Type.String({ minLength: 1 })),
}, options('level'));

export type NextUnit = Type.Static<typeof UnitSchema>;
export type NextBuilding = Type.Static<typeof BuildingSchema>;
export type NextElement = Type.Static<typeof ElementSchema>;
export type NextBalance = Type.Static<typeof BalanceSchema>;
export type NextCampaign = Type.Static<typeof CampaignSchema>;
export type NextLevel = Type.Static<typeof LevelSchema>;

/** Generated to `schemas/<name>.schema.json` by `scripts/generate-schemas.ts`. */
export const NextSchemas = {
  content: ContentSchema, unit: UnitSchema, building: BuildingSchema, element: ElementSchema,
  level: LevelSchema, campaign: CampaignSchema, balance: BalanceSchema, manifest: ManifestSchema, 'manifest-art': ManifestArtSchema,
};
