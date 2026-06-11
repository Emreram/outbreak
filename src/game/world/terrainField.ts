// THE terrain function (Terrain Overhaul PR1): a pure, global, per-tile field that
// decides what the natural ground IS at any world tile — biome region, coherent
// water bodies (ocean gradient, lakes, rivers, marsh pools), vegetation, clearings.
//
// Why per-tile: biomes used to be resolved per 48×48-tile CHUNK, which produced
// hard square borders and "marsh = a chunk of walkable ocean". Every field here is
// a continuous function of GLOBAL coords, so biome borders are organic noise curves
// that cross chunk seams, coasts are real beach gradients, and water forms coherent
// pools/lakes/rivers instead of per-tile salt-and-pepper speckles.
//
// PURITY INVARIANT: everything in this module is a pure function of (seed, gx, gy)
// — no rng streams. That makes terrain seamless across chunks by construction and
// keeps the main worldgen rng stream untouched by terrain decisions.
//
// Layering (leaf module): terrainField → noise/tiles/constants only. The biome
// CLASSIFIER (table + bands + thresholds) lives here; the biome DATA catalog stays
// in biomes.ts, which imports the classifier (no cycle — BiomeId is declared here
// and re-exported by biomes.ts for back-compat).

import { Tile } from "./tiles";
import { field, hashUnit } from "./noise";
import { CHUNK_TILES, WORLD_TILES_X, WORLD_TILES_Y } from "../constants";

export type BiomeId =
  | "downtown" | "suburb" | "commercial_strip" | "industrial" | "warehouse_district"
  | "hospital_zone" | "police_district" | "military_base" | "school_campus" | "shopping_mall"
  | "trainyard" | "construction_site" | "forest" | "dense_woods" | "farmland" | "grassland"
  | "riverbank" | "lake" | "marsh" | "coast" | "quarry" | "parkland" | "ocean"
  | "volcanic" | "wetland" | "badlands";

// --- the classifier (moved verbatim-in-spirit from biomes.ts) -------------------

// 5×5 lookup over (density row, moisture col); each quantised band picks a biome.
// (coast is produced by the continental coastline field, not the table.)
const TABLE: BiomeId[][] = [
  ["badlands", "grassland", "parkland", "marsh", "lake"],
  ["farmland", "farmland", "forest", "dense_woods", "riverbank"],
  ["construction_site", "suburb", "suburb", "forest", "wetland"],
  ["commercial_strip", "suburb", "school_campus", "warehouse_district", "trainyard"],
  ["downtown", "downtown", "hospital_zone", "industrial", "quarry"],
];

/** Which classifier ids are urban (kept in sync with BIOMES[..].urban — asserted
 *  in tests). Used to clamp urban ids to rural ground when sampling raw terrain. */
export const URBAN_IDS: ReadonlySet<BiomeId> = new Set([
  "downtown", "suburb", "commercial_strip", "industrial", "warehouse_district",
  "hospital_zone", "police_district", "military_base", "school_campus", "shopping_mall",
  "trainyard",
]);

// Continental land/sea thresholds (very-low-frequency field): below OCEAN_LEVEL is
// open water, the thin band up to COAST_LEVEL is the coastline biome.
export const OCEAN_LEVEL = 0.26;
export const COAST_LEVEL = 0.32;

// fbm noise clusters near 0.5; stretch around the midpoint so the extreme bands
// (corner biomes like downtown/lake/grassland/quarry) actually appear.
function band(v: number): number {
  const s = (v - 0.5) * 1.7 + 0.5;
  return Math.max(0, Math.min(4, Math.floor(s * 5)));
}

/** Continental field at a point in CHUNK units, with the world-edge falloff that
 *  drowns the rim organically (replaces the old hard square ocean border). */
function contAt(seed: string, u: number, v: number): number {
  const cont = field(seed + ":cont", u, v, 17, 2);
  // Distance to the world edge in chunk units; a ~1.5-chunk falloff pulls the
  // field below sea level at the rim so the map ends in real, irregular water.
  const edge = Math.min(u, v, WORLD_TILES_X / CHUNK_TILES - u, WORLD_TILES_Y / CHUNK_TILES - v);
  return cont - Math.max(0, 1 - edge / 1.5) * 0.45;
}

