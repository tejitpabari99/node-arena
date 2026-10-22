import type { ErrorObject } from 'ajv';
import { convertFixedPoint, escapePointerSegment, type ContentIssue, type NumericSchema } from '../fixed-point.js';
import { createAjv } from '../validate.js';
import { NextSchemas } from './schemas.js';

export type NextSchemaName = keyof typeof NextSchemas;
export type ContentSource = string | object;

const ajv = createAjv();
const compiled = Object.fromEntries((Object.keys(NextSchemas) as NextSchemaName[]).map((name) => {
  // JSON round-trip drops typebox symbols so the fx3 walker and Ajv see plain schema.
  const schema = JSON.parse(JSON.stringify(NextSchemas[name])) as NumericSchema;
  return [name, { schema, validate: ajv.compile(schema) }];
})) as Record<NextSchemaName, { schema: NumericSchema; validate: ReturnType<typeof ajv.compile> }>;

export function schemaIssue(file: string, error: ErrorObject): ContentIssue {
  const property = error.keyword === 'additionalProperties' ? error.params.additionalProperty : error.keyword === 'required' ? error.params.missingProperty : undefined;
  return { file, pointer: error.instancePath + (typeof property === 'string' ? `/${escapePointerSegment(property)}` : ''), message: error.message ?? 'Invalid content' };
}

/** Parse JSON text (objects pass through), schema-validate the authored shape, then convert fx3 to milli-ints. */
export function parseAndConvert<T>(file: string, source: ContentSource, name: NextSchemaName): { value?: T; issues: ContentIssue[] } {
  let authored: unknown;
  try { authored = typeof source === 'string' ? JSON.parse(source) : source; }
  catch { return { issues: [{ file, pointer: '', message: 'Invalid JSON' }] }; }
  if (!authored || typeof authored !== 'object' || Array.isArray(authored)) return { issues: [{ file, pointer: '', message: 'Content file must contain an object' }] };
  const { schema, validate } = compiled[name];
  const numeric: ContentIssue[] = [];
  const converted = convertFixedPoint(authored, schema, file, '', numeric);
  const valid = validate(authored);
  const issues = [...numeric, ...(valid ? [] : (validate.errors ?? []).map((e) => schemaIssue(file, e)))];
  return issues.length ? { issues } : { value: converted as T, issues };
}
