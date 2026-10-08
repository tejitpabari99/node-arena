import type { ErrorObject } from 'ajv';
import { ContentLoadError, convertFixedPoint, escapePointerSegment, type ContentIssue, type NumericSchema } from './fixed-point.js';
import { CoreSchemas, type Archetype, type CoreEntity } from './core.schema.js';
import { COMPONENT_REGISTRY, validateTroopValue, type ComponentRegistry } from './component-registry.js';
import { resolveArchetypes } from './resolve-archetypes.js';
import { createAjv } from './validate.js';

export type ContentFileMap = Record<string, string | object>;
/** Path-keyed clones in milli-units; archetype component params are resolved. */
export type LoadedContent = Record<string, CoreEntity>;
const ajv = createAjv();
const schemas = Object.entries(CoreSchemas).map(([name, schema]) => ({
  filename: `${name}.schema.json`, schema: schema as NumericSchema, validate: ajv.compile(schema),
}));

function issueForSchemaError(file: string, error: ErrorObject): ContentIssue {
  const property = error.keyword === 'additionalProperties' ? error.params.additionalProperty
    : error.keyword === 'required' ? error.params.missingProperty : undefined;
  return {
    file,
    pointer: error.instancePath + (typeof property === 'string' ? `/${escapePointerSegment(property)}` : ''),
    message: error.message ?? 'Invalid content',
  };
}

export interface LoadContentOptions { registry?: ComponentRegistry }

/** Pure fileMap adapter shared by Node I/O callers and the browser's edited JSON. */
export function loadContent(fileMap: ContentFileMap, opts: LoadContentOptions = {}): LoadedContent {
  const registry = opts.registry ?? COMPONENT_REGISTRY;
  const archetypes: Record<string, Archetype> = {};
  const entries: [string, CoreEntity][] = [];
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
    const entry = schemas.find(({ filename, schema }) => typeof schemaReference === 'string'
      && (schemaReference === schema.$id || schemaReference === filename || schemaReference.endsWith(`/${filename}`)));
    if (!entry) {
      errors.push({ file, pointer: '/$schema', message: 'Unknown or missing content schema' });
      continue;
    }
    try {
      // Check numeric precision before schema ranges so NaN/overflow get fx3 diagnostics.
      const converted = convertFixedPoint(authored, entry.schema, file);
      // Validate authored units: scaled speed intentionally exceeds the authored bound.
      if (!entry.validate(authored)) {
        errors.push(...(entry.validate.errors ?? []).map((error) => issueForSchemaError(file, error)));
        continue;
      }
      if (entry.filename === 'troop.schema.json') errors.push(...validateTroopValue((converted as { value: number }).value, file, registry));
      if (entry.filename === 'archetype.schema.json') archetypes[file] = converted as Archetype;
      entries.push([file, converted as CoreEntity]);
    } catch (error) {
      if (!(error instanceof ContentLoadError)) throw error;
      errors.push(...error.errors);
    }
  }
  if (errors.length) throw new ContentLoadError(errors);
  return { ...Object.fromEntries(entries), ...resolveArchetypes(archetypes, registry) };
}
