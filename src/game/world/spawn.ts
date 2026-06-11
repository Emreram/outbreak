// Spawn-chunk selection (Terrain Overhaul PR1). The old world FORCED chunk
// (20,20) to a safe biome, which stamped a square biome island into whatever
// region the noise actually wanted there (a hard visible edge at the very first
// thing a player sees). Instead we now SEARCH outward from the world centre for
// the first naturally-hospitable, naturally-dry chunk — the world stays organic
// and the start is still guaranteed safe + varied per seed. Pure + memoized.

import { biomeAt } from "./biomes";
import { terrainSampleAt, type BiomeId } from "./terrainField";
import { CHUNK_TILES, SPAWN_CHUNK } from "../constants";

/** Biomes a run may open in: walkable, lootable, low-threat. */
const HOSPITABLE: ReadonlySet<BiomeId> = new Set([
  "grassland", "suburb", "farmland", "parkland", "forest", "commercial_strip",
]);

/** A start chunk must be nearly dry (no lakes/rivers swallowing the opening). */
const MAX_WATER_FRAC = 0.08;
const SEARCH_RADIUS = 8;

const cache = new Map<string, { x: number; y: number }>();

/** Fraction of a 12×12 sample lattice across the chunk that is shallow-or-wetter. */
function waterFrac(seed: string, cx: number, cy: number): number {
  const N = 12;
  const step = CHUNK_TILES / N;
  let wet = 0;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const gx = Math.floor(cx * CHUNK_TILES + (ix + 0.5) * step);
      const gy = Math.floor(cy * CHUNK_TILES + (iy + 0.5) * step);
      if (terrainSampleAt(seed, gx, gy).wet >= 0.6) wet++;
    }
  }
  return wet / (N * N);
}

/** The run's spawn chunk: ring-search out from the world centre (deterministic
 *  order) for the first hospitable, dry chunk. Falls back to the centre itself
 *  if nothing within range qualifies (practically unreachable). */
export function findSpawnChunk(seed: string): { x: number; y: number } {
  const hit = cache.get(seed);
  if (hit) return hit;
  const c = SPAWN_CHUNK; // the world centre — search origin + last-resort fallback
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (const { x, y } of ring(c.x, c.y, r)) {
      if (!HOSPITABLE.has(biomeAt(seed, x, y).id)) continue;
      if (waterFrac(seed, x, y) > MAX_WATER_FRAC) continue;
      const found = { x, y };
      cache.set(seed, found);
      return found;
    }
  }
  cache.set(seed, c);
  return c;
}

/** The chunks on the square ring of radius r around (cx, cy), deterministic order:
 *  top row L→R, right col T→B, bottom row R→L, left col B→T. */
function ring(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  if (r === 0) return [{ x: cx, y: cy }];
  const out: Array<{ x: number; y: number }> = [];
  for (let x = cx - r; x <= cx + r; x++) out.push({ x, y: cy - r });
  for (let y = cy - r + 1; y <= cy + r; y++) out.push({ x: cx + r, y });
  for (let x = cx + r - 1; x >= cx - r; x--) out.push({ x, y: cy + r });
  for (let y = cy + r - 1; y >= cy - r + 1; y--) out.push({ x: cx - r, y });
  return out;
}
