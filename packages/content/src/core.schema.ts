import Type from 'typebox';
import { BotSchema, type BotProfile } from './bot.schema.js';
import { ManifestSchema } from './manifest.schema.js';
import { SCHEMA_VERSION, TroopSchema } from './troop.schema.js';

const idPattern = '^[a-z0-9][a-z0-9-]*$';
const id = () => Type.String({ pattern: idPattern });
const visual = () => Type.String({ minLength: 1, 'x-presentation': true });
const count = () => Type.Integer({ minimum: 0, maximum: 2147483647 });
const distance = () => Type.Number({ minimum: 0, maximum: 500, 'x-unit': 'fx3' });
const envelope = { $schema: Type.String({ minLength: 1 }), schemaVersion: Type.Literal(SCHEMA_VERSION) };
const options = (name: string) => ({ $schema: 'http://json-schema.org/draft-07/schema#', $id: `https://node-arena.local/schemas/${name}.schema.json`, title: name, additionalProperties: false });
const semver = () => Type.String({ pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' });

// Extension payloads remain flat param bags: registry validation owns param names,
// required params and ranges. Nested objects and arrays of objects are not params.
const scalar = Type.Union([Type.Integer({ minimum: -2147483647, maximum: 2147483647 }), Type.String(), Type.Boolean()]);
export const ComponentParamsSchema = Type.Object({
  cap: Type.Optional(count()),
  troop: Type.Optional(id()),
  ratePerSec: Type.Optional(Type.Number({ exclusiveMinimum: 0, 'x-unit': 'fx3' })),
  radius: Type.Optional(distance()),
  extraSlotAbove: Type.Optional(Type.Array(count())),
}, {
  additionalProperties: false,
  patternProperties: {
    // Exclude named properties so Ajv strict mode can keep overlap checking enabled.
    '^(?!(?:cap|troop|ratePerSec|radius|extraSlotAbove)$)[a-z][a-zA-Z0-9]*$': Type.Union([scalar, Type.Array(scalar)]),
  },
});
const components = () => Type.Record(Type.String({ pattern: '^[a-z][a-zA-Z0-9]*$' }), ComponentParamsSchema, { additionalProperties: false });
const defaults = { timeLimitSec: Type.Integer({ minimum: 1, maximum: 2147483647 }), theme: visual() };

export const ContentSchema = Type.Object({ ...envelope, contentVersion: semver(), rulesVersion: semver() }, options('content'));
export const BalanceSchema = Type.Object({ ...envelope, defaults: Type.Object(defaults, { additionalProperties: false }) }, options('balance'));
export const ArchetypeSchema = Type.Object({
  ...envelope, id: id(), extends: Type.Optional(id()), visual: visual(), footprintRadius: distance(), components: components(),
}, options('archetype'));

const position = Type.Object({
  x: Type.Number({ minimum: -500, maximum: 500, 'x-unit': 'fx3' }),
  y: Type.Number({ minimum: -500, maximum: 500, 'x-unit': 'fx3' }),
}, { additionalProperties: false });
const reservedObject = Type.Object({
  kind: id(), pos: Type.Optional(position), footprintRadius: Type.Optional(distance()),
  delta: Type.Optional(Type.Integer({ minimum: -2147483647, maximum: 2147483647 })), hp: Type.Optional(count()),
}, { additionalProperties: false });
const troopPatch = Type.Object({ value: Type.Optional(TroopSchema.properties.value), speed: Type.Optional(TroopSchema.properties.speed) }, { additionalProperties: false });
const archetypePatch = Type.Object({ components: components() }, { additionalProperties: false });
export const LevelSchema = Type.Object({
  ...envelope, id: id(), name: Type.String({ minLength: 1, 'x-presentation': true }),
  order: Type.Integer({ minimum: 1 }), band: Type.Integer({ minimum: 1 }),
  visual: Type.Optional(visual()), timeLimitSec: Type.Optional(defaults.timeLimitSec),
  bounds: Type.Object({ w: distance(), h: distance() }, { additionalProperties: false }),
  players: Type.Array(Type.Object({
    id: id(), kind: Type.Union([Type.Literal('human'), Type.Literal('bot')]), colorKey: visual(),
    team: Type.Optional(id()), botProfile: Type.Optional(id()),
  }, { additionalProperties: false })),
  towers: Type.Array(Type.Object({
    id: id(), archetype: id(), pos: position, owner: Type.Union([id(), Type.Null()]), garrison: count(),
  }, { additionalProperties: false })),
  obstacles: Type.Array(reservedObject), mapObjects: Type.Array(reservedObject),
  overrides: Type.Object({
    globals: Type.Optional(Type.Object({ timeLimitSec: Type.Optional(defaults.timeLimitSec) }, { additionalProperties: false })),
    troops: Type.Optional(Type.Record(Type.String({ pattern: idPattern }), troopPatch, { additionalProperties: false })),
    archetypes: Type.Optional(Type.Record(Type.String({ pattern: idPattern }), archetypePatch, { additionalProperties: false })),
  }, { additionalProperties: false }),
}, options('level'));

export type Content = Type.Static<typeof ContentSchema>;
export type Balance = Type.Static<typeof BalanceSchema>;
export type Archetype = Type.Static<typeof ArchetypeSchema>;
export type Level = Type.Static<typeof LevelSchema>;
export type CoreEntity = Content | Balance | Archetype | Level | Type.Static<typeof TroopSchema> | BotProfile;
/** Ordered schema catalog shared by the loader and generated editor artifacts. */
export const CoreSchemas = { content: ContentSchema, balance: BalanceSchema, troop: TroopSchema, archetype: ArchetypeSchema, level: LevelSchema, bot: BotSchema };
/** Editor schemas additionally include the web-owned visual manifest contract. */
export const HostedSchemas = { ...CoreSchemas, manifest: ManifestSchema };
