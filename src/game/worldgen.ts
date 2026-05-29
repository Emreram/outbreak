// Seeded procedural city generator (CLAUDE.md §10).
// "Code generates the geometry; the AI handles what's inside."
//
// Produces a tile grid (roads, sidewalks, buildings, doors) plus structured
// building metadata (type + enterable door) that later phases will use to
// trigger GM encounters. Same seed -> same city.

import { createRng, type Rng } from "./rng";
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "./constants";

export enum Tile {
  Road = 0,
  Sidewalk = 1,
  Floor = 2,
  Wall = 3,
  Door = 4,
  Grass = 5,
}

/** Tile indices the player cannot walk through. Everything else is walkable. */
export const SOLID_TILES: readonly Tile[] = [Tile.Wall];

export type BuildingType =
  | "house"
  | "pharmacy"
  | "grocery"
  | "gas_station"
  | "hospital"
  | "police_station"
  | "hardware_store";

// Weighted pool — houses are common, special buildings rarer.
const BUILDING_TYPES: readonly BuildingType[] = [
  "house",
  "house",
  "house",
  "house",
  "pharmacy",
  "grocery",
  "grocery",
  "gas_station",
  "hardware_store",
  "police_station",
  "hospital",
];

export interface Building {
  id: number;
  type: BuildingType;
  /** outer wall bounds in tile space */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  /** the single enterable door, in tile coords */
  door: { x: number; y: number };
  /** building centre in world pixels (for labels / triggers) */
  center: { x: number; y: number };
}

export interface WorldData {
  seed: string;
  tileSize: number;
  width: number; // tiles
  height: number; // tiles
  grid: Tile[][]; // grid[row][col]
  buildings: Building[];
  start: { x: number; y: number }; // player spawn, world pixels
}

export interface WorldGenOptions {
  width?: number;
  height?: number;
  tileSize?: number;
}

export function generateWorld(seed: string, opts: WorldGenOptions = {}): WorldData {
  const width = opts.width ?? MAP_WIDTH;
  const height = opts.height ?? MAP_HEIGHT;
  const tileSize = opts.tileSize ?? TILE_SIZE;
  const rng = createRng(seed);

  // 1) Base layer: grass everywhere.
  const grid: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = new Array<Tile>(width).fill(Tile.Grass);
  }

  // 2) Street network: 2-wide roads on a jittered grid.
  const roadCols = axisRoads(width, rng);
  const roadRows = axisRoads(height, rng);
  const roadColSet = new Set<number>(roadCols.flatMap((c) => [c, c + 1]));
  const roadRowSet = new Set<number>(roadRows.flatMap((r) => [r, r + 1]));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (roadColSet.has(x) || roadRowSet.has(y)) grid[y][x] = Tile.Road;
    }
  }

  // 3) Sidewalks: any grass tile orthogonally adjacent to a road.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === Tile.Grass && hasRoadNeighbor(grid, x, y, width, height)) {
        grid[y][x] = Tile.Sidewalk;
      }
    }
  }

  // 4) Buildings: fill each block (between roads) with a row/grid of structures
  //    separated by alleys, leaving the sidewalk ring intact.
  const buildings: Building[] = [];
  const colBlocks = blockEdges(roadCols, width);
  const rowBlocks = blockEdges(roadRows, height);
  let nextId = 0;
  for (const [ax, bx] of colBlocks) {
    for (const [ay, by] of rowBlocks) {
      const made = fillBlock(grid, nextId, ax, ay, bx, by, tileSize, rng);
      buildings.push(...made);
      nextId += made.length;
    }
  }

  // 5) Spawn the player on a central road tile (always walkable).
  const start = centralRoad(grid, width, height, tileSize);

  return { seed, tileSize, width, height, grid, buildings, start };
}

// --- helpers ---------------------------------------------------------------

/** Start positions of 2-wide roads along one axis, with jittered block gaps. */
function axisRoads(len: number, rng: Rng): number[] {
  const roads: number[] = [];
  let p = 2; // leave a small grass/sidewalk border
  roads.push(p);
  // each road is 2 wide; gap is the buildable block between roads
  while (true) {
    const gap = rng.int(11, 16);
    p = p + 2 + gap;
    if (p >= len - 4) break;
    roads.push(p);
  }
  return roads;
}

