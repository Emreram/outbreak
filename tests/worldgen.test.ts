// Per-chunk procedural invariants (CLAUDE.md §10), now chunk-based.
// Verifies each generated chunk is well-formed: in-range tiles, in-bounds
// buildings with reachable Door tiles, containers on walkable tiles, and
// reproducibility by (seed, cx, cy).

import { generateChunk, Tile, SOLID_TILES, TILE_COUNT, chunkStartPx } from "../src/game/worldgen";
import { biomeAt } from "../src/game/world/biomes";
import { findSpawnChunk } from "../src/game/world/spawn";
import { isWaterish } from "../src/game/world/terrainField";
import { CHUNK_TILES } from "../src/game/constants";

const SOLID = new Set<number>(SOLID_TILES as number[]);
const walkable = (t: number) => !SOLID.has(t);

function checkChunk(seed: string, cx: number, cy: number): string[] {
  const c = generateChunk(seed, cx, cy);
  const errs: string[] = [];
  const gx0 = cx * c.size;
  const gy0 = cy * c.size;

  if (c.grid.length !== c.size) errs.push("grid height");
  if (c.grid.some((r) => r.length !== c.size)) errs.push("grid width");

  let bad = 0;
  for (const row of c.grid) for (const t of row) if (t < 0 || t >= TILE_COUNT) bad++;
  if (bad) errs.push(`${bad} out-of-range tiles`);

  for (const b of c.buildings) {
    if (b.tx < gx0 || b.ty < gy0 || b.tx + b.tw - 1 >= gx0 + c.size || b.ty + b.th - 1 >= gy0 + c.size) {
      errs.push(`building ${b.gid} OOB`);
      continue;
    }
    const lx = b.door.x - gx0;
    const ly = b.door.y - gy0;
    if (c.grid[ly]?.[lx] !== Tile.Door) errs.push(`building ${b.gid} door not a Door tile`);
    const neigh: Array<[number, number]> = [[lx - 1, ly], [lx + 1, ly], [lx, ly - 1], [lx, ly + 1]];
    const reachable = neigh.some(([nx, ny]) => {
      const t = c.grid[ny]?.[nx];
      return t !== undefined && walkable(t) && t !== Tile.Door;
    });
    if (!reachable) errs.push(`building ${b.gid} door unreachable`);
  }

  for (const ct of c.containers) {
    const lx = ct.tx - gx0;
    const ly = ct.ty - gy0;
    const t = c.grid[ly]?.[lx];
    if (t === undefined) errs.push(`container ${ct.gid} OOB`);
    else if (!walkable(t)) errs.push(`container ${ct.gid} on a solid tile`);
  }

  return errs;
}

let failed = 0;

// A patch of interior chunks around spawn (none are the ocean edge).
let totalBuildings = 0;
let sawNewTerrain = false;
const biomesSeen = new Set<string>();
for (let cy = 16; cy <= 24; cy++) {
  for (let cx = 16; cx <= 24; cx++) {
    const errs = checkChunk("alpha", cx, cy);
    if (errs.length) {
      failed++;
      console.log(`chunk ${cx},${cy} FAIL ${errs.join("; ")}`);
    }
    const c = generateChunk("alpha", cx, cy);
    totalBuildings += c.buildings.length;
    biomesSeen.add(c.biome);
    if (c.grid.some((r) => r.some((t) => t > Tile.Grass))) sawNewTerrain = true;
  }
}
console.log(`81 chunks · buildings=${totalBuildings} · biomes=${biomesSeen.size} · newTerrain=${sawNewTerrain}`);
if (totalBuildings < 10) { failed++; console.log("FAIL: too few buildings across the patch"); }
if (!sawNewTerrain) { failed++; console.log("FAIL: no new biome terrain appeared"); }
if (biomesSeen.size < 4) { failed++; console.log("FAIL: too few biomes in the patch"); }

// Reproducible by (seed, cx, cy); varies across coords.
const a = generateChunk("repro", 20, 20);
const b = generateChunk("repro", 20, 20);
const reproducible = JSON.stringify(a.grid) === JSON.stringify(b.grid) && a.biome === b.biome;
const d = generateChunk("repro", 21, 20);
const varied = JSON.stringify(a.grid) !== JSON.stringify(d.grid);
console.log(`reproducible=${reproducible}  varied=${varied}`);
if (!reproducible) failed++;
if (!varied) failed++;

// Prop gids (U1 searchables): every prop carries a gid, unique per chunk, and the
// id sequence is reproducible by (seed, cx, cy) — `searched_<gid>` flags depend on it.
{
  let propGidErrs = 0;
  for (let cy = 16; cy <= 24; cy++) {
    for (let cx = 16; cx <= 24; cx++) {
      const c = generateChunk("alpha", cx, cy);
      const gids = c.props.map((p) => p.gid);
      if (gids.some((g) => !g)) propGidErrs++;
      if (new Set(gids).size !== gids.length) propGidErrs++;
    }
  }
  const p1 = generateChunk("repro", 20, 20).props.map((p) => `${p.gid}:${p.kind}:${p.x},${p.y}`).join("|");
  const p2 = generateChunk("repro", 20, 20).props.map((p) => `${p.gid}:${p.kind}:${p.x},${p.y}`).join("|");
  if (p1 !== p2) propGidErrs++;
  console.log(`prop gids unique+reproducible=${propGidErrs === 0}`);
  if (propGidErrs) failed++;
}

