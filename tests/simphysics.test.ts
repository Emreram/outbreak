// sim/physics.ts — the hand-ported Arcade semantics (3D master plan §3.4).
// These are the characterization guarantees the port rests on: separate-axis
// slide, doorway clearance for the 20px body, per-tile process gates (fly/swim),
// unloaded-chunk solidity, world-bounds clamp, swept tile traces, broadphase.

import { moveAndSlide, traceSegment, circlesOverlap, SpatialHash, type TileGrid } from "../src/sim/physics";
import { Tile } from "../src/game/world/tiles";
import { TILE_SIZE } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

/** Build a TileGrid from rows of glyphs: # wall, . floor, ~ water, D door. */
function gridOf(rows: string[]): TileGrid {
  const map: Record<string, number> = { "#": Tile.Wall, ".": Tile.Floor, "~": Tile.Water, D: Tile.Door };
  return {
    tileAt(gtx, gty) {
      const row = rows[gty];
      if (!row || gtx < 0 || gtx >= row.length) return null;
      return map[row[gtx]] ?? Tile.Floor;
    },
  };
}

const BODY = 20; // the player's arcade body
const T = TILE_SIZE;

// --- separate-axis resolution -----------------------------------------------------
{
  // Arrange: a wall column at tx=3; body walking east from the tile before it.
  const g = gridOf(["....", "...#", "...."]);
  // Act: walk straight east into the wall at row 1 (centre y = 1.5 tiles).
  const r = moveAndSlide(g, 2.5 * T, 1.5 * T, 200, 0, 0.5, BODY);
  // Assert: clamped so body right edge = wall left face (3*T), x = 3*T - 10.
  ok(r.hitX && Math.abs(r.x - (3 * T - BODY / 2)) < 1e-6, `east run stops at the wall face (x=${r.x})`);
  ok(r.y === 1.5 * T, "y untouched by an x-axis hit");
}

{
  // Arrange: same wall; move diagonally into it.
  const g = gridOf(["....", "...#", "...."]);
  // Act: diagonal NE into the wall.
  const r = moveAndSlide(g, 2.5 * T, 1.5 * T, 150, -60, 0.2, BODY);
  // Assert: x clamps, y keeps moving — the Arcade slide.
  ok(r.hitX && !r.hitY, "diagonal into a wall clamps x only");
  ok(Math.abs(r.y - (1.5 * T - 12)) < 1e-6, `slide continues on y (y=${r.y})`);
}

// --- doorway clearance (20px body through a 32px door) -----------------------------
{
  // Arrange: a wall column with a single door gap at row 1.
  const g = gridOf(["...#....", "...D....", "...#...."]);
  // Act 1: pass through the door centre.
  const centred = moveAndSlide(g, 2.5 * T, 1.5 * T, 300, 0, 0.4, BODY);
  // Act 2: try again offset 8px off the door centreline (body would clip the wall row).
  const offset = moveAndSlide(g, 2.5 * T, 1.5 * T + 8, 300, 0, 0.4, BODY);
  // Assert.
  ok(!centred.hitX && centred.x > 3.5 * T, "centred body glides through a 1-tile doorway");
  ok(offset.hitX, "an off-centre body clips the door jamb and stops");
}

// --- process gates (fly-over / swim) ------------------------------------------------
{
  // Arrange: a water band with open ground on both sides.
  const g = gridOf(["....", "~~~~", "....", "...."]);
  const from = { x: 1.5 * T, y: 0.5 * T };
  // Act: walk south into water without and with a swim gate.
  const blocked = moveAndSlide(g, from.x, from.y, 0, 200, 0.4, BODY);
  const swimming = moveAndSlide(g, from.x, from.y, 0, 200, 0.4, BODY, {
    gate: (t) => t === Tile.Water || t === Tile.DeepWater,
  });
  const flying = moveAndSlide(g, from.x, from.y, 0, 200, 0.4, BODY, { gate: () => true });
  // Assert.
  ok(blocked.hitY && Math.abs(blocked.y - (T - BODY / 2)) < 1e-6, "water is solid on foot");
  ok(!swimming.hitY && swimming.y > T, "the swim gate opens water tiles only");
  ok(!flying.hitY, "the fly gate passes everything");
}

// --- unloaded chunk = solid + world bounds clamp -----------------------------------
{
  // Arrange: a 2-row grid — beyond it tileAt returns null (unloaded).
  const g = gridOf(["....", "...."]);
  // Act: run east past the loaded edge; clamp against explicit world bounds too.
  const offEdge = moveAndSlide(g, 3.5 * T, 0.5 * T, 400, 0, 1, BODY);
  const bounded = moveAndSlide(g, 3.5 * T, 0.5 * T, 400, 0, 1, BODY, {
    gate: () => true, // even a flying mount…
    bounds: { w: 4 * T, h: 2 * T }, // …respects the finite world edge
  });
  // Assert.
  ok(offEdge.hitX && offEdge.x <= 4 * T - BODY / 2 + 1e-6, "unloaded tiles block like ChunkManager.walkable");
  ok(bounded.x === 4 * T - BODY / 2, "world bounds clamp the centre to [half, w-half]");
}

// --- swept segment trace ------------------------------------------------------------
{
  // Arrange: wall column at tx=3, ray fired east from x=16.
  const g = gridOf(["....", "...#", "...."]);
  // Act.
  const hit = traceSegment(g, 16, 1.5 * T, 0, 500);
  const miss = traceSegment(g, 16, 0.5 * T, 0, 80);
  const gated = traceSegment(g, 16, 1.5 * T, 0, 90, () => true); // stays inside the 4-wide map
  // Assert: entry face of the wall tile is x = 96 → dist 80.
  ok(hit.hit && Math.abs(hit.dist - 80) < 1e-6 && hit.tile?.gtx === 3, `ray stops at the wall face (d=${hit.dist})`);
  ok(!miss.hit && miss.dist === 80, "a clear ray runs its full length");
  ok(!gated.hit, "a gated ray passes solid tiles");
}

// --- broadphase + overlap -----------------------------------------------------------
{
  // Arrange.
  const hash = new SpatialHash<string>(64);
  hash.insert(10, 10, "near");
  hash.insert(500, 500, "far");
  // Act.
  const found = hash.query(0, 0, 80);
  // Assert.
  ok(found.includes("near") && !found.includes("far"), "spatial hash returns only nearby cells");
  ok(circlesOverlap(0, 0, 10, 15, 0, 6), "touching circles overlap");
  ok(!circlesOverlap(0, 0, 10, 17, 0, 6), "separated circles don't");
}

console.log(fail === 0 ? "ALL SIM PHYSICS CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
