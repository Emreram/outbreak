// Biome catalog (CLAUDE.md §10 "the AI handles what's inside" — here the code
// decides the *kind* of place). The biome CLASSIFIER (table/bands/thresholds)
// lives in terrainField.ts and works at TILE resolution; this module keeps the
// pure-data biome definitions and the chunk-dominant `biomeAt` API (classified
// at the chunk centre) that loot/danger/spawn-tables/minimap consume.

import { Tile, type BuildingType } from "./tiles";
import { field, hashUnit } from "./noise";
import { naturalBiomeIdAt, type BiomeId } from "./terrainField";
import { WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "../constants";

// Re-export so the many existing `import { BiomeId } from "./biomes"` keep working.
export type { BiomeId } from "./terrainField";

export interface ScatterRule {
  tile: Tile;
  p: number; // probability per eligible base tile
}
export interface LandmarkRule {
  kind: string;
  label: string;
  p: number; // chance per chunk
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  base: Tile; // dominant ground tile
  scatter: ScatterRule[]; // probabilistic terrain features over the base
  urban: boolean; // true → road grid + dense buildings via partition
  buildingPool: BuildingType[]; // structures placed here
  structureChance: number; // for non-urban biomes: chance a candidate plot gets a structure
  props: string[]; // decorative prop kinds scattered here
  propDensity: number; // ~props per chunk
  lootSource: string; // SOURCES key for open-ground (street) loot in this biome
  lootBias: number; // added to loot rarity bias
  danger: number; // added to the distance danger tier
  landmarks: LandmarkRule[];
  labelColor: number;
  /** Minimap cell colour override. Water-identity biomes need it since their
   *  `base` tile became dry land in the terrain overhaul (lake base is Grass —
   *  the lake itself comes from the per-tile field). Fallback: base tile fill. */
  mapColor?: number;
}

const URBAN_PROPS = ["car", "wreck", "crate", "barrel", "corpse", "sign", "streetlight", "dumpster"];
const NATURE_PROPS = ["tree", "pine", "rock", "bush", "corpse"];

function def(d: Partial<BiomeDef> & Pick<BiomeDef, "id" | "name" | "base">): BiomeDef {
  return {
    scatter: [],
    urban: false,
    buildingPool: [],
    structureChance: 0,
    props: NATURE_PROPS,
    propDensity: 8,
    lootSource: "street",
    lootBias: 0,
    danger: 0,
    landmarks: [],
    labelColor: 0xf4efe2,
    ...d,
  };
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  downtown: def({
    id: "downtown", name: "Downtown", base: Tile.Pavement, urban: true,
    buildingPool: ["office", "office", "pharmacy", "grocery", "hardware_store", "police_station", "diner", "house"],
    props: URBAN_PROPS, propDensity: 14, lootSource: "street", lootBias: 0.15, danger: 2,
    landmarks: [{ kind: "blocked_overpass", label: "Collapsed overpass", p: 0.1 }, { kind: "horde_nest", label: "Horde", p: 0.08 }],
    labelColor: 0xcfe6ff,
  }),
  suburb: def({
    id: "suburb", name: "Suburb", base: Tile.Grass, urban: true,
    buildingPool: ["house", "house", "house", "grocery", "pharmacy", "gas_station", "church", "school"],
    props: ["car", "tree", "bush", "sign", "corpse"], propDensity: 10, lootSource: "house", lootBias: 0, danger: 0,
    landmarks: [{ kind: "survivor_camp", label: "Survivor camp", p: 0.08 }],
  }),
  commercial_strip: def({
    id: "commercial_strip", name: "Commercial strip", base: Tile.Pavement, urban: true,
    buildingPool: ["grocery", "diner", "gas_station", "hardware_store", "motel", "pharmacy", "office"],
    props: URBAN_PROPS, propDensity: 12, lootSource: "grocery", lootBias: 0.1, danger: 1,
    landmarks: [{ kind: "gas_truck", label: "Overturned tanker", p: 0.08 }],
  }),
  industrial: def({
    id: "industrial", name: "Industrial zone", base: Tile.Pavement, urban: true,
    buildingPool: ["factory", "warehouse", "factory", "warehouse", "gas_station", "hardware_store"],
    scatter: [{ tile: Tile.Rubble, p: 0.03 }], props: ["barrel", "crate", "wreck", "car", "corpse"],
    propDensity: 14, lootSource: "industrial", lootBias: 0.2, danger: 2,
    landmarks: [{ kind: "horde_nest", label: "Horde", p: 0.1 }],
  }),
  warehouse_district: def({
    id: "warehouse_district", name: "Warehouse district", base: Tile.Pavement, urban: true,
    buildingPool: ["warehouse", "warehouse", "port_warehouse", "factory", "hardware_store"],
    props: ["crate", "barrel", "wreck", "car"], propDensity: 12, lootSource: "industrial", lootBias: 0.25, danger: 2,
    landmarks: [{ kind: "supply_cache", label: "Supply cache", p: 0.1 }],
  }),
  hospital_zone: def({
    id: "hospital_zone", name: "Hospital zone", base: Tile.Pavement, urban: true,
    buildingPool: ["hospital", "pharmacy", "hospital", "office", "house"],
    props: ["car", "wreck", "corpse", "sign"], propDensity: 12, lootSource: "hospital", lootBias: 0.3, danger: 3,
    landmarks: [{ kind: "quarantine_tents", label: "Quarantine tents", p: 0.14 }],
  }),
  police_district: def({
    id: "police_district", name: "Police district", base: Tile.Pavement, urban: true,
    buildingPool: ["police_station", "fire_station", "police_station", "office", "hardware_store"],
    props: ["car", "wreck", "barrel", "sign"], propDensity: 12, lootSource: "police_station", lootBias: 0.4, danger: 3,
    landmarks: [{ kind: "roadblock", label: "Police roadblock", p: 0.16 }],
  }),
  military_base: def({
    id: "military_base", name: "Military checkpoint", base: Tile.Dirt, urban: true,
    buildingPool: ["military_depot", "bunker", "military_depot", "warehouse"],
    scatter: [{ tile: Tile.Rubble, p: 0.02 }], props: ["wreck", "barrel", "crate", "tent", "corpse_soldier", "corpse"],
    propDensity: 14, lootSource: "military", lootBias: 0.6, danger: 5,
    landmarks: [{ kind: "crashed_helicopter", label: "Crashed helicopter", p: 0.18 }, { kind: "horde_nest", label: "Horde", p: 0.1 }],
    labelColor: 0xc9d6a0,
  }),
  school_campus: def({
    id: "school_campus", name: "School campus", base: Tile.Grass, urban: true,
    buildingPool: ["school", "school", "office", "house"],
    props: ["car", "tree", "bench", "sign", "corpse"], propDensity: 10, lootSource: "house", lootBias: 0.1, danger: 1,
    landmarks: [{ kind: "school_bus", label: "Abandoned school bus", p: 0.12 }],
  }),
  shopping_mall: def({
    id: "shopping_mall", name: "Shopping mall", base: Tile.Pavement, urban: true,
    buildingPool: ["mall", "mall", "diner", "grocery", "motel"],
    props: ["car", "wreck", "crate", "sign"], propDensity: 14, lootSource: "grocery", lootBias: 0.3, danger: 2,
    landmarks: [{ kind: "horde_nest", label: "Horde", p: 0.14 }],
  }),
  trainyard: def({
    id: "trainyard", name: "Trainyard", base: Tile.Dirt, urban: true,
    scatter: [{ tile: Tile.Rail, p: 0.06 }, { tile: Tile.Rubble, p: 0.02 }],
    buildingPool: ["warehouse", "factory", "warehouse"], props: ["crate", "barrel", "wreck", "corpse"],
    propDensity: 12, lootSource: "industrial", lootBias: 0.25, danger: 3,
    landmarks: [{ kind: "derailed_train", label: "Derailed train", p: 0.18 }],
  }),
  construction_site: def({
    id: "construction_site", name: "Construction site", base: Tile.Dirt, urban: false,
    scatter: [{ tile: Tile.Rubble, p: 0.08 }, { tile: Tile.Sand, p: 0.05 }],
    buildingPool: ["warehouse", "office"], structureChance: 0.3, props: ["crate", "barrel", "rock", "wreck"],
    propDensity: 14, lootSource: "hardware_store", lootBias: 0.2, danger: 2,
    landmarks: [{ kind: "crane", label: "Toppled crane", p: 0.14 }],
  }),
  forest: def({
    id: "forest", name: "Forest", base: Tile.Grass,
    scatter: [{ tile: Tile.Tree, p: 0.14 }, { tile: Tile.Bush, p: 0.08 }, { tile: Tile.TallGrass, p: 0.1 }],
    buildingPool: ["cabin", "ranger_station"], structureChance: 0.16, props: ["pine", "tree", "rock", "bush", "tent"],
    propDensity: 18, lootSource: "forest", lootBias: 0.1, danger: 1,
    landmarks: [{ kind: "ranger_lookout", label: "Ranger lookout", p: 0.1 }, { kind: "campsite", label: "Old campsite", p: 0.12 }],
    labelColor: 0xbfe3a8,
  }),
  dense_woods: def({
    id: "dense_woods", name: "Deep woods", base: Tile.Grass,
    scatter: [{ tile: Tile.Tree, p: 0.26 }, { tile: Tile.Bush, p: 0.12 }, { tile: Tile.TallGrass, p: 0.14 }],
    buildingPool: ["cabin"], structureChance: 0.1, props: ["pine", "pine", "tree", "rock"],
    propDensity: 22, lootSource: "forest", lootBias: 0.2, danger: 2,
    landmarks: [{ kind: "hunters_cabin", label: "Hunter's cabin", p: 0.12 }],
    labelColor: 0x9fcf86,
  }),
  farmland: def({
    id: "farmland", name: "Farmland", base: Tile.Dirt,
    scatter: [{ tile: Tile.Crop, p: 0.22 }, { tile: Tile.TallGrass, p: 0.06 }],
    buildingPool: ["barn", "silo", "house", "barn"], structureChance: 0.22, props: ["hay", "tree", "car", "corpse", "rock"],
    propDensity: 12, lootSource: "farm", lootBias: 0.1, danger: 1,
    landmarks: [{ kind: "grain_silos", label: "Grain silos", p: 0.14 }, { kind: "survivor_camp", label: "Farmstead holdouts", p: 0.08 }],
    labelColor: 0xe6d28a,
  }),
  grassland: def({
    id: "grassland", name: "Grassland", base: Tile.Grass,
    scatter: [{ tile: Tile.TallGrass, p: 0.22 }, { tile: Tile.Bush, p: 0.03 }],
    buildingPool: ["cabin", "barn"], structureChance: 0.08, props: ["rock", "tree", "corpse", "bush"],
    propDensity: 8, lootSource: "street", lootBias: 0, danger: 0,
    landmarks: [{ kind: "radio_tower", label: "Radio tower", p: 0.08 }],
  }),
  // Water in riverbank/lake/marsh/coast/wetland now comes from the COHERENT field
  // systems in terrainField.ts (river banks, lake blobs with beach rings, marsh
  // pools, the coast gradient) — not per-tile scatter speckles. Their `base` is
  // the DRY ground between the water bodies.
  riverbank: def({
    id: "riverbank", name: "Riverbank", base: Tile.Grass,
    buildingPool: ["cabin"], structureChance: 0.12, props: ["tree", "rock", "tent", "corpse"],
    propDensity: 12, lootSource: "forest", lootBias: 0.15, danger: 1,
    landmarks: [{ kind: "fishing_dock", label: "Fishing dock", p: 0.12 }],
    labelColor: 0x8fc7e6,
  }),
  lake: def({
    id: "lake", name: "Lake", base: Tile.Grass, mapColor: 0x3f6f93,
    buildingPool: ["cabin"], structureChance: 0.05, props: ["rock", "tree", "bush"], propDensity: 6,
    lootSource: "street", lootBias: 0.2, danger: 1, landmarks: [],
    labelColor: 0x8fc7e6,
  }),
  marsh: def({
    id: "marsh", name: "Marshland", base: Tile.Grass, mapColor: 0x49705c,
    buildingPool: ["cabin"], structureChance: 0.06, props: ["bush", "tree", "corpse"], propDensity: 10,
    lootSource: "forest", lootBias: 0.1, danger: 2,
    landmarks: [{ kind: "sunken_shack", label: "Sunken shack", p: 0.1 }],
    labelColor: 0x9fb38a,
  }),
  coast: def({
    id: "coast", name: "Coast", base: Tile.Sand,
    buildingPool: ["cabin", "motel"], structureChance: 0.12, props: ["rock", "wreck", "tent", "corpse"],
    propDensity: 10, lootSource: "street", lootBias: 0.2, danger: 1,
    landmarks: [{ kind: "lighthouse", label: "Lighthouse", p: 0.14 }, { kind: "beached_boat", label: "Beached trawler", p: 0.1 }],
    labelColor: 0xe6d8a8,
  }),
  quarry: def({
    id: "quarry", name: "Quarry", base: Tile.Dirt,
    scatter: [{ tile: Tile.Rubble, p: 0.18 }, { tile: Tile.Sand, p: 0.06 }],
    buildingPool: ["warehouse"], structureChance: 0.1, props: ["boulder", "rock", "barrel", "crate", "wreck"],
    propDensity: 16, lootSource: "hardware_store", lootBias: 0.25, danger: 3,
    landmarks: [{ kind: "mining_rig", label: "Abandoned dig site", p: 0.14 }],
  }),
  parkland: def({
    id: "parkland", name: "City park", base: Tile.Grass,
    scatter: [{ tile: Tile.Tree, p: 0.08 }, { tile: Tile.Trail, p: 0.06 }, { tile: Tile.TallGrass, p: 0.06 }],
    buildingPool: ["ranger_station"], structureChance: 0.08, props: ["tree", "bench", "rock", "corpse", "bush"],
    propDensity: 14, lootSource: "street", lootBias: 0.1, danger: 1,
    landmarks: [{ kind: "bandstand", label: "Park bandstand", p: 0.12 }],
    labelColor: 0xbfe3a8,
  }),
  ocean: def({
    id: "ocean", name: "Open water", base: Tile.DeepWater,
    scatter: [{ tile: Tile.Water, p: 0 }], buildingPool: [], propDensity: 0, props: [],
    lootSource: "street", lootBias: 0, danger: 0, landmarks: [],
    labelColor: 0x6fa8c7,
  }),
  // --- Living-World biomes -------------------------------------------------
  volcanic: def({
    id: "volcanic", name: "Volcanic field", base: Tile.Scorched,
    scatter: [{ tile: Tile.Lava, p: 0.05 }, { tile: Tile.Basalt, p: 0.09 }, { tile: Tile.Ash, p: 0.13 }],
    buildingPool: ["bunker"], structureChance: 0.06, props: ["boulder", "rock", "wreck", "corpse"],
    propDensity: 9, lootSource: "industrial", lootBias: 0.35, danger: 4,
    landmarks: [{ kind: "lava_vent", label: "Lava vent", p: 0.22 }],
    labelColor: 0xff8a4a,
  }),
  wetland: def({
    id: "wetland", name: "Wetland", base: Tile.Mud, mapColor: 0x4f5a3a,
    buildingPool: ["cabin"], structureChance: 0.05, props: ["bush", "tree", "corpse"], propDensity: 10,
    lootSource: "forest", lootBias: 0.12, danger: 2,
    landmarks: [{ kind: "sunken_shack", label: "Sunken shack", p: 0.1 }],
    labelColor: 0x9fb38a,
  }),
  badlands: def({
    id: "badlands", name: "Badlands", base: Tile.Dirt,
    scatter: [{ tile: Tile.Rubble, p: 0.1 }, { tile: Tile.Sand, p: 0.1 }, { tile: Tile.Basalt, p: 0.02 }],
    buildingPool: ["cabin", "warehouse"], structureChance: 0.06, props: ["boulder", "rock", "wreck", "corpse"],
    propDensity: 11, lootSource: "street", lootBias: 0.15, danger: 2,
    landmarks: [{ kind: "mining_rig", label: "Abandoned dig site", p: 0.1 }],
    labelColor: 0xc8a878,
  }),
};

// Rare special districts, injected where a third noise spikes over dense areas.
// (Chunk-level identity — a police district is a district, not a tile gradient.)
const SPECIALS: BiomeId[] = ["police_district", "military_base", "shopping_mall"];
const DENSE_IDS = new Set<BiomeId>([
  "commercial_strip", "school_campus", "warehouse_district", "trainyard",
  "downtown", "hospital_zone", "industrial", "quarry",
]);

/** Chebyshev distance (in chunks) to the nearest world edge. */
function edgeDistChunks(cx: number, cy: number): number {
  return Math.min(cx, cy, WORLD_CHUNKS_X - 1 - cx, WORLD_CHUNKS_Y - 1 - cy);
}

/** The DOMINANT biome for a chunk — the tile-resolution classifier sampled at the
 *  chunk centre (terrainField.naturalBiomeIdAt), plus chunk-level special-district
 *  injection and the hard ocean ring at the world edge. This stays the API the
 *  rest of the game consumes (loot, danger, spawn tables, minimap, vehicles);
 *  actual per-tile terrain inside a chunk comes from terrainField directly. */
export function biomeAt(seed: string, cx: number, cy: number): BiomeDef {
  if (edgeDistChunks(cx, cy) <= 0) return BIOMES.ocean;

  const id = naturalBiomeIdAt(seed, cx + 0.5, cy + 0.5);

  // Rare special districts only in built-up (high-density) regions.
  if (DENSE_IDS.has(id)) {
    const spec = field(seed + ":spec", cx, cy, 3, 2);
    if (spec > 0.9) {
      const idx = Math.floor(hashUnit(seed + ":specpick", cx, cy) * SPECIALS.length) % SPECIALS.length;
      return BIOMES[SPECIALS[idx]];
    }
  }

  return BIOMES[id];
}

export function getBiome(id: BiomeId | string): BiomeDef {
  return BIOMES[id as BiomeId] ?? BIOMES.grassland;
}
