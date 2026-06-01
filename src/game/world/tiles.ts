// Terrain tiles, building types, and the per-chunk data shapes — a dependency-free
// leaf module so both worldgen.ts and the biome catalog can import it without a
// cycle. worldgen.ts re-exports these for back-compat.

export enum Tile {
  // Original city set (indices 0–5 kept stable).
  Road = 0,
  Sidewalk = 1,
  Floor = 2,
  Wall = 3,
  Door = 4,
  Grass = 5,
  // New terrain for the biome system. Contiguous so each value === its tileset
  // frame index (see engine/textures.ts generateTileTexture order).
  Water = 6,
  ShallowWater = 7,
  Sand = 8,
  Dirt = 9,
  Trail = 10,
  Tree = 11,
  Bush = 12,
  TallGrass = 13,
  Rubble = 14,
  Pavement = 15,
  Rail = 16,
  Crop = 17,
  Bridge = 18,
}

/** Total number of distinct tiles (used to size the generated tileset). */
export const TILE_COUNT = 19;

/**
 * Canonical tile order for the generated tileset: frame index i renders Tile
 * value i, so a grid value maps straight to a tileset frame. MUST list every
 * Tile in enum-value order (asserted in tests).
 */
export const TILE_ORDER: Tile[] = [
  Tile.Road, Tile.Sidewalk, Tile.Floor, Tile.Wall, Tile.Door, Tile.Grass,
  Tile.Water, Tile.ShallowWater, Tile.Sand, Tile.Dirt, Tile.Trail, Tile.Tree,
  Tile.Bush, Tile.TallGrass, Tile.Rubble, Tile.Pavement, Tile.Rail, Tile.Crop, Tile.Bridge,
];

/** Tile indices the player (and enemies/projectiles) cannot pass. */
export const SOLID_TILES: readonly Tile[] = [Tile.Wall, Tile.Water, Tile.Tree, Tile.Rubble, Tile.Rail];

export type BuildingType =
  // original city
  | "house"
  | "pharmacy"
  | "grocery"
  | "gas_station"
  | "hospital"
  | "police_station"
  | "hardware_store"
  // biome structures
  | "barn"
  | "silo"
  | "warehouse"
  | "factory"
  | "school"
  | "church"
  | "mall"
  | "motel"
  | "diner"
  | "bunker"
  | "military_depot"
  | "fire_station"
  | "lab"
  | "cabin"
  | "ranger_station"
  | "port_warehouse"
  | "office";

/** Loot tier (0..4) by building type — drives chest quality + loot bias. */
export const CONTAINER_TIER: Record<BuildingType, number> = {
  house: 0,
  cabin: 0,
  motel: 0,
  barn: 1,
  silo: 1,
  diner: 1,
  grocery: 1,
  gas_station: 1,
  pharmacy: 1,
  church: 1,
  school: 1,
  ranger_station: 1,
  office: 1,
  hardware_store: 2,
  warehouse: 2,
  factory: 2,
  port_warehouse: 2,
  hospital: 2,
  mall: 2,
  fire_station: 2,
  lab: 3,
  police_station: 3,
  bunker: 3,
  military_depot: 4,
};

export interface Building {
  gid: string; // stable global id: `${cx}_${cy}_${i}`
  type: BuildingType;
  // outer wall bounds, GLOBAL tile coords
  tx: number;
  ty: number;
  tw: number;
  th: number;
  door: { x: number; y: number }; // GLOBAL tile coords
  center: { x: number; y: number }; // GLOBAL world pixels (labels / triggers)
}

/** Visual + behavioural variety for lootable containers (not all are "chests"). */
export type ContainerKind =
  | "crate" | "drawer" | "locker" | "fridge" | "toolbox" | "cabinet"
  | "register" | "med_cabinet" | "gun_cabinet" | "safe";

export interface Container {
  gid: string; // `${cx}_${cy}_${i}`
  tx: number; // GLOBAL tile coords
  ty: number;
  tier: number;
  type: BuildingType;
  kind: ContainerKind; // drives sprite + loot bias
  locked: boolean; // needs a Crowbar / Lockpick / Bolt Cutters to open
}

/** Decorative, non-blocking props (rendered as small sprites, not tiles). */
export interface Prop {
  kind: string; // car, tree, rock, crate, corpse, barrel, sign, tent, grave…
  x: number; // GLOBAL world pixels
  y: number;
}

/** A landmark set-piece placed in a chunk (curated points of interest). */
export interface Landmark {
  kind: string;
  x: number; // GLOBAL world pixels (centre)
  y: number;
  label: string;
}

/** One generated chunk. Grid is LOCAL (size×size); everything else is global. */
export interface ChunkData {
  cx: number;
  cy: number;
  size: number; // CHUNK_TILES
  tileSize: number;
  biome: string; // BiomeId
  grid: Tile[][]; // grid[localRow][localCol]
  buildings: Building[];
  containers: Container[];
  props: Prop[];
  landmarks: Landmark[];
}
