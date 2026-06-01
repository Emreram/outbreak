// Distance- and biome-based difficulty/loot scaling (CLAUDE.md world feature:
// "Distance-scaled danger & loot"). Pure functions of (seed, chunk coords) so
// they're deterministic and headlessly testable — the ChunkManager just maps
// world pixels to chunk coords and calls these.

import { biomeAt } from "./biomes";
import { SPAWN_CHUNK } from "../constants";

/** Chebyshev distance (in chunks) from a chunk to the spawn chunk. */
export function chunkDistToSpawn(cx: number, cy: number): number {
  return Math.max(Math.abs(cx - SPAWN_CHUNK.x), Math.abs(cy - SPAWN_CHUNK.y));
}

/**
 * Integer danger boost added to `day` when rolling spawns: rises with distance
 * from spawn and with the local biome's own danger. Monotonic in distance.
 */
export function dangerTierAt(seed: string, cx: number, cy: number): number {
  return Math.min(24, Math.floor(chunkDistToSpawn(cx, cy) / 2) + biomeAt(seed, cx, cy).danger);
}

/** Loot rarity bias added to rollLoot's extraBias: rises with distance + biome. */
export function lootBiasAt(seed: string, cx: number, cy: number): number {
  return Math.min(2, chunkDistToSpawn(cx, cy) * 0.06 + biomeAt(seed, cx, cy).lootBias);
}
