import Type from 'typebox';

export const SCHEMA_VERSION = '1.0.0';

export const TroopSchema = Type.Object({
  $schema: Type.String({ minLength: 1 }),
  schemaVersion: Type.Literal(SCHEMA_VERSION),
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  visual: Type.String({ minLength: 1, 'x-presentation': true }),
  // The registry will enforce v1 value == 1; the shape leaves room for v2 tanks.
  value: Type.Integer({ minimum: 1, maximum: 2147483647 }),
  speed: Type.Number({ exclusiveMinimum: 0, maximum: 100, 'x-unit': 'fx3' }),
}, {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://node-arena.local/schemas/troop.schema.json',
  title: 'Troop',
  additionalProperties: false,
});

export type Troop = Type.Static<typeof TroopSchema>;
