// Inventory operations (CLAUDE.md §8.5): add with stack-merge + per-item cap,
// remove without going below zero, ignore items not held. Plus the catalog-backed
// equip/reload/ammo helpers for the loot system (Phase 3+).

import type { GameState } from "../shared/contracts";
import type { ArmorDef, ConsumableDef, StatKey, WeaponDef } from "./items/types";
import { allWeapons, ammoItemForType, defOf, isWeaponName, weaponDef, FISTS } from "./items/catalog";

export const MAX_STACK = 99;
const STAT_KEYS: readonly StatKey[] = ["hp", "stamina", "hunger", "thirst", "infection"];
// 0–100 clamp inlined (importing clampStat from GameState would cycle: GameState imports this module).
const clamp100 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0);

/** Names that count as a weapon — derived from the catalog (used by the mock GM). */
export const WEAPON_ITEMS: ReadonlySet<string> = new Set(allWeapons().map((w) => w.name));

/** Whether the player is holding any weapon. */
export function isArmed(s: GameState): boolean {
  return s.inventory.some((i) => isWeaponName(i.item));
}

/** Add qty of an item, merging into an existing stack and capping the total. */
export function addItem(s: GameState, item: string, qty = 1, note?: string): void {
  if (qty <= 0) return;
  const existing = s.inventory.find((i) => i.item === item);
  if (existing) {
    existing.qty = Math.min(MAX_STACK, existing.qty + qty);
    if (note) existing.note = note;
  } else {
    s.inventory.push({ item, qty: Math.min(MAX_STACK, qty), note });
  }
}

/**
 * Remove up to qty of an item. Never goes below 0, drops empty stacks, and is a
 * no-op for items not held. Returns the amount actually removed.
 */
export function removeItem(s: GameState, item: string, qty = 1): number {
  if (qty <= 0) return 0;
  const idx = s.inventory.findIndex((i) => i.item === item);
  if (idx < 0) return 0;
  const stack = s.inventory[idx];
  const removed = Math.min(stack.qty, qty);
  stack.qty -= removed;
  if (stack.qty <= 0) s.inventory.splice(idx, 1);
  return removed;
}

export function hasItem(s: GameState, item: string, qty = 1): boolean {
  const stack = s.inventory.find((i) => i.item === item);
  return !!stack && stack.qty >= qty;
}

// --- consumables (catalog-driven; powers the quick-use hotbar) ----------------

/** Quick-use category for the hotbar: 0 food · 1 drink · 2 heal/other · 3 cure. */
function consumableCategory(d: ConsumableDef): number {
  const e = d.effects ?? {};
  if ((e.hunger ?? 0) > 0) return 0;
  if ((e.thirst ?? 0) > 0) return 1;
  if (d.cure || (e.infection ?? 0) < 0) return 3;
  return 2;
}

/**
 * Use one consumable: apply its catalog `effects` (each clamped 0–100), honour
 * `cure` (infection → 0), and remove one from the stack. Returns whether it was
 * actually a held consumable. The single source of truth for "using an item".
 */
export function useConsumable(s: GameState, name: string | undefined): boolean {
  if (!name) return false;
  const def = defOf(name);
  if (def.kind !== "consumable" || !hasItem(s, name)) return false;
  removeItem(s, name, 1);
  const eff = def.effects ?? {};
  for (const k of STAT_KEYS) {
    const d = eff[k];
    if (d) s.player[k] = clamp100(s.player[k] + d);
  }
  if (def.cure) s.player.infection = 0;
  return true;
}

export interface QuickSlot {
  item: string;
  qty: number;
  def: ConsumableDef;
}

/** Fixed 4 quick-use slots [food, drink, heal, cure] — the best-stocked held
 *  consumable per category, or undefined when you hold none. Stable so the number
 *  keys always map to the same category. */
export function quickUseItems(s: GameState): (QuickSlot | undefined)[] {
  const slots: (QuickSlot | undefined)[] = [undefined, undefined, undefined, undefined];
  for (const it of s.inventory) {
    const def = defOf(it.item);
    if (def.kind !== "consumable") continue;
    const k = consumableCategory(def);
    const cur = slots[k];
    if (!cur || it.qty > cur.qty) slots[k] = { item: it.item, qty: it.qty, def };
  }
  return slots;
}

export function itemCount(s: GameState, item: string): number {
  return s.inventory.find((i) => i.item === item)?.qty ?? 0;
}

// --- equipment / ammo (loot system) ---------------------------------------

