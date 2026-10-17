import Type from 'typebox';
import { SCHEMA_VERSION } from './troop.schema.js';
import { BotParamsSchema } from './bot-params.js';

export const BotSchema = Type.Object({
  $schema: Type.String({ minLength: 1 }), schemaVersion: Type.Literal(SCHEMA_VERSION),
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  kind: Type.Union([Type.Literal('utility'), Type.Literal('idle')]),
  params: BotParamsSchema,
}, {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://node-arena.local/schemas/bot.schema.json', title: 'bot', additionalProperties: false,
  if: { properties: { kind: { const: 'utility' } }, required: ['kind'] },
  then: { properties: { params: { type: 'object', properties: { skill: {} }, required: ['skill'] } } },
  else: { properties: { params: { type: 'object', maxProperties: 0 } } },
});
export type BotProfile = Type.Static<typeof BotSchema>;
/** Plain JSON Schema export for browser form builders and validators. */
export const BotJsonSchema: object = JSON.parse(JSON.stringify(BotSchema));
