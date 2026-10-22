import { Sfc32, fnv1a32, mixSeed } from './math.js';

/** One independent random stream (03 R7). Draw count is part of the hashed state via `snapshot()`. */
export interface Stream {
  next(): number;
  /** Unbiased integer in [0, n). */
  below(n: number): number;
  snapshot(): [number, number, number, number];
}

export interface Streams {
  /** Seed = mixSeed(seed, fnv1a32(name), idx): entity-keyed, so cross-entity order cannot shift draws. */
  fork(name: string, idx: number): Stream;
}

/** Purpose id of a stream name (distinctness across names is asserted in tests). */
export const purposeId = fnv1a32;

export function createStreams(seed: number): Streams {
  return { fork: (name, idx) => new Sfc32(mixSeed(seed, purposeId(name), idx)) };
}