/** The equipped melee weapon def — falls back to bare Fists. */
export function equippedMeleeDef(s: GameState): WeaponDef {
  return weaponDef(s.equippedMelee ?? "") ?? FISTS;
}

/** The equipped gun def, or undefined if none. */
export function equippedRangedDef(s: GameState): WeaponDef | undefined {
  return weaponDef(s.equippedRanged ?? "");
}

/** Reserve rounds held for a calibre (not counting the loaded magazine). */
export function ammoReserve(s: GameState, ammoType: string | undefined): number {
  const item = ammoItemForType(ammoType);
  return item ? itemCount(s, item) : 0;
}

/** Equip an owned weapon into its slot. Ranged guns auto-reload from reserve. */
export function equipWeapon(s: GameState, name: string): boolean {
  const w = weaponDef(name);
  if (!w || !hasItem(s, name)) return false;
  if (w.hand === "melee") {
    s.equippedMelee = name;
  } else {
    s.equippedRanged = name;
    s.loadedAmmo = 0;
    reloadEquipped(s);
  }
  return true;
}

export function unequip(s: GameState, hand: "melee" | "ranged"): void {
  if (hand === "melee") s.equippedMelee = undefined;
  else {
    s.equippedRanged = undefined;
    s.loadedAmmo = 0;
  }
}

/** Top up the equipped gun's magazine from reserve ammo. Returns rounds loaded. */
export function reloadEquipped(s: GameState): number {
  const w = equippedRangedDef(s);
  if (!w || !w.ammoType || !w.magSize) return 0;
  const need = w.magSize - (s.loadedAmmo ?? 0);
  if (need <= 0) return 0;
  const item = ammoItemForType(w.ammoType);
  if (!item) return 0;
  const took = removeItem(s, item, need);
  s.loadedAmmo = (s.loadedAmmo ?? 0) + took;
  return took;
}

/** Auto-equip a freshly found weapon OR armour if its slot is empty (quality of life). */
export function autoEquip(s: GameState, name: string): boolean {
  const w = weaponDef(name);
  if (w) {
    if (w.hand === "melee" && !s.equippedMelee) return equipWeapon(s, name);
    if (w.hand === "ranged" && !s.equippedRanged) return equipWeapon(s, name);
    return false;
  }
  const d = defOf(name);
  if (d.kind === "armor") {
    const slot = armorSlot(d);
    const cur = slot === "head" ? s.player.equippedArmorHead : s.player.equippedArmorBody;
    if (!cur) return equipArmor(s, name);
  }
  return false;
}

// --- armour (two equip slots: body + head; only equipped pieces protect) ------

/** Which slot an armour piece occupies (defaults to body). */
export function armorSlot(d: ArmorDef): "head" | "body" {
  return d.slot ?? "body";
}

/** The equipped armour def for a slot, or undefined. */
export function equippedArmorDef(s: GameState, slot: "head" | "body"): ArmorDef | undefined {
  const name = slot === "head" ? s.player.equippedArmorHead : s.player.equippedArmorBody;
  if (!name) return undefined;
  const d = defOf(name);
  return d.kind === "armor" ? d : undefined;
}

/** Equip an owned armour piece into its body/head slot. */
export function equipArmor(s: GameState, name: string): boolean {
  const d = defOf(name);
  if (d.kind !== "armor" || !hasItem(s, name)) return false;
  if (armorSlot(d) === "head") s.player.equippedArmorHead = name;
  else s.player.equippedArmorBody = name;
  return true;
}

export function unequipArmor(s: GameState, slot: "head" | "body"): void {
  if (slot === "head") s.player.equippedArmorHead = undefined;
  else s.player.equippedArmorBody = undefined;
}

/** Stacked defence % from the two equipped armour pieces, clamped 0..85. */
export function armorDefensePct(s: GameState): number {
  const body = equippedArmorDef(s, "body")?.defense ?? 0;
  const head = equippedArmorDef(s, "head")?.defense ?? 0;
  return Math.max(0, Math.min(85, body + head));
}

/** Carried weapons (melee first, then ranged) — backs the hotbar weapon strip. */
export function weaponsInBag(s: GameState): WeaponDef[] {
  const melee: WeaponDef[] = [];
  const ranged: WeaponDef[] = [];
  for (const it of s.inventory) {
    const w = weaponDef(it.item);
    if (!w) continue;
    (w.hand === "melee" ? melee : ranged).push(w);
  }
  return [...melee, ...ranged];
}
