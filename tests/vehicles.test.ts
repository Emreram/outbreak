// Vehicles (Feature 4) — pure-logic invariants: deterministic seed-based spawns on
// walkable road tiles, the find→fix→fuel→drive gate, persisted overrides, and that
// a repaired/moved car survives a save/load round-trip.

import {
  chunkVehicles,
  initialVehicle,
  resolveVehicle,
  upsertVehicle,
  fitPart,
  nextNeed,
  isRepaired,
  isDrivable,
  vehicleChunkOf,
  vehicleDef,
  VEHICLE_TYPE_IDS,
  CAR_PARTS,
  FUEL_PER_CAN,
} from "../src/game/vehicles";
import { isRoadCol, isRoadRow } from "../src/game/worldgen";
import { biomeAt } from "../src/game/world/biomes";
import { CHUNK_TILES, TILE_SIZE } from "../src/game/constants";
import { newGame, saveGame, loadGame, clearSave } from "../src/game/GameState";

// in-memory localStorage shim so persistence is testable under Node
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const SEED = "vtest";

// --- deterministic spawns: urban-only, on road tiles, reproducible ---
let found: { cx: number; cy: number; v: ReturnType<typeof chunkVehicles> } | null = null;
outer: for (let cx = 14; cx < 30; cx++) {
  for (let cy = 14; cy < 30; cy++) {
    if (!biomeAt(SEED, cx, cy).urban) continue;
    const v = chunkVehicles(SEED, cx, cy);
    if (v.length > 0) {
      found = { cx, cy, v };
      break outer;
    }
  }
}
ok(found !== null, "at least one urban chunk spawns a vehicle");

if (found) {
  const again = chunkVehicles(SEED, found.cx, found.cy);
  ok(JSON.stringify(again) === JSON.stringify(found.v), "chunkVehicles is deterministic for the same seed+coords");
  ok(
    found.v.every((sp) => isRoadCol(SEED, sp.tx) || isRoadRow(SEED, sp.ty)),
    "every spawn lands on a road tile (guaranteed walkable)",
  );
  ok(found.v.every((sp) => VEHICLE_TYPE_IDS.includes(sp.type)), "spawn types are valid vehicle types");
}

// non-urban chunks (the ocean border at 0,0) never spawn cars
ok(!biomeAt(SEED, 0, 0).urban && chunkVehicles(SEED, 0, 0).length === 0, "non-urban chunks spawn no vehicles");

// --- initial (wreck) condition ---
const sp0 = found!.v[0];
const iv = initialVehicle(SEED, sp0);
ok(iv.fuel === 0 && iv.repaired === false && iv.needs.length >= 2, "a fresh wreck has an empty tank, is unrepaired, and needs ≥2 parts");
ok(iv.needs.every((p) => (CAR_PARTS as readonly string[]).includes(p)), "needed parts come from the car-parts list");
ok(JSON.stringify(initialVehicle(SEED, sp0)) === JSON.stringify(iv), "initialVehicle is deterministic per gid");

// --- repair gate: fit each needed part → repaired; then fuel → drivable ---
const v = initialVehicle(SEED, sp0);
const before = v.needs.length;
const first = nextNeed(v)!;
ok(fitPart(v, "Garden Gnome") === false && v.needs.length === before, "fitPart ignores a part the wreck doesn't need");
ok(fitPart(v, first) === true && v.needs.length === before - 1, "fitPart consumes a needed part");
while (v.needs.length > 0) fitPart(v, v.needs[0]);
ok(isRepaired(v) === true, "vehicle is repaired once every needed part is fitted");
ok(isDrivable(v) === false, "repaired but empty tank → not drivable");
v.fuel = FUEL_PER_CAN;
ok(isDrivable(v) === true, "repaired + fuelled → drivable");

// --- persisted overrides win over the deterministic default ---
const st = newGame("vsave");
ok(resolveVehicle(st, SEED, sp0).repaired === false, "resolve returns the deterministic default when untouched");
const moved = { ...initialVehicle(SEED, sp0), repaired: true, needs: [] as string[], fuel: 80, x: 123456, y: 654321 };
upsertVehicle(st, moved);
ok((st.vehicles?.length ?? 0) === 1, "upsert inserts a record");
upsertVehicle(st, { ...moved, fuel: 40 });
ok(st.vehicles?.length === 1 && st.vehicles?.[0].fuel === 40, "upsert replaces the record by gid (no duplicate)");
ok(resolveVehicle(st, SEED, sp0).fuel === 40, "resolve returns the persisted override, not the default");

// --- chunk math: a moved car maps to its NEW chunk ---
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
const vc = vehicleChunkOf({ gid: "x", type: "sedan", x: CHUNK_PX * 3 + 5, y: CHUNK_PX * 4 + 5, fuel: 0, repaired: false, needs: [] });
ok(vc.cx === 3 && vc.cy === 4, "vehicleChunkOf maps world pixels → chunk coords");

// --- catalog sanity ---
ok(CAR_PARTS.length === 4, "four distinct car parts exist");
ok(VEHICLE_TYPE_IDS.every((id) => vehicleDef(id).speedMult > 1), "every vehicle type drives faster than walking");

// --- a repaired, moved car survives save/load ---
saveGame(st);
const loaded = loadGame();
ok(loaded !== null && JSON.stringify(loaded.vehicles) === JSON.stringify(st.vehicles), "vehicles persist across a save/load round-trip");
clearSave();

console.log(fail === 0 ? "ALL VEHICLE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
