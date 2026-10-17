import Type from 'typebox';
import { COMPONENT_REGISTRY } from './component-registry.js';

/** Kept in content so profile validation never depends on the bot engine. */
export const BOT_CONSIDERATIONS = [
  'targetValue', 'timeToTake', 'distance', 'threatToSource', 'threatToTarget',
  'targetWeakness', 'ownerDominance', 'sliceCost', 'lineUseless', 'stickiness',
] as const;
export const BOT_ACTIONS = ['attack', 'reinforce', 'cut'] as const;
export type BotConsideration = typeof BOT_CONSIDERATIONS[number];
export type BotAction = typeof BOT_ACTIONS[number];

const weight = () => Type.Number({ minimum: 0, maximum: 10, 'x-unit': 'fx3' });
const optionalWeight = () => Type.Optional(weight());
function weightMap<K extends string>(keys: readonly K[]) {
  return Type.Object(Object.fromEntries(keys.map(key => [key, optionalWeight()])) as Record<K, ReturnType<typeof optionalWeight>>, { additionalProperties: false });
}
/** The closed key set and per-weight bound cap sum(w*c) at 100,000,000:
 * 10 considerations * 10,000 loaded weight * 1,000 consideration score < 2^31.
 * Normalize that numerator before multiplying by the loaded action bias.
 */
export const BotConsiderationWeightsSchema = weightMap(BOT_CONSIDERATIONS);
export const BotSkillSchema = Type.Object({
  decisionIntervalSec: Type.Number({ exclusiveMinimum: 0, 'x-unit': 'fx3' }),
  noise: Type.Number({ minimum: 0, maximum: 1, 'x-unit': 'fx3' }),
  actionsPerDecision: Type.Integer({ minimum: 1, maximum: 2147483647 }),
}, { additionalProperties: false });
export const BotParamsSchema = Type.Object({
  extends: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' })),
  skill: Type.Optional(BotSkillSchema),
  bias: Type.Optional(weightMap(BOT_ACTIONS)),
  holdThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1, 'x-unit': 'fx3' })),
  maxTargetsPerSource: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
  cooldownSec: Type.Optional(Type.Number({ minimum: 0, 'x-unit': 'fx3' })),
  componentValue: Type.Optional(weightMap(Object.keys(COMPONENT_REGISTRY.components))),
  weights: Type.Optional(Type.Object({
    attack: Type.Optional(BotConsiderationWeightsSchema),
    reinforce: Type.Optional(BotConsiderationWeightsSchema),
    cut: Type.Optional(BotConsiderationWeightsSchema),
  }, { additionalProperties: false })),
}, {
  additionalProperties: false,
  // References/depth and skill-only inheritance also have a semantic boundary.
  if: { properties: { extends: {} }, required: ['extends'] },
  then: { properties: {
    skill: {}, bias: false, holdThreshold: false, maxTargetsPerSource: false,
    cooldownSec: false, componentValue: false, weights: false,
  }, required: ['skill'] },
});
export type BotSkill = Type.Static<typeof BotSkillSchema>;
export type BotParams = Type.Static<typeof BotParamsSchema>;
