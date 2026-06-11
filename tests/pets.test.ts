// Tamable pets (Companions & Spectacle PR-A): catalog integrity (diets are REAL
// items, stats in sane bands, every species has a drawer), wild-spawn gating and
// determinism, tame-chance math, bond scaling, roster mutations, and a save/load
// round-trip of the roster.

import {
  PETS, PET_IDS, getPetDef, isRideable, bondedSpeed, bondedDamage, tameChance, baitFor,
  rollWildPet, denSpecies, hatchSpecies, addPet, setActivePet, removePet, feedPet, activePet,
  MAX_PET_ROSTER, RIDE_MIN_SPEED,
} from "../src/game/pets";
import { petSpriteIds } from "../src/engine/petSprites";
import { getItemDef } from "../src/game/items/catalog";
import { RARITY_META, RARITIES } from "../src/game/items/rarity";
import { newGame, saveGame, loadGame, clearSave } from "../src/game/GameState";
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

// --- catalog integrity ---------------------------------------------------------
{
  ok(PET_IDS.length >= 20, `a real menagerie (${PET_IDS.length} species)`);
  let bad = "";
  for (const def of Object.values(PETS)) {
    const dietReal = def.diet.length > 0 && def.diet.every((d) => getItemDef(d) !== undefined);
    const statsSane = def.hp > 0 && def.speed > 0 && def.speed <= 3.5 && def.damage > 0 && def.staminaMax > 0;
    const tameSane = def.tameP > 0 && def.tameP <= 1;
    const raritySane = (RARITIES as readonly string[]).includes(def.rarity);
    if (!dietReal) bad = `${def.id}: diet has a fake item`;
    else if (!statsSane) bad = `${def.id}: stats out of band`;
    else if (!tameSane) bad = `${def.id}: tameP out of (0,1]`;
    else if (!raritySane) bad = `${def.id}: bad rarity`;
    if (bad) break;
  }
  ok(bad === "", `every species valid (${bad || "ok"})`);

  // mythics are the hardest to win; commons the easiest (monotone-ish by tier)
  const meanP = (r: string) => {
    const pool = Object.values(PETS).filter((p) => p.rarity === r);
    return pool.reduce((a, p) => a + p.tameP, 0) / Math.max(1, pool.length);
  };
  ok(meanP("common") > meanP("epic") && meanP("epic") > meanP("mythic"), "tame odds fall with rarity");

  // movement classes all represented + fantasy lives at the top tiers
  const moves = new Set(Object.values(PETS).map((p) => p.move));
  ok(moves.has("ground") && moves.has("fly") && moves.has("swim"), "ground + fly + swim all exist");
  const fantasy = ["griffin", "kelpie", "unicorn", "dragonling", "phoenix", "ancient_dragon", "tide_serpent", "nightmare"];
  ok(fantasy.every((id) => PETS[id] && RARITY_META[PETS[id].rarity].rank >= 3), "fantasy species sit at epic+");
  ok(Object.values(PETS).some((p) => isRideable(p)) && !isRideable(PETS.cat), `rideability gates on speed ≥ ${RIDE_MIN_SPEED}`);
}

// --- every species has a sprite drawer (and wings where it flies) ---------------
{
  const drawn = new Set(petSpriteIds());
  const missing = PET_IDS.filter((id) => !drawn.has(id));
  ok(missing.length === 0, `every species has a drawer${missing.length ? " — MISSING: " + missing.join(",") : ""}`);
}

// --- wild spawn gating + determinism --------------------------------------------
{
  // epic+ never ambient, whatever the biome/day
  let leaked = "";
  for (const biome of ["forest", "grassland", "suburb", "marsh", "farmland", "downtown"]) {
    const rng = createRng("wild:" + biome);
    for (let i = 0; i < 400; i++) {
      const d = rollWildPet(rng, biome, 12);
      if (d && RARITY_META[d.rarity].rank >= 3) leaked = `${biome}:${d.id}`;
    }
  }
  ok(leaked === "", `epic+ never spawns ambient (${leaked || "ok"})`);

  // rares wait until day 2
  const rng0 = createRng("day0");
  let earlyRare = false;
  for (let i = 0; i < 400; i++) {
    const d = rollWildPet(rng0, "forest", 0);
    if (d && RARITY_META[d.rarity].rank === 2) earlyRare = true;
  }
  ok(!earlyRare, "rares hold off until day 2");

  ok(rollWildPet(createRng("det"), "suburb", 1)?.id === rollWildPet(createRng("det"), "suburb", 1)?.id, "rollWildPet deterministic per rng");
  ok(rollWildPet(createRng("x"), "ocean", 5) === null, "no wild pets where nothing lives");

  // dens always produce an epic+ wonder, deterministically
  const a = denSpecies(createRng("seed:denpet:4:5"));
  const b = denSpecies(createRng("seed:denpet:4:5"));
  ok(a.id === b.id && RARITY_META[a.rarity].rank >= 3, `dens wake epic+ residents deterministically (${a.id})`);

  // eggs hatch their own rarity
  ok(hatchSpecies(createRng("egg1"), "legendary").rarity === "legendary", "eggs hatch their printed rarity");
}

// --- tame math -------------------------------------------------------------------
{
  const wolf = getPetDef("wolf")!;
  ok(tameChance(wolf, "Raw Meat") === wolf.tameP, "right bait = full odds");
  ok(tameChance(wolf, "Cooked Meat") > wolf.tameP, "cooked upgrade charms harder");
  ok(tameChance(wolf, "Carrot") === 0, "wrong food never works");
  ok(baitFor(wolf, (i) => i === "Cooked Meat") === "Cooked Meat", "baitFor finds the held diet item");
  ok(baitFor(wolf, () => false) === null, "no bait when the pack is empty");
  ok(bondedSpeed(wolf, 5) > bondedSpeed(wolf, 0), "bond raises speed");
  ok(bondedDamage(wolf, 5) >= bondedDamage(wolf, 0), "bond raises damage");
}

// --- roster mutations + persistence ----------------------------------------------
{
  const s = newGame("pets");
  const first = addPet(s, "stray_dog");
  ok(!!first && first.active === true, "first tame becomes the active companion");
  const second = addPet(s, "cat");
  ok(!!second && !second.active, "later tames go to the stable");
  ok(activePet(s)?.id === first!.id, "activePet resolves the companion");
  setActivePet(s, second!.id);
  ok(activePet(s)?.id === second!.id && !s.pets!.find((p) => p.id === first!.id)?.active, "setActivePet swaps exclusively");

  const before = second!.hp;
  second!.hp = 1;
  feedPet(second!);
  ok(second!.hp > 1 && second!.bond > 0, "feeding heals + bonds");
  void before;

  for (let i = 0; i < MAX_PET_ROSTER + 2; i++) addPet(s, "goat");
  ok((s.pets ?? []).length <= MAX_PET_ROSTER, `roster caps at ${MAX_PET_ROSTER}`);

  removePet(s, first!.id);
  ok(!s.pets!.some((p) => p.id === first!.id), "release removes the record");

  saveGame(s);
  const loaded = loadGame();
  ok(loaded !== null && JSON.stringify(loaded.pets) === JSON.stringify(s.pets) && loaded.petCounter === s.petCounter, "roster survives save/load");
  clearSave();

  const old = newGame("old");
  ok(old.pets === undefined && activePet(old) === undefined, "old saves without pets stay valid");
}

console.log(fail === 0 ? "ALL PET CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
