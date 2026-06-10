import { createRng } from "../rng";
import { CHUNK_TILES } from "../constants";

// The seamless GLOBAL road grid — a dependency-free leaf so worldgen, vehicles
// and set-pieces can all place things on guaranteed road tiles without import
// cycles. Each ROAD_PERIOD-wide band holds one 2-wide road at a seed-jittered
// offset. MOVED verbatim from worldgen.ts (same rng strings → identical roads).

export const ROAD_PERIOD = 17;

function roadStart(seed: string, axis: string, band: number): number {
  const r = createRng(`${seed}:road:${axis}:${band}`);
  return band * ROAD_PERIOD + 2 + r.int(0, ROAD_PERIOD - 5);
}

export function isRoad(seed: string, axis: string, g: number): boolean {
  const band = Math.floor(g / ROAD_PERIOD);
  const s = roadStart(seed, axis, band);
  return g === s || g === s + 1;
}

export const isRoadCol = (seed: string, gx: number): boolean => isRoad(seed, "x", gx);
export const isRoadRow = (seed: string, gy: number): boolean => isRoad(seed, "y", gy);

/** A road tile inside the chunk (GLOBAL coords). Road rows/cols fill an entire
 *  row/col, so any tile on a road band is walkable Road regardless of the other
 *  axis. Shared by vehicle + set-piece placement. */
export function roadTileInChunk(
  seed: string,
  cx: number,
  cy: number,
  rng: { chance(p: number): boolean; int(a: number, b: number): number; pick<T>(a: readonly T[]): T },
  used: Set<string>,
): { tx: number; ty: number } | null {
  const g0x = cx * CHUNK_TILES;
  const g0y = cy * CHUNK_TILES;
  const cols: number[] = [];
  const rows: number[] = [];
  for (let g = g0x + 1; g < g0x + CHUNK_TILES - 1; g++) if (isRoadCol(seed, g)) cols.push(g);
  for (let g = g0y + 1; g < g0y + CHUNK_TILES - 1; g++) if (isRoadRow(seed, g)) rows.push(g);
  if (cols.length === 0 && rows.length === 0) return null;
  for (let tries = 0; tries < 12; tries++) {
    let tx: number;
    let ty: number;
    if (cols.length && (rows.length === 0 || rng.chance(0.5))) {
      tx = rng.pick(cols);
      ty = rng.int(g0y + 1, g0y + CHUNK_TILES - 2);
    } else {
      ty = rng.pick(rows);
      tx = rng.int(g0x + 1, g0x + CHUNK_TILES - 2);
    }
    if (!used.has(`${tx},${ty}`)) return { tx, ty };
  }
  return null;
}
