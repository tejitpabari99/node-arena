import Type, { type Static } from 'typebox';

const buildingRef = () => Type.Union([Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }), Type.Null()]);
const ms = (minimum = 0) => Type.Integer({ minimum, maximum: 2147483647 });

/** Nested `steps` node (06 R5). */
const StepNode = Type.Cyclic({
  Node: Type.Object({
    goal: Type.Union([Type.Literal('line'), Type.Literal('capture'), Type.Literal('none')]),
    own: Type.Optional(buildingRef()),
    target: Type.Optional(buildingRef()),
    delayMs: Type.Optional(ms()),
    then: Type.Optional(Type.Array(Type.Ref('Node'))),
  }, { additionalProperties: false }),
}, 'Node');

const ScriptOp = Type.Union([
  Type.Object({ op: Type.Literal('delay'), ms: ms() }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('line'), own: buildingRef(), target: buildingRef(), afterMs: ms() }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('steps'), root: StepNode }, { additionalProperties: false }),
]);

export const TwBotParams = Type.Object({
  kind: Type.Literal('tw'),
  actionDelayMs: ms(50),
  behavior: Type.Union([Type.Literal('full'), Type.Literal('attackOnly')]),
  script: Type.Optional(Type.Array(ScriptOp)),
}, { additionalProperties: false });

export type TwBot = Static<typeof TwBotParams>;

interface StepLike { own?: string | null; target?: string | null; then?: readonly StepLike[] }

function stepRefs(node: StepLike, out: Set<string>): void {
  if (node.own) out.add(node.own);
  if (node.target) out.add(node.target);
  for (const child of node.then ?? []) stepRefs(child, out);
}

function twBuildingRefs(bot: TwBot): string[] {
  const out = new Set<string>();
  for (const op of bot.script ?? []) {
    if (op.op === 'line') { if (op.own) out.add(op.own); if (op.target) out.add(op.target); }
    else if (op.op === 'steps') stepRefs(op.root, out);
  }
  return [...out];
}

/** Seat `bot` block kinds. `params` is the full block incl. `kind`; `buildingRefs` lists referenced building ids (first-seen order, deduped). */
export const BOT_KINDS = {
  tw: { id: 'tw', params: TwBotParams, buildingRefs: twBuildingRefs },
} as const;

export type BotKindId = keyof typeof BOT_KINDS;
