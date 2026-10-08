import Type from 'typebox';

/** SP04 replaces this closed minimal utility payload with its consideration registry.
 * Only attack/targetValue is hosted now to exercise bounded scoring and fx3 loading;
 * full personalities, consideration features and authored profiles belong to SP04.
 */
const weight = () => Type.Number({ minimum: 0, maximum: 10, 'x-unit': 'fx3' });
export const BotSkillSchema = Type.Object({
  decisionIntervalSec: Type.Number({ exclusiveMinimum: 0, 'x-unit': 'fx3' }),
  noise: Type.Number({ minimum: 0, maximum: 1, 'x-unit': 'fx3' }),
  actionsPerDecision: Type.Integer({ minimum: 1, maximum: 2147483647 }),
}, { additionalProperties: false });
export const BotParamsSchema = Type.Object({
  extends: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' })),
  skill: Type.Optional(BotSkillSchema),
  bias: Type.Optional(Type.Object({ attack: weight() }, { additionalProperties: false })),
  weights: Type.Optional(Type.Object({
    attack: Type.Object({ targetValue: weight() }, { additionalProperties: false }),
  }, { additionalProperties: false })),
}, {
  additionalProperties: false,
  // Difficulty variants may only patch skill. References/depth are semantic checks.
  if: { properties: { extends: {} }, required: ['extends'] },
  then: { properties: { skill: {}, bias: false, weights: false }, required: ['skill'] },
});
export type BotSkill = Type.Static<typeof BotSkillSchema>;
export type BotParams = Type.Static<typeof BotParamsSchema>;
