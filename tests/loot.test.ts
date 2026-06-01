// Phase 1 — loot data layer: the weapon catalog, rarity, item defs and loot tables.
// Pure data/logic, runs headless in Node (no DOM/canvas/WebGPU).

import { WEAPONS } from "../src/game/items/weapons";
import { allItems, getItemDef, isWeaponName, ammoItemForType } from "../src/game/items/catalog";
import { isWeaponDef } from "../src/game/items/types";
import { RARITIES, RARITY_META, rollRarity } from "../src/game/items/rarity";
import { AMMO } from "../src/game/items/ammo";
import { rollLoot } from "../src/game/items/lootTables";
import { createRng } from "../src/game/rng";
import { meleeOutcome, shotOutcome } from "../src/game/combat";
import { addItem, equipWeapon, equippedMeleeDef } from "../src/game/inventory";
import { newGame } from "../src/game/GameState";
import { applyOutcome, sanitizeGM } from "../src/game/outcomes";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

function main(): void {
  // --- catalog size + uniqueness ---
  ok(WEAPONS.length >= 200, `>=200 weapons (have ${WEAPONS.length})`);

  const items = allItems();
  const names = new Set<string>();
  const ids = new Set<string>();
  let dupName = "";
  let dupId = "";
  for (const d of items) {
    if (names.has(d.name)) dupName = d.name;
    if (ids.has(d.id)) dupId = d.id;
    names.add(d.name);
    ids.add(d.id);
  }
  ok(dupName === "", `all item names unique (${dupName || "ok"})`);
  ok(dupId === "", `all item ids unique (${dupId || "ok"})`);

  // --- every weapon is well-formed ---
  let badWeapon = "";
  for (const w of WEAPONS) {
    const valid =
      w.damage > 0 &&
      w.range > 0 &&
      w.cooldownMs > 0 &&
      typeof w.icon === "string" &&
      w.icon.length > 0 &&
      (RARITIES as readonly string[]).includes(w.rarity) &&
      (w.hand === "ranged"
        ? !!w.ammoType && (w.magSize ?? 0) > 0 && (w.reloadMs ?? 0) > 0 && (w.projectileSpeed ?? 0) > 0
        : w.ammoType === undefined);
    if (!valid) {
      badWeapon = w.name;
      break;
    }
  }
  ok(badWeapon === "", `every weapon valid (${badWeapon || "ok"})`);

  // --- every item has a rarity + icon ---
  let badItem = "";
  for (const d of items) {
    if (!(RARITIES as readonly string[]).includes(d.rarity) || !d.icon) {
      badItem = d.name;
      break;
    }
  }
  ok(badItem === "", `every item has rarity + icon (${badItem || "ok"})`);

  // --- ammo wiring: every ranged weapon resolves to a real ammo item ---
  let badAmmo = "";
  for (const w of WEAPONS) {
    if (w.hand !== "ranged") continue;
    const itemName = ammoItemForType(w.ammoType);
    const def = itemName ? getItemDef(itemName) : undefined;
    if (!def || def.kind !== "ammo" || def.ammoType !== w.ammoType) {
      badAmmo = `${w.name} -> ${w.ammoType}`;
      break;
    }
  }
  ok(badAmmo === "", `every ranged weapon has matching ammo (${badAmmo || "ok"})`);
  ok(AMMO.length >= 10, `>=10 ammo types (have ${AMMO.length})`);

  // --- rarity weights positive + strictly decreasing by rank ---
  let weightsOk = true;
  for (let i = 1; i < RARITIES.length; i++) {
    const prev = RARITY_META[RARITIES[i - 1]].weight;
    const cur = RARITY_META[RARITIES[i]].weight;
    if (cur <= 0 || cur >= prev) weightsOk = false;
  }
  ok(weightsOk, "rarity weights positive + decreasing by rank");

  // --- rollRarity distribution: common dominates ---
  const rng = createRng("dist");
  const counts: Record<string, number> = {};
  for (let i = 0; i < 4000; i++) {
    const r = rollRarity(rng);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  ok((counts.common ?? 0) > (counts.rare ?? 0), "common rolls more than rare");
  ok((counts.mythic ?? 0) < (counts.common ?? 0), "mythic is the rarest");

  // --- scarcity: rare+ tiers are genuinely uncommon at base bias ---
  const rsc = createRng("scarcity");
  let rarePlus = 0;
  const N = 8000;
  for (let i = 0; i < N; i++) {
    const r = rollRarity(rsc);
    if (r === "rare" || r === "epic" || r === "legendary" || r === "mythic") rarePlus++;
  }
  ok(rarePlus / N < 0.15, `rare+ loot is scarce at base bias (${((rarePlus / N) * 100).toFixed(1)}% < 15%)`);

  // --- rollLoot determinism ---
  const a = rollLoot("police_station", createRng("seed-1"), 5);
  const b = rollLoot("police_station", createRng("seed-1"), 5);
  ok(JSON.stringify(a) === JSON.stringify(b), "rollLoot is deterministic per seed");

  // --- rollLoot returns only real catalog items with qty>0 ---
  let badLoot = "";
  const r2 = createRng("loot-validity");
  for (let i = 0; i < 300; i++) {
    const src = ["pharmacy", "police_station", "chest:2", "enemy:zombie", "military", "house"][i % 6];
    for (const s of rollLoot(src, r2, 2)) {
      if (!getItemDef(s.item) || s.qty <= 0) {
        badLoot = `${src}:${s.item}x${s.qty}`;
        break;
      }
    }
    if (badLoot) break;
  }
  ok(badLoot === "", `loot rolls return valid catalog stacks (${badLoot || "ok"})`);

  // --- source bias: military yields far more guns than grocery ---
  const isGun = (name: string) => {
    const d = getItemDef(name);
    return !!d && isWeaponDef(d) && d.hand === "ranged";
  };
  const countGuns = (src: string, seed: string) => {
    const r = createRng(seed);
    let g = 0;
    for (let i = 0; i < 600; i++) for (const s of rollLoot(src, r, 1)) if (isGun(s.item)) g++;
    return g;
  };
  const milGuns = countGuns("military", "mil");
  const groGuns = countGuns("grocery", "gro");
  ok(milGuns > groGuns + 50, `military drops more guns than grocery (${milGuns} vs ${groGuns})`);

  // --- biome ids route to valid loot tables (street/open encounters) ---
  let badBiomeLoot = "";
  const r3 = createRng("biome-loot");
  for (const src of ["forest", "farmland", "downtown", "military_base", "lake", "warehouse", "barn"]) {
    for (let i = 0; i < 60; i++) {
      for (const s of rollLoot(src, r3, 2)) {
        if (!getItemDef(s.item) || s.qty <= 0) badBiomeLoot = `${src}:${s.item}`;
      }
    }
  }
  ok(badBiomeLoot === "", `biome/building sources yield valid loot (${badBiomeLoot || "ok"})`);
  // military_base routes to the military table → far more guns than farmland.
  const milBiomeGuns = countGuns("military_base", "mb");
  const farmGuns = countGuns("farmland", "fl");
  ok(milBiomeGuns > farmGuns, `military_base biome out-guns farmland (${milBiomeGuns} vs ${farmGuns})`);

  // --- weapon boost: improvised melee turns up even where there's no weapon table ---
  const wf = createRng("weapon-floor");
  let groceryMelee = 0;
  for (let i = 0; i < 600; i++)
    for (const s of rollLoot("grocery", wf, 1)) {
      const d = getItemDef(s.item);
      if (d && isWeaponDef(d) && d.hand === "melee") groceryMelee++;
    }
  ok(groceryMelee > 0, `improvised melee turns up even in groceries (${groceryMelee})`);

  // --- ...but OP loot stays rare: legendary+ is a tiny slice of all drops ---
  const op = createRng("op-scarce");
  let totalStacks = 0;
  let legendaryPlus = 0;
  for (let i = 0; i < 4000; i++) {
    const src = ["house", "police_station", "military", "hardware_store", "gas_station"][i % 5];
    for (const s of rollLoot(src, op, 1)) {
      totalStacks++;
      const r = getItemDef(s.item)?.rarity;
      if (r === "legendary" || r === "mythic") legendaryPlus++;
    }
  }
  ok(
    totalStacks > 0 && legendaryPlus / totalStacks < 0.05,
    `legendary+ stays rare after the weapon boost (${((legendaryPlus / totalStacks) * 100).toFixed(2)}% < 5%)`,
  );

  // --- isWeaponName sanity ---
  ok(isWeaponName("Katana") && !isWeaponName("Bandage"), "isWeaponName classifies correctly");

  // --- equip + melee combat math ---
  const st = newGame("combat");
  addItem(st, "Sledgehammer", 1);
  ok(equipWeapon(st, "Sledgehammer"), "equip a melee weapon");
  ok(equippedMeleeDef(st).name === "Sledgehammer", "equipped melee resolves to the catalog def");
  const hit = meleeOutcome(st, createRng("hit"));
  ok(hit.damage >= 9 && hit.knockback > 0, "sledgehammer hit carries damage + knockback");
  const fistHit = meleeOutcome(newGame("bare"), createRng("f"));
  ok(fistHit.damage === 1, "fists fall back to 1 damage when unarmed");

  // --- ranged equip auto-reloads from reserve ---
  const g = newGame("gun");
  addItem(g, "9mm Pistol", 1);
  addItem(g, "9mm Rounds", 30);
  ok(equipWeapon(g, "9mm Pistol"), "equip a gun");
  ok((g.loadedAmmo ?? 0) === 12, "gun auto-reloads its magazine on equip (12)");
  addItem(g, "Pump Shotgun", 1);
  addItem(g, "Shotgun Shells", 12);
  equipWeapon(g, "Pump Shotgun");
  const shot = shotOutcome(g, createRng("s"));
  ok(!!shot && shot.pellets > 1, "shotgun fires multiple pellets per shot");

  // --- a GM-removed equipped weapon gets unequipped (consistency) ---
  const rm = newGame("rm");
  addItem(rm, "Katana", 1);
  equipWeapon(rm, "Katana");
  applyOutcome(rm, sanitizeGM({ inventory_remove: [{ item: "Katana", qty: 1 }] }));
  ok(rm.equippedMelee === undefined, "removing an equipped weapon unequips it");

  if (fail === 0) console.log("\nALL LOOT CHECKS PASSED");
  else {
    console.log(`\n${fail} LOOT CHECK(S) FAILED`);
    process.exit(1);
  }
}

main();
