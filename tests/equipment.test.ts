// Update-pass equipment invariants: the carried-weapon strip ordering (Batch B) and
// the two-slot armour system (Batch C) — equip/stack/cap/unequip, autoEquip filling an
// empty slot, ownership gating, and save/load persistence.

import { newGame, saveGame, loadGame, clearSave } from "../src/game/GameState";
import {
  addItem,
  itemCount,
  equipArmor,
  unequipArmor,
  equippedArmorDef,
  armorDefensePct,
  autoEquip,
  weaponsInBag,
} from "../src/game/inventory";

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

// --- carried-weapon strip (Batch B): melee-first, weapons only ---------------
const w = newGame("weap");
addItem(w, "9mm Pistol", 1); // ranged
addItem(w, "Kitchen Knife", 1); // melee
const bag = weaponsInBag(w);
ok(bag.length === 2, "the weapon strip lists both carried weapons");
ok(bag[0].hand === "melee", "melee weapons come first in the strip");
ok(bag[bag.length - 1].hand === "ranged", "ranged weapons come after melee");
addItem(w, "Bandage", 5); // a consumable
addItem(w, "Scrap Metal", 3); // a material
ok(weaponsInBag(w).length === 2, "non-weapons are excluded from the weapon strip");

// --- armour: two slots that stack, clamp, and unequip (Batch C) --------------
const s = newGame("armor");
addItem(s, "Leather Jacket", 1); // body, 12%
addItem(s, "Helmet", 1); // head, 14%
ok(armorDefensePct(s) === 0, "no armour equipped → 0% (carrying it does nothing)");
ok(equipArmor(s, "Leather Jacket") && equippedArmorDef(s, "body")?.name === "Leather Jacket", "equip a body piece");
ok(equipArmor(s, "Helmet") && equippedArmorDef(s, "head")?.name === "Helmet", "equip a head piece");
ok(armorDefensePct(s) === 12 + 14, "body + head defence stack");

addItem(s, "Plate Carrier", 1); // body, 52%
ok(equipArmor(s, "Plate Carrier") && equippedArmorDef(s, "body")?.name === "Plate Carrier", "equipping a new body piece swaps the body slot");
ok(equippedArmorDef(s, "head")?.name === "Helmet", "swapping the body slot leaves the head slot untouched");
ok(armorDefensePct(s) === 52 + 14, "the stronger body piece restacks with the helmet");
ok(armorDefensePct(s) <= 85, "stacked armour is clamped at 85%");

unequipArmor(s, "head");
ok(equippedArmorDef(s, "head") === undefined && armorDefensePct(s) === 52, "unequip head leaves only the body's protection");
unequipArmor(s, "body");
ok(armorDefensePct(s) === 0, "unequip everything → 0% again");

// --- ownership gate + autoEquip ----------------------------------------------
const s3 = newGame("noown");
ok(!equipArmor(s3, "Helmet"), "cannot equip armour you don't hold");
addItem(s3, "Helmet", 1);
ok(autoEquip(s3, "Helmet") && s3.player.equippedArmorHead === "Helmet", "autoEquip fills an empty head slot on pickup");
addItem(s3, "Gas Mask", 1);
ok(!autoEquip(s3, "Gas Mask") && s3.player.equippedArmorHead === "Helmet", "autoEquip won't displace an already-worn piece");

// --- persistence -------------------------------------------------------------
const sv = newGame("armorsave");
addItem(sv, "Kevlar Vest", 1);
addItem(sv, "Helmet", 1);
equipArmor(sv, "Kevlar Vest");
equipArmor(sv, "Helmet");
saveGame(sv);
const loaded = loadGame();
ok(
  loaded !== null &&
    loaded.player.equippedArmorBody === "Kevlar Vest" &&
    loaded.player.equippedArmorHead === "Helmet" &&
    armorDefensePct(loaded) === 30 + 14,
  "equipped body + head armour persists across save/load",
);
ok(itemCount(sv, "Kevlar Vest") === 1, "equipping armour keeps the item in the bag (it's worn, not consumed)");
clearSave();

console.log(fail === 0 ? "ALL EQUIPMENT CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
