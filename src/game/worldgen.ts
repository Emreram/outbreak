// Seeded procedural generator (CLAUDE.md §10), now CHUNK-based: the world is an
// enormous, finite, seamless grid of chunks generated on demand from
// (seed, chunkX, chunkY). "Code generates the geometry; the AI handles what's
// inside." Same seed + coords -> identical chunk, so terrain never needs saving.
//
// DETERMINISM INVARIANTS (worldFlags like `chest_<gid>`/`searched_<gid>` depend
// on stable ids across versions):
// 1. New generation passes APPEND ONLY — never insert work into the middle of the
//    main rng stream; fork a child rng (`createRng(`${seed}:<pass>:${cx}:${cy}`)`)
//    so every existing chunk stays byte-identical.
// 2. Prop gids are a per-chunk counter over ALL props in generation order — new
//    prop-producing steps must run AFTER the existing ones.

import { createRng, type Rng } from "./rng";
import { CHUNK_TILES, TILE_SIZE } from "./constants";
import {
  Tile,
  SOLID_TILES,
  CONTAINER_TIER,
  type BuildingType,
  type Building,
  type Container,
  type ContainerKind,
  type Prop,
  type Landmark,
  type ChunkData,
} from "./world/tiles";
import { biomeAt, type BiomeDef } from "./world/biomes";
import { field, hashUnit } from "./world/noise";
import { isWaterish, terrainTileAt } from "./world/terrainField";
import { isRoad, isRoadCol, isRoadRow } from "./world/roads";
import { applySetpieces } from "./world/setpieces";

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
  type ContainerKind,
  type Prop,
  type Landmark,
  type ChunkData,
} from "./world/tiles";

// Which container kinds a building type tends to hold (first ~= most likely).
const KINDS_BY_TYPE: Partial<Record<BuildingType, ContainerKind[]>> = {
  pharmacy: ["med_cabinet", "cabinet", "drawer"],
  hospital: ["med_cabinet", "cabinet", "locker"],
  police_station: ["gun_cabinet", "locker", "safe"],
  military_depot: ["gun_cabinet", "locker", "crate"],
  bunker: ["safe", "gun_cabinet", "locker"],
  hardware_store: ["toolbox", "crate", "cabinet"],
  warehouse: ["crate", "crate", "toolbox"],
  port_warehouse: ["crate", "crate", "locker"],
  factory: ["toolbox", "crate", "locker"],
  grocery: ["fridge", "register", "crate"],
  diner: ["fridge", "register", "cabinet"],
  gas_station: ["register", "fridge", "toolbox"],
  house: ["drawer", "cabinet", "fridge"],
  cabin: ["drawer", "cabinet", "crate"],
  motel: ["drawer", "cabinet", "fridge"],
  office: ["drawer", "cabinet", "locker"],
  school: ["locker", "cabinet", "drawer"],
  church: ["cabinet", "drawer", "crate"],
  mall: ["register", "cabinet", "crate"],
  fire_station: ["locker", "toolbox", "cabinet"],
  lab: ["med_cabinet", "safe", "cabinet"],
  barn: ["crate", "toolbox", "cabinet"],
  silo: ["crate", "crate", "toolbox"],
  ranger_station: ["cabinet", "drawer", "locker"],
};

function containerKindFor(type: BuildingType, rng: Rng): ContainerKind {
  return rng.pick(KINDS_BY_TYPE[type] ?? ["crate"]);
}

/** Safes/gun-cabinets are usually locked; higher-tier buildings lock more often. */
function lockedFor(kind: ContainerKind, tier: number, rng: Rng): boolean {
  if (kind === "safe") return true;
  if (kind === "gun_cabinet") return rng.chance(0.8);
  if (kind === "register") return rng.chance(0.4);
  return rng.chance(0.06 + tier * 0.08);
}

