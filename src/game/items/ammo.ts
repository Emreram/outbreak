import type { AmmoDef, Rarity } from "./types";

// Ammo items. `name` is what sits in the inventory; `ammoType` is the calibre id
// that weapons reference (weapons.ts). One friendly name per calibre.

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function ammo(name: string, ammoType: string, rarity: Rarity, tint = 0xd9b54a): AmmoDef {
  return { id: slug(name), name, kind: "ammo", rarity, icon: "ammo", ammoType, tint };
}

export const AMMO: readonly AmmoDef[] = Object.freeze([
  ammo("9mm Rounds", "9mm", "common"),
  ammo(".45 ACP", "45acp", "common"),
  ammo(".357 Rounds", "357", "uncommon"),
  ammo(".50 AE", "50ae", "rare", 0xffd23f),
  ammo("Shotgun Shells", "12ga", "common", 0xd13a2a),
  ammo("5.56 Rounds", "556", "uncommon"),
  ammo("7.62 Rounds", "762", "uncommon"),
  ammo(".308 Rounds", "308", "rare"),
  ammo("Arrows", "arrow", "common", 0x8a6a3a),
  ammo("Crossbow Bolts", "bolt", "uncommon", 0x8a6a3a),
  ammo("Nails", "nail", "common", 0x9aa3ad),
  ammo("Rockets", "rocket", "epic", 0x2a2a2a),
  ammo("Fuel", "fuel", "uncommon", 0xd13a2a),
  ammo("Energy Cells", "cell", "rare", 0x6fc3ff),
]);

/** ammoType -> the inventory item name that feeds it. */
export const AMMO_ITEM_BY_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(AMMO.map((a) => [a.ammoType, a.name])),
);
