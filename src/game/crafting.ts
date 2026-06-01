// Crafting (Feature 8): data-driven recipes that consume inventory materials and
// produce items. Pure logic — the scene opens a modal and calls craft(). Stations
// (campfire/workbench, Feature 7) are recorded for flavour/future gating; for now
// everything is hand-craftable so the system is useful before bases exist.

import type { GameState } from "../shared/contracts";
import { addItem, hasItem, removeItem } from "./inventory";

export interface Recipe {
  id: string;
  out: string; // output item name (must exist in the catalog)
  outQty: number;
  inputs: { item: string; qty: number }[];
  station?: "campfire" | "workbench" | "forge" | "chem"; // future gating
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: "bandage", out: "Bandage", outQty: 1, inputs: [{ item: "Cloth", qty: 2 }], desc: "Bind a wound (+HP)." },
  { id: "lockpick", out: "Lockpick", outQty: 2, inputs: [{ item: "Scrap Metal", qty: 1 }], desc: "Pop locked containers." },
  { id: "water", out: "Water Bottle", outQty: 1, inputs: [{ item: "Empty Bottle", qty: 1 }], desc: "Bottle clean water." },
  { id: "purified", out: "Purified Water", outQty: 1, inputs: [{ item: "Water Bottle", qty: 1 }, { item: "Antiseptic", qty: 1 }], station: "chem", desc: "Purify water." },
  { id: "molotov", out: "Molotov", outQty: 1, inputs: [{ item: "Empty Bottle", qty: 1 }, { item: "Fuel Canister", qty: 1 }, { item: "Cloth", qty: 1 }], desc: "Improvised firebomb." },
  { id: "pipe_bomb", out: "Pipe Bomb", outQty: 1, inputs: [{ item: "Scrap Metal", qty: 1 }, { item: "Gunpowder", qty: 2 }, { item: "Duct Tape", qty: 1 }], station: "workbench", desc: "Explosive trap." },
  { id: "cooked_meal", out: "Cooked Meal", outQty: 1, inputs: [{ item: "Potato", qty: 1 }, { item: "Carrot", qty: 1 }], station: "campfire", desc: "A hot meal (big +hunger, +HP)." },
  { id: "leather", out: "Leather", outQty: 1, inputs: [{ item: "Hide", qty: 2 }], desc: "Tan hides into leather." },
  { id: "barricade_kit", out: "Barricade Kit", outQty: 1, inputs: [{ item: "Wood Plank", qty: 2 }, { item: "Duct Tape", qty: 1 }], station: "workbench", desc: "Board up a window or door." },
];

export function canCraft(s: GameState, r: Recipe): boolean {
  return r.inputs.every((i) => hasItem(s, i.item, i.qty));
}

/** Consume the inputs and add the output. Returns false if materials are missing. */
export function craft(s: GameState, r: Recipe): boolean {
  if (!canCraft(s, r)) return false;
  for (const i of r.inputs) removeItem(s, i.item, i.qty);
  addItem(s, r.out, r.outQty);
  return true;
}