/**
 * The biome classifier at an arbitrary point in CHUNK units (fractional coords →
 * tile-resolution borders). Shared by biomeAt (sampled at the chunk centre) and
 * the per-tile terrain below. Ocean/coast come from the continental field; the
 * rest from the domain-warped density×moisture table. Pure + deterministic.
 */
export function naturalBiomeIdAt(seed: string, u: number, v: number): BiomeId {
  const cont = contAt(seed, u, v);
  if (cont < OCEAN_LEVEL) return "ocean";
  if (cont < COAST_LEVEL) return "coast";
  if (field(seed + ":volc", u, v, 5, 2) > 0.83) return "volcanic";
  const wx = (field(seed + ":warpx", u, v, 12, 2) - 0.5) * 6;
  const wy = (field(seed + ":warpy", u, v, 12, 2) - 0.5) * 6;
  const density = field(seed + ":dens", u + wx, v + wy, 6, 3);
  const moisture = field(seed + ":moist", u + wx, v + wy, 8, 3);
  return TABLE[band(density)][band(moisture)];
}

// --- per-tile terrain ------------------------------------------------------------

export interface TerrainSample {
  biome: BiomeId; // tile-resolution region id (urban ids may appear)
  ground: Tile; // the natural ground tile (water bands + banks + vegetation)
  wet: number; // 0 dry … 1 deep water (drives spawn search + shore prop passes)
}

export function isWaterish(t: Tile): boolean {
  return t === Tile.Water || t === Tile.DeepWater || t === Tile.ShallowWater;
}

/** Open, dry, walkable ground — what shorelines form against and props stand on. */
export function isDryGround(t: Tile): boolean {
  return (
    t === Tile.Grass || t === Tile.Dirt || t === Tile.Sand || t === Tile.Trail ||
    t === Tile.TallGrass || t === Tile.Crop || t === Tile.Scorched || t === Tile.Ash ||
    t === Tile.Sidewalk || t === Tile.Pavement || t === Tile.Road
  );
}

// Water tiers (deepest wins when several systems overlap at a tile).
const enum Wet { Dry = 0, Fringe = 1, Shallow = 2, Open = 3, Deep = 4 }

interface WaterHit {
  tier: Wet;
  tile: Tile;
}

// Per-biome boost for the lake field: lake-table regions almost always hold a real
// lake; wet biomes sometimes; everything else only where the field genuinely spikes.
const LAKE_BOOST: Partial<Record<BiomeId, number>> = {
  lake: 0.2, // a "Lake" region must reliably HOLD a lake (ringed, with beaches)
  marsh: 0.06,
  wetland: 0.05,
  riverbank: 0.04,
};

// Vegetation/ground rules per biome (dry land only — water comes from the fields).
// p values mirror the old per-chunk scatter densities so each biome keeps its look.
interface VegRule {
  tile: Tile;
  p: number;
  tree?: boolean; // suppressed inside forest clearings
}
interface GroundRule {
  ground: Tile;
  veg: VegRule[];
}

const DEFAULT_RULE: GroundRule = { ground: Tile.Grass, veg: [] };

