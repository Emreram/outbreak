// Seeded procedural generator (CLAUDE.md §10), now CHUNK-based: the world is an
// enormous, finite, seamless grid of chunks generated on demand from
// (seed, chunkX, chunkY). "Code generates the geometry; the AI handles what's
// inside." Same seed + coords -> identical chunk, so terrain never needs saving.

import { createRng, type Rng } from "./rng";
import { CHUNK_TILES, TILE_SIZE } from "./constants";
import {
  Tile,
  SOLID_TILES,
  CONTAINER_TIER,
  type BuildingType,
  type Building,
  type Container,
  type Prop,
  type Landmark,
  type ChunkData,
} from "./world/tiles";
import { biomeAt, type BiomeDef } from "./world/biomes";

// Re-export the tile/data shapes so existing imports `from "../game/worldgen"`
// keep working (WorldScene, tests, etc.).
export {
  Tile,
  SOLID_TILES,
  TILE_COUNT,
  TILE_ORDER,
  CONTAINER_TIER,
  type BuildingType,
  type Building,
  type Container,
  type Prop,
  type Landmark,
  type ChunkData,
} from "./world/tiles";

const SOLID = new Set<number>(SOLID_TILES as number[]);
const isSolid = (t: Tile): boolean => SOLID.has(t);

// --- global road grid (seamless across chunk borders) ----------------------
// Roads live in GLOBAL tile space so adjacent urban chunks always line up.
// Each ROAD_PERIOD-wide band holds one 2-wide road at a seed-jittered offset.
const ROAD_PERIOD = 17;

function roadStart(seed: string, axis: string, band: number): number {
  const r = createRng(`${seed}:road:${axis}:${band}`);
  return band * ROAD_PERIOD + 2 + r.int(0, ROAD_PERIOD - 5);
}
function isRoad(seed: string, axis: string, g: number): boolean {
  const band = Math.floor(g / ROAD_PERIOD);
  const s = roadStart(seed, axis, band);
  return g === s || g === s + 1;
}
const isRoadCol = (seed: string, gx: number): boolean => isRoad(seed, "x", gx);
const isRoadRow = (seed: string, gy: number): boolean => isRoad(seed, "y", gy);

// ---------------------------------------------------------------------------

export function generateChunk(seed: string, cx: number, cy: number): ChunkData {
  const size = CHUNK_TILES;
  const tileSize = TILE_SIZE;
  const biome = biomeAt(seed, cx, cy);
  const rng = createRng(`${seed}:chunk:${cx}:${cy}`);
  const gx0 = cx * size;
  const gy0 = cy * size;

  // 1) Base terrain + probabilistic scatter (trees, water, crops, rubble…).
  const grid: Tile[][] = [];
  for (let ly = 0; ly < size; ly++) grid[ly] = new Array<Tile>(size).fill(biome.base);
  for (const s of biome.scatter) {
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        if (grid[ly][lx] === biome.base && rng.chance(s.p)) grid[ly][lx] = s.tile;
      }
    }
  }

  const buildings: Building[] = [];
  const containers: Container[] = [];
  const props: Prop[] = [];
  const landmarks: Landmark[] = [];

  if (biome.urban) carveUrban(grid, seed, cx, cy, size, biome, rng, buildings);
  else carveNatural(grid, cx, cy, size, biome, rng, buildings);

  // 2) Loot containers inside buildings.
  let ci = 0;
  for (const b of buildings) {
    const n = 1 + (rng.chance(0.35) ? 1 : 0);
    const used = new Set<string>();
    for (let i = 0; i < n; i++) {
      const tile = floorTileIn(grid, b, gx0, gy0, rng, used);
      if (tile) {
        used.add(`${tile.x},${tile.y}`);
        containers.push({ gid: `${cx}_${cy}_c${ci++}`, tx: tile.x, ty: tile.y, tier: CONTAINER_TIER[b.type] ?? 1, type: b.type });
      }
    }
  }

  // 3) Rare landmark set-pieces (each leaves a good loot cache).
  for (const lm of biome.landmarks) {
    if (!rng.chance(lm.p)) continue;
    const t = walkableLocal(grid, size, rng);
    if (!t) continue;
    const gx = gx0 + t.x;
    const gy = gy0 + t.y;
    landmarks.push({ kind: lm.kind, label: lm.label, x: (gx + 0.5) * tileSize, y: (gy + 0.5) * tileSize });
    containers.push({ gid: `${cx}_${cy}_L${ci++}`, tx: gx, ty: gy, tier: 3, type: "warehouse" });
  }

  // 4) Decorative props (non-blocking sprites).
  for (let i = 0; i < biome.propDensity; i++) {
    const t = nonWaterLocal(grid, size, rng);
    if (!t) continue;
    props.push({ kind: rng.pick(biome.props.length ? biome.props : ["rock"]), x: (gx0 + t.x + 0.5) * tileSize, y: (gy0 + t.y + 0.5) * tileSize });
  }

  // 5) Anti-emptiness: guarantee at least one interactable per chunk.
  if (buildings.length === 0 && containers.length === 0) {
    const t = walkableLocal(grid, size, rng);
    if (t) {
      const gx = gx0 + t.x;
      const gy = gy0 + t.y;
      containers.push({ gid: `${cx}_${cy}_x0`, tx: gx, ty: gy, tier: 1, type: "house" });
      landmarks.push({ kind: "supply_cache", label: "Supply cache", x: (gx + 0.5) * tileSize, y: (gy + 0.5) * tileSize });
    }
  }

  return { cx, cy, size, tileSize, biome: biome.id, grid, buildings, containers, props, landmarks };
}

