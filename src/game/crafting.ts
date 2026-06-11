// Crafting (Feature 8): data-driven recipes that consume inventory materials and
// produce items. Pure logic — the scene opens a modal and calls craft(). Recipes can
// gate on a nearby STATION (campfire/workbench, Feature 7) and on a CRAFTING skill
// level (Feature 9). canCraft/craft re-validate everything so the UI can never force
// an item the player hasn't earned. Crafting XP is granted by the caller on success.

import type { GameState } from "../shared/contracts";
import { addItem, hasItem, removeItem } from "./inventory";
import { skillLevel, type SkillId } from "./skills";

export type CraftCategory = "Medical" | "Survival" | "Tools" | "Ammunition" | "Armour" | "Explosives";

/** Fixed display order for the crafting menu's category groups. */
export const CRAFT_CATEGORIES: readonly CraftCategory[] = [
  "Medical",
  "Survival",
  "Tools",
  "Ammunition",
  "Armour",
  "Explosives",
];

export interface Recipe {
  id: string;
  out: string; // output item name (must exist in the catalog)
  outQty: number;
  inputs: { item: string; qty: number }[];
  station?: "campfire" | "workbench" | "forge" | "chem"; // requires a nearby station
  skill?: { id: SkillId; level: number }; // requires a minimum skill level
  category: CraftCategory;
  desc: string;
}

export const RECIPES: Recipe[] = [
  // --- Medical ---
  { id: "gauze", out: "Gauze", outQty: 1, inputs: [{ item: "Cloth", qty: 1 }], category: "Medical", desc: "Quick wound dressing (+HP)." },
  { id: "bandage", out: "Bandage", outQty: 1, inputs: [{ item: "Cloth", qty: 2 }], category: "Medical", desc: "Bind a wound (+HP)." },
  // Gate on the campfire (boil + treat) — there is no "chem" station in the build
  // palette, which silently made this recipe permanently uncraftable.
  { id: "purified", out: "Purified Water", outQty: 1, inputs: [{ item: "Water Bottle", qty: 1 }, { item: "Antiseptic", qty: 1 }], station: "campfire", category: "Medical", desc: "Boil + treat water (lowers infection risk)." },
  // --- Survival / food ---
  { id: "water", out: "Water Bottle", outQty: 1, inputs: [{ item: "Empty Bottle", qty: 1 }], category: "Survival", desc: "Bottle clean water." },
  { id: "cooked_meal", out: "Cooked Meal", outQty: 1, inputs: [{ item: "Potato", qty: 1 }, { item: "Carrot", qty: 1 }], station: "campfire", category: "Survival", desc: "A hot meal (big +hunger, +HP)." },
  { id: "cooked_meat", out: "Cooked Meat", outQty: 1, inputs: [{ item: "Raw Meat", qty: 1 }], station: "campfire", category: "Survival", desc: "Cook raw meat — safe + filling." },
  { id: "cooked_fish", out: "Cooked Fish", outQty: 1, inputs: [{ item: "Raw Fish", qty: 1 }], station: "campfire", category: "Survival", desc: "Grill the day's catch." },
  // --- Tools ---
  { id: "lockpick", out: "Lockpick", outQty: 2, inputs: [{ item: "Scrap Metal", qty: 1 }], category: "Tools", desc: "Pop locked containers." },
  { id: "leather", out: "Leather", outQty: 1, inputs: [{ item: "Hide", qty: 2 }], category: "Tools", desc: "Tan hides into leather." },
  { id: "barricade_kit", out: "Barricade Kit", outQty: 1, inputs: [{ item: "Wood Plank", qty: 2 }, { item: "Duct Tape", qty: 1 }], station: "workbench", category: "Tools", desc: "Board up a window or door." },
  { id: "radio", out: "Radio", outQty: 1, inputs: [{ item: "Electronics", qty: 1 }, { item: "Batteries", qty: 1 }], station: "workbench", category: "Tools", desc: "Pick up survivor broadcasts (map leads)." },
  // --- Ammunition ---
  { id: "nails", out: "Nails", outQty: 10, inputs: [{ item: "Scrap Metal", qty: 1 }], station: "workbench", category: "Ammunition", desc: "Nailgun ammo from scrap." },
  { id: "arrows", out: "Arrows", outQty: 6, inputs: [{ item: "Wood Plank", qty: 1 }], category: "Ammunition", desc: "Fletch arrows from a plank." },
  { id: "ammo_9mm", out: "9mm Rounds", outQty: 12, inputs: [{ item: "Gunpowder", qty: 1 }, { item: "Scrap Metal", qty: 1 }], station: "workbench", category: "Ammunition", desc: "Hand-load pistol rounds." },
  { id: "ammo_shells", out: "Shotgun Shells", outQty: 6, inputs: [{ item: "Gunpowder", qty: 1 }, { item: "Scrap Metal", qty: 1 }], station: "workbench", category: "Ammunition", desc: "Reload shotgun shells." },
  { id: "ammo_rifle", out: "5.56 Rounds", outQty: 10, inputs: [{ item: "Gunpowder", qty: 2 }, { item: "Scrap Metal", qty: 1 }], station: "workbench", skill: { id: "crafting", level: 2 }, category: "Ammunition", desc: "Press rifle rounds (Crafting 2)." },
  // --- Armour (craft / upgrade with Leather + Scrap) ---
  { id: "armor_jacket", out: "Leather Jacket", outQty: 1, inputs: [{ item: "Leather", qty: 3 }], category: "Armour", desc: "Stitch a protective jacket (body)." },
  { id: "armor_helmet", out: "Helmet", outQty: 1, inputs: [{ item: "Scrap Metal", qty: 3 }], station: "workbench", category: "Armour", desc: "Bash out a head guard (head)." },
  { id: "armor_vest", out: "Padded Vest", outQty: 1, inputs: [{ item: "Leather", qty: 2 }, { item: "Scrap Metal", qty: 2 }, { item: "Cloth", qty: 2 }], station: "workbench", skill: { id: "crafting", level: 2 }, category: "Armour", desc: "Layer a padded vest (Crafting 2)." },
  // --- Explosives / traps ---
  { id: "molotov", out: "Molotov", outQty: 1, inputs: [{ item: "Empty Bottle", qty: 1 }, { item: "Fuel Canister", qty: 1 }, { item: "Cloth", qty: 1 }], category: "Explosives", desc: "Improvised firebomb." },
  { id: "smoke_bomb", out: "Smoke Bomb", outQty: 1, inputs: [{ item: "Empty Bottle", qty: 1 }, { item: "Gunpowder", qty: 1 }, { item: "Cloth", qty: 1 }], category: "Explosives", desc: "Cover your escape." },
  { id: "pipe_bomb", out: "Pipe Bomb", outQty: 1, inputs: [{ item: "Scrap Metal", qty: 1 }, { item: "Gunpowder", qty: 2 }, { item: "Duct Tape", qty: 1 }], station: "workbench", category: "Explosives", desc: "Explosive trap." },
];

