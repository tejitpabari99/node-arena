import Type from 'typebox';
import { SCHEMA_VERSION } from './troop.schema.js';

const closed = { additionalProperties: false };
const key = () => Type.String({ minLength: 1 });
const color = () => Type.String({ pattern: '^#[0-9a-fA-F]{6}$' });
const positive = () => Type.Number({ exclusiveMinimum: 0 });
const vector = () => Type.Array(Type.Number(), { minItems: 3, maxItems: 3 });
const map = <T extends Type.TSchema>(schema: T) => Type.Record(Type.String({ minLength: 1 }), schema, closed);
const model = Type.Union([
  Type.Object({ src: key() }, closed),
  Type.Object({ primitive: Type.Union([Type.Literal('box'), Type.Literal('capsule'), Type.Literal('cylinder')]), size: Type.Array(positive(), { minItems: 3, maxItems: 3 }) }, closed),
]);
const anim = Type.Union([
  Type.Object({ type: Type.Literal('none') }, closed),
  Type.Object({ type: Type.Literal('bob'), hz: positive(), amp: Type.Number({ minimum: 0 }), sway: Type.Number({ minimum: 0 }) }, closed),
]);
const effect = { sfx: Type.Optional(key()), fx: Type.Optional(key()) };

/** Presentation-only values keep authored units; asset/key resolution belongs to SP03.
 * Theme ground/sky are hex colours; props use model refs and world-space xyz vectors.
 * fx/sfx are renderer/audio keys; the runtime owns their interpretation and assets.
 */
export const ManifestSchema = Type.Object({
  $schema: Type.String({ minLength: 1 }), schemaVersion: Type.Literal(SCHEMA_VERSION),
  palettes: Type.Object({ default: map(color()), colorblind: map(color()) }, closed),
  teamMarkers: map(key()),
  models: map(model),
  visuals: map(Type.Object({
    kind: Type.Union([Type.Literal('tower'), Type.Literal('troop')]), model: key(), scale: positive(),
    yOffset: Type.Optional(Type.Number()), teamMaterial: Type.Optional(key()), tint: Type.Optional(color()),
    anim: Type.Optional(anim), label: Type.Optional(Type.Object({ height: Type.Number({ minimum: 0 }) }, closed)), ...effect,
  }, closed)),
  themes: map(Type.Object({
    ground: color(), sky: color(),
    light: Type.Object({ dir: vector(), color: color(), intensity: Type.Number({ minimum: 0 }) }, closed),
    fog: Type.Optional(Type.Object({ color: color(), near: Type.Number({ minimum: 0 }), far: positive() }, closed)),
    props: Type.Optional(Type.Array(Type.Object({ model: key(), pos: vector(), scale: Type.Optional(positive()), rotation: Type.Optional(vector()) }, closed))),
  }, closed)),
  events: map(Type.Object(effect, closed)),
  camera: Type.Object({ pitchDeg: Type.Number({ minimum: 0, maximum: 90 }), fov: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 180 }), margin: Type.Number({ minimum: 0 }) }, closed),
}, {
  ...closed, $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://node-arena.local/schemas/manifest.schema.json', title: 'manifest', 'x-presentation': true,
});
export type Manifest = Type.Static<typeof ManifestSchema>;
export const ManifestJsonSchema: object = JSON.parse(JSON.stringify(ManifestSchema));
