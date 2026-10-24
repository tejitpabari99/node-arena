import Type from 'typebox';
import { MANIFEST_SCHEMA_VERSION, TEAM_KEYS } from './manifest.schema.js';
import { TEAM_MODES } from '@node-arena/defs';

// Art patch (`apps/web/assets/manifest.art.json`): a sparse, closed whitelist over the merged manifest. Objects deep-merge, arrays and
// scalars replace. Not overridable: `kind`, `model.budget`, ids/keys' meaning. No nulls (absent = no override).
const closed = { additionalProperties: false };
const key = () => Type.String({ minLength: 1 });
const path = key;
const color = () => Type.String({ pattern: '^#[0-9a-fA-F]{6}$' });
const vector = () => Type.Array(Type.Number(), { minItems: 3, maxItems: 3 });
const map = <T extends Type.TSchema>(schema: T) => Type.Record(Type.String({ minLength: 1 }), schema, closed);
const opt = Type.Optional;

const stage = Type.Union([
  Type.Object({ mesh: key() }, closed),
  Type.Object({ enable: Type.Array(key(), { minItems: 1 }) }, closed),
]);

export const ManifestArtSchema = Type.Object({
  $schema: opt(Type.String({ minLength: 1 })), schemaVersion: opt(Type.Literal(MANIFEST_SCHEMA_VERSION)),
  visuals: opt(map(Type.Object({
    model: opt(Type.Object({ parts: opt(path()), lod: opt(path()) }, closed)),
    scale: opt(Type.Number({ exclusiveMinimum: 0 })),
    stages: opt(Type.Array(stage, { minItems: 1 })),
    anim: opt(Type.Object({
      mode: opt(Type.Union([Type.Literal('none'), Type.Literal('node-tracks')])),
      clips: opt(Type.Object({ run: opt(key()), death: opt(key()) }, closed)),
    }, closed)),
    team: opt(Type.Object({
      mode: opt(Type.Union(TEAM_MODES.map((m) => Type.Literal(m)))),
      textures: opt(Type.Object(Object.fromEntries(TEAM_KEYS.map((k) => [k, opt(path())])), closed)),
    }, closed)),
    label: opt(Type.Object({ height: opt(Type.Number({ minimum: 0 })) }, closed)),
  }, closed))),
  themes: opt(map(Type.Object({
    ground: opt(Type.Object({ mesh: opt(path()), texture: opt(path()) }, closed)),
    obstacle: opt(Type.Object({ small: opt(path()), big: opt(path()), texture: opt(path()) }, closed)),
    sky: opt(color()),
    light: opt(Type.Object({
      dir: opt(vector()), color: opt(color()), intensity: opt(Type.Number({ minimum: 0 })),
      ambient: opt(Type.Object({ color: opt(color()), intensity: opt(Type.Number({ minimum: 0 })) }, closed)),
    }, closed)),
  }, closed))),
  fx: opt(map(Type.Object({ texture: opt(path()), params: opt(map(Type.Number())) }, closed))),
  events: opt(map(Type.Object({ sfx: opt(key()) }, closed))),
}, {
  ...closed, $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://node-arena.local/schemas/manifest-art.schema.json', title: 'manifest-art', 'x-presentation': true,
});
export type ManifestArt = Type.Static<typeof ManifestArtSchema>;
