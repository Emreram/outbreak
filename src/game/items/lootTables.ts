import type { ItemDef } from "./types";
import type { Rng } from "../rng";
import { rarityRank, rollRarity } from "./rarity";
import { WEAPONS } from "./weapons";
import { MISC_ITEMS } from "./consumables";
import { AMMO } from "./ammo";

// Rarity-weighted, location-aware loot. Sources: building types, chests
// ("chest:<tier>"), and enemy drops ("enemy:<kind>"). Deterministic with a seeded Rng.

type Category =
  | "melee" | "pistol" | "auto" | "shotgun" | "rifle" | "sniper" | "bow" | "special"
  | "ammo" | "medical" | "food" | "drink" | "material" | "armor" | "throwable";

function categoryOf(d: ItemDef): Category {
  switch (d.kind) {
    case "weapon":
      switch (d.wclass) {
        case "pistol":
        case "revolver":
          return "pistol";
        case "smg":
        case "lmg":
          return "auto";
        case "shotgun":
          return "shotgun";
        case "rifle":
          return "rifle";
        case "dmr":
          return "sniper";
        case "bow":
        case "crossbow":
          return "bow";
        case "launcher":
        case "flame":
        case "nailgun":
        case "energy":
          return "special";
        default:
          return "melee";
      }
    case "ammo":
      return "ammo";
    case "armor":
      return "armor";
    case "throwable":
      return "throwable";
    case "material":
      return "material";
    case "consumable":
      return d.icon === "food" ? "food" : d.icon === "drink" ? "drink" : "medical";
    default:
      return "material";
  }
}

const POOLS: Record<Category, ItemDef[]> = (() => {
  const p = {} as Record<Category, ItemDef[]>;
  for (const d of [...WEAPONS, ...MISC_ITEMS, ...AMMO]) {
    const c = categoryOf(d);
    (p[c] ||= []).push(d);
  }
  return p;
})();

interface SourceTable {
  weights: Partial<Record<Category, number>>;
  bias: number;
}

const SOURCES: Record<string, SourceTable> = {
  pharmacy: { weights: { medical: 6, drink: 1, food: 1, material: 1 }, bias: 0.1 },
  hospital: { weights: { medical: 7, drink: 1, armor: 1, material: 1 }, bias: 0.2 },
  grocery: { weights: { food: 6, drink: 4, material: 1 }, bias: 0 },
  gas_station: { weights: { food: 3, drink: 3, material: 2, throwable: 1, ammo: 1 }, bias: 0 },
  hardware_store: { weights: { melee: 5, material: 4, throwable: 1, special: 1 }, bias: 0.1 },
  police_station: { weights: { pistol: 4, shotgun: 2, rifle: 2, ammo: 4, armor: 2, melee: 1 }, bias: 0.25 },
  house: { weights: { food: 2, drink: 2, material: 2, melee: 2, medical: 1, armor: 1 }, bias: 0 },
  military: { weights: { rifle: 4, sniper: 1, auto: 1, ammo: 4, armor: 2, special: 1, throwable: 1 }, bias: 0.4 },
  street: { weights: { material: 4, melee: 2, food: 1, drink: 1, throwable: 1 }, bias: 0 },
};

const CHEST_WEIGHTS: Partial<Record<Category, number>> = {
  melee: 3, pistol: 2, auto: 1, shotgun: 1, rifle: 1, sniper: 1, bow: 1, special: 1,
  ammo: 3, medical: 2, food: 1, drink: 1, material: 2, armor: 1, throwable: 1,
};

const ENEMY: Record<string, SourceTable> = {
  zombie: { weights: { material: 4, ammo: 2, medical: 1, food: 1 }, bias: 0 },
  zombie_runner: { weights: { ammo: 3, medical: 2, melee: 1, material: 2 }, bias: 0.2 },
  survivor_hostile: { weights: { pistol: 2, ammo: 3, medical: 2, melee: 2, armor: 1, rifle: 1 }, bias: 0.35 },
};

function pickCategory(weights: Partial<Record<Category, number>>, rng: Rng): Category {
  const entries = Object.entries(weights) as [Category, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [c, w] of entries) {
    x -= w;
    if (x <= 0) return c;
  }
  return entries[0][0];
}

function pickFromCategory(cat: Category, rng: Rng, bias: number): ItemDef | undefined {
  const pool = POOLS[cat];
  if (!pool || pool.length === 0) return undefined;
  const target = rarityRank(rollRarity(rng, bias));
  let best = -1;
  for (const d of pool) {
    const r = rarityRank(d.rarity);
    if (r <= target && r > best) best = r;
  }
  if (best < 0) best = Math.min(...pool.map((d) => rarityRank(d.rarity)));
  const tier = pool.filter((d) => rarityRank(d.rarity) === best);
  return rng.pick(tier);
}

function qtyFor(d: ItemDef, rng: Rng): number {
  switch (d.kind) {
    case "ammo":
      return rng.int(8, 40);
    case "material":
      return rng.int(1, 4);
    case "throwable":
      return rng.int(1, 2);
    case "consumable":
      return rng.int(1, 3);
    default:
      return 1;
  }
}

export interface LootStack {
  item: string;
  qty: number;
}

function tableFor(source: string): SourceTable {
  if (source.startsWith("chest:")) {
    const tier = Math.max(0, Math.min(4, parseInt(source.slice(6), 10) || 0));
    return { weights: CHEST_WEIGHTS, bias: 0.15 + tier * 0.5 };
  }
  if (source.startsWith("enemy:")) {
    return ENEMY[source.slice(6)] ?? ENEMY.zombie;
  }
  return SOURCES[source] ?? SOURCES.street;
}

/** Roll `n` loot stacks from a named source. Merges duplicate items. */
export function rollLoot(source: string, rng: Rng, n = 1): LootStack[] {
  const { weights, bias } = tableFor(source);
  const out: LootStack[] = [];
  for (let i = 0; i < n; i++) {
    const cat = pickCategory(weights, rng);
    const d = pickFromCategory(cat, rng, bias);
    if (d) out.push({ item: d.name, qty: qtyFor(d, rng) });
  }
  const merged = new Map<string, number>();
  for (const s of out) merged.set(s.item, (merged.get(s.item) ?? 0) + s.qty);
  return [...merged.entries()].map(([item, qty]) => ({ item, qty }));
}
