/** Authored fx3 values use milli-units; simulation may widen its internal factor. */
export const FIXED_POINT_SCALE = 1000;

export interface ContentIssue {
  file: string;
  pointer: string;
  message: string;
}

export class ContentLoadError extends Error {
  constructor(public readonly errors: ContentIssue[]) {
    super(errors.map(({ file, pointer, message }) => `${file}#${pointer}: ${message}`).join('\n'));
    this.name = 'ContentLoadError';
  }
}

/** The JSON Schema subset needed to walk tagged object/array fields. */
export interface NumericSchema {
  type?: string;
  $id?: string;
  'x-unit'?: string;
  exclusiveMinimum?: number;
  properties?: Record<string, NumericSchema>;
  patternProperties?: Record<string, NumericSchema>;
  items?: NumericSchema;
  additionalProperties?: boolean | NumericSchema;
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Clone authored data, converting only schema-tagged fx3 fields, never integer counts. */
export function convertFixedPoint<T>(value: T, schema: NumericSchema, file: string, pointer = '', issues?: ContentIssue[]): T {
  if (schema['x-unit'] === 'fx3') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      const error = { file, pointer, message: 'fx3 requires a finite number' };
      if (issues) { issues.push(error); return value; }
      throw new ContentLoadError([error]);
    }
    const scaled = value * FIXED_POINT_SCALE;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-9) {
      const error = { file, pointer, message: 'fx3 allows at most three decimal places' };
      if (issues) { issues.push(error); return value; }
      throw new ContentLoadError([error]);
    }
    // The PRD specifies a symmetric range: |n| <= 2^31 - 1.
    if (!Number.isFinite(rounded) || Math.abs(rounded) > 2147483647) {
      const error = { file, pointer, message: 'scaled fx3 value exceeds int32 range' };
      if (issues) { issues.push(error); return value; }
      throw new ContentLoadError([error]);
    }
    if (schema.exclusiveMinimum === 0 && rounded <= 0) {
      const error = { file, pointer, message: 'positive fx3 value must be at least one milli-unit' };
      if (issues) { issues.push(error); return value; }
      throw new ContentLoadError([error]);
    }
    return (rounded === 0 ? 0 : rounded) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => convertFixedPoint(item, schema.items ?? {}, file, `${pointer}/${index}`, issues)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const childSchema = schema.properties?.[key]
        ?? Object.entries(schema.patternProperties ?? {}).find(([pattern]) => new RegExp(pattern).test(key))?.[1]
        ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {});
      return [key, convertFixedPoint(item, childSchema, file, `${pointer}/${escapePointerSegment(key)}`, issues)];
    })) as T;
  }
  return value;
}