const GROUND_RULES: Partial<Record<BiomeId, GroundRule>> = {
  forest: { ground: Tile.Grass, veg: [{ tile: Tile.Tree, p: 0.14, tree: true }, { tile: Tile.Bush, p: 0.08 }, { tile: Tile.TallGrass, p: 0.1 }] },
  dense_woods: { ground: Tile.Grass, veg: [{ tile: Tile.Tree, p: 0.26, tree: true }, { tile: Tile.Bush, p: 0.12 }, { tile: Tile.TallGrass, p: 0.14 }] },
  grassland: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.22 }, { tile: Tile.Bush, p: 0.03 }] },
  farmland: { ground: Tile.Dirt, veg: [{ tile: Tile.Crop, p: 0.22 }, { tile: Tile.TallGrass, p: 0.06 }] },
  parkland: { ground: Tile.Grass, veg: [{ tile: Tile.Tree, p: 0.08, tree: true }, { tile: Tile.Trail, p: 0.06 }, { tile: Tile.TallGrass, p: 0.06 }] },
  // Marsh is LAND with coherent pools now (the old base was walkable ShallowWater).
  marsh: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.24 }, { tile: Tile.Bush, p: 0.05 }] },
  wetland: { ground: Tile.Mud, veg: [{ tile: Tile.TallGrass, p: 0.2 }, { tile: Tile.Bush, p: 0.04 }] },
  riverbank: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.1 }, { tile: Tile.Sand, p: 0.06 }] },
  lake: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.12 }, { tile: Tile.Bush, p: 0.04 }] },
  coast: { ground: Tile.Sand, veg: [{ tile: Tile.Bush, p: 0.03 }, { tile: Tile.TallGrass, p: 0.04 }] },
  quarry: { ground: Tile.Dirt, veg: [{ tile: Tile.Rubble, p: 0.18 }, { tile: Tile.Sand, p: 0.06 }] },
  badlands: { ground: Tile.Dirt, veg: [{ tile: Tile.Rubble, p: 0.1 }, { tile: Tile.Sand, p: 0.1 }, { tile: Tile.Basalt, p: 0.02 }] },
  construction_site: { ground: Tile.Dirt, veg: [{ tile: Tile.Rubble, p: 0.08 }, { tile: Tile.Sand, p: 0.05 }] },
  volcanic: { ground: Tile.Scorched, veg: [{ tile: Tile.Lava, p: 0.05 }, { tile: Tile.Basalt, p: 0.09 }, { tile: Tile.Ash, p: 0.13 }] },
};

// Urban table ids clamp to a plain rural ground when sampled as NATURAL terrain
// (urban chunks paint their own pavement/roads/buildings; this is what their
// surroundings — fringes, ring samplers, spawn search — see instead).
const URBAN_GROUND: Partial<Record<BiomeId, GroundRule>> = {
  suburb: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.06 }] },
  school_campus: { ground: Tile.Grass, veg: [{ tile: Tile.TallGrass, p: 0.06 }] },
  shopping_mall: { ground: Tile.Grass, veg: [] },
};
const URBAN_FALLBACK: GroundRule = { ground: Tile.Dirt, veg: [{ tile: Tile.Rubble, p: 0.03 }] };

// River ridge tuning (kept from the old carveRivers so rivers keep their look).
const RIVER_SCALE = 30;
const RIVER_WATER = 0.972;
const RIVER_SHALLOW = 0.955;
const RIVER_BANK = 0.94;