/** Inclusive [start, end] tile ranges of buildable blocks between consecutive roads. */
function blockEdges(roads: number[], _len: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < roads.length - 1; i++) {
    const a = roads[i] + 2; // first tile past this 2-wide road
    const b = roads[i + 1] - 1; // last tile before the next road
    if (b - a >= 4) edges.push([a, b]);
  }
  return edges;
}

function hasRoadNeighbor(grid: Tile[][], x: number, y: number, w: number, h: number): boolean {
  if (x > 0 && grid[y][x - 1] === Tile.Road) return true;
  if (x < w - 1 && grid[y][x + 1] === Tile.Road) return true;
  if (y > 0 && grid[y - 1][x] === Tile.Road) return true;
  if (y < h - 1 && grid[y + 1][x] === Tile.Road) return true;
  return false;
}

/**
 * Partition an inclusive [lo, hi] span into building segments separated by
 * 1-tile alleys. Segments are 4–8 tiles; leftovers become alley/grass.
 */
function partition(lo: number, hi: number, rng: Rng): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let s = lo;
  while (s <= hi) {
    const remaining = hi - s + 1;
    if (remaining < 4) break;
    const len = Math.min(remaining, rng.int(4, 8));
    segs.push([s, s + len - 1]);
    s += len + 1; // +1 tile alley gap between buildings
  }
  return segs;
}

/** Fill one block with buildings. The block's outer ring (ax..bx, ay..by edges)
 *  is already sidewalk; we build inside it, separated by grass alleys. */
function fillBlock(
  grid: Tile[][],
  idStart: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tileSize: number,
  rng: Rng,
): Building[] {
  const out: Building[] = [];
  let id = idStart;
  const xs = partition(ax + 1, bx - 1, rng); // inset 1 to keep the sidewalk ring
  const ys = partition(ay + 1, by - 1, rng);
  for (const [sx, ex] of xs) {
    for (const [sy, ey] of ys) {
      if (rng.chance(0.14)) continue; // empty lot / pocket park — adds variety
      const b = carveBuilding(grid, id, sx, sy, ex, ey, tileSize, rng);
      if (b) {
        out.push(b);
        id++;
      }
    }
  }
  return out;
}

/** Carve a single building: wall perimeter, floor interior, one door. */
function carveBuilding(
  grid: Tile[][],
  id: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  tileSize: number,
  rng: Rng,
): Building | null {
  const w = ex - sx + 1;
  const h = ey - sy + 1;
  if (w < 3 || h < 3) return null; // need an interior tile

  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const isEdge = x === sx || x === ex || y === sy || y === ey;
      grid[y][x] = isEdge ? Tile.Wall : Tile.Floor;
    }
  }

  // Door on a random side, never in a corner. The tile just outside is always
  // walkable (sidewalk ring or a grass alley), so the building is reachable.
  const side = rng.int(0, 3);
  let dx: number;
  let dy: number;
  if (side === 0) {
    dx = rng.int(sx + 1, ex - 1);
    dy = sy; // top
  } else if (side === 1) {
    dx = rng.int(sx + 1, ex - 1);
    dy = ey; // bottom
  } else if (side === 2) {
    dx = sx;
    dy = rng.int(sy + 1, ey - 1); // left
  } else {
    dx = ex;
    dy = rng.int(sy + 1, ey - 1); // right
  }
  grid[dy][dx] = Tile.Door;

  const center = {
    x: ((sx + ex) / 2 + 0.5) * tileSize,
    y: ((sy + ey) / 2 + 0.5) * tileSize,
  };

  return {
    id,
    type: rng.pick(BUILDING_TYPES),
    tx: sx,
    ty: sy,
    tw: w,
    th: h,
    door: { x: dx, y: dy },
    center,
  };
}

/** Find a road tile near the map centre and return its world-pixel centre. */
function centralRoad(grid: Tile[][], width: number, height: number, tileSize: number) {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const maxR = Math.max(width, height);
  for (let r = 0; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (grid[y][x] === Tile.Road) {
          return { x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize };
        }
      }
    }
  }
  // Fallback: dead centre.
  return { x: (cx + 0.5) * tileSize, y: (cy + 0.5) * tileSize };
}
