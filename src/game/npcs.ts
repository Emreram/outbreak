// Survivors, factions & barter (Feature 10b). Friendly survivors roam the safer
// edges of the world; you can TRADE with them (item-for-item barter), RECRUIT them as
// companions (they follow + fight), and your standing with their FACTION shifts with
// your actions. Hostile raiders are handled by the enemy system (survivor_hostile).
// Pure logic — the scene owns sprites, follow/fight AI, and the trade modal.

import type { GameState } from "../shared/contracts";
import type { Rng } from "./rng";
import { addItem, hasItem, removeItem } from "./inventory";
import { rollLoot } from "./items/lootTables";
import { defOf } from "./items/catalog";
import { rarityRank } from "./items/rarity";

export const FACTIONS = ["townsfolk", "wanderers", "scavengers"] as const;
export type Faction = (typeof FACTIONS)[number];

export const MAX_COMPANIONS = 2;

const NAMES = [
  "Mara", "Cole", "Dana", "Reese", "Iris", "Hollis", "June", "Tariq", "Nadia", "Otto",
  "Sasha", "Wes", "Priya", "Lena", "Diego", "Quinn", "Asha", "Boyd", "Cyrus", "Esme",
];

// What survivors will accept in barter (common staples), with a rough unit value.
const NEEDS = ["Canned Food", "Water Bottle", "Scrap Metal", "Cloth", "Ammo"] as const;

/** Which faction tends to hold a biome (friendly survivors). */
export function factionForBiome(biome: string): Faction {
  if (["suburb", "farmland", "school_campus", "parkland"].includes(biome)) return "townsfolk";
  if (["forest", "dense_woods", "grassland", "riverbank", "coast", "marsh"].includes(biome)) return "wanderers";
  return "scavengers"; // industrial / downtown / everywhere else
}

/** Loot source a faction's traders tend to stock. */
export function factionStock(faction: string): string {
  switch (faction) {
    case "townsfolk": return "grocery";
    case "wanderers": return "forest";
    default: return "hardware_store";
  }
}

export function npcName(rng: Rng): string {
  return rng.pick(NAMES);
}

/** A rough barter value for an item (rarity-driven, kind-weighted). */
export function itemValue(name: string): number {
  const d = defOf(name);
  const base = rarityRank(d.rarity) + 1; // 1..6+
  const kindMul = d.kind === "weapon" ? 3 : d.kind === "armor" ? 2.5 : d.kind === "ammo" ? 0.25 : 1;
  return Math.max(1, base * kindMul);
}

export interface TradeOffer {
  give: { item: string; qty: number }[];
  get: { item: string; qty: number };
}

/** Generate a survivor's barter offers: each gives a staple for something useful. */
export function generateOffers(rng: Rng, faction: string): TradeOffer[] {
  const offers: TradeOffer[] = [];
  const seen = new Set<string>();
  for (const stack of rollLoot(factionStock(faction), rng, 5, 0.1)) {
    if (seen.has(stack.item) || NEEDS.includes(stack.item as (typeof NEEDS)[number])) continue;
    seen.add(stack.item);
    const getVal = itemValue(stack.item) * stack.qty;
    const need = rng.pick(NEEDS);
    const qty = Math.min(6, Math.max(1, Math.round(getVal / itemValue(need))));
    offers.push({ give: [{ item: need, qty }], get: { item: stack.item, qty: stack.qty } });
    if (offers.length >= 4) break;
  }
  return offers;
}

export function canAccept(s: GameState, o: TradeOffer): boolean {
  return o.give.every((g) => hasItem(s, g.item, g.qty));
}

/** Execute a barter: take the player's staples, give the survivor's goods. */
export function acceptOffer(s: GameState, o: TradeOffer): boolean {
  if (!canAccept(s, o)) return false;
  for (const g of o.give) removeItem(s, g.item, g.qty);
  addItem(s, o.get.item, o.get.qty);
  return true;
}

// --- faction standing ----------------------------------------------------------

export function getStanding(s: GameState, faction: string): number {
  return s.factions?.[faction] ?? 0;
}

export function addStanding(s: GameState, faction: string, delta: number): number {
  s.factions = s.factions ?? {};
  const next = Math.max(-100, Math.min(100, (s.factions[faction] ?? 0) + delta));
  s.factions[faction] = next;
  return next;
}

export function standingLabel(v: number): string {
  if (v >= 60) return "allied";
  if (v >= 20) return "friendly";
  if (v > -20) return "neutral";
  if (v > -60) return "wary";
  return "hostile";
}

export function companionCount(s: GameState): number {
  return (s.npcs ?? []).filter((n) => n.kind === "companion").length;
}
