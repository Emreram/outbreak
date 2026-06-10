import type { ItemDef, WeaponDef } from "./types";
import { isWeaponDef } from "./types";
import { WEAPONS, FISTS } from "./weapons";
import { MISC_ITEMS } from "./consumables";
import { AMMO, AMMO_ITEM_BY_TYPE } from "./ammo";
import { READABLES } from "./readables";

// The item catalog: the single name -> definition lookup. Inventory stays
// name-keyed; everything rich (stats, rarity, abilities, icon) is resolved here.
// READABLES resolve here for icons/tooltips but stay OUT of the loot pools
// (lootTables builds its pools from WEAPONS/MISC_ITEMS/AMMO directly).

const ALL: readonly ItemDef[] = Object.freeze([...WEAPONS, FISTS, ...MISC_ITEMS, ...AMMO, ...READABLES]);

const BY_NAME = new Map<string, ItemDef>();
for (const d of ALL) BY_NAME.set(d.name, d);

export function getItemDef(name: string): ItemDef | undefined {
  return BY_NAME.get(name);
}

/** Unknown item name -> a safe generic common material so UI/loot never breaks. */
export function genericDef(name: string): ItemDef {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "item",
    name,
    kind: "material",
    rarity: "common",
    icon: "scrap",
  };
}

/** Def or generic fallback — never undefined. */
export function defOf(name: string): ItemDef {
  return BY_NAME.get(name) ?? genericDef(name);
}

export function isWeaponName(name: string): boolean {
  return isWeaponDef(BY_NAME.get(name));
}

export function weaponDef(name: string): WeaponDef | undefined {
  const d = BY_NAME.get(name);
  return isWeaponDef(d) ? d : undefined;
}

export function allWeapons(): readonly WeaponDef[] {
  return WEAPONS;
}

export function allItems(): readonly ItemDef[] {
  return ALL;
}

/** Which inventory item feeds a weapon's calibre (e.g. "9mm" -> "9mm Rounds"). */
export function ammoItemForType(ammoType: string | undefined): string | undefined {
  return ammoType ? AMMO_ITEM_BY_TYPE[ammoType] : undefined;
}

export { FISTS };