// Themed interior furniture per building type (decorative props) so a pharmacy,
// a house, and a police station read completely differently inside.
const FURNITURE_BY_TYPE: Partial<Record<BuildingType, string[]>> = {
  pharmacy: ["shelf", "shelf", "counter"],
  hospital: ["bed", "bed", "shelf", "counter"],
  grocery: ["shelf", "shelf", "fridge_prop", "counter"],
  hardware_store: ["toolrack", "shelf", "counter"],
  house: ["bed", "sofa", "table", "fridge_prop"],
  cabin: ["bed", "table", "shelf"],
  motel: ["bed", "bed", "table"],
  police_station: ["desk", "locker_prop", "desk"],
  fire_station: ["locker_prop", "bench", "toolrack"],
  office: ["desk", "desk", "bookshelf"],
  school: ["desk", "desk", "bookshelf"],
  church: ["pew", "pew", "table"],
  diner: ["table", "table", "counter", "fridge_prop"],
  gas_station: ["shelf", "counter", "fridge_prop"],
  mall: ["shelf", "shelf", "counter"],
  warehouse: ["shelf", "crate"],
  factory: ["toolrack", "crate"],
  barn: ["hay", "shelf"],
  silo: ["crate"],
  bunker: ["locker_prop", "shelf", "desk"],
  military_depot: ["locker_prop", "crate", "toolrack"],
  lab: ["counter", "shelf", "desk"],
  ranger_station: ["desk", "shelf", "bed"],
  port_warehouse: ["crate", "shelf"],
};

const SOLID = new Set<number>(SOLID_TILES as number[]);
const isSolid = (t: Tile): boolean => SOLID.has(t);

// Global road grid moved to ./world/roads (leaf) so vehicles + set-pieces can
// share it without import cycles. Re-exported for back-compat.
export { isRoadCol, isRoadRow } from "./world/roads";

// ---------------------------------------------------------------------------

