// Disaster-scar overlay invariants (Living World). The scar system must:
//  - leave base terrain untouched when there are no zones (so generateChunk stays
//    the deterministic source of truth),
//  - convert terrain inside an active zone (eruption → lava core, basalt ring),
//  - be a pure function of (chunk, zones, day) — identical inputs, identical output,
//  - revert (no-op) once a zone has healed.

import { generateChunk, Tile } from "../src/game/worldgen";
import { applyScars } from "../src/game/world/disasterScars";
import type { DisasterZone } from "../src/shared/contracts";
import { CHUNK_TILES, TILE_SIZE } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const SEED = "alpha";
const CX = 20;
const CY = 20; // a land chunk (spawn region)
const has = (grid: Tile[][], t: Tile) => grid.some((r) => r.includes(t));
const snapshot = (grid: Tile[][]) => JSON.stringify(grid);

// Epicentre at the chunk's centre tile, in GLOBAL world pixels.
const centreTile = CX * CHUNK_TILES + CHUNK_TILES / 2;
const erupt = (overrides: Partial<DisasterZone> = {}): DisasterZone => ({
  id: "z1",
  kind: "eruption",
  px: (centreTile + 0.5) * TILE_SIZE,
  py: (centreTile + 0.5) * TILE_SIZE,
  radius: 12,
  startDay: 0,
  intensity: 1,
  cataclysm: false,
  ...overrides,
});

// test_scars_no_zones_leaves_terrain_untouched
{
  const chunk = generateChunk(SEED, CX, CY);
  const before = snapshot(chunk.grid);
  applyScars(chunk, [], 1);
  applyScars(chunk, undefined, 1);
  ok(snapshot(chunk.grid) === before, "no zones → grid is byte-identical to generateChunk output");
}

// test_scars_eruption_converts_core_to_lava_and_basalt
{
  const chunk = generateChunk(SEED, CX, CY);
  ok(!has(chunk.grid, Tile.Lava) && !has(chunk.grid, Tile.Basalt), "base chunk has no lava/basalt before scarring");
  applyScars(chunk, [erupt()], 1);
  ok(has(chunk.grid, Tile.Lava), "eruption scar creates a molten lava core");
  ok(has(chunk.grid, Tile.Basalt), "eruption scar creates a cooled basalt ring");
}

// test_scars_are_pure_deterministic
{
  const a = generateChunk(SEED, CX, CY);
  const b = generateChunk(SEED, CX, CY);
  applyScars(a, [erupt()], 1);
  applyScars(b, [erupt()], 1);
  ok(snapshot(a.grid) === snapshot(b.grid), "same (chunk, zones, day) → identical scarred grid");
}

// test_scars_healed_zone_is_skipped
{
  const chunk = generateChunk(SEED, CX, CY);
  const before = snapshot(chunk.grid);
  applyScars(chunk, [erupt({ healDay: 3 })], 5); // day 5 ≥ healDay 3 → healed
  ok(snapshot(chunk.grid) === before, "a zone past its healDay reverts to base terrain");
}

// test_scars_distant_zone_does_not_touch_chunk
{
  const chunk = generateChunk(SEED, CX, CY);
  const before = snapshot(chunk.grid);
  const far = erupt({ px: 0, py: 0 }); // epicentre at the world origin, far from chunk 20,20
  applyScars(chunk, [far], 1);
  ok(snapshot(chunk.grid) === before, "a zone whose radius doesn't reach the chunk leaves it untouched");
}

console.log(fail === 0 ? "ALL SCAR CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
