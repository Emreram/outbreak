// Base building & barricading (Feature 7): claim a building as home, then build
// barricades, walls, gates, spike traps, storage crates, and crafting stations from
// scavenged materials. Placeables persist on GameState.placeables with live HP, so a
// horde's siege damage carries across save/reload. Pure logic — the scene owns the
// streamed sprites, collision, the build palette, and the siege tick.

import type { GameState, Placeable } from "../shared/contracts";
import { addItem, hasItem, removeItem } from "./inventory";

export interface PlaceableDef {
  id: string;
  name: string;
  cost: { item: string; qty: number }[];
  hp: number; // 0 = indestructible/flavour (stations)
  blocks: boolean; // occupies the tile (player + zombies collide)
  storage?: boolean; // opens the base stash
  station?: "campfire" | "workbench"; // unlocks station-gated recipes nearby
  damage?: number; // contact damage dealt to zombies standing on it (spike traps)
  color: number; // sprite tint / placeholder colour
  desc: string;
}

// Costs use only materials that already exist in the catalog (no new items needed).
export const PLACEABLES: Record<string, PlaceableDef> = {
  barricade: {
    id: "barricade", name: "Barricade", cost: [{ item: "Wood Plank", qty: 2 }], hp: 120, blocks: true,
    color: 0x8a6a3a, desc: "Board up a gap. Slows and soaks a horde.",
  },
  wall: {
    id: "wall", name: "Wooden Wall", cost: [{ item: "Wood Plank", qty: 3 }], hp: 200, blocks: true,
    color: 0x6e5230, desc: "A solid wall section. Tougher than a barricade.",
  },
  gate: {
    id: "gate", name: "Reinforced Gate", cost: [{ item: "Wood Plank", qty: 2 }, { item: "Scrap Metal", qty: 2 }], hp: 260, blocks: true,
    color: 0x9aa3ad, desc: "A metal-braced gate — your toughest barrier.",
  },
  spikes: {
    id: "spikes", name: "Spike Trap", cost: [{ item: "Wood Plank", qty: 1 }, { item: "Scrap Metal", qty: 2 }], hp: 80, blocks: false,
    damage: 6, color: 0xb5651d, desc: "Sharpened stakes — wounds anything that crosses.",
  },
  storage: {
    id: "storage", name: "Storage Crate", cost: [{ item: "Wood Plank", qty: 3 }, { item: "Scrap Metal", qty: 1 }], hp: 100, blocks: true,
    storage: true, color: 0xb5853f, desc: "A footlocker for your base — extra stash space.",
  },
  campfire: {
    id: "campfire", name: "Campfire", cost: [{ item: "Wood Plank", qty: 2 }, { item: "Loose Brick", qty: 2 }], hp: 0, blocks: false,
    station: "campfire", color: 0xd1572a, desc: "Cook meat and boil water (unlocks cooking recipes).",
  },
  workbench: {
    id: "workbench", name: "Workbench", cost: [{ item: "Wood Plank", qty: 3 }, { item: "Scrap Metal", qty: 2 }], hp: 0, blocks: true,
    station: "workbench", color: 0x6e5230, desc: "Craft tools, weapons and traps (unlocks workbench recipes).",
  },
};

/** The order the build palette cycles through (B / wheel). */
export const BUILD_ORDER = ["barricade", "wall", "gate", "spikes", "storage", "campfire", "workbench"] as const;

export function placeableDef(kind: string): PlaceableDef {
  return PLACEABLES[kind] ?? PLACEABLES.barricade;
}

export function placeableGid(tx: number, ty: number): string {
  return `pl_${tx}_${ty}`;
}

export function placeableAt(s: GameState, tx: number, ty: number): Placeable | undefined {
  return s.placeables?.find((p) => p.tx === tx && p.ty === ty);
}

/** A crafted Barricade Kit (workbench) builds a barricade by itself — the prepared
 *  alternative to raw planks. Without this the kit had no use at all. */
function kitCovers(s: GameState, def: PlaceableDef): boolean {
  return def.id === "barricade" && hasItem(s, "Barricade Kit");
}

export function canAfford(s: GameState, def: PlaceableDef): boolean {
  if (kitCovers(s, def)) return true;
  return def.cost.every((c) => hasItem(s, c.item, c.qty));
}

/** Build a placeable at a tile: consume materials (a Barricade Kit covers a
 *  barricade outright), append the record. Returns it, or null if the tile is
 *  taken or the player can't afford it. */
export function buildPlaceable(s: GameState, kind: string, tx: number, ty: number): Placeable | null {
  const def = placeableDef(kind);
  if (placeableAt(s, tx, ty)) return null; // one structure per tile
  if (!canAfford(s, def)) return null;
  if (kitCovers(s, def)) removeItem(s, "Barricade Kit", 1);
  else for (const c of def.cost) removeItem(s, c.item, c.qty);
  const p: Placeable = { gid: placeableGid(tx, ty), kind: def.id, tx, ty, hp: def.hp || 1, maxHp: def.hp || 1 };
  s.placeables = s.placeables ?? [];
  s.placeables.push(p);
  return p;
}

/** Apply siege damage. Returns true when the structure is destroyed (and removed). */
export function damagePlaceable(s: GameState, p: Placeable, dmg: number): boolean {
  const def = placeableDef(p.kind);
  if (def.hp === 0) return false; // stations don't take siege damage
  p.hp -= dmg;
  if (p.hp <= 0) {
    removePlaceable(s, p.gid);
    return true;
  }
  return false;
}

export function removePlaceable(s: GameState, gid: string): void {
  if (!s.placeables) return;
  const i = s.placeables.findIndex((p) => p.gid === gid);
  if (i >= 0) s.placeables.splice(i, 1);
}

// --- the claimed base + its shared storage stash --------------------------------

export function claimBase(s: GameState, gid: string, x: number, y: number, name: string): void {
  s.base = { gid, x, y, name };
}

export function isBaseClaimed(s: GameState, gid: string): boolean {
  return s.base?.gid === gid;
}

/** Move one stack from the pack into base storage. */
export function stash(s: GameState, item: string, qty: number): boolean {
  if (!hasItem(s, item, qty)) return false;
  removeItem(s, item, qty);
  s.baseStorage = s.baseStorage ?? [];
  const ex = s.baseStorage.find((i) => i.item === item);
  if (ex) ex.qty += qty;
  else s.baseStorage.push({ item, qty });
  return true;
}

/** Move one stack from base storage back into the pack. */
export function unstash(s: GameState, item: string, qty: number): boolean {
  const ex = s.baseStorage?.find((i) => i.item === item);
  if (!ex || ex.qty < qty) return false;
  ex.qty -= qty;
  if (ex.qty <= 0) s.baseStorage = s.baseStorage!.filter((i) => i !== ex);
  addItem(s, item, qty);
  return true;
}