export function generateChunk(seed: string, cx: number, cy: number): ChunkData {
  const size = CHUNK_TILES;
  const tileSize = TILE_SIZE;
  const biome = biomeAt(seed, cx, cy);
  const rng = createRng(`${seed}:chunk:${cx}:${cy}`);
  const gx0 = cx * size;
  const gy0 = cy * size;

  // 1) Terrain. Natural chunks sample the PURE per-tile terrain field (organic
  //    biome borders, coherent lakes/rivers/marsh-pools, beach gradients — see
  //    world/terrainField.ts); urban chunks keep their chunk-coherent base (roads
  //    and buildings need square logic) but get a natural fringe where they border
  //    countryside. No rng is consumed by terrain: it's all hash/field-driven, so
  //    the grid is a pure function of (seed, cx, cy).
  const grid: Tile[][] = [];
  if (!biome.urban) {
    for (let ly = 0; ly < size; ly++) {
      grid[ly] = new Array<Tile>(size);
      for (let lx = 0; lx < size; lx++) grid[ly][lx] = paintedNaturalTileAt(seed, gx0 + lx, gy0 + ly);
    }
    shorelinePass(grid, seed, cx, cy, size);
  } else {
    for (let ly = 0; ly < size; ly++) grid[ly] = new Array<Tile>(size).fill(biome.base);
    for (const s of biome.scatter) {
      for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
          if (grid[ly][lx] !== biome.base) continue;
          const m = field(`${seed}:feat`, gx0 + lx, gy0 + ly, 7, 2); // 0..1 density modulation
          if (hashUnit(`${seed}:uscatter:${s.tile}`, gx0 + lx, gy0 + ly) < s.p * (0.3 + 1.7 * m)) grid[ly][lx] = s.tile;
        }
      }
    }
    paintUrbanFringe(grid, seed, cx, cy, size);
  }

  const buildings: Building[] = [];
  const containers: Container[] = [];
  const props: Prop[] = [];
  const landmarks: Landmark[] = [];

  if (biome.urban) carveUrban(grid, seed, cx, cy, size, biome, rng, buildings);
  else carveNatural(grid, cx, cy, size, biome, rng, buildings);

  // 2) Loot containers inside buildings — SCARCE. Most buildings hold nothing
  //    worth a container; high-tier buildings (police/lab/military) are likelier
  //    to, and only rarely hold two. Scavenging should feel lean and earned.
  let ci = 0;
  for (const b of buildings) {
    const tier = CONTAINER_TIER[b.type] ?? 1;
    if (!rng.chance(0.14 + tier * 0.13)) continue; // house ~14% … military ~66%
    const n = rng.chance(0.12 + tier * 0.05) ? 2 : 1;
    const used = new Set<string>();
    for (let i = 0; i < n; i++) {
      const tile = floorTileIn(grid, b, gx0, gy0, rng, used);
      if (tile) {
        used.add(`${tile.x},${tile.y}`);
        const kind = containerKindFor(b.type, rng);
        containers.push({ gid: `${cx}_${cy}_c${ci++}`, tx: tile.x, ty: tile.y, tier, type: b.type, kind, locked: lockedFor(kind, tier, rng) });
      }
    }
  }

  // 2.5) Interior furniture — themed per building type (decorative, non-blocking).
  let pi = 0; // per-chunk prop counter → stable gids for interactable props
  for (const b of buildings) {
    const pool = FURNITURE_BY_TYPE[b.type];
    if (!pool || pool.length === 0) continue;
    const interior = Math.max(0, b.tw - 2) * Math.max(0, b.th - 2);
    const count = Math.min(4, Math.max(1, Math.floor(interior / 8)));
    const usedF = new Set<string>();
    for (let i = 0; i < count; i++) {
      const tile = floorTileIn(grid, b, gx0, gy0, rng, usedF);
      if (!tile) break;
      usedF.add(`${tile.x},${tile.y}`);
      props.push({ kind: rng.pick(pool), x: (tile.x + 0.5) * tileSize, y: (tile.y + 0.5) * tileSize, gid: `${cx}_${cy}_p${pi++}` });
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
    containers.push({ gid: `${cx}_${cy}_L${ci++}`, tx: gx, ty: gy, tier: 3, type: "warehouse", kind: "crate", locked: rng.chance(0.5) });
  }

  // 4) Decorative props (non-blocking sprites) — dry open ground only.
  for (let i = 0; i < biome.propDensity; i++) {
    const t = openGroundLocal(grid, size, rng);
    if (!t) continue;
    props.push({ kind: rng.pick(biome.props.length ? biome.props : ["rock"]), x: (gx0 + t.x + 0.5) * tileSize, y: (gy0 + t.y + 0.5) * tileSize, gid: `${cx}_${cy}_p${pi++}` });
  }

  const chunk: ChunkData = { cx, cy, size, tileSize, biome: biome.id, grid, buildings, containers, props, landmarks };

  // 4.5) Roadside set-piece scenes (Expansion U2) — APPEND-ONLY on a FORKED rng
  //      (`:scene:`), so the main stream above stays byte-identical (invariant #1).
  applySetpieces(seed, chunk);

  // 4.6) Shore & nature props (Terrain Overhaul PR3) — reeds/cattails/lilypads on
  //      marsh pools, driftwood/rowboats/docks/fishing spots on lake/river/coast
  //      shores, flower patches in forest clearings. APPEND-ONLY on a FORKED rng
  //      (`:shore:`), gid namespace `_sh<i>` (invariants #1 + #2).
  applyShoreProps(seed, chunk);

  // 5) Anti-emptiness: guarantee at least one interactable per chunk.
  if (buildings.length === 0 && containers.length === 0) {
    const t = walkableLocal(grid, size, rng);
    if (t) {
      const gx = gx0 + t.x;
      const gy = gy0 + t.y;
      containers.push({ gid: `${cx}_${cy}_x0`, tx: gx, ty: gy, tier: 1, type: "house", kind: "crate", locked: false });
      landmarks.push({ kind: "supply_cache", label: "Supply cache", x: (gx + 0.5) * tileSize, y: (gy + 0.5) * tileSize });
    }
  }

  return chunk;
}

// Tiles a player should START on: dry, open, readable ground.
const START_GROUND = new Set<Tile>([
  Tile.Grass, Tile.Dirt, Tile.Trail, Tile.Sand, Tile.Pavement, Tile.Sidewalk, Tile.Road, Tile.Bridge,
]);

/** A walkable world-pixel spawn point for a freshly-generated chunk: the nearest
 *  DRY OPEN tile to the centre. Three tiers — preferred dry ground, then any
 *  walkable non-wet tile, then anything walkable — so a run never opens with the
 *  survivor wading in a pond or stuck in mud. */
