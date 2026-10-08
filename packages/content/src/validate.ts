import { Ajv } from 'ajv';
import { TroopSchema, type Troop } from './troop.schema.js';

export function createAjv(): Ajv {
  const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  // Metadata used by the later compiler/hash stages, never validation bypasses.
  ajv.addKeyword({ keyword: 'x-unit', schemaType: 'string', valid: true });
  ajv.addKeyword({ keyword: 'x-presentation', schemaType: 'boolean', valid: true });
  return ajv;
}

export const validateTroop = createAjv().compile<Troop>(TroopSchema);
