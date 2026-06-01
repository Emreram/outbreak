// Base building & barricading (Feature 7) — pure-logic invariants: build costs are
// consumed, one structure per tile, siege damage destroys (but stations are immune),
// claim/release a base, the storage stash round-trips, and it all survives save/load.

import {
  PLACEABLES,
  BUILD_ORDER,
  placeableAt,
  canAfford,
  buildPlaceable,
  damagePlaceable,
  claimBase,
  isBaseClaimed,
  stash,
  unstash,
} from "../src/game/base";
import { newGame, saveGame, loadGame, clearSave } from "../src/game/GameState";
import { addItem, itemCount } from "../src/game/inventory";

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

// --- palette sanity ---
ok(BUILD_ORDER.length >= 5 && BUILD_ORDER.every((k) => !!PLACEABLES[k]), "every build-palette kind has a definition");

// --- build cost + one-per-tile ---
let s = newGame("base");
ok(!buildPlaceable(s, "barricade", 10, 10), "cannot build a barricade without planks");
ok(placeableAt(s, 10, 10) === undefined, "no structure was placed on the failed build");
addItem(s, "Wood Plank", 5);
const p = buildPlaceable(s, "barricade", 10, 10);
ok(!!p && p.kind === "barricade" && p.hp === 120 && p.maxHp === 120, "build a barricade with planks (full HP)");
ok(itemCount(s, "Wood Plank") === 3, "building consumed exactly 2 planks");
ok(placeableAt(s, 10, 10) === p, "placeableAt finds the built structure");
ok(!buildPlaceable(s, "wall", 10, 10), "cannot build on an already-occupied tile");

// --- siege damage destroys; stations are immune ---
ok(damagePlaceable(s, p!, 50) === false && p!.hp === 70, "siege damage lowers HP without destroying");
ok(damagePlaceable(s, p!, 100) === true, "lethal damage destroys the structure");
ok(placeableAt(s, 10, 10) === undefined && (s.placeables?.length ?? 0) === 0, "a destroyed structure is removed from state");
addItem(s, "Wood Plank", 6);
addItem(s, "Loose Brick", 4);
const cf = buildPlaceable(s, "campfire", 12, 12);
ok(!!cf && PLACEABLES.campfire.hp === 0, "a station's HP def is 0 (indestructible)");
ok(damagePlaceable(s, cf!, 999) === false, "stations ignore siege damage");

// --- afford check ---
const g = newGame("aff");
ok(!canAfford(g, PLACEABLES.gate), "can't afford a gate with an empty pack");
addItem(g, "Wood Plank", 2);
addItem(g, "Scrap Metal", 2);
ok(canAfford(g, PLACEABLES.gate), "afford a gate with planks + scrap");

// --- claim / release a base ---
const b = newGame("claim");
ok(!isBaseClaimed(b, "b1"), "no base claimed by default");
claimBase(b, "b1", 100, 200, "house");
ok(isBaseClaimed(b, "b1") && b.base?.name === "house", "claimBase records the home building");
ok(!isBaseClaimed(b, "b2"), "a different building is not the base");

// --- storage stash round-trip (Scrap Metal isn't in the starting kit) ---
const st = newGame("stash");
addItem(st, "Scrap Metal", 3);
ok(stash(st, "Scrap Metal", 2) === true && itemCount(st, "Scrap Metal") === 1, "stash moves items out of the pack");
ok(st.baseStorage?.find((i) => i.item === "Scrap Metal")?.qty === 2, "stashed items are recorded in base storage");
ok(unstash(st, "Scrap Metal", 2) === true && itemCount(st, "Scrap Metal") === 3, "unstash returns items to the pack");
ok(!st.baseStorage?.find((i) => i.item === "Scrap Metal"), "an emptied stash stack is removed");
ok(unstash(st, "Scrap Metal", 1) === false, "cannot unstash what isn't stored");

// --- persistence ---
const sv = newGame("bsave");
addItem(sv, "Wood Plank", 4);
buildPlaceable(sv, "wall", 5, 5);
claimBase(sv, "bz", 1, 2, "cabin");
stash(sv, "Wood Plank", 1);
saveGame(sv);
const loaded = loadGame();
ok(
  loaded !== null &&
    JSON.stringify(loaded.placeables) === JSON.stringify(sv.placeables) &&
    loaded.base?.gid === "bz" &&
    JSON.stringify(loaded.baseStorage) === JSON.stringify(sv.baseStorage),
  "base + placeables + storage all persist across save/load",
);
clearSave();

console.log(fail === 0 ? "ALL BASE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