export function chunkStartPx(chunk: ChunkData): { x: number; y: number } {
  const { grid, size, tileSize, cx, cy } = chunk;
  const c = Math.floor(size / 2);
  const toPx = (lx: number, ly: number) => ({ x: (cx * size + lx + 0.5) * tileSize, y: (cy * size + ly + 0.5) * tileSize });
  let tier2: { x: number; y: number } | null = null; // walkable, not wet, not interior
  let tier3: { x: number; y: number } | null = null; // any walkable
  for (let r = 0; r < size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const lx = c + dx;
        const ly = c + dy;
        if (lx < 0 || ly < 0 || lx >= size || ly >= size) continue;
        const t = grid[ly][lx];
        if (isSolid(t)) continue;
        if (START_GROUND.has(t)) return toPx(lx, ly); // nearest preferred ground wins outright
        if (!tier3) tier3 = toPx(lx, ly);
        if (!tier2 && t !== Tile.Floor && t !== Tile.Door && !isWaterish(t) && t !== Tile.Mud && t !== Tile.Lava) {
          tier2 = toPx(lx, ly);
        }
      }
    }
  }
  return tier2 ?? tier3 ?? toPx(c, c);
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

/** True if the rectangle can host a structure: it must NOT overlap an existing
 *  building (any Wall/Floor/Door tile aborts — otherwise a later building can carve
 *  over an earlier one's door) and must be mostly dry land (little open water). */
function areaClearable(grid: Tile[][], sx: number, sy: number, ex: number, ey: number): boolean {
  let waterish = 0;
  let total = 0;
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      total++;
      const t = grid[y]?.[x];
      if (t === Tile.Wall || t === Tile.Floor || t === Tile.Door) return false; // overlaps an existing building
      if (t !== undefined && isWaterish(t)) waterish++;
    }
  }
  return total > 0 && waterish / total < 0.2;
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

// --- natural terrain painting (per-tile field + trails + shoreline) ----------

/** The natural tile actually PAINTED at a global coord: the pure terrain field
 *  composed with the global country-road web — the (previously invisible) road
 *  grid becomes dirt Trails through the countryside, and where it crosses open
 *  water it becomes a BRIDGE, so rivers are real barriers with deterministic
 *  crossings. Pure in (seed, gx, gy) — also used as the shoreline ring sampler,
 *  which is what makes the shoreline pass seamless across chunk borders. */
function paintedNaturalTileAt(seed: string, gx: number, gy: number): Tile {
  const t = terrainTileAt(seed, gx, gy);
  if (isRoadCol(seed, gx) || isRoadRow(seed, gy)) {
    if (t === Tile.Lava || t === Tile.Basalt) return t; // the road died here
    if (t === Tile.DeepWater) return t; // no bridging the open sea
    if (isWaterish(t)) return Tile.Bridge;
    return Tile.Trail;
  }
  return t;
}

// Plain ground the shoreline rim conversion may claim (trees/crops/roads stay put).
const SHORE_CONVERTIBLE = new Set<Tile>([Tile.Grass, Tile.Dirt, Tile.Sand, Tile.Mud, Tile.TallGrass]);

/** Shoreline post-pass (double-buffered, order-independent): guarantee every
 *  water body has a readable, wadeable rim — plain ground touching open Water
 *  becomes a ShallowWater fringe, DeepWater never touches land directly, and
 *  Foam appears ONLY where Sand actually meets water. The out-of-chunk ring is
 *  sampled via the same pure painter, so the pass is seamless across chunks
 *  (urban neighbours sample as dry pavement — they paint their own ground). */