/** Resolve the coherent water systems at a tile. Deepest tier wins. */
function waterAt(seed: string, gx: number, gy: number, u: number, v: number, biome: BiomeId): WaterHit | null {
  let best: WaterHit | null = null;
  const take = (tier: Wet, tile: Tile): void => {
    if (!best || tier > best.tier) best = { tier, tile };
  };

  // 1) Ocean / coast gradient from the continental field — a true beach by
  //    construction: DeepWater → Water → Shallow → (Foam via shoreline) → Sand.
  const cont = contAt(seed, u, v);
  if (cont < 0.215) take(Wet.Deep, Tile.DeepWater);
  else if (cont < OCEAN_LEVEL) take(Wet.Open, Tile.Water);
  else if (cont < 0.285) take(Wet.Shallow, Tile.ShallowWater);
  else if (cont < 0.34) take(Wet.Fringe, Tile.Sand); // beach band (spills past the coast biome)

  // 2) Lakes: a tile-scale blob field, boosted in lake-ish biomes so the lake
  //    region actually holds one coherent lake with a beach ring.
  const lk = field(seed + ":lake", gx, gy, 110, 2) + (LAKE_BOOST[biome] ?? 0);
  const lakeShore = biome === "marsh" || biome === "wetland" ? Tile.Mud : Tile.Sand;
  if (lk > 0.88) take(Wet.Deep, Tile.DeepWater);
  else if (lk > 0.82) take(Wet.Open, Tile.Water);
  else if (lk > 0.76) take(Wet.Shallow, Tile.ShallowWater);
  else if (lk > 0.72) take(Wet.Fringe, lakeShore);

  // 3) Rivers: the global ridge field (seamless meanders), now with real banks.
  const ridge = 1 - Math.abs(2 * field(seed + ":river", gx, gy, RIVER_SCALE, 2) - 1);
  if (ridge > RIVER_WATER) take(Wet.Open, Tile.Water);
  else if (ridge > RIVER_SHALLOW) take(Wet.Shallow, Tile.ShallowWater);
  else if (ridge > RIVER_BANK) {
    const moist = field(seed + ":moist", u, v, 8, 3);
    take(Wet.Fringe, moist >= 0.5 ? Tile.Mud : Tile.Sand);
  }

  // 4) Marsh/wetland pools: coherent ponds with mud fringes + reed bands instead
  //    of the old per-tile water speckles.
  if (biome === "marsh" || biome === "wetland") {
    const pool = field(seed + ":pool", gx, gy, 26, 2);
    if (pool > 0.86) take(Wet.Open, Tile.Water);
    else if (pool > 0.78) take(Wet.Shallow, Tile.ShallowWater);
    else if (pool > 0.72) take(Wet.Fringe, Tile.Mud);
    else if (pool > 0.68) take(Wet.Fringe, Tile.TallGrass); // reed band hugging the pool
  }

  return best;
}

const WETNESS: Record<Wet, number> = {
  [Wet.Dry]: 0,
  [Wet.Fringe]: 0.25,
  [Wet.Shallow]: 0.6,
  [Wet.Open]: 0.85,
  [Wet.Deep]: 1,
};

/** Full terrain sample at a GLOBAL tile. Pure in (seed, gx, gy). */
export function terrainSampleAt(seed: string, gx: number, gy: number): TerrainSample {
  // Beyond the world: open ocean (keeps ring samplers at the rim consistent).
  if (gx < 0 || gy < 0 || gx >= WORLD_TILES_X || gy >= WORLD_TILES_Y) {
    return { biome: "ocean", ground: Tile.DeepWater, wet: 1 };
  }
  const u = (gx + 0.5) / CHUNK_TILES;
  const v = (gy + 0.5) / CHUNK_TILES;

  // Tile-scale jitter wobbles biome borders organically (±, sub-band-width).
  const j = (field(seed + ":bjit", gx, gy, 9, 2) - 0.5) * 0.05;
  const biome = naturalBiomeIdAt(seed, u + j, v + j);

  const water = waterAt(seed, gx, gy, u, v, biome);
  if (water) return { biome, ground: water.tile, wet: WETNESS[water.tier] };

  // Dry ground: biome rule + clustered vegetation via hash thresholds (NO rng).
  const rule = GROUND_RULES[biome] ?? URBAN_GROUND[biome] ?? (URBAN_IDS.has(biome) ? URBAN_FALLBACK : DEFAULT_RULE);
  const clearing =
    (biome === "forest" || biome === "dense_woods" || biome === "parkland") &&
    field(seed + ":clear", gx, gy, 70, 2) > 0.74;
  const m = field(seed + ":feat", gx, gy, 7, 2); // clustering: thickets + open runs
  for (const vr of rule.veg) {
    if (vr.tree && clearing) continue; // glades stay open
    if (hashUnit(`${seed}:veg:${vr.tile}`, gx, gy) < vr.p * (0.3 + 1.7 * m)) {
      return { biome, ground: vr.tile, wet: 0 };
    }
  }
  return { biome, ground: rule.ground, wet: 0 };
}

/** Fast path when only the tile matters. */
export function terrainTileAt(seed: string, gx: number, gy: number): Tile {
  return terrainSampleAt(seed, gx, gy).ground;
}
