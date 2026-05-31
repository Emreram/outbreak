// Character creation data: backgrounds (loadouts resolve, perks exist), the
// applyCreation pipeline, and the pure perk modifier helpers. Headless.

import { BACKGROUNDS, getBackground } from "../src/game/backgrounds";
import { PERKS, isPerk, hasPerk, decayMods, damageTakenMult, meleeMult, rangedMult, consumableMult, lootLuck } from "../src/game/perks";
import { getItemDef } from "../src/game/items/catalog";
import { newGame, applyCreation } from "../src/game/GameState";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const STAT_KEYS = new Set(["hp", "stamina", "hunger", "thirst", "infection"]);

function main(): void {
  ok(BACKGROUNDS.length >= 8, `>=8 backgrounds (have ${BACKGROUNDS.length})`);

  const ids = new Set<string>();
  let dup = "";
  for (const b of BACKGROUNDS) {
    if (ids.has(b.id)) dup = b.id;
    ids.add(b.id);
  }
  ok(dup === "", `background ids unique (${dup || "ok"})`);

  // every background is well-formed: items resolve, perks exist, colour/difficulty sane
  let bad = "";
  for (const b of BACKGROUNDS) {
    if (b.items.length === 0 || !b.items.every((it) => getItemDef(it.item) && it.qty > 0)) {
      bad = `${b.name}: bad item`;
      break;
    }
    if (!b.perks.every((p) => isPerk(p))) {
      bad = `${b.name}: bad perk`;
      break;
    }
    if (typeof b.color !== "number" || b.difficulty < 0.5 || b.difficulty > 2) {
      bad = `${b.name}: colour/difficulty`;
      break;
    }
    if (b.statTweaks && !Object.keys(b.statTweaks).every((k) => STAT_KEYS.has(k))) {
      bad = `${b.name}: stat key`;
      break;
    }
  }
  ok(bad === "", `every background valid (${bad || "ok"})`);

  // every perk is reachable (granted by some background)
  const used = new Set<string>();
  for (const b of BACKGROUNDS) for (const p of b.perks) used.add(p);
  ok(PERKS.every((p) => used.has(p.id)), "every perk is granted by some background");

  // applyCreation folds the chosen class in
  const s = newGame("c");
  applyCreation(s, { background: "soldier", color: 0x6b8e23, difficulty: 0.8 });
  ok(s.background === "soldier", "applyCreation sets background");
  ok(hasPerk(s, "marksman"), "soldier has the Marksman perk");
  ok(s.inventory.some((i) => i.item === "9mm Pistol"), "soldier loadout added");
  ok(s.equippedRanged === "9mm Pistol", "soldier wields the pistol");
  ok(s.appearance?.color === 0x6b8e23, "appearance colour applied");
  ok(s.difficultyModifier < 1, `difficulty applied (${s.difficultyModifier.toFixed(2)})`);
  ok(getBackground("soldier")?.name === "Soldier", "getBackground resolves");

  // perk modifier helpers
  const ig = newGame("ig");
  ig.perks = ["iron_gut"];
  ok(decayMods(ig).hunger < 1 && decayMods(ig).thirst < 1, "Iron Gut slows hunger/thirst");
  const tg = newGame("tg");
  tg.perks = ["tough"];
  ok(damageTakenMult(tg, "physical") < 1, "Tough reduces physical damage");
  const fp = newGame("fp");
  fp.perks = ["fireproof"];
  ok(damageTakenMult(fp, "burn") < damageTakenMult(fp, "physical"), "Fireproof reduces burn most");
  const br = newGame("br");
  br.perks = ["brawler"];
  ok(meleeMult(br) > 1, "Brawler boosts melee");
  const mk = newGame("mk");
  mk.perks = ["marksman"];
  ok(rangedMult(mk) > 1, "Marksman boosts ranged");
  const fm = newGame("fm");
  fm.perks = ["field_medic"];
  ok(consumableMult(fm) > 1, "Field Medic boosts consumables");
  const lk = newGame("lk");
  lk.perks = ["lucky"];
  ok(lootLuck(lk) > 0, "Lucky adds loot bias");

  if (fail === 0) console.log("\nALL CHARACTER CHECKS PASSED");
  else {
    console.log(`\n${fail} CHARACTER CHECK(S) FAILED`);
    process.exit(1);
  }
}

main();