function shorelinePass(grid: Tile[][], seed: string, cx: number, cy: number, size: number): void {
  const gx0 = cx * size;
  const gy0 = cy * size;
  const snap: Tile[][] = grid.map((row) => row.slice());
  const at = (lx: number, ly: number): Tile => {
    if (lx >= 0 && ly >= 0 && lx < size && ly < size) return snap[ly][lx];
    const gx = gx0 + lx;
    const gy = gy0 + ly;
    const ncx = Math.floor(gx / size);
    const ncy = Math.floor(gy / size);
    if (biomeAt(seed, ncx, ncy).urban) return Tile.Pavement; // urban paints its own dry ground
    return paintedNaturalTileAt(seed, gx, gy);
  };
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const t = snap[ly][lx];
      const n = [at(lx - 1, ly), at(lx + 1, ly), at(lx, ly - 1), at(lx, ly + 1)];
      if (t === Tile.DeepWater) {
        // Deep water never laps directly against land — demote to open water.
        if (n.some((x) => !isWaterish(x) && x !== Tile.Bridge)) grid[ly][lx] = Tile.Water;
      } else if (SHORE_CONVERTIBLE.has(t) && n.some((x) => x === Tile.Water || x === Tile.DeepWater)) {
        grid[ly][lx] = Tile.ShallowWater; // wadeable rim between land and open water
      } else if (t === Tile.Sand && n.some((x) => x === Tile.ShallowWater) && hashUnit(`${seed}:foam`, gx0 + lx, gy0 + ly) < 0.45) {
        grid[ly][lx] = Tile.Foam; // surf line — only where a beach meets the water
      }
    }
  }
}

/** Soften an urban chunk's border where it meets countryside: the outer band
 *  bordering a NON-urban neighbour shows natural ground (clamped dry) instead of
 *  wall-to-wall pavement, so city edges stop being razor-straight palette cuts.
 *  Runs BEFORE roads/buildings, which overwrite it where they need to. */
function paintUrbanFringe(grid: Tile[][], seed: string, cx: number, cy: number, size: number): void {
  const BAND = 2;
  const openSide = {
    left: !biomeAt(seed, cx - 1, cy).urban,
    right: !biomeAt(seed, cx + 1, cy).urban,
    up: !biomeAt(seed, cx, cy - 1).urban,
    down: !biomeAt(seed, cx, cy + 1).urban,
  };
  if (!openSide.left && !openSide.right && !openSide.up && !openSide.down) return;
  const gx0 = cx * size;
  const gy0 = cy * size;
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const inBand =
        (openSide.left && lx < BAND) || (openSide.right && lx >= size - BAND) ||
        (openSide.up && ly < BAND) || (openSide.down && ly >= size - BAND);
      if (!inBand) continue;
      let t = terrainTileAt(seed, gx0 + lx, gy0 + ly);
      if (isWaterish(t) || t === Tile.Foam) t = Tile.Sand; // city fringe stays dry
      else if (t === Tile.Lava || t === Tile.Basalt) t = Tile.Scorched;
      grid[ly][lx] = t;
    }
  }
}

// --- shore & nature props (Terrain Overhaul PR3) -----------------------------

/** Water-edge + clearing dressing: the coherent water bodies from terrainField
 *  get LIFE — reeds and lilypads on marsh pools, driftwood/rowboats/docks and
 *  searchable fishing spots along lake/river/coast shores, flower patches in
 *  forest glades. Forked rng + appended gids keep the main stream untouched. */
