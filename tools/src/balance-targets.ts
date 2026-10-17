import Type from 'typebox';
import { createAjv } from '@node-arena/content';
import { readFile } from 'node:fs/promises';
import { LocatedError } from './files.js';

const percent = Type.Number({minimum:0,maximum:100});
const band = Type.Object({referenceWinMin:percent,humanProxyWin:Type.Tuple([percent,percent]),timeoutMaxPct:percent,idleWinMax:percent},{additionalProperties:false});
/** Percentages (0..100), including win thresholds. Values are authored by SP05. */
export const BalanceTargetsSchema = Type.Object({$schema:Type.Optional(Type.String()),bands:Type.Object({'1':band,'2':band,'3':band,'4':band},{additionalProperties:false})},{$schema:'http://json-schema.org/draft-07/schema#',additionalProperties:false});
export type BalanceTargets = Type.Static<typeof BalanceTargetsSchema>;
const validate = createAjv().compile(BalanceTargetsSchema);
export function parseBalanceTargets(value: unknown): BalanceTargets {
  if (!validate(value)) throw new Error(`Invalid balance targets: ${validate.errors?.map(e=>`${e.instancePath} ${e.message}`).join('; ')}`);
  const targets = value as BalanceTargets;
  for (const [key, value] of Object.entries(targets.bands)) {
    if (value.humanProxyWin[0] > value.humanProxyWin[1]) throw new Error(`bands.${key}.humanProxyWin minimum exceeds maximum`);
  }
  return targets;
}
export async function readBalanceTargets(path: string, optional: boolean): Promise<BalanceTargets | undefined> {
  let text: string;
  try { text = await readFile(path,'utf8'); }
  catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new LocatedError(path,(error as Error).message); }
  try { return parseBalanceTargets(JSON.parse(text)); }
  catch (error) { throw new LocatedError(path,(error as Error).message); }
}
