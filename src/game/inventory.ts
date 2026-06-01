// Inventory operations (CLAUDE.md §8.5): add with stack-merge + per-item cap,
// remove without going below zero, ignore items not held. Plus the catalog-backed
// equip/reload/ammo helpers for the loot system (Phase 3+).

import type { GameState } from "../shared/contracts";
import type { WeaponDef } from "./items/types";
import { allWeapons, ammoItemForType, isWeaponName, weaponDef, FISTS } from "./items/catalog";

export const MAX_STACK = 99;

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

/** Auto-equip a freshly found weapon if its slot is empty (quality of life). */
export function autoEquip(s: GameState, name: string): boolean {
  const w = weaponDef(name);
  if (!w) return false;
  if (w.hand === "melee" && !s.equippedMelee) return equipWeapon(s, name);
  if (w.hand === "ranged" && !s.equippedRanged) return equipWeapon(s, name);
  return false;
}
