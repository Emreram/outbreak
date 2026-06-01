// Per-chunk procedural invariants (CLAUDE.md §10), now chunk-based.
// Verifies each generated chunk is well-formed: in-range tiles, in-bounds
// buildings with reachable Door tiles, containers on walkable tiles, and
// reproducibility by (seed, cx, cy).

import { generateChunk, Tile, SOLID_TILES, TILE_COUNT, chunkStartPx } from "../src/game/worldgen";
import { biomeAt } from "../src/game/world/biomes";
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

// Spawn point is walkable.
const start = chunkStartPx(generateChunk("alpha", 20, 20));
const stx = Math.floor(start.x / 32) - 20 * CHUNK_TILES;
const sty = Math.floor(start.y / 32) - 20 * CHUNK_TILES;
const startWalkable = walkable(generateChunk("alpha", 20, 20).grid[sty][stx]);
console.log(`spawn walkable=${startWalkable} (biome ${biomeAt("alpha", 20, 20).id})`);
if (!startWalkable) failed++;

console.log(failed === 0 ? "ALL WORLDGEN CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
