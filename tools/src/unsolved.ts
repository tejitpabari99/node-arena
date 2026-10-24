import Type from 'typebox';
import { createAjv } from '@node-arena/content';
import { readFile } from 'node:fs/promises';
import { LocatedError } from './files.js';

/** Levels the human proxy cannot win; printed as warnings. `ownerSignOff` stays null until the owner's manual pass. */
export const UnsolvedSchema = Type.Array(Type.Object({
  id: Type.String({ minLength: 1 }), position: Type.Optional(Type.Integer({ minimum: 1 })), reason: Type.String({ minLength: 1 }),
  ownerSignOff: Type.Union([Type.Null(), Type.String({ minLength: 1 })]),
}, { additionalProperties: false }));
export type UnsolvedEntry = Type.Static<typeof UnsolvedSchema>[number];
const validate = createAjv().compile(UnsolvedSchema);
export function parseUnsolved(value: unknown): UnsolvedEntry[] {
  if (!validate(value)) throw new Error(`Invalid unsolved-by-proxy list: ${validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  const list = value as UnsolvedEntry[];
  if (new Set(list.map(e => e.id)).size !== list.length) throw new Error('Duplicate id in unsolved-by-proxy list');
  for (const entry of list) if (entry.position === undefined && !entry.id.startsWith('na-')) throw new Error(`Invalid unsolved-by-proxy list: ${entry.id} requires a campaign position`);
  return list;
}
export async function readUnsolved(path: string): Promise<UnsolvedEntry[]> {
  try { return parseUnsolved(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { throw new LocatedError(path, (error as Error).message); }
}
