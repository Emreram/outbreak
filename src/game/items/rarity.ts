import type { Rarity } from "./types";
import type { Rng } from "../rng";

// Six rarity tiers shared by weapons, ammo, consumables and materials. Weights
// drive drop chance; rank/colour drive visuals (icons, glows, tooltips, toasts).

export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export interface RarityMeta {
  label: string;
  color: number; // Phaser tint
  css: string; // DOM colour
  glow: number;
  weight: number; // base drop weight (higher = more common)
  rank: number; // 0..5
}

export const RARITY_META: Record<Rarity, RarityMeta> = {
  common: { label: "Common", color: 0xb8c0c8, css: "#b8c0c8", glow: 0x6b7480, weight: 1000, rank: 0 },
  uncommon: { label: "Uncommon", color: 0x5ed66e, css: "#5ed66e", glow: 0x2f8f3c, weight: 420, rank: 1 },
  rare: { label: "Rare", color: 0x4aa3ff, css: "#4aa3ff", glow: 0x1d62c4, weight: 170, rank: 2 },
  epic: { label: "Epic", color: 0xb368ff, css: "#b368ff", glow: 0x7a2fcf, weight: 60, rank: 3 },
  legendary: { label: "Legendary", color: 0xffa23f, css: "#ffa23f", glow: 0xc7641a, weight: 18, rank: 4 },
  mythic: { label: "Mythic", color: 0xff5a6e, css: "#ff5a6e", glow: 0xc41d3a, weight: 4, rank: 5 },
};

export function rarityRank(r: Rarity): number {
  return RARITY_META[r].rank;
}

export function rarityColor(r: Rarity): number {
  return RARITY_META[r].color;
}

export function rarityCss(r: Rarity): string {
  return RARITY_META[r].css;
}

/**
 * Roll a rarity. `bias` >0 shifts the distribution toward rarer tiers (better
 * loot sources / deeper risk); 0 is the base distribution.
 */
export function rollRarity(rng: Rng, bias = 0): Rarity {
  const weights = RARITIES.map((r) => RARITY_META[r].weight * Math.pow(1 + Math.max(0, bias), RARITY_META[r].rank));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < RARITIES.length; i++) {
    x -= weights[i];
    if (x <= 0) return RARITIES[i];
  }
  return "common";
}