/** A walkable world-pixel spawn point for a freshly-generated chunk: the nearest
 *  OPEN tile to the centre (road/ground), avoiding building interiors. */
export function chunkStartPx(chunk: ChunkData): { x: number; y: number } {
  const { grid, size, tileSize, cx, cy } = chunk;
  const c = Math.floor(size / 2);
  const toPx = (lx: number, ly: number) => ({ x: (cx * size + lx + 0.5) * tileSize, y: (cy * size + ly + 0.5) * tileSize });
  let firstWalkable: { x: number; y: number } | null = null;
  for (let r = 0; r < size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const lx = c + dx;
        const ly = c + dy;
        if (lx < 0 || ly < 0 || lx >= size || ly >= size) continue;
        const t = grid[ly][lx];
        if (isSolid(t)) continue;
        if (!firstWalkable) firstWalkable = toPx(lx, ly);
        if (t !== Tile.Floor && t !== Tile.Door) return toPx(lx, ly); // prefer open ground
      }
    }
  }
  return firstWalkable ?? toPx(c, c);
}

// --- urban generation ------------------------------------------------------

function carveUrban(
  grid: Tile[][],
  seed: string,
  cx: number,
  cy: number,
  size: number,
  biome: BiomeDef,
  rng: Rng,
  out: Building[],
): void {
  const gx0 = cx * size;
  const gy0 = cy * size;

  // Roads from the global grid.
  for (let ly = 0; ly < size; ly++) {
    const rowRoad = isRoadRow(seed, gy0 + ly);
    for (let lx = 0; lx < size; lx++) {
      if (rowRoad || isRoadCol(seed, gx0 + lx)) grid[ly][lx] = Tile.Road;
    }
  }
  // Sidewalks: ground next to a road.
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const t = grid[ly][lx];
      if (t !== Tile.Road && t !== Tile.Wall && !isSolid(t) && adjRoad(grid, lx, ly, size)) {
        grid[ly][lx] = Tile.Sidewalk;
      }
    }
  }

  // Building plots: blocks between roads, clipped to the chunk interior so no
  // building spans a chunk border (keeps chunks independent & seamless).
  const cols = nonRoadRuns(seed, "x", gx0, size);
  const rows = nonRoadRuns(seed, "y", gy0, size);
  let id = 0;
  for (const [ax, bx] of cols) {
    for (const [ay, by] of rows) {
      const xs = partition(ax + 1, bx - 1, rng); // inset for a sidewalk ring
      const ys = partition(ay + 1, by - 1, rng);
      for (const [sx, ex] of xs) {
        for (const [sy, ey] of ys) {
          if (rng.chance(0.16)) continue; // empty lot / pocket park
          const b = carveBuilding(grid, `${cx}_${cy}_b${id}`, sx, sy, ex, ey, gx0, gy0, rng.pick(biome.buildingPool), rng);
          if (b) {
            out.push(b);
            id++;
          }
        }
      }
    }
  }
}

/** Local [lo, hi] runs of non-road tiles within a chunk axis, clipped to interior. */
function nonRoadRuns(seed: string, axis: string, g0: number, size: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let l = 1; l < size - 1; l++) {
    const road = isRoad(seed, axis, g0 + l);
    if (!road && start < 0) start = l;
    if ((road || l === size - 2) && start >= 0) {
      const end = road ? l - 1 : size - 2;
      if (end - start >= 4) runs.push([start, end]);
      start = -1;
    }
  }
  return runs;
}

// --- natural generation ----------------------------------------------------

function carveNatural(
  grid: Tile[][],
  cx: number,
  cy: number,
  size: number,
  biome: BiomeDef,
  rng: Rng,
  out: Building[],
): void {
  if (biome.buildingPool.length === 0) return;
  const gx0 = cx * size;
  const gy0 = cy * size;
  const attempts = 5;
  let id = 0;
  for (let a = 0; a < attempts; a++) {
    if (!rng.chance(biome.structureChance)) continue;
    const w = rng.int(4, 7);
    const h = rng.int(4, 7);
    const sx = rng.int(1, size - w - 2);
    const sy = rng.int(1, size - h - 2);
    if (!areaClearable(grid, sx, sy, sx + w - 1, sy + h - 1)) continue;
    const b = carveBuilding(grid, `${cx}_${cy}_n${id}`, sx, sy, sx + w - 1, sy + h - 1, gx0, gy0, rng.pick(biome.buildingPool), rng);
    if (b) {
      out.push(b);
      id++;
    }
  }
}

