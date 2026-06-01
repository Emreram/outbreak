// Persistent disaster SCARS (Living World). A disaster leaves a lasting mark on
// the world — burned ground, floodwater, fresh lava, quake rubble. Terrain is
// never saved (it regenerates deterministically from the seed, CLAUDE.md §10),
// so scars are stored as a handful of compact DisasterZone records on GameState
// and re-applied here as a POST-PROCESS over each freshly-generated chunk grid.
//
// Pure + deterministic given (chunk, zones, day): the same inputs always produce
// the same scarred grid, so a chunk looks identical every time it streams back in
// and across save/load. NEVER call this inside generateChunk (that must stay
// byte-reproducible for the worldgen tests) — ChunkManager calls it afterwards.

import { Tile, type ChunkData } from "./tiles";
import type { DisasterZone } from "../../shared/contracts";

/** Map a base tile → its scarred form for a given disaster kind. `frac` is the
 *  radial intensity at this tile (1 at the epicentre, 0 at the rim). */
function scarTile(t: Tile, kind: DisasterZone["kind"], frac: number): Tile {
  switch (kind) {
    case "wildfire":
      if (t === Tile.Tree) return Tile.Stump;
      if (t === Tile.Bush || t === Tile.TallGrass || t === Tile.Crop) return Tile.Scorched;
      if (t === Tile.Grass || t === Tile.Dirt || t === Tile.Trail) return frac > 0.6 ? Tile.Ash : Tile.Scorched;
      return t;
    case "flood":
      // Low, soft ground drowns; the deep core becomes open water.
      if (t === Tile.Grass || t === Tile.Dirt || t === Tile.Sand || t === Tile.Trail || t === Tile.Crop || t === Tile.TallGrass)
        return frac > 0.6 ? Tile.Water : Tile.ShallowWater;
      if (t === Tile.ShallowWater && frac > 0.6) return Tile.Water;
      return t;
    case "eruption":
      if (frac > 0.7) return Tile.Lava;
      if (frac > 0.45) return Tile.Basalt;
      if (t === Tile.Tree || t === Tile.Bush || t === Tile.TallGrass || t === Tile.Crop) return Tile.Scorched;
      if (t === Tile.Grass || t === Tile.Dirt || t === Tile.Trail || t === Tile.Sand) return Tile.Scorched;
      return t;
    case "earthquake":
      // Hard structures crack and collapse; ground splits into rubble near the core.
      if (t === Tile.Wall || t === Tile.Road || t === Tile.Pavement || t === Tile.Sidewalk || t === Tile.Floor || t === Tile.Bridge)
        return Tile.Rubble;
      if (frac > 0.7 && (t === Tile.Grass || t === Tile.Dirt || t === Tile.Trail)) return Tile.Rubble;
      return t;
    case "storm_lightning":
      // A strike scorches a small patch; mostly cosmetic.
      if (t === Tile.Tree) return Tile.Stump;
      if (t === Tile.Grass || t === Tile.TallGrass || t === Tile.Bush || t === Tile.Crop) return Tile.Scorched;
      return t;
  }
}

/** Does a zone (still active on `day`) reach into this chunk at all? Cheap AABB
 *  reject so most chunks skip the per-tile loop entirely. */
function zoneTouchesChunk(z: DisasterZone, chunk: ChunkData, day: number): boolean {
  if (z.healDay !== undefined && day >= z.healDay) return false;
  const ts = chunk.tileSize;
  const x0 = chunk.cx * chunk.size * ts;
  const y0 = chunk.cy * chunk.size * ts;
  const span = chunk.size * ts;
  const reach = z.radius * ts;
  return z.px + reach >= x0 && z.px - reach <= x0 + span && z.py + reach >= y0 && z.py - reach <= y0 + span;
}

/** Apply all scars overlapping this chunk to its grid IN PLACE. Deterministic. */
export function applyScars(chunk: ChunkData, zones: readonly DisasterZone[] | undefined, day: number): void {
  if (!zones || zones.length === 0) return;
  const size = chunk.size;
  const ts = chunk.tileSize;
  for (const z of zones) {
    if (!zoneTouchesChunk(z, chunk, day)) continue;
    const ecx = z.px / ts; // epicentre in global TILE coords (fractional)
    const ecy = z.py / ts;
    const r2 = z.radius * z.radius;
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        const gx = chunk.cx * size + lx + 0.5;
        const gy = chunk.cy * size + ly + 0.5;
        const dx = gx - ecx;
        const dy = gy - ecy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const frac = (1 - Math.sqrt(d2) / z.radius) * z.intensity;
        if (frac <= 0.05) continue;
        chunk.grid[ly][lx] = scarTile(chunk.grid[ly][lx], z.kind, frac);
      }
    }
  }
}
