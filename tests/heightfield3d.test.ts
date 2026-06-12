// render3d/env/heightField.ts (graphics plan WS6): the visual-only terrain
// relief — raise-only amplitude bound, determinism, flatness on structure
// tiles (water/roads/walls), smoothness, and the sim-invisibility guarantee
// (the default space.ts hook stays 0 unless a field is installed).

import { createHeightField, RELIEF_AMP_M } from "../src/render3d/env/heightField";
import { groundHeightAt } from "../src/render3d/space";
import { SimChunkStore } from "../src/sim/world";
import { Tile, SOLID_TILES } from "../src/game/world/tiles";
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

// Arrange: a real store on a fixed seed, loaded ring at spawn.
const store = new SimChunkStore("hf-test-seed", { isChestLooted: () => false });
store.ensureAround(store.start.x, store.start.y);
const hf = createHeightField("hf-test-seed", store);

// --- sim invisibility ----------------------------------------------------------------
{
  ok(groundHeightAt(store.start.x, store.start.y) === 0, "space.ts default hook stays flat (no field installed)");
}

// --- bounds + determinism ---------------------------------------------------------------
{
  let lo = 99;
  let hi = -99;
  for (let i = 0; i < 600; i++) {
    const h = hf.heightAt(store.start.x + (i % 40) * 16, store.start.y + Math.floor(i / 40) * 16);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  ok(lo >= 0, `relief is raise-only (min ${lo.toFixed(3)})`);
  ok(hi <= RELIEF_AMP_M + 1e-9, `relief stays under the ${RELIEF_AMP_M}m amplitude (max ${hi.toFixed(3)})`);
  ok(hi > 0.02, "relief actually rises somewhere");
  ok(hf.heightAt(store.start.x + 100, store.start.y + 50) === hf.heightAt(store.start.x + 100, store.start.y + 50), "deterministic per position");
}

// --- flat on structure tiles -------------------------------------------------------------
{
  // Act: scan loaded chunks for representative flat-rule tiles.
  const solid = new Set<number>(SOLID_TILES as readonly number[]);
  let road: { x: number; y: number } | null = null;
  let water: { x: number; y: number } | null = null;
  let wall: { x: number; y: number } | null = null;
  for (const lc of store.loadedChunks()) {
    for (let y = 0; y < lc.data.size && !(road && water && wall); y++) {
      for (let x = 0; x < lc.data.size; x++) {
        const t = lc.data.grid[y][x];
        const px = (lc.cx * lc.data.size + x + 0.5) * TILE_SIZE;
        const py = (lc.cy * lc.data.size + y + 0.5) * TILE_SIZE;
        if (!road && (t === Tile.Road || t === Tile.Pavement || t === Tile.Sidewalk)) road = { x: px, y: py };
        if (!water && (t === Tile.Water || t === Tile.DeepWater)) water = { x: px, y: py };
        if (!wall && t === Tile.Wall) wall = { x: px, y: py };
      }
    }
  }
  void solid;
  ok(road !== null, "found a road/pavement tile in the loaded ring");
  if (road) ok(hf.heightAt(road.x, road.y) === 0, "roads sit on the 0-plinth");
  if (water) ok(hf.heightAt(water.x, water.y) === 0, "water sits on the 0-plinth (fixed-Y planes safe)");
  if (wall) ok(hf.heightAt(wall.x, wall.y) === 0, "walls sit on the 0-plinth");
}

// --- smoothness -----------------------------------------------------------------------------
{
  let maxStep = 0;
  for (let i = 0; i < 400; i++) {
    const x = store.start.x - 600 + i * 3;
    const d = Math.abs(hf.heightAt(x + 8, store.start.y + 40) - hf.heightAt(x, store.start.y + 40));
    maxStep = Math.max(maxStep, d);
  }
  ok(maxStep < 0.15, `8px steps stay gentle (max ${maxStep.toFixed(3)}m — slopes, not cliffs)`);
}

console.log(fail === 0 ? "ALL HEIGHTFIELD3D CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
