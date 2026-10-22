import Type, { type TNumber, type TInteger, type TObject } from 'typebox';

/** Authored fixed-point number: milli-units (3 decimals), tag read by content's `convertFixedPoint`. */
export function fx3(options: { minimum?: number; maximum?: number; exclusiveMinimum?: number; 'x-presentation'?: boolean } = {}): TNumber {
  return Type.Number({ minimum: 0, maximum: 500, ...options, 'x-unit': 'fx3' });
}

/** Integer count/level: never scaled. */
export function count(options: { minimum?: number; maximum?: number } = {}): TInteger {
  return Type.Integer({ minimum: 0, maximum: 2147483647, ...options });
}

export function unitId() {
  return Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' });
}

export const noParams = (): TObject => Type.Object({}, { additionalProperties: false });
