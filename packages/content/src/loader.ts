import type { ErrorObject } from 'ajv';
import { ContentLoadError, convertFixedPoint, escapePointerSegment, type ContentIssue, type NumericSchema } from './fixed-point.js';
import { TroopSchema, type Troop } from './troop.schema.js';
import { validateTroop } from './validate.js';

export type ContentFileMap = Record<string, string | object>;
/** Current schema dispatch contains troops; later tasks add content entity schemas. */
export type LoadedContent = Record<string, Troop>;
const troopSchema: NumericSchema = TroopSchema;

function issueForSchemaError(file: string, error: ErrorObject): ContentIssue {
  const property = error.keyword === 'additionalProperties' ? error.params.additionalProperty
    : error.keyword === 'required' ? error.params.missingProperty : undefined;
  return {
    file,
    pointer: error.instancePath + (typeof property === 'string' ? `/${escapePointerSegment(property)}` : ''),
    message: error.message ?? 'Invalid content',
  };
}

/** Pure fileMap adapter shared by Node I/O callers and the browser's edited JSON. */
export function loadContent(fileMap: ContentFileMap): LoadedContent {
  const entries: [string, Troop][] = [];
  const errors: ContentIssue[] = [];
  for (const [file, source] of Object.entries(fileMap)) {
    let authored: unknown;
    try {
      authored = typeof source === 'string' ? JSON.parse(source) : source;
    } catch {
      errors.push({ file, pointer: '', message: 'Invalid JSON' });
      continue;
    }
    if (!authored || typeof authored !== 'object' || Array.isArray(authored)) {
      errors.push({ file, pointer: '', message: 'Content file must contain an object' });
      continue;
    }
    const schemaReference = (authored as Record<string, unknown>).$schema;
    // File adapters can retain relative editor references or use the schema's canonical ID.
    if (typeof schemaReference !== 'string'
      || !(schemaReference === troopSchema.$id || schemaReference === 'troop.schema.json' || schemaReference.endsWith('/troop.schema.json'))) {
      errors.push({ file, pointer: '/$schema', message: 'Unknown or missing content schema' });
      continue;
    }
    try {
      // Check numeric precision before schema ranges so NaN/overflow get fx3 diagnostics.
      const converted = convertFixedPoint(authored, TroopSchema, file);
      // Validate authored units: scaled speed intentionally exceeds the authored bound.
      if (!validateTroop(authored)) {
        errors.push(...(validateTroop.errors ?? []).map((error) => issueForSchemaError(file, error)));
        continue;
      }
      entries.push([file, converted as Troop]);
    } catch (error) {
      if (!(error instanceof ContentLoadError)) throw error;
      errors.push(...error.errors);
    }
  }
  if (errors.length) throw new ContentLoadError(errors);
  return Object.fromEntries(entries);
}
