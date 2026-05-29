// Phase 1 — procedural city invariants (CLAUDE.md §10).
// Verifies a generated city is well-formed: walkable spawn, reachable doors,
// in-bounds buildings, reproducible by seed, and varied across seeds.

import { generateWorld, Tile, SOLID_TILES } from "../src/game/worldgen";

const SOLID = new Set<number>(SOLID_TILES as number[]);
const walkable = (t: number) => !SOLID.has(t);

function check(seed: string): { buildings: number; errs: string[] } {
  const w = generateWorld(seed, { width: 80, height: 80, tileSize: 32 });
  const errs: string[] = [];

  if (w.grid.length !== w.height) errs.push("grid height mismatch");
  if (w.grid.some((r) => r.length !== w.width)) errs.push("grid width mismatch");

  let bad = 0;
  for (const row of w.grid) for (const t of row) if (t < 0 || t > 5) bad++;
  if (bad) errs.push(`${bad} out-of-range tile values`);

  const stx = Math.floor(w.start.x / 32);
  const sty = Math.floor(w.start.y / 32);
  if (stx < 0 || sty < 0 || stx >= w.width || sty >= w.height) errs.push("spawn out of bounds");
  else if (!walkable(w.grid[sty][stx])) errs.push("spawn not walkable");

  if (w.buildings.length < 5) errs.push(`too few buildings: ${w.buildings.length}`);

  let doorTileOk = 0;
  let doorReach = 0;
  for (const b of w.buildings) {
    const { x, y } = b.door;
    if (b.tx + b.tw - 1 > w.width || b.ty + b.th - 1 > w.height) errs.push(`building ${b.id} OOB`);
    if (w.grid[y][x] === Tile.Door) doorTileOk++;
    const onPerim = x === b.tx || x === b.tx + b.tw - 1 || y === b.ty || y === b.ty + b.th - 1;
    if (!onPerim) errs.push(`building ${b.id} door not on perimeter`);
    const neigh: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    if (neigh.some(([nx, ny]) => walkable(w.grid[ny]?.[nx] ?? Tile.Wall) && w.grid[ny][nx] !== Tile.Door)) {
      doorReach++;
    }
  }
  if (doorTileOk !== w.buildings.length) errs.push(`doors not all Door tiles: ${doorTileOk}/${w.buildings.length}`);
  if (doorReach !== w.buildings.length) errs.push(`doors not all reachable: ${doorReach}/${w.buildings.length}`);

  return { buildings: w.buildings.length, errs };
}

let failed = 0;
for (const seed of ["alpha", "bravo", "charlie", "delta", "echo"]) {
  const { buildings, errs } = check(seed);
  if (errs.length) failed++;
  console.log(`seed=${seed.padEnd(8)} buildings=${String(buildings).padStart(3)} ${errs.length ? "FAIL " + errs.join("; ") : "ok"}`);
}

const a = generateWorld("repro-seed");
const b = generateWorld("repro-seed");
const reproducible = JSON.stringify(a.grid) === JSON.stringify(b.grid) && a.buildings.length === b.buildings.length;
const c = generateWorld("seed-A");
const d = generateWorld("seed-B");
const varied = JSON.stringify(c.grid) !== JSON.stringify(d.grid);
console.log(`reproducible(same seed)=${reproducible}  varied(diff seeds)=${varied}`);
if (!reproducible) failed++;
if (!varied) failed++;

console.log(failed === 0 ? "ALL WORLDGEN CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
