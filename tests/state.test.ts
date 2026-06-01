// Phase 3 — game-logic invariants (CLAUDE.md §7, §8.5, §12).
// Clamping, inventory rules, survival decay, death detection, recentEvents trim,
// and save/load round-trip (with a tiny in-memory localStorage shim).

import {
  newGame,
  clampStat,
  isDead,
  saveGame,
  loadGame,
  clearSave,
  pushRecentEvent,
} from "../src/game/GameState";
import { addItem, removeItem, hasItem, itemCount, useConsumable, quickUseItems, MAX_STACK } from "../src/game/inventory";
import { applyDecay, DEFAULT_DECAY } from "../src/game/survival";

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

ok(clampStat(-5) === 0 && clampStat(150) === 100 && clampStat(50) === 50 && clampStat(NaN) === 0, "clampStat bounds + NaN");

let s = newGame("t");
ok(itemCount(s, "Canned Food") === 2, "starting Canned Food x2");
ok(removeItem(s, "Canned Food", 1) === 1 && itemCount(s, "Canned Food") === 1, "remove 1 leaves 1");
ok(removeItem(s, "Canned Food", 5) === 1 && itemCount(s, "Canned Food") === 0, "remove >held clamps, drops stack");
ok(removeItem(s, "Canned Food", 1) === 0, "remove from empty = 0");
ok(removeItem(s, "Gold", 1) === 0, "remove unheld = 0");
addItem(s, "Water Bottle", 3);
ok(itemCount(s, "Water Bottle") === 5, "addItem merges stack (2+3=5)");
addItem(s, "Ammo", 200);
ok(itemCount(s, "Ammo") === MAX_STACK, "addItem caps at MAX_STACK");
ok(hasItem(s, "Water Bottle", 5) && !hasItem(s, "Water Bottle", 6), "hasItem qty check");

s = newGame("t");
const h0 = s.player.hunger;
const t0 = s.player.thirst;
applyDecay(s);
ok(s.player.hunger === h0 - DEFAULT_DECAY.hunger && Math.abs(s.player.thirst - (t0 - DEFAULT_DECAY.thirst)) < 1e-9, "hunger/thirst decay");
ok(s.player.stamina === 100, "stamina regen clamps at 100");
s.player.hunger = 0;
const hp0 = s.player.hp;
applyDecay(s);
ok(s.player.hp === hp0 - DEFAULT_DECAY.starveDamage, "starvation damages HP");
s.player.infection = 10;
applyDecay(s);
ok(Math.abs(s.player.infection - 11.5) < 1e-9, "infection climbs once set");

s = newGame("t");
s.player.hp = 0;
ok(isDead(s), "death at hp<=0");
s = newGame("t");
s.player.infection = 100;
ok(isDead(s), "death at infection>=100");
s = newGame("t");
ok(!isDead(s), "alive otherwise");

s = newGame("t");
for (let i = 0; i < 10; i++) pushRecentEvent(s, "e" + i);
ok(s.recentEvents.length === 6 && s.recentEvents[5] === "e9", "recentEvents trimmed to last 6");

s = newGame("save-seed");
s.player.hp = 42;
addItem(s, "Map", 1);
saveGame(s);
const loaded = loadGame();
ok(loaded !== null && JSON.stringify(loaded) === JSON.stringify(s), "save/load round-trip identical");
clearSave();
ok(loadGame() === null, "clearSave -> null");
store.set("outbreak_save_v1", "{not json");
ok(loadGame() === null, "corrupt JSON -> null");
store.set("outbreak_save_v1", JSON.stringify({ seed: 123 }));
ok(loadGame() === null, "invalid shape -> null");

// --- consumables: catalog-driven use + quick-use hotbar slots ---
s = newGame("t");
const bandages0 = itemCount(s, "Bandage");
addItem(s, "Bandage", 1);
s.player.hp = 50;
ok(useConsumable(s, "Bandage") === true && s.player.hp === 80 && itemCount(s, "Bandage") === bandages0, "useConsumable applies effects (+30 hp) and removes 1");
s = newGame("t");
s.player.infection = 60;
addItem(s, "Antiviral Serum", 1);
ok(useConsumable(s, "Antiviral Serum") === true && s.player.infection === 0, "cure consumable zeroes infection");
s = newGame("t");
ok(useConsumable(s, "First-Aid Kit") === false, "useConsumable false when item not held");
addItem(s, "Crowbar", 1);
ok(useConsumable(s, "Crowbar") === false, "useConsumable false for a non-consumable");

s = newGame("t");
addItem(s, "Energy Bar", 5); // food (hunger)
addItem(s, "Canteen", 5); // drink (thirst)
addItem(s, "First-Aid Kit", 5); // heal (hp)
addItem(s, "Antibiotics", 5); // cure (infection<0)
const q = quickUseItems(s);
ok(q.length === 4, "quickUseItems returns 4 fixed slots");
ok(q[0]?.item === "Energy Bar", "quick slot 0 = food");
ok(q[1]?.item === "Canteen", "quick slot 1 = drink");
ok(q[2]?.item === "First-Aid Kit", "quick slot 2 = heal");
ok(q[3]?.item === "Antibiotics", "quick slot 3 = cure/anti-infection");
const qFresh = quickUseItems(newGame("t"));
ok(qFresh.length === 4 && qFresh.every((x) => x === undefined || x.qty > 0), "quick slots length 4, no empty stacks (sparse-safe)");

console.log(fail === 0 ? "ALL STATE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
