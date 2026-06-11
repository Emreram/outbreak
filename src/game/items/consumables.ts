import type { ArmorDef, ConsumableDef, ItemDef, MaterialDef, Rarity, StatKey, ThrowableDef } from "./types";

// Non-weapon items: medical / food / drink consumables, crafting materials,
// armor, and throwables — all rarity-graded so loot tables + UI work uniformly.

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function con(
  name: string,
  rarity: Rarity,
  icon: string,
  effects: Partial<Record<StatKey, number>>,
  extra?: { cure?: boolean; desc?: string; tint?: number },
): ConsumableDef {
  const d: ConsumableDef = { id: slug(name), name, kind: "consumable", rarity, icon, effects };
  if (extra?.cure) d.cure = true;
  if (extra?.desc) d.desc = extra.desc;
  if (extra?.tint !== undefined) d.tint = extra.tint;
  return d;
}
function mat(name: string, rarity: Rarity, tint?: number, icon = "scrap"): MaterialDef {
  const d: MaterialDef = { id: slug(name), name, kind: "material", rarity, icon };
  if (tint !== undefined) d.tint = tint;
  return d;
}
function arm(name: string, rarity: Rarity, defense: number, slot: "head" | "body" = "body", tint?: number): ArmorDef {
  const d: ArmorDef = { id: slug(name), name, kind: "armor", rarity, icon: "armor", defense, slot };
  if (tint !== undefined) d.tint = tint;
  return d;
}
function thr(name: string, rarity: Rarity, damage: number, radius: number, effect?: ThrowableDef["effect"]): ThrowableDef {
  const d: ThrowableDef = { id: slug(name), name, kind: "throwable", rarity, icon: "grenade", damage, radius };
  if (effect) d.effect = effect;
  return d;
}

const MEDICAL: ConsumableDef[] = [
  con("Gauze", "common", "bandage", { hp: 18 }),
  con("Bandage", "common", "bandage", { hp: 30 }),
  con("Painkillers", "uncommon", "pills", { hp: 14, stamina: 20 }),
  con("Antiseptic", "uncommon", "syringe", { infection: -25 }),
  con("First-Aid Kit", "rare", "bandage", { hp: 55 }, { tint: 0xff5555 }),
  con("Antibiotics", "rare", "pills", { infection: -45 }),
  con("Saline Drip", "rare", "syringe", { hp: 25, thirst: 20 }),
  con("Adrenaline Shot", "rare", "syringe", { stamina: 60, hp: 10 }),
  con("Trauma Kit", "epic", "bandage", { hp: 80, stamina: 10 }, { tint: 0xffd23f }),
  con("Antiviral Serum", "legendary", "syringe", { infection: -100, hp: 20 }, { cure: true, desc: "Stops the turn cold." }),
  con("Nanite Cure", "mythic", "syringe", { infection: -100, hp: 60 }, { cure: true, tint: 0xff5a6e, desc: "Whatever this is, it works." }),
];

const FOOD: ConsumableDef[] = [
  con("Snacks", "common", "food", { hunger: 14 }),
  con("Dried Fruit", "common", "food", { hunger: 16 }),
  con("Energy Bar", "common", "food", { hunger: 18, stamina: 12 }),
  con("Canned Food", "common", "food", { hunger: 30 }),
  con("MRE", "uncommon", "food", { hunger: 45, thirst: 10 }),
  con("Cooked Meal", "rare", "food", { hunger: 60, hp: 8 }),
  // Harvested produce (Feature 5) — raw restores some hunger; cooking enhances later.
  con("Wheat", "common", "food", { hunger: 8 }),
  con("Corn", "common", "food", { hunger: 14 }),
  con("Tomato", "common", "food", { hunger: 10, thirst: 4 }),
  con("Potato", "common", "food", { hunger: 16 }),
  con("Carrot", "common", "food", { hunger: 12 }),
  // Hunting (Feature 6): raw meat is risky (small infection), cooking makes it great.
  con("Raw Meat", "common", "food", { hunger: 18, infection: 3 }),
  con("Cooked Meat", "uncommon", "food", { hunger: 42, hp: 10 }),
  // Fishing (Terrain Overhaul PR3): pulled from shore fishing spots / rowboats.
  con("Raw Fish", "common", "food", { hunger: 16, infection: 2 }),
  con("Cooked Fish", "uncommon", "food", { hunger: 38, hp: 8 }),
];

