import type { EnemyFamily, ZombieDef } from "./types";
import type { Rng } from "../rng";
import type { Rarity } from "../items/types";
import { rarityRank } from "../items/rarity";
import { ZOMBIES } from "./zombies";
import { familyPool } from "./catalog";
import { affinityFor, affinityMult, type BiomeAffinity } from "./biomeSpawns";

// Rarity-weighted, day-gated spawn selection. Common walkers still lead the calm
// early game, but the curve is deliberately FLATTER than the loot rarity curve so
// the full roster of 100+ types actually shows up: the rarer (and most visually
// distinct) types surface often enough that the streets stop feeling monotonous.
// A short anti-repeat memory further guarantees back-to-back spawns vary even
// within a single tier.

const UNDEAD = ZOMBIES.filter((z) => z.family === "zombie");

// Enemy spawn weights — much gentler than RARITY_META (which is tuned for loot
// scarcity). Variety-forward: every tier is a meaningful fraction of spawns instead
// of commons swamping everything. Commons still lead, but a rare special is a real
// possibility, not a once-an-hour event.
const SPAWN_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 70,
  rare: 40,
  epic: 18,
  legendary: 7,
  mythic: 3,
};

function weightFor(z: ZombieDef, day: number): number {
  const base = SPAWN_WEIGHT[z.rarity];
  const dayBoost = Math.pow(1 + day * 0.06, rarityRank(z.rarity)); // later days -> rarer
  return base * dayBoost;
}

// --- anti-repeat memory --------------------------------------------------------
// Remember the last few spawned ids and down-weight them so the player doesn't see
// the same zombie three times in a row. This is a live (non-seeded) presentation
// concern; reset it at the start of each run via resetSpawnVariety().
const RECENT_MAX = 6;
const recent: string[] = [];

/** Clear the recent-spawn memory (call when a new run begins). */
export function resetSpawnVariety(): void {
  recent.length = 0;
}

/** Penalty multiplier for a type seen recently: 0.3x for the just-spawned type,
 *  easing back toward 1 for the oldest entry in the window, 1 if not seen at all. */
function antiRepeat(id: string): number {
  const i = recent.lastIndexOf(id);
  if (i < 0) return 1;
  const recency = (i + 1) / recent.length; // ~1 newest .. ~1/len oldest
  return 1 - 0.7 * recency;
}

function remember(id: string): void {
  recent.push(id);
  if (recent.length > RECENT_MAX) recent.shift();
}

function pickWeighted(pool: ZombieDef[], rng: Rng, day: number, aff?: BiomeAffinity): ZombieDef | undefined {
  const eligible = pool.filter((z) => z.minDay <= day);
  const use = eligible.length ? eligible : pool;
  if (use.length === 0) return undefined;
  const weights = use.map((z) => weightFor(z, day) * antiRepeat(z.id) * affinityMult(z, aff));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  let chosen = use[use.length - 1];
  for (let i = 0; i < use.length; i++) {
    x -= weights[i];
    if (x <= 0) {
      chosen = use[i];
      break;
    }
  }
  remember(chosen.id);
  return chosen;
}

/** Roll a specific zombie for a GM family, biased by the local biome (Living World).
 *  "zombie" pulls the whole undead pool; in feral biomes it may upgrade to a runner. */
export function rollZombie(family: EnemyFamily, rng: Rng, day = 0, biome?: string): ZombieDef {
  const aff = affinityFor(biome);
  if (family === "zombie" && aff?.runnerBias && rng.chance(aff.runnerBias)) family = "zombie_runner";
  const pool = family === "zombie" ? UNDEAD : familyPool(family);
  return pickWeighted(pool, rng, day, aff) ?? UNDEAD[0] ?? ZOMBIES[0];
}

/** Ambient spawn — mostly undead (biome-biased), with a small chance to upgrade to a boss on deeper days. */
export function rollAmbientUndead(rng: Rng, day = 0, biome?: string): ZombieDef {
  if (day >= 4 && rng.chance(0.03 + day * 0.004)) {
    const bosses = familyPool("boss").filter((b) => b.minDay <= day);
    if (bosses.length) return rng.pick(bosses);
  }
  return rollZombie("zombie", rng, day, biome);
}
