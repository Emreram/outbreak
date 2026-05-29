// Inventory operations (CLAUDE.md §8.5): add with stack-merge + per-item cap,
// remove without ever going below zero, and ignore items the player doesn't
// hold. Reused by the debug actions now and by outcomes.ts (GM output) in Phase 4.

import type { GameState } from "../shared/contracts";

export const MAX_STACK = 99;

/** Items that count as a melee/ranged weapon (better combat odds). */
export const WEAPON_ITEMS: ReadonlySet<string> = new Set([
  "Pistol", "Crowbar", "Hatchet", "Hammer", "Baton", "Kitchen Knife", "Machete", "Bat", "Shiv",
]);

/** Whether the player is holding any weapon. */
export function isArmed(s: GameState): boolean {
  return s.inventory.some((i) => WEAPON_ITEMS.has(i.item));
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
