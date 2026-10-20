// Seeded render randomness (PRD SP01 N6): unseeded random and wall clocks are banned in src/render and src/fx
// (visual/lib/lint-determinism.mjs + eslint no-restricted-properties). Any render jitter
// (e.g. brawl puffs) draws from seededRandom(pairKey, tick) so captures are reproducible.

/** mulberry32 PRNG: deterministic floats in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** PRNG seeded only from (pairKey, tick), e.g. ('0-3', 120): same lane + tick => same jitter every run. */
export function seededRandom(pairKey: string, tick: number): () => number {
  return mulberry32(fnv1a(pairKey) ^ Math.imul(tick | 0, 0x9e3779b1));
}
