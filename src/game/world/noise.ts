// Deterministic value-noise / fbm for biome fields and terrain variation.
// Pure functions of (seed, x, y) so the world is fully reproducible (CLAUDE.md §14).
// Reuses the xmur3-style integer hashing from rng.ts in a stateless form.

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** A stable hash of (seedHash, ix, iy) in [0, 1). */
function hash2(seedH: number, ix: number, iy: number): number {
  let h = seedH ^ Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

/** Bilinearly-interpolated value noise at (x, y) for an integer seed hash. */
function valueNoise(seedH: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = hash2(seedH, x0, y0);
  const v10 = hash2(seedH, x0 + 1, y0);
  const v01 = hash2(seedH, x0, y0 + 1);
  const v11 = hash2(seedH, x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

/**
 * Fractal value noise in [0, 1). `scale` is the wavelength in input units
 * (larger = smoother / larger features). `octaves` adds finer detail.
 */
export function field(seed: string, x: number, y: number, scale: number, octaves = 3): number {
  const seedH = hashSeed(seed);
  let amp = 1;
  let freq = 1 / Math.max(1e-6, scale);
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seedH + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** A stable hash in [0, 1) for discrete decisions keyed by (seed, a, b). */
export function hashUnit(seed: string, a: number, b: number): number {
  return hash2(hashSeed(seed), a, b);
}
