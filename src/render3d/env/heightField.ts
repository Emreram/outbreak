// Visual terrain relief (graphics plan WS6 / master plan §3.5 step 2):
// a seeded, RAISE-ONLY [0, 0.4m] height field sampled at fractional global
// tile coords — organic undulation that the sim never sees. Flattened to the
// 0-plinth wherever structure meets ground: water/lava (the fixed-Y planes),
// roads/pavement/floors/rail/bridges/doors, and every extruded solid; the
// flatten factor feathers out over a tile and is bilinearly smoothed, so
// slopes stay gentle and chunk-shared corners agree.
//
// Tile flatness resolves through the loaded chunk store (fast, exact); on the
// unloaded streaming fringe it falls back to the pure natural-terrain sampler
// — a road arriving exactly at an unloaded border can therefore mismatch by
// ≤0.4m three chunks out, hidden in fog, and only until that area is meshed.
// Accepted in the plan.

import { field } from "../../game/world/noise";
import { terrainTileAt } from "../../game/world/terrainField";
import { Tile } from "../../game/world/tiles";
import { TILE_SIZE } from "../../game/constants";
import type { SimChunkStore } from "../../sim/world";

export const RELIEF_AMP_M = 0.4;
const FEATHER_NEAR_FLAT = 0.45;
const CACHE_CAP = 40000; // per-tile flat factors (numbers) — a few loaded rings

function isFlatTile(t: number): boolean {
  switch (t) {
    case Tile.Water:
    case Tile.ShallowWater:
    case Tile.DeepWater:
    case Tile.Foam:
    case Tile.Lava:
    case Tile.Road:
    case Tile.Sidewalk:
    case Tile.Pavement:
    case Tile.Floor:
    case Tile.Door:
    case Tile.Rail:
    case Tile.Bridge:
    case Tile.Wall:
    case Tile.Basalt:
    case Tile.Rubble:
      return true;
    default:
      return false;
  }
}

export interface HeightField {
  heightAt(xPx: number, yPx: number): number;
}

export function createHeightField(seed: string, store: SimChunkStore): HeightField {
  const reliefSeed = `${seed}:relief`;
  const flatCache = new Map<number, number>();

  const tileAt = (gtx: number, gty: number): number => {
    const t = store.tileAt(gtx, gty);
    if (t !== null) return t;
    return terrainTileAt(seed, gtx, gty); // unloaded fringe: natural terrain
  };

  /** Flatten factor per tile: 0 on flat tiles, feathered beside them, 1 open. */
  const flatFactor = (gtx: number, gty: number): number => {
    const key = gtx * 131072 + gty; // world is 1920² tiles — collision-free
    const hit = flatCache.get(key);
    if (hit !== undefined) return hit;
    let f: number;
    if (isFlatTile(tileAt(gtx, gty))) {
      f = 0;
    } else {
      let nearFlat = false;
      for (let dy = -1; dy <= 1 && !nearFlat; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (isFlatTile(tileAt(gtx + dx, gty + dy))) {
            nearFlat = true;
            break;
          }
        }
      }
      f = nearFlat ? FEATHER_NEAR_FLAT : 1;
    }
    if (flatCache.size > CACHE_CAP) flatCache.clear(); // cheap pressure valve
    flatCache.set(key, f);
    return f;
  };

  const heightAt = (xPx: number, yPx: number): number => {
    const gx = xPx / TILE_SIZE;
    const gy = yPx / TILE_SIZE;
    // bilinear flatten over the 4 surrounding tile centres
    const cx = gx - 0.5;
    const cy = gy - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const f00 = flatFactor(x0, y0);
    const f10 = flatFactor(x0 + 1, y0);
    const f01 = flatFactor(x0, y0 + 1);
    const f11 = flatFactor(x0 + 1, y0 + 1);
    const f = (f00 * (1 - fx) + f10 * fx) * (1 - fy) + (f01 * (1 - fx) + f11 * fx) * fy;
    if (f <= 0) return 0;
    const relief = Math.max(0, field(reliefSeed, gx, gy, 23, 2));
    return relief * f * RELIEF_AMP_M;
  };

  return { heightAt };
}
