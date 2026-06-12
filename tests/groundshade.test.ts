// render3d/chunks/groundShade.ts (graphics plan WS5): the pure vertex-shade
// helpers — deterministic per-tile jitter inside its bounds, corner AO levels,
// biome tints. Headless, Babylon-free.

import { biomeGrassTint, cornerAO, hashUnit, isOccluder, seedHash, takesGrassTint, tileJitter } from "../src/render3d/chunks/groundShade";
import { Tile } from "../src/game/world/tiles";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- hashing + jitter ---------------------------------------------------------------
{
  const sn = seedHash("test-seed", "vjit");
  ok(seedHash("test-seed", "vjit") === sn, "seedHash is deterministic");
  ok(seedHash("other", "vjit") !== sn, "seedHash varies by seed");
  ok(hashUnit(sn, 5, 9) === hashUnit(sn, 5, 9), "hashUnit is deterministic per tile");

  let lo = 1;
  let hi = 0;
  let varied = false;
  let prev = -1;
  for (let i = 0; i < 200; i++) {
    const j = tileJitter(sn, i, i * 7);
    for (const c of [j.r, j.g, j.b]) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
    if (prev >= 0 && Math.abs(j.g - prev) > 1e-6) varied = true;
    prev = j.g;
  }
  ok(lo >= 0.9 && hi <= 1.1, `jitter stays in bounds (${lo.toFixed(3)}..${hi.toFixed(3)})`);
  ok(varied, "jitter varies across tiles");
}

// --- corner AO -------------------------------------------------------------------------
{
  // Arrange: a wall column east of a floor tile.
  const grid = (x: number, y: number): number => (x === 1 && y === 0 ? Tile.Wall : Tile.Floor);
  // Act/Assert: the corner touching the wall darkens, the far corner doesn't.
  ok(cornerAO(grid, 0, 0, 1, 0) === 0.82, "one occluder at the shared corner → 0.82");
  ok(cornerAO(grid, 0, 0, 0, 1) === 1, "an open corner stays unshaded");
  const dense = (): number => Tile.Wall;
  ok(cornerAO(dense, 5, 5, 0, 0) === 0.58, "three occluders → deepest level 0.58");
  ok(isOccluder(Tile.Tree) && isOccluder(Tile.Wall) && !isOccluder(Tile.Grass), "occluder set: walls/trees yes, grass no");
}

// --- biome tints ----------------------------------------------------------------------
{
  ok(biomeGrassTint("forest") !== null && biomeGrassTint("forest")!.g === 1.0, "forest tint exists (green-held)");
  const grass = biomeGrassTint("grassland")!;
  ok(grass.r > 1 && grass.b < 1, "grassland warms toward gold");
  ok(biomeGrassTint("downtown") === null, "urban biomes take no grass tint");
  ok(takesGrassTint(Tile.Grass) && takesGrassTint(Tile.Dirt) && !takesGrassTint(Tile.Road), "tint applies to grass/dirt, not roads");
}

console.log(fail === 0 ? "ALL GROUNDSHADE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
