// World-system invariants for the huge, finite, seamless, biome-rich overworld:
// tileset frame order, the impassable set, biome assignment (ocean edge +
// variety + determinism), global-id uniqueness across chunks, the min-density
// guarantee, and distance-scaled danger/loot.

import { Tile, TILE_ORDER, TILE_COUNT, SOLID_TILES, generateChunk } from "../src/game/worldgen";
import { biomeAt, getBiome, BIOMES } from "../src/game/world/biomes";
import { field } from "../src/game/world/noise";
import { dangerTierAt, lootBiasAt, chunkDistToSpawn } from "../src/game/world/scaling";
import { hasLandmarkStyle } from "../src/game/world/landmarks";
import { WORLD_CHUNKS_X, WORLD_CHUNKS_Y, SPAWN_CHUNK } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- tileset frame order ---------------------------------------------------
ok(TILE_ORDER.length === TILE_COUNT, `TILE_ORDER covers all ${TILE_COUNT} tiles (has ${TILE_ORDER.length})`);
ok(TILE_ORDER.every((t, i) => t === i), "frame index === Tile value for every tile");

// --- impassable set --------------------------------------------------------
const solid = new Set<number>(SOLID_TILES as number[]);
ok([Tile.Wall, Tile.Water, Tile.Tree, Tile.Rubble, Tile.Rail].every((t) => solid.has(t)), "SOLID_TILES blocks wall/water/tree/rubble/rail");
ok(![Tile.ShallowWater, Tile.Sand, Tile.Dirt, Tile.Trail, Tile.Grass, Tile.Road].some((t) => solid.has(t)), "ground/shallows are walkable");

// --- biome assignment ------------------------------------------------------
// Every edge chunk is forced to ocean (a real world border).
let edgeOk = true;
for (let c = 0; c < WORLD_CHUNKS_X; c++) {
  if (biomeAt("alpha", c, 0).id !== "ocean") edgeOk = false;
  if (biomeAt("alpha", c, WORLD_CHUNKS_Y - 1).id !== "ocean") edgeOk = false;
}
for (let r = 0; r < WORLD_CHUNKS_Y; r++) {
  if (biomeAt("alpha", 0, r).id !== "ocean") edgeOk = false;
  if (biomeAt("alpha", WORLD_CHUNKS_X - 1, r).id !== "ocean") edgeOk = false;
}
ok(edgeOk, "world edge is ocean all the way around");

// Interior chunks are not forced to ocean and show real variety across the
// whole (huge) world. Biomes are large contiguous regions, so a small patch
// holds only a few — the full world holds many.
const seen = new Set<string>();
for (let cy = 1; cy < WORLD_CHUNKS_Y - 1; cy++) {
  for (let cx = 1; cx < WORLD_CHUNKS_X - 1; cx++) seen.add(biomeAt("alpha", cx, cy).id);
}
seen.delete("ocean");
ok(seen.size >= 12, `world shows many biomes (${seen.size} distinct land biomes)`);
ok(getBiome([...seen][0]).id !== undefined, "getBiome resolves a seen id");

// Determinism: biome + noise are pure functions of (seed, x, y).
ok(biomeAt("alpha", 12, 13).id === biomeAt("alpha", 12, 13).id, "biomeAt deterministic");
ok(field("alpha", 3, 4, 6) === field("alpha", 3, 4, 6), "noise field deterministic");
ok(biomeAt("alpha", 12, 13).id !== biomeAt("beta", 12, 13).id || biomeAt("alpha", 14, 13).id !== biomeAt("beta", 14, 13).id, "different seeds give different worlds");

// Contiguity: neighbouring interior chunks usually share a biome (smooth noise).
let same = 0;
let pairs = 0;
for (let cy = 10; cy < 30; cy++) {
  for (let cx = 10; cx < 29; cx++) {
    pairs++;
    if (biomeAt("alpha", cx, cy).id === biomeAt("alpha", cx + 1, cy).id) same++;
  }
}
ok(same / pairs > 0.4, `biomes form contiguous regions (${Math.round((100 * same) / pairs)}% of neighbours match)`);

// --- global id uniqueness across a block of chunks -------------------------
const gids = new Set<string>();
let dupe = "";
let minDensityOk = true;
for (let cy = 16; cy <= 24; cy++) {
  for (let cx = 16; cx <= 24; cx++) {
    const c = generateChunk("alpha", cx, cy);
    for (const b of c.buildings) {
      if (gids.has(b.gid)) dupe = b.gid;
      gids.add(b.gid);
    }
    for (const ct of c.containers) {
      if (gids.has(ct.gid)) dupe = ct.gid;
      gids.add(ct.gid);
    }
    // Anti-emptiness: a land chunk always has something to interact with.
    if (c.biome !== "ocean" && c.buildings.length === 0 && c.containers.length === 0 && c.landmarks.length === 0) {
      minDensityOk = false;
    }
  }
}
ok(dupe === "", `building/chest gids unique across 81 chunks (${dupe || "ok"})`);
ok(minDensityOk, "no land chunk is empty (min interactable density)");

// Every landmark kind a biome can place has an explicit (curated) marker style.
const lmKinds = new Set<string>();
for (const b of Object.values(BIOMES)) for (const lm of b.landmarks) lmKinds.add(lm.kind);
const unstyled = [...lmKinds].filter((k) => !hasLandmarkStyle(k));
ok(unstyled.length === 0, `every biome landmark has a style (${unstyled.join(",") || "ok"})`);

// --- distance-scaled danger & loot -----------------------------------------
ok(chunkDistToSpawn(SPAWN_CHUNK.x, SPAWN_CHUNK.y) === 0, "spawn chunk is distance 0");
const nearD = dangerTierAt("alpha", SPAWN_CHUNK.x, SPAWN_CHUNK.y);
const farD = dangerTierAt("alpha", SPAWN_CHUNK.x + 18, SPAWN_CHUNK.y);
ok(farD > nearD, `danger rises with distance (near ${nearD} → far ${farD})`);
const nearL = lootBiasAt("alpha", SPAWN_CHUNK.x, SPAWN_CHUNK.y);
const farL = lootBiasAt("alpha", SPAWN_CHUNK.x + 18, SPAWN_CHUNK.y);
ok(farL > nearL, `loot bias rises with distance (near ${nearL.toFixed(2)} → far ${farL.toFixed(2)})`);

if (fail === 0) console.log("\nALL WORLD CHECKS PASSED");
else {
  console.log(`\n${fail} WORLD CHECK(S) FAILED`);
  process.exit(1);
}
