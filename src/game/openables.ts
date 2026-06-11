// Openables (Companions & Spectacle PR-C): the pure logic behind sealed caches
// and pet eggs, plus the routing rule for the tiered loot ceremony. The scene
// owns the DOM ceremony (ui/LootReveal.ts) and the actual item/roster mutation —
// everything here is deterministic and Phaser-free so the tests can bite.

import { getItemDef } from "./items/catalog";
import type { OpenableDef } from "./items/types";
import { hatchSpecies, type PetDef } from "./pets";
import { createRng } from "./rng";
import type { GameState } from "../shared/contracts";

export function openableDef(name: string): OpenableDef | undefined {
  const d = getItemDef(name);
  return d?.kind === "openable" ? d : undefined;
}

/** Tiered ceremony routing (user-approved): commons stay a quick pop; tier-2+
 *  chests and anything locked earn the full reveal. */
export function deservesCeremony(tier: number, locked: boolean): boolean {
  return tier >= 2 || locked;
}

/** Egg-bonus odds for a freshly opened chest: only the best containers ever
 *  hold one (tier 3 = 3%, tier 4 = 8%), and locked stock is no luckier. */
export function chestEggChance(tier: number): number {
  return tier >= 4 ? 0.08 : tier >= 3 ? 0.03 : 0;
}

/** Which egg a chest of this tier hides (rolled only after chestEggChance hits). */
export function chestEggName(tier: number, roll: number): string {
  if (tier >= 4) return roll < 0.25 ? "Gilded Egg" : "Marbled Egg";
  return roll < 0.3 ? "Marbled Egg" : "Spotted Egg";
}

/** The species an egg hatches — rolled off the PERSISTED pet counter, so the
 *  outcome is fixed the moment the egg is opened-next: reloading before opening
 *  re-rolls nothing (no save-scum), and consecutive eggs hatch differently. */
export function hatchFromEgg(seed: string, petCounter: number, def: OpenableDef): PetDef {
  const rarity = def.eggRarity ?? "uncommon";
  return hatchSpecies(createRng(`${seed}:egg:${petCounter + 1}:${def.id}`), rarity);
}

/** Convenience over GameState (the scene's call site). */
export function hatchPreview(s: GameState, def: OpenableDef): PetDef {
  return hatchFromEgg(s.seed, s.petCounter ?? 0, def);
}
