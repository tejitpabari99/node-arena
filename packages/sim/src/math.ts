/** R-TCK-01: fixed simulation ticks per second; never a balance parameter. */
export const TICK_RATE = 20;

function safeInteger(value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError('Expected a safe integer');
}

/** Exact signed integer division, truncated toward zero; zero is canonical +0. */
export function idiv(numerator: number, denominator: number): number {
  safeInteger(numerator);
  safeInteger(denominator);
  if (denominator === 0) throw new RangeError('Division by zero');
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  let quotient = Math.trunc(n / d);
  // A rounded double quotient can reach the next integer. Its product is at
  // most 2^53 here, so comparison and correction still use exact integers.
  if (quotient * d > n) quotient -= 1;
  if (quotient === 0) return 0;
  return (numerator < 0) !== (denominator < 0) ? -quotient : quotient;
}

/** Multiply first; reject an inexact intermediate even if division would fit. */
export function mulDiv(a: number, b: number, denominator: number): number {
  safeInteger(a);
  safeInteger(b);
  const product = a * b;
  safeInteger(product);
  return idiv(product, denominator);
}

/** Greatest integer r such that r*r <= value, without square-root approximation. */
export function isqrt(value: number): number {
  safeInteger(value);
  if (value < 0) throw new RangeError('Square root of negative integer');
  if (value < 2) return value === 0 ? 0 : value;
  let lower = 1;
  // Exclusive upper bound for sqrt(MAX_SAFE_INTEGER). Comparing by division
  // avoids ever constructing an unsafe candidate square.
  let upper = Math.min(value, 94906266);
  while (lower + 1 < upper) {
    const middle = idiv(lower + upper, 2);
    if (middle <= idiv(value, middle)) lower = middle;
    else upper = middle;
  }
  return lower;
}

function word(value: number): number {
  if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) {
    throw new RangeError('Expected an int32 or uint32 seed word');
  }
  return value >>> 0;
}

/** Ordered seed-word mixing, using Murmur3's 32-bit avalanche operations. */
export function mixSeed(...parts: number[]): number {
  let hash = 0x9e3779b9;
  for (const part of parts) {
    let lane = Math.imul(word(part), 0xcc9e2d51);
    lane = (lane << 15) | (lane >>> 17);
    lane = Math.imul(lane, 0x1b873593);
    hash ^= lane;
    hash = (hash << 13) | (hash >>> 19);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }
  hash ^= parts.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Integer-output sfc32. No normalization to a floating-point fraction. */
export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const initial = word(seed);
    this.a = mixSeed(initial, 0);
    this.b = mixSeed(initial, 1);
    this.c = mixSeed(initial, 2);
    this.d = mixSeed(initial, 3);
    for (let i = 0; i < 12; i++) this.next();
  }

  next(): number {
    const result = (this.a + this.b + this.d) | 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + result) >>> 0;
    return result >>> 0;
  }

  /** Fresh unsigned words, suitable for deterministic hashes and snapshots. */
  snapshot(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }
}