// Spawn point is walkable, DRY ground in the seed's searched spawn chunk.
{
  const sc = findSpawnChunk("alpha");
  const start = chunkStartPx(generateChunk("alpha", sc.x, sc.y));
  const stx = Math.floor(start.x / 32) - sc.x * CHUNK_TILES;
  const sty = Math.floor(start.y / 32) - sc.y * CHUNK_TILES;
  const t = generateChunk("alpha", sc.x, sc.y).grid[sty][stx];
  const startDry = walkable(t) && !isWaterish(t) && t !== Tile.Mud && t !== Tile.Lava;
  console.log(`spawn dry+walkable=${startDry} (chunk ${sc.x},${sc.y} · biome ${biomeAt("alpha", sc.x, sc.y).id} · tile ${Tile[t]})`);
  if (!startDry) failed++;
}

// --- Terrain Overhaul invariants (coherent water + shorelines) ---------------
{
  let isolatedOpenWater = 0; // open Water/DeepWater with NO waterish 4-neighbour (speckles)
  let deepVsDry = 0; // DeepWater directly against dry land (shoreline must demote)
  let bareRim = 0; // plain ground touching open Water with no wadeable rim
  const plain = new Set<Tile>([Tile.Grass, Tile.Dirt, Tile.Sand, Tile.Mud, Tile.TallGrass]);
  let marshChunks = 0;
  let marshWalkableOk = 0;
  for (let cy = 16; cy <= 24; cy++) {
    for (let cx = 16; cx <= 24; cx++) {
      const biome = biomeAt("alpha", cx, cy);
      if (biome.urban) continue;
      const g = generateChunk("alpha", cx, cy).grid;
      let walkableTiles = 0;
      for (let y = 1; y < CHUNK_TILES - 1; y++) {
        for (let x = 1; x < CHUNK_TILES - 1; x++) {
          const t = g[y][x];
          if (!SOLID.has(t)) walkableTiles++;
          const n = [g[y][x - 1], g[y][x + 1], g[y - 1][x], g[y + 1][x]];
          if ((t === Tile.Water || t === Tile.DeepWater) && !n.some((m) => isWaterish(m))) isolatedOpenWater++;
          if (t === Tile.DeepWater && n.some((m) => !isWaterish(m) && m !== Tile.Bridge)) deepVsDry++;
          if (plain.has(t) && n.some((m) => m === Tile.Water || m === Tile.DeepWater)) bareRim++;
        }
      }
      if (biome.id === "marsh" || biome.id === "wetland") {
        marshChunks++;
        if (walkableTiles / ((CHUNK_TILES - 2) * (CHUNK_TILES - 2)) >= 0.7) marshWalkableOk++;
      }
    }
  }
  console.log(`anti-speckle: isolated=${isolatedOpenWater} deepVsDry=${deepVsDry} bareRim=${bareRim}`);
  if (isolatedOpenWater > 0) { failed++; console.log("FAIL: isolated open-water speckles exist"); }
  if (deepVsDry > 0) { failed++; console.log("FAIL: deep water touches dry land"); }
  if (bareRim > 0) { failed++; console.log("FAIL: open water without a wadeable rim against plain ground"); }

  // Marshes specifically (wherever this seed put them): LAND with pools, mostly
  // walkable — the old marsh was a chunk-wide walkable sea (the screenshot bug).
  outer: for (let cy = 1; cy < 39 && marshChunks < 4; cy++) {
    for (let cx = 1; cx < 39 && marshChunks < 4; cx++) {
      const id = biomeAt("alpha", cx, cy).id;
      if (id !== "marsh" && id !== "wetland") continue;
      marshChunks++;
      const g = generateChunk("alpha", cx, cy).grid;
      let walkableTiles = 0;
      for (let y = 0; y < CHUNK_TILES; y++) for (let x = 0; x < CHUNK_TILES; x++) if (!SOLID.has(g[y][x])) walkableTiles++;
      if (walkableTiles / (CHUNK_TILES * CHUNK_TILES) >= 0.7) marshWalkableOk++;
      if (marshChunks >= 4) break outer;
    }
  }
  console.log(`marsh/wetland chunks ≥70% walkable: ${marshWalkableOk}/${marshChunks}`);
  if (marshChunks > 0 && marshWalkableOk < marshChunks) { failed++; console.log("FAIL: a marsh/wetland chunk is <70% walkable"); }
}

// Shore props (`_sh` gids, PR3) sit on LEGAL tiles: lilypads + fishing spots ON
// shallow water (by design), everything else on dry walkable ground.
{
  const ON_WATER = new Set(["lilypad", "fishing_spot"]);
  let shoreProps = 0;
  let bad = 0;
  for (let cy = 10; cy <= 30; cy += 2) {
    for (let cx = 10; cx <= 30; cx += 2) {
      const c = generateChunk("alpha", cx, cy);
      for (const p of c.props) {
        if (!p.gid?.includes("_sh")) continue;
        shoreProps++;
        const lx = Math.floor(p.x / 32) - cx * CHUNK_TILES;
        const ly = Math.floor(p.y / 32) - cy * CHUNK_TILES;
        const t = c.grid[ly]?.[lx];
        if (t === undefined) { bad++; continue; }
        if (ON_WATER.has(p.kind)) {
          if (t !== Tile.ShallowWater) bad++;
        } else if (SOLID.has(t) || isWaterish(t) || t === Tile.Floor) {
          bad++;
        }
      }
    }
  }
  console.log(`shore props: ${shoreProps} placed, ${bad} on illegal tiles`);
  if (shoreProps === 0) { failed++; console.log("FAIL: no shore props generated at all"); }
  if (bad > 0) { failed++; console.log("FAIL: shore props on illegal tiles"); }
}

console.log(failed === 0 ? "ALL WORLDGEN CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
