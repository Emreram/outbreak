// Terrain movement/hazard classification invariants (Living World). The movement
// model must slow you in shallow water and mud, treat lava as a near-stop burning
// hazard, leave normal ground unaffected, and keep deep water/lava-rock as solid
// barriers (so they're never "stood on" in normal play).

import { terrainEffect, isHazardTile } from "../src/game/terrain";
import { Tile, SOLID_TILES } from "../src/game/worldgen";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const solid = new Set<number>(SOLID_TILES as number[]);

// test_terrain_shallow_water_slows_and_splashes
{
  const e = terrainEffect(Tile.ShallowWater);
  ok(e.mult < 1 && e.mult > 0 && e.stepFx === "splash" && !e.hazard, "shallow water slows + splashes, no damage");
}

// test_terrain_mud_slows
{
  const e = terrainEffect(Tile.Mud);
  ok(e.mult < 1 && e.stepFx === "mud" && !e.hazard, "mud slows + mud FX, no damage");
}

// test_terrain_lava_near_stops_and_burns
{
  const e = terrainEffect(Tile.Lava);
  ok(e.mult < 0.4 && e.hazard === "lava" && e.stepFx === "ember", "lava near-stops + burns + ember FX");
  ok(isHazardTile(Tile.Lava) && !isHazardTile(Tile.Grass), "isHazardTile flags lava only");
}

// test_terrain_normal_ground_unaffected
{
  for (const t of [Tile.Grass, Tile.Road, Tile.Sand, Tile.Scorched, Tile.Ash, null, undefined]) {
    const e = terrainEffect(t as Tile);
    if (e.mult !== 1 || e.hazard || e.stepFx !== "none") fail++;
  }
  ok(true, "normal/unknown ground → full speed, no FX, no hazard");
}

// test_terrain_barriers_stay_solid
{
  ok(solid.has(Tile.Water) && solid.has(Tile.DeepWater) && solid.has(Tile.Basalt), "deep water + cooled basalt are solid barriers");
  ok(!solid.has(Tile.ShallowWater) && !solid.has(Tile.Mud) && !solid.has(Tile.Lava), "shallow water, mud, and lava are walkable (lava is a hazard, not a wall)");
}

console.log(fail === 0 ? "ALL TERRAIN CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
