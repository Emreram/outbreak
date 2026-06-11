// Openables + loot ceremony (Companions & Spectacle PR-C): cache/egg defs
// resolve and open REAL loot sources, the tiered-ceremony routing rule, egg
// hatching determinism (persisted-counter seed = no save-scum) and rarity
// fidelity, and the no-recursion rule (random loot never rolls an openable).

import { getItemDef } from "../src/game/items/catalog";
import { rollLoot } from "../src/game/items/lootTables";
import { RARITY_META } from "../src/game/items/rarity";
import {
  openableDef, deservesCeremony, chestEggChance, chestEggName, hatchFromEgg,
} from "../src/game/openables";
import { PETS } from "../src/game/pets";
import { createRng } from "../src/game/rng";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
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

// --- defs resolve + open real sources --------------------------------------------
{
  const names = ["Supply Cache", "Military Cache", "Spotted Egg", "Marbled Egg", "Gilded Egg", "Mythic Egg"];
  ok(names.every((n) => openableDef(n) !== undefined), "every cache/egg resolves as an openable");
  ok(openableDef("Bandage") === undefined, "ordinary items are not openable");

  for (const n of ["Supply Cache", "Military Cache"]) {
    const def = openableDef(n)!;
    ok(typeof def.opens === "string" && !def.eggRarity, `${n} opens a loot source`);
    // duplicate rolls merge into one stack, so entry count is 1..5 — every name must be real
    const rolls = rollLoot(def.opens!, createRng("open:" + n), 5, 0.4);
    ok(rolls.length >= 1 && rolls.length <= 5 && rolls.every((s) => getItemDef(s.item) !== undefined), `${n} rolls real items from "${def.opens}" (${rolls.length} stacks)`);
  }
  for (const n of ["Spotted Egg", "Marbled Egg", "Gilded Egg", "Mythic Egg"]) {
    const def = openableDef(n)!;
    ok(def.eggRarity === def.rarity && !def.opens, `${n} hatches its printed rarity`);
  }
}

// --- random loot can never roll an openable (no cache-in-a-cache) -------------------
{
  let leaked = "";
  for (const src of ["chest:0", "chest:2", "chest:3", "chest:4", "military", "house", "police_station"]) {
    const rng = createRng("leak:" + src);
    for (let i = 0; i < 200; i++) {
      for (const s of rollLoot(src, rng, 3, 1.5)) {
        if (getItemDef(s.item)?.kind === "openable") leaked = `${src}:${s.item}`;
      }
    }
  }
  ok(leaked === "", `openables never random-roll (${leaked || "ok"})`);
}

// --- tiered ceremony routing ----------------------------------------------------------
{
  ok(!deservesCeremony(0, false) && !deservesCeremony(1, false), "common containers stay a quick pop");
  ok(deservesCeremony(2, false) && deservesCeremony(4, false), "tier-2+ earns the full reveal");
  ok(deservesCeremony(0, true), "anything locked earns the full reveal");
}

// --- chest egg odds --------------------------------------------------------------------
{
  ok(chestEggChance(0) === 0 && chestEggChance(2) === 0, "ordinary chests never hold eggs");
  ok(chestEggChance(3) === 0.03 && chestEggChance(4) === 0.08, "only the best containers gamble an egg");
  ok(chestEggName(3, 0.9) === "Spotted Egg" && chestEggName(3, 0.1) === "Marbled Egg", "tier-3 eggs skew humble");
  ok(chestEggName(4, 0.9) === "Marbled Egg" && chestEggName(4, 0.1) === "Gilded Egg", "tier-4 eggs skew gilded");
  ok([chestEggName(3, 0.5), chestEggName(4, 0.5)].every((n) => openableDef(n) !== undefined), "rolled egg names are real items");
}

// --- egg hatching: deterministic, rarity-true, counter-advanced -------------------------
{
  const def = openableDef("Gilded Egg")!;
  const a = hatchFromEgg("seedA", 4, def);
  const b = hatchFromEgg("seedA", 4, def);
  ok(a.id === b.id, "same seed + counter → same hatch (reload can't re-roll)");
  ok(a.rarity === "epic", `gilded egg hatches an epic (${a.id})`);

  const c = hatchFromEgg("seedA", 5, def);
  ok(PETS[c.id] !== undefined, "hatched species is a real pet");
  // different counters explore the pool — over a few counters, more than one species
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) seen.add(hatchFromEgg("seedA", i, def).id);
  ok(seen.size > 1, `consecutive eggs vary (${[...seen].join(", ")})`);

  const mythic = hatchFromEgg("seedB", 0, openableDef("Mythic Egg")!);
  ok(RARITY_META[mythic.rarity].rank === 5, `mythic egg hatches a mythic (${mythic.id})`);
  const spotted = hatchFromEgg("seedB", 0, openableDef("Spotted Egg")!);
  ok(spotted.rarity === "uncommon", `spotted egg hatches an uncommon (${spotted.id})`);
}

console.log(fail === 0 ? "ALL OPENABLE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
