// Enemy data layer: the 100+ zombie catalog + rarity/family/trait integrity + the
// day-gated, rarity-weighted spawn roller. Pure data — runs headless in Node.

import { ZOMBIES } from "../src/game/enemies/zombies";
import { getZombie, familyPool } from "../src/game/enemies/catalog";
import { rollZombie } from "../src/game/enemies/spawnTable";
import { MOVEMENTS, TRAITS, FAMILIES } from "../src/game/enemies/types";
import { RARITIES } from "../src/game/items/rarity";
import { createRng } from "../src/game/rng";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const LOOT_FAMILIES = new Set(["zombie", "zombie_runner", "survivor_hostile", "elite", "boss"]);
const ARCHETYPES = new Set([
  "humanoid", "bloated", "crawler", "brute", "lanky", "child", "hazmat",
  "spitter", "screamer", "husk", "armored", "toxic", "runner", "behemoth",
]);
const MOVESET = new Set<string>(MOVEMENTS);
const TRAITSET = new Set<string>(TRAITS);
const FAMSET = new Set<string>(FAMILIES);
const RARSET = new Set<string>(RARITIES);

function main(): void {
  ok(ZOMBIES.length >= 100, `>=100 zombie types (have ${ZOMBIES.length})`);

  const ids = new Set<string>();
  const names = new Set<string>();
  let dup = "";
  for (const z of ZOMBIES) {
    if (ids.has(z.id)) dup = z.id;
    if (names.has(z.name)) dup = z.name;
    ids.add(z.id);
    names.add(z.name);
  }
  ok(dup === "", `all zombie ids + names unique (${dup || "ok"})`);

  let bad = "";
  for (const z of ZOMBIES) {
    const valid =
      z.hp > 0 &&
      z.speed >= 0 &&
      z.aggro >= 0 &&
      z.damage >= 0 &&
      z.scale > 0 &&
      z.minDay >= 0 &&
      FAMSET.has(z.family) &&
      RARSET.has(z.rarity) &&
      MOVESET.has(z.movement) &&
      LOOT_FAMILIES.has(z.lootFamily) &&
      !!z.look &&
      ARCHETYPES.has(z.look.body) &&
      z.traits.every((t) => TRAITSET.has(t));
    if (!valid) {
      bad = z.name;
      break;
    }
  }
  ok(bad === "", `every zombie def valid (${bad || "ok"})`);

  // family-appropriate rolls
  const rng = createRng("spawn");
  ok(rollZombie("zombie_runner", rng, 5).family === "zombie_runner", "rollZombie(runner) -> runner family");
  ok(rollZombie("survivor_hostile", rng, 5).family === "survivor_hostile", "rollZombie(hostile) -> hostile family");
  ok(rollZombie("survivor_friendly", rng, 5).family === "survivor_friendly", "rollZombie(friendly) -> friendly family");
  ok(rollZombie("zombie", rng, 0).family === "zombie", "rollZombie(zombie) -> zombie family");

  // day gating: nothing above the day is ever rolled
  let gateOk = true;
  const r2 = createRng("gate");
  for (let i = 0; i < 500; i++) if (rollZombie("zombie", r2, 0).minDay > 0) gateOk = false;
  ok(gateOk, "day-0 rolls never return a minDay>0 type");

  // rarity weighting: commons dominate at day 0
  const r3 = createRng("weight");
  let common = 0;
  let rarePlus = 0;
  for (let i = 0; i < 2000; i++) {
    const z = rollZombie("zombie", r3, 0);
    if (z.rarity === "common") common++;
    else if (z.rarity === "rare" || z.rarity === "epic" || z.rarity === "legendary" || z.rarity === "mythic") rarePlus++;
  }
  ok(common > rarePlus, `commons dominate early-game spawns (${common} vs ${rarePlus})`);

  // deeper days unlock rarer/nastier types
  const r4 = createRng("deep");
  let nasty = 0;
  for (let i = 0; i < 800; i++) if (rollZombie("zombie", r4, 9).minDay >= 3) nasty++;
  ok(nasty > 0, "deep-day spawns include high-minDay specials");

  ok(!!getZombie("shambler"), "getZombie resolves a known id");
  ok(familyPool("boss").length >= 8, `boss pool populated (${familyPool("boss").length})`);

  if (fail === 0) console.log("\nALL ENEMY CHECKS PASSED");
  else {
    console.log(`\n${fail} ENEMY CHECK(S) FAILED`);
    process.exit(1);
  }
}

main();
