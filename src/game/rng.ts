// Seeded RNG so every procedural system is reproducible (CLAUDE.md §14).
// Same seed -> same city, for debugging. New seed -> new city.
// Implementation: xmur3 string hash -> mulberry32 PRNG (fast, tiny, well-distributed).

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [minInclusive, maxInclusive] */
  int(minInclusive: number, maxInclusive: number): number;
  /** float in [min, max) */
  range(min: number, max: number): number;
  /** true with probability p (0..1) */
  chance(p: number): boolean;
  /** uniformly pick one element of a non-empty array */
  pick<T>(arr: readonly T[]): T;
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  const rand = mulberry32(seedFn());
  const next = () => rand();
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => next() * (max - min) + min,
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

/** A fresh random run seed (used when starting a brand-new run). */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
