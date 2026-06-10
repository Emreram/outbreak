// Survivors, factions & barter (Feature 10b). Friendly survivors roam the safer
// edges of the world; you can TRADE with them (item-for-item barter), RECRUIT them as
// companions (they follow + fight), and your standing with their FACTION shifts with
// your actions. Hostile raiders are handled by the enemy system (survivor_hostile).
// Pure logic — the scene owns sprites, follow/fight AI, and the trade modal.

import type { GameState } from "../shared/contracts";
import { createRng, type Rng } from "./rng";
import { addItem, hasItem, removeItem } from "./inventory";
import { rollLoot } from "./items/lootTables";
import { defOf } from "./items/catalog";
import { rarityRank } from "./items/rarity";

export const FACTIONS = ["townsfolk", "wanderers", "scavengers"] as const;
export type Faction = (typeof FACTIONS)[number];

export const MAX_COMPANIONS = 2;

// --- survivor quality tiers (Batch E) -----------------------------------------
// Tiers scale a survivor's toughness, fighting strength, barter quality, and what
// it costs (supplies + standing) to recruit them. A visible tint + name-tag cues it.

export type NpcTier = "poor" | "average" | "prime";

export interface TierMeta {
  hpMul: number; // scales spawn hp/maxHp (engine reads hp/maxHp)
  dmgMul: number; // scales companion melee damage (scene applies)
  offerBias: number; // extra loot bias on their barter goods (prime → rarer/better)
  recruitMul: number; // scales the recruit supply bundle
  standingReq: number; // min faction standing to recruit
  maxOffers: number; // how many barter offers they generate (poor → thin)
  tint: number; // sprite tint cue
  namePrefix: string; // name-tag label ("" = no tag)
}

export const NPC_TIERS: Record<NpcTier, TierMeta> = {
  poor: { hpMul: 0.7, dmgMul: 0.7, offerBias: 0, recruitMul: 0.6, standingReq: 0, maxOffers: 2, tint: 0x9a8f7a, namePrefix: "" },
  average: { hpMul: 1.0, dmgMul: 1.0, offerBias: 0.15, recruitMul: 1.0, standingReq: 20, maxOffers: 3, tint: 0x6fa8c7, namePrefix: "" },
  prime: { hpMul: 1.4, dmgMul: 1.4, offerBias: 0.7, recruitMul: 1.6, standingReq: 45, maxOffers: 4, tint: 0xffd23f, namePrefix: "Prime" },
};

export const NPC_TIER_IDS = ["poor", "average", "prime"] as const;

export function tierMeta(tier: string | undefined): TierMeta {
  return NPC_TIERS[(tier as NpcTier) in NPC_TIERS ? (tier as NpcTier) : "average"];
}

/** Roll a survivor quality tier, weighted by faction (scavengers run harder) and
 *  day (the world keeps only its tougher survivors over time). Deterministic per rng. */
export function rollTier(rng: Rng, day = 0, faction = "townsfolk"): NpcTier {
  let wPoor = 40;
  const wAvg = 45;
  let wPrime = 15;
  if (faction === "scavengers") { wPoor -= 10; wPrime += 12; }
  else if (faction === "wanderers") { wPrime += 5; }
  const shift = Math.min(22, day * 1.5);
  wPrime += shift;
  wPoor = Math.max(5, wPoor - shift);
  const total = wPoor + wAvg + wPrime;
  const x = rng.next() * total;
  if (x < wPoor) return "poor";
  if (x < wPoor + wAvg) return "average";
  return "prime";
}

export interface RecruitCost {
  items: { item: string; qty: number }[];
  standingReq: number;
}

/** Supplies + standing required to recruit a survivor of the given tier. */
export function recruitCost(tier: string | undefined): RecruitCost {
  const m = tierMeta(tier);
  const items = [
    { item: "Canned Food", qty: Math.max(1, Math.round(2 * m.recruitMul)) },
    { item: "Water Bottle", qty: Math.max(1, Math.round(2 * m.recruitMul)) },
  ];
  if (tier === "prime") items.push({ item: "Bandage", qty: 1 }); // a prime survivor wants real medicine
  return { items, standingReq: m.standingReq };
}

/** Whether the player meets the standing + supply cost to recruit this tier. */
export function canRecruit(s: GameState, faction: string, tier: string | undefined): boolean {
  const cost = recruitCost(tier);
  if (getStanding(s, faction) < cost.standingReq) return false;
  return cost.items.every((c) => hasItem(s, c.item, c.qty));
}

/** Consume the recruit supply bundle (call only after canRecruit). */
export function payRecruit(s: GameState, tier: string | undefined): void {
  for (const c of recruitCost(tier).items) removeItem(s, c.item, c.qty);
}

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

/** Generate a survivor's barter offers: each gives a staple for something useful.
 *  The quality tier biases toward rarer goods (prime) and caps how many they offer
 *  (poor → thin). Deterministic per rng seed. */
export function generateOffers(rng: Rng, faction: string, tier: string | undefined = "average"): TradeOffer[] {
  const meta = tierMeta(tier);
  const offers: TradeOffer[] = [];
  const seen = new Set<string>();
  for (const stack of rollLoot(factionStock(faction), rng, 6, 0.1 + meta.offerBias)) {
    if (seen.has(stack.item) || NEEDS.includes(stack.item as (typeof NEEDS)[number])) continue;
    seen.add(stack.item);
    const getVal = itemValue(stack.item) * stack.qty;
    const need = rng.pick(NEEDS);
    const qty = Math.min(6, Math.max(1, Math.round(getVal / itemValue(need))));
    offers.push({ give: [{ item: need, qty }], get: { item: stack.item, qty: stack.qty } });
    if (offers.length >= meta.maxOffers) break;
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

// --- living camps (Expansion U5) -------------------------------------------------

/** Landmark kinds that host a resident roster of NPCs. */
export const CAMP_LANDMARKS = new Set(["survivor_camp", "campsite", "quarantine_tents"]);

export interface CampMate {
  id: string; // stable: camp_<cx>_<cy>_<i> — suppression flags key off it
  name: string;
  role: "trader" | "guard";
  tier: NpcTier;
}

/** The deterministic resident roster of the camp in chunk (cx, cy): 2–3 people,
 *  one of them the camp's trader. Stable ids → stable barter stock + clean
 *  suppression via npc_gone_<id> flags when someone is recruited or dies. */
export function campRoster(seed: string, cx: number, cy: number, faction: Faction): CampMate[] {
  const rng = createRng(`${seed}:camp:${cx}:${cy}`);
  const n = rng.chance(0.5) ? 3 : 2;
  const out: CampMate[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `camp_${cx}_${cy}_${i}`,
      name: npcName(rng),
      role: i === 0 ? "trader" : "guard",
      tier: rollTier(rng, 3, faction), // settled camps keep decent people
    });
  }
  return out;
}

export const npcGoneFlag = (id: string): string => `npc_gone_${id}`;