function applyShoreProps(seed: string, chunk: ChunkData): void {
  const { cx, cy, size, tileSize, grid, props } = chunk;
  const id = chunk.biome;
  if (id === "ocean" || biomeAt(seed, cx, cy).urban) return;
  const rng = createRng(`${seed}:shore:${cx}:${cy}`);
  const gx0 = cx * size;
  const gy0 = cy * size;
  let si = 0;
  const add = (kind: string, lx: number, ly: number): void => {
    props.push({ kind, x: (gx0 + lx + 0.5) * tileSize, y: (gy0 + ly + 0.5) * tileSize, gid: `${cx}_${cy}_sh${si++}` });
  };

  // One scan: dry ground hugging open water (banks) + shallow tiles (in-water spots).
  const banks: Array<{ x: number; y: number }> = [];
  const shallows: Array<{ x: number; y: number }> = [];
  for (let ly = 1; ly < size - 1; ly++) {
    for (let lx = 1; lx < size - 1; lx++) {
      const t = grid[ly][lx];
      if (t === Tile.ShallowWater) {
        shallows.push({ x: lx, y: ly });
        continue;
      }
      if (!isWaterish(t) && !isSolid(t) && t !== Tile.Floor && t !== Tile.Foam && t !== Tile.Bridge) {
        const n = [grid[ly][lx - 1], grid[ly][lx + 1], grid[ly - 1][lx], grid[ly + 1][lx]];
        if (n.some((m) => isWaterish(m))) banks.push({ x: lx, y: ly });
      }
    }
  }
  const takeBank = (): { x: number; y: number } | null => (banks.length ? banks.splice(rng.int(0, banks.length - 1), 1)[0] : null);
  const takeShallow = (): { x: number; y: number } | null => (shallows.length ? shallows.splice(rng.int(0, shallows.length - 1), 1)[0] : null);

  if (id === "marsh" || id === "wetland") {
    const reeds = rng.int(3, 7);
    for (let i = 0; i < reeds; i++) {
      const t = takeBank();
      if (!t) break;
      add(rng.chance(0.5) ? "reeds" : "cattail", t.x, t.y);
    }
    const pads = rng.int(2, 5);
    for (let i = 0; i < pads; i++) {
      const t = takeShallow();
      if (!t) break;
      add("lilypad", t.x, t.y);
    }
  } else if (id === "lake" || id === "riverbank" || id === "coast") {
    const wood = rng.int(0, 2);
    for (let i = 0; i < wood; i++) {
      const t = takeBank();
      if (!t) break;
      add("driftwood", t.x, t.y);
    }
    if (rng.chance(0.06)) {
      const t = takeBank();
      if (t) add("rowboat", t.x, t.y);
    }
    if (rng.chance(0.05)) {
      const dockT = takeBank();
      const spotT = takeShallow();
      if (dockT) add("dock", dockT.x, dockT.y);
      if (spotT) add("fishing_spot", spotT.x, spotT.y);
    }
  }

  // Flower patches in forest/park clearings (the `:clear` field from PR1).
  if (id === "forest" || id === "dense_woods" || id === "parkland" || id === "grassland") {
    for (let tries = 0, made = 0; tries < 14 && made < 3; tries++) {
      const lx = rng.int(2, size - 3);
      const ly = rng.int(2, size - 3);
      if (grid[ly][lx] !== Tile.Grass) continue;
      if (field(`${seed}:clear`, gx0 + lx, gy0 + ly, 70, 2) <= 0.74) continue;
      add("flowers", lx, ly);
      made++;
    }
  }
}

// --- small helpers ---------------------------------------------------------

function adjRoad(grid: Tile[][], x: number, y: number, size: number): boolean {
  if (x > 0 && grid[y][x - 1] === Tile.Road) return true;
  if (x < size - 1 && grid[y][x + 1] === Tile.Road) return true;
  if (y > 0 && grid[y - 1][x] === Tile.Road) return true;
  if (y < size - 1 && grid[y + 1][x] === Tile.Road) return true;
  return false;
}

// Wet/hazard walkables that landmarks, caches and decorative props must avoid —
// nothing should stand IN a pond, in mud, or on a lava field.
const WET_OR_HAZARD = new Set<Tile>([Tile.ShallowWater, Tile.Mud, Tile.Foam, Tile.Lava]);

function walkableLocal(grid: Tile[][], size: number, rng: Rng): { x: number; y: number } | null {
  for (let i = 0; i < 80; i++) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    const t = grid[y][x];
    if (!isSolid(t) && t !== Tile.Floor && !WET_OR_HAZARD.has(t)) return { x, y };
  }
  return null;
}

/** A spot for a decorative prop: open DRY ground only. (Trees standing in the
 *  middle of a pond were a real, screenshot-reported bug — the old check only
 *  rejected open Water.) */
function openGroundLocal(grid: Tile[][], size: number, rng: Rng): { x: number; y: number } | null {
  for (let i = 0; i < 30; i++) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    const t = grid[y][x];
    if (t !== Tile.Wall && t !== Tile.Floor && !isWaterish(t) && !WET_OR_HAZARD.has(t) && t !== Tile.Bridge) return { x, y };
  }
  return null;
}