const DRINK: ConsumableDef[] = [
  con("Soda", "common", "drink", { thirst: 22, stamina: 10 }),
  con("Water Bottle", "common", "drink", { thirst: 35 }),
  con("Coffee", "uncommon", "drink", { stamina: 35 }),
  con("Canteen", "uncommon", "drink", { thirst: 50 }),
  con("Energy Drink", "uncommon", "drink", { stamina: 45, thirst: 10 }),
  con("Purified Water", "rare", "drink", { thirst: 60, infection: -5 }),
];

const MATERIALS: MaterialDef[] = [
  mat("Scrap Metal", "common", 0x9aa3ad),
  mat("Cloth", "common", 0xcdb89a),
  mat("Wood Plank", "common", 0x8a6a3a),
  mat("Empty Bottle", "common", 0x6fc3ff),
  mat("Loose Brick", "common", 0xb5651d),
  mat("Duct Tape", "common", 0x4a4a4a),
  mat("Rope", "common", 0xcdb89a),
  mat("Blanket", "common", 0x7a6f8a),
  mat("Batteries", "uncommon", 0x5ed66e),
  mat("Electronics", "uncommon", 0x4aa3ff),
  mat("Gunpowder", "uncommon", 0x2a2a2a),
  mat("Fuel Canister", "uncommon", 0xd13a2a),
  mat("Toolkit", "rare", 0xffd23f),
  mat("Weapon Parts", "rare", 0x9aa3ad),
  mat("Lockpick", "uncommon", 0xc8d0d8), // opens locked containers (consumed)
  mat("Bolt Cutters", "rare", 0xd1483a), // opens locked containers (reusable)
  // Farming tools + seeds (Feature 5)
  mat("Hoe", "common", 0x9c6b3f),
  mat("Watering Can", "common", 0x4ec3ff),
  mat("Wheat Seeds", "common", 0xe6c34a),
  mat("Corn Seeds", "common", 0xf2d43f),
  mat("Tomato Seeds", "common", 0xe2462f),
  mat("Potato Seeds", "common", 0xb98a4a),
  mat("Carrot Seeds", "common", 0xe07a2f),
  // Crafting materials (Feature 8). Hide drops from hunted animals (Feature 6).
  mat("Hide", "common", 0x8a6a3a),
  mat("Leather", "common", 0x6b4a2a),
  mat("Barricade Kit", "uncommon", 0x9c6b3f),
  mat("Bone", "common", 0xe8e2d0),
  // Car parts (Feature 4): scavenged from garages/gas stations/wrecks to repair vehicles.
  mat("Engine Part", "uncommon", 0x6b7079),
  mat("Battery", "uncommon", 0x3a7a4a),
  mat("Spark Plug", "common", 0xd1a23a),
  mat("Tire", "common", 0x2b2e33),
  // Radio (Feature 10): hold one to pick up survivor broadcasts (POI leads on the map).
  mat("Radio", "uncommon", 0x2a3a4a),
];

const ARMOR: ArmorDef[] = [
  arm("Leather Jacket", "common", 12, "body", 0x6b4a2a),
  arm("Warm Coat", "common", 10, "body", 0x3a5236),
  arm("Helmet", "uncommon", 14, "head", 0x5b616a),
  arm("Gas Mask", "uncommon", 8, "head", 0x4a4a4a),
  arm("Padded Vest", "uncommon", 18, "body", 0x4a4a4a),
  arm("Kevlar Vest", "rare", 30, "body", 0x2a2e33),
  arm("Riot Gear", "epic", 40, "body", 0x23262b),
  arm("Plate Carrier", "legendary", 52, "body", 0x1a1a1a),
];

const THROWABLES: ThrowableDef[] = [
  thr("Rock", "common", 4, 0),
  thr("Road Flare", "common", 2, 0, "burn"),
  thr("Smoke Bomb", "uncommon", 0, 60),
  thr("Molotov", "rare", 14, 70, "burn"),
  thr("Pipe Bomb", "rare", 30, 80, "explosive"),
  thr("Frag Grenade", "epic", 45, 90, "explosive"),
  thr("Incendiary Grenade", "epic", 30, 80, "incendiary"),
  thr("C4 Charge", "legendary", 80, 120, "explosive"),
];

export const MISC_ITEMS: readonly ItemDef[] = Object.freeze([
  ...MEDICAL,
  ...FOOD,
  ...DRINK,
  ...MATERIALS,
  ...ARMOR,
  ...THROWABLES,
]);
