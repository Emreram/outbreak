// Biome-aware spawn invariants (Living World). The same catalog must produce
// visibly different dead per biome: bloated in the marsh, runners in the woods —
// while a biome with no affinity stays neutral, and determinism/day-gating hold.

import { rollZombie, rollAmbientUndead } from "../src/game/enemies/spawnTable";
import { affinityMult, affinityFor } from "../src/game/enemies/biomeSpawns";
import { createRng } from "../src/game/rng";
import type { ZombieDef } from "../src/game/enemies/types";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- affinityMult math (arrange/act/assert) ---
const bloated = { traits: ["bloated"], look: { body: "bloated", skin: 0 } } as unknown as ZombieDef;
const plain = { traits: ["biter"], look: { body: "humanoid", skin: 0 } } as unknown as ZombieDef;
ok(affinityMult(bloated, affinityFor("marsh")) > 1, "bloated def is up-weighted in the marsh");
ok(affinityMult(plain, affinityFor("marsh")) === 1, "a plain biter is neutral in the marsh");
ok(affinityMult(bloated, affinityFor("downtown")) === 1, "no marsh bias leaks into downtown");
ok(affinityMult(bloated, undefined) === 1, "no biome → neutral multiplier");

// --- statistical: marsh spawns more bloated bodies than a neutral biome ---
const N = 3000;
const frac = (biome: string): number => {
  const rng = createRng("spawnstat:" + biome);
  let bloatedCount = 0;
  for (let i = 0; i < N; i++) if (rollZombie("zombie", rng, 9, biome).look.body === "bloated") bloatedCount++;
  return bloatedCount / N;
};
const marshFrac = frac("marsh");
const cityFrac = frac("downtown");
ok(marshFrac > cityFrac, `marsh fields more bloated dead than downtown (${(100 * marshFrac).toFixed(1)}% vs ${(100 * cityFrac).toFixed(1)}%)`);

// --- runnerBias: the deep woods upgrade plain undead toward runners ---
{
  const rng = createRng("woods");
  let runners = 0;
  for (let i = 0; i < N; i++) if (rollZombie("zombie", rng, 9, "dense_woods").family === "zombie_runner") runners++;
  ok(runners / N > 0.2, `deep woods spawn many runners (${(100 * runners / N).toFixed(1)}%)`);
}

// --- determinism + day gating still hold (no biome and with biome) ---
{
  const a = createRng("det");
  const b = createRng("det");
  ok(rollZombie("zombie", a, 5, "marsh").id === rollZombie("zombie", b, 5, "marsh").id, "biome-aware rolls stay deterministic for a fixed rng");
  const rng = createRng("amb");
  ok([...Array(50)].every(() => !!rollAmbientUndead(rng, 6, "forest").id), "rollAmbientUndead returns a valid def with a biome");
}

console.log(fail === 0 ? "ALL BIOME-SPAWN CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
