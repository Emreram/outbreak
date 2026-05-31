import type { EnemyFamily, ZombieDef } from "./types";
import type { Rng } from "../rng";
import { RARITY_META, rarityRank } from "../items/rarity";
import { ZOMBIES } from "./zombies";
import { familyPool } from "./catalog";

// Rarity-weighted, day-gated spawn selection. Common walkers dominate early; rarer
// and nastier types gain weight (and become eligible via minDay) as the days pass.

const UNDEAD = ZOMBIES.filter((z) => z.family === "zombie");

function weightFor(z: ZombieDef, day: number): number {
  const base = RARITY_META[z.rarity].weight;
  const dayBoost = Math.pow(1 + day * 0.06, rarityRank(z.rarity)); // later days -> rarer
  return base * dayBoost;
}

function pickWeighted(pool: ZombieDef[], rng: Rng, day: number): ZombieDef | undefined {
  const eligible = pool.filter((z) => z.minDay <= day);
  const use = eligible.length ? eligible : pool;
  if (use.length === 0) return undefined;
  const weights = use.map((z) => weightFor(z, day));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < use.length; i++) {
    x -= weights[i];
    if (x <= 0) return use[i];
  }
  return use[use.length - 1];
}

/** Roll a specific zombie for a GM family. "zombie" pulls the whole undead pool. */
export function rollZombie(family: EnemyFamily, rng: Rng, day = 0): ZombieDef {
  const pool = family === "zombie" ? UNDEAD : familyPool(family);
  return pickWeighted(pool, rng, day) ?? UNDEAD[0] ?? ZOMBIES[0];
}

/** Ambient spawn — mostly undead, with a small chance to upgrade to a boss on deeper days. */
export function rollAmbientUndead(rng: Rng, day = 0): ZombieDef {
  if (day >= 4 && rng.chance(0.03 + day * 0.004)) {
    const bosses = familyPool("boss").filter((b) => b.minDay <= day);
    if (bosses.length) return rng.pick(bosses);
  }
  return rollZombie("zombie", rng, day);
}
