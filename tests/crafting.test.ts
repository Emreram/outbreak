// Crafting, expanded + bug-hardened (Batch D): every recipe references real catalog
// items; recipes consume inputs + yield output; station + skill gates block until met;
// duplicate-input totals are summed (no over-crafting on partial stacks); a failed
// craft mutates nothing (no negative stacks).

import { newGame } from "../src/game/GameState";
import { addItem, itemCount } from "../src/game/inventory";
import { RECIPES, canCraft, craft, type Recipe } from "../src/game/crafting";
import { getItemDef } from "../src/game/items/catalog";
import { addXp, xpForLevel } from "../src/game/skills";

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

// --- every recipe references real catalog items + has a category --------------
let allValid = true;
for (const r of RECIPES) {
  if (!getItemDef(r.out)) {
    allValid = false;
    console.log("FAIL: recipe", r.id, "output not in catalog:", r.out);
  }
  for (const i of r.inputs) {
    if (!getItemDef(i.item)) {
      allValid = false;
      console.log("FAIL: recipe", r.id, "input not in catalog:", i.item);
    }
  }
  if (!r.category) allValid = false;
}
ok(allValid, "every recipe's inputs + output exist in the catalog and have a category");

// --- a plain recipe consumes inputs + yields output --------------------------
const bandage = RECIPES.find((r) => r.id === "bandage")!;
const s = newGame("craft");
const cloth0 = itemCount(s, "Cloth"); // newGame seeds no cloth
const band0 = itemCount(s, "Bandage"); // newGame seeds a starting bandage
ok(!canCraft(s, bandage), "cannot craft a bandage without cloth");
addItem(s, "Cloth", 2);
ok(canCraft(s, bandage) && craft(s, bandage), "craft a bandage with 2 cloth");
ok(itemCount(s, "Cloth") === cloth0 && itemCount(s, "Bandage") === band0 + 1, "craft consumed inputs and produced the output");

// --- a failed craft mutates nothing (no negative stacks) ---------------------
const sNeg = newGame("neg");
addItem(sNeg, "Cloth", 1);
ok(!craft(sNeg, bandage), "craft fails without enough materials");
ok(itemCount(sNeg, "Cloth") === 1, "a failed craft consumes nothing");

// --- station gate: blocked until a workbench is nearby -----------------------
const pipe = RECIPES.find((r) => r.id === "pipe_bomb")!;
const sStn = newGame("station");
addItem(sStn, "Scrap Metal", 1);
addItem(sStn, "Gunpowder", 2);
addItem(sStn, "Duct Tape", 1);
ok(!canCraft(sStn, pipe), "a station recipe is blocked with no station info");
ok(!canCraft(sStn, pipe, new Set()), "still blocked with no stations nearby");
ok(canCraft(sStn, pipe, new Set(["workbench"])), "craftable at a workbench");
ok(craft(sStn, pipe, new Set(["workbench"])), "crafts at a workbench");
ok(itemCount(sStn, "Pipe Bomb") === 1 && itemCount(sStn, "Gunpowder") === 0, "station craft consumed inputs + yielded output");
ok(!canCraft(newGame("nomat"), pipe, new Set(["workbench"])), "a station recipe still needs the materials");

// --- skill gate: blocked below the required Crafting level -------------------
const rifle = RECIPES.find((r) => r.id === "ammo_rifle")!;
const sSkill = newGame("skill");
addItem(sSkill, "Gunpowder", 2);
addItem(sSkill, "Scrap Metal", 1);
ok(rifle.skill !== undefined, "the rifle-ammo recipe has a skill gate");
ok(!canCraft(sSkill, rifle, new Set(["workbench"])), "blocked below the Crafting skill gate even at a workbench");
addXp(sSkill, "crafting", xpForLevel(rifle.skill!.level));
ok(canCraft(sSkill, rifle, new Set(["workbench"])), "unlocks once the Crafting level + station + materials are met");
ok(craft(sSkill, rifle, new Set(["workbench"])) && itemCount(sSkill, "5.56 Rounds") === rifle.outQty, "produces the rifle ammo batch");

// --- duplicate-input totals are summed (no over-craft on partial stacks) -----
const dupR: Recipe = {
  id: "dup-test",
  out: "Bandage",
  outQty: 1,
  inputs: [
    { item: "Cloth", qty: 1 },
    { item: "Cloth", qty: 1 },
  ],
  category: "Medical",
  desc: "test recipe with a repeated input",
};
const sDup = newGame("dup");
addItem(sDup, "Cloth", 1);
ok(!canCraft(sDup, dupR), "a recipe needing 2 Cloth total is NOT craftable with only 1");
addItem(sDup, "Cloth", 1); // now hold 2
ok(canCraft(sDup, dupR) && craft(sDup, dupR), "craftable once the summed total is held");
ok(itemCount(sDup, "Cloth") === 0, "both cloth consumed — duplicate inputs sum correctly");

console.log(fail === 0 ? "ALL CRAFTING CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