/** True if the rectangle is mostly open (not water/wall) so a structure can sit there. */
function areaClearable(grid: Tile[][], sx: number, sy: number, ex: number, ey: number): boolean {
  let blocked = 0;
  let total = 0;
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      total++;
      const t = grid[y]?.[x];
      if (t === Tile.Water || t === Tile.Wall) blocked++;
    }
  }
  return total > 0 && blocked / total < 0.2;
}

// --- building carving (shared) ---------------------------------------------

/** Carve one building into the LOCAL grid; record GLOBAL coords. */
function carveBuilding(
  grid: Tile[][],
  gid: string,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  gx0: number,
  gy0: number,
  type: BuildingType,
  rng: Rng,
): Building | null {
  const w = ex - sx + 1;
  const h = ey - sy + 1;
  if (w < 3 || h < 3) return null;

  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const isEdge = x === sx || x === ex || y === sy || y === ey;
      grid[y][x] = isEdge ? Tile.Wall : Tile.Floor;
    }
  }

  // Door on a random side, never a corner.
  const side = rng.int(0, 3);
  let dx: number;
  let dy: number;
  if (side === 0) {
    dx = rng.int(sx + 1, ex - 1);
    dy = sy;
  } else if (side === 1) {
    dx = rng.int(sx + 1, ex - 1);
    dy = ey;
  } else if (side === 2) {
    dx = sx;
    dy = rng.int(sy + 1, ey - 1);
  } else {
    dx = ex;
    dy = rng.int(sy + 1, ey - 1);
  }
  grid[dy][dx] = Tile.Door;

  // Guarantee the door is reachable: the tile just outside must be walkable.
  const ox = dx + (dx === sx ? -1 : dx === ex ? 1 : 0);
  const oy = dy + (dy === sy ? -1 : dy === ey ? 1 : 0);
  if (grid[oy]?.[ox] !== undefined && isSolid(grid[oy][ox])) grid[oy][ox] = Tile.Trail;

  return {
    gid,
    type,
    tx: gx0 + sx,
    ty: gy0 + sy,
    tw: w,
    th: h,
    door: { x: gx0 + dx, y: gy0 + dy },
    center: { x: (gx0 + (sx + ex) / 2 + 0.5) * TILE_SIZE, y: (gy0 + (sy + ey) / 2 + 0.5) * TILE_SIZE },
  };
}

/**
 * Partition an inclusive [lo, hi] span into building segments (4–8 tiles)
 * separated by 1-tile alleys.
 */
function partition(lo: number, hi: number, rng: Rng): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let s = lo;
  while (s <= hi) {
    const remaining = hi - s + 1;
    if (remaining < 4) break;
    const len = Math.min(remaining, rng.int(4, 8));
    segs.push([s, s + len - 1]);
    s += len + 1;
  }
  return segs;
}

/** A random interior Floor tile of a building (GLOBAL coords out), avoiding the door. */
function floorTileIn(
  grid: Tile[][],
  b: Building,
  gx0: number,
  gy0: number,
  rng: Rng,
  used: Set<string>,
): { x: number; y: number } | null {
  const lx0 = b.tx - gx0;
  const ly0 = b.ty - gy0;
  const candidates: { x: number; y: number }[] = [];
  for (let ly = ly0 + 1; ly < ly0 + b.th - 1; ly++) {
    for (let lx = lx0 + 1; lx < lx0 + b.tw - 1; lx++) {
      const gx = gx0 + lx;
      const gy = gy0 + ly;
      if (grid[ly]?.[lx] === Tile.Floor && !(gx === b.door.x && gy === b.door.y) && !used.has(`${gx},${gy}`)) {
        candidates.push({ x: gx, y: gy });
      }
    }
  }
  return candidates.length ? rng.pick(candidates) : null;
}

// --- small helpers ---------------------------------------------------------

function adjRoad(grid: Tile[][], x: number, y: number, size: number): boolean {
  if (x > 0 && grid[y][x - 1] === Tile.Road) return true;
  if (x < size - 1 && grid[y][x + 1] === Tile.Road) return true;
  if (y > 0 && grid[y - 1][x] === Tile.Road) return true;
  if (y < size - 1 && grid[y + 1][x] === Tile.Road) return true;
  return false;
}

function walkableLocal(grid: Tile[][], size: number, rng: Rng): { x: number; y: number } | null {
  for (let i = 0; i < 80; i++) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    if (!isSolid(grid[y][x]) && grid[y][x] !== Tile.Floor) return { x, y };
  }
  return null;
}

function nonWaterLocal(grid: Tile[][], size: number, rng: Rng): { x: number; y: number } | null {
  for (let i = 0; i < 30; i++) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    const t = grid[y][x];
    if (t !== Tile.Water && t !== Tile.Wall && t !== Tile.Floor) return { x, y };
  }
  return null;
}