/** Sum input quantities per item so a recipe that lists the same material twice is
 *  checked + consumed against the true total (avoids over-crafting on partial stacks). */
function neededTotals(r: Recipe): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of r.inputs) m.set(i.item, (m.get(i.item) ?? 0) + i.qty);
  return m;
}

/** Is a required station (if any) available? */
export function hasStation(r: Recipe, stations?: Set<string>): boolean {
  return !r.station || !!stations?.has(r.station);
}

/** Does the player meet the recipe's skill gate (if any)? */
export function hasSkill(s: GameState, r: Recipe): boolean {
  return !r.skill || skillLevel(s, r.skill.id) >= r.skill.level;
}

/** Has the materials for a recipe (ignores station/skill). */
export function hasMaterials(s: GameState, r: Recipe): boolean {
  for (const [item, qty] of neededTotals(r)) if (!hasItem(s, item, qty)) return false;
  return true;
}

export function canCraft(s: GameState, r: Recipe, stations?: Set<string>): boolean {
  return hasSkill(s, r) && hasStation(r, stations) && hasMaterials(s, r);
}

/** Consume the inputs and add the output. Re-validates materials + station + skill so
 *  a stale UI can never produce an item; atomic (canCraft guards before any mutation). */
export function craft(s: GameState, r: Recipe, stations?: Set<string>): boolean {
  if (!canCraft(s, r, stations)) return false;
  for (const [item, qty] of neededTotals(r)) removeItem(s, item, qty);
  addItem(s, r.out, r.outQty);
  return true;
}
