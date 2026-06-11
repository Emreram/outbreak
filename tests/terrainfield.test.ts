// Terrain field invariants (Terrain Overhaul PR1): the per-tile terrain function
// is PURE (same inputs → same sample), chunk seams are legal (no deep water
// kissing dry land across a border), the seed-aware spawn search lands on
// hospitable dry ground for every seed, the classifier's urban set matches the
// biome catalog, and chunk generation stays inside its perf budget.

import { terrainSampleAt, terrainTileAt, URBAN_IDS, isWaterish } from "../src/game/world/terrainField";
import { BIOMES, biomeAt } from "../src/game/world/biomes";
import { findSpawnChunk } from "../src/game/world/spawn";
import { generateChunk, Tile } from "../src/game/worldgen";
import { CHUNK_TILES } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- purity: double evaluation is identical over a scattered sample ----------
{
  let pure = true;
  for (let i = 0; i < 400; i++) {
    const gx = 100 + ((i * 37) % 1700);
    const gy = 100 + ((i * 91) % 1700);
    const a = terrainSampleAt("pure", gx, gy);
    const b = terrainSampleAt("pure", gx, gy);
    if (a.ground !== b.ground || a.biome !== b.biome || a.wet !== b.wet) pure = false;
  }
  ok(pure, "terrainSampleAt is pure (double-call identical over 400 tiles)");
}

// --- classifier/catalog consistency ------------------------------------------
{
  let consistent = true;
  for (const def of Object.values(BIOMES)) {
    if (URBAN_IDS.has(def.id) !== def.urban) {
      consistent = false;
      console.log(`  mismatch: ${def.id} urban=${def.urban} but URBAN_IDS=${URBAN_IDS.has(def.id)}`);
    }
  }
  ok(consistent, "terrainField URBAN_IDS matches BIOMES[..].urban");
}

// --- chunk-seam legality: adjacent generated chunks never put DeepWater against
// --- dry ground across the border (the shoreline pass samples neighbours via the
// --- same pure painter, so the rule must hold at seams exactly like inside) ----
{
  const seed = "seam";
  let pairs = 0;
  let bad = 0;
  for (let cy = 8; cy <= 32 && pairs < 24; cy += 3) {
    for (let cx = 8; cx <= 31 && pairs < 24; cx += 3) {
      if (biomeAt(seed, cx, cy).urban || biomeAt(seed, cx + 1, cy).urban) continue;
      const A = generateChunk(seed, cx, cy);
      const B = generateChunk(seed, cx + 1, cy);
      pairs++;
      for (let ly = 0; ly < CHUNK_TILES; ly++) {
        const a = A.grid[ly][CHUNK_TILES - 1];
        const b = B.grid[ly][0];
        const deepVsDry =
          (a === Tile.DeepWater && !isWaterish(b) && b !== Tile.Bridge) ||
          (b === Tile.DeepWater && !isWaterish(a) && a !== Tile.Bridge);
        if (deepVsDry) bad++;
      }
    }
  }
  ok(pairs >= 10, `sampled enough natural seam pairs (${pairs})`);
  ok(bad === 0, `no DeepWater touches dry ground across chunk seams (${bad} violations)`);
}

// --- spawn: deterministic, hospitable, dry — across seeds ---------------------
{
  const HOSPITABLE = new Set(["grassland", "suburb", "farmland", "parkland", "forest", "commercial_strip"]);
  let allGood = true;
  for (const seed of ["alpha", "beta", "deepaudit", "marshy", "x9", "zz-top"]) {
    const a = findSpawnChunk(seed);
    const b = findSpawnChunk(seed);
    if (a.x !== b.x || a.y !== b.y) allGood = false;
    const biome = biomeAt(seed, a.x, a.y);
    if (!HOSPITABLE.has(biome.id)) {
      allGood = false;
      console.log(`  seed ${seed}: spawn biome ${biome.id} not hospitable`);
    }
    // Ground truth: the GENERATED spawn chunk is nearly dry (count grid tiles —
    // the search's 8% field-lattice cap allows a little extra from shoreline rims).
    const g = generateChunk(seed, a.x, a.y).grid;
    let wet = 0;
    for (const row of g) for (const t of row) if (isWaterish(t)) wet++;
    const frac = wet / (CHUNK_TILES * CHUNK_TILES);
    if (frac > 0.18) {
      allGood = false;
      console.log(`  seed ${seed}: spawn chunk ${(100 * frac).toFixed(0)}% water tiles`);
    }
  }
  ok(allGood, "findSpawnChunk: deterministic + hospitable + dry across 6 seeds");
}

// --- perf budget: chunk generation must stay snappy (streaming hitches) -------
{
  // Warm up (JIT + texture-free pure logic), then measure a mixed 5×5 patch.
  for (let i = 0; i < 4; i++) generateChunk("perf", 20 + i, 20);
  const t0 = performance.now();
  let n = 0;
  for (let cy = 14; cy < 19; cy++) {
    for (let cx = 14; cx < 19; cx++) {
      generateChunk("perf", cx, cy);
      n++;
    }
  }
  const mean = (performance.now() - t0) / n;
  console.log(`  mean generateChunk = ${mean.toFixed(2)} ms over ${n} chunks`);
  ok(mean < 10, `chunk generation under the 10 ms budget (${mean.toFixed(2)} ms)`);
}

// --- terrainTileAt fast path agrees with the full sample ----------------------
{
  let agree = true;
  for (let i = 0; i < 200; i++) {
    const gx = 200 + ((i * 53) % 1400);
    const gy = 200 + ((i * 29) % 1400);
    if (terrainTileAt("agree", gx, gy) !== terrainSampleAt("agree", gx, gy).ground) agree = false;
  }
  ok(agree, "terrainTileAt matches terrainSampleAt.ground");
}

console.log(fail === 0 ? "ALL TERRAIN-FIELD CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
