import type { ErrorObject } from 'ajv';
import { CoreSchemas, type CoreEntity } from './core.schema.js';
import { convertFixedPoint, escapePointerSegment, type ContentIssue, type NumericSchema } from './fixed-point.js';
import { createAjv } from './validate.js';

export type ContentFileMap = Record<string, string | object>;
export type LoadedContent = Record<string, CoreEntity>;
export type EntityKind = keyof typeof CoreSchemas;
const ajv = createAjv();
const schemas = Object.entries(CoreSchemas).map(([kind, schema]) => ({ kind: kind as EntityKind, filename: `${kind}.schema.json`, schema: schema as NumericSchema, validate: ajv.compile(schema) }));

export function issueForSchemaError(file: string, error: ErrorObject): ContentIssue {
  const property = error.keyword === 'additionalProperties' ? error.params.additionalProperty : error.keyword === 'required' ? error.params.missingProperty : undefined;
  return { file, pointer: error.instancePath + (typeof property === 'string' ? `/${escapePointerSegment(property)}` : ''), message: error.message ?? 'Invalid content' };
}

/** Schema/numeric stage only. Semantic consumers share it without a loader cycle. */
export function parseContent(fileMap: ContentFileMap): { files: LoadedContent; kinds: Record<string, EntityKind>; errors: ContentIssue[] } {
  const files: LoadedContent = Object.create(null); const kinds: Record<string, EntityKind> = Object.create(null); const errors: ContentIssue[] = [];
  for (const [file, source] of Object.entries(fileMap)) {
    let authored: unknown;
    try { authored = typeof source === 'string' ? JSON.parse(source) : source; }
    catch { errors.push({ file, pointer: '', message: 'Invalid JSON' }); continue; }
    if (!authored || typeof authored !== 'object' || Array.isArray(authored)) { errors.push({ file, pointer: '', message: 'Content file must contain an object' }); continue; }
    const ref = (authored as Record<string, unknown>).$schema;
    const entry = schemas.find(e => typeof ref === 'string' && (ref === e.schema.$id || ref === e.filename || ref.endsWith(`/${e.filename}`)));
    if (!entry) { errors.push({ file, pointer: '/$schema', message: 'Unknown or missing content schema' }); continue; }
    const numericErrors: ContentIssue[] = [];
    const converted = convertFixedPoint(authored, entry.schema, file, '', numericErrors);
    errors.push(...numericErrors);
    const valid = entry.validate(authored);
    if (!valid) errors.push(...(entry.validate.errors ?? []).map(e => issueForSchemaError(file, e)));
    if (!valid || numericErrors.length) continue;
    files[file] = converted as CoreEntity; kinds[file] = entry.kind;
  }
  return { files, kinds, errors };
}
