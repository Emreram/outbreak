// Item / weapon type system (Phase 1 of the loot system). Inventory stays
// name-keyed {item, qty}; these definitions add the richness behind each name via
// the catalog. The AI proposes item names; the engine looks up the def here.

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export type ItemKind = "weapon" | "consumable" | "ammo" | "material" | "throwable" | "armor" | "readable";

export type Hand = "melee" | "ranged";

export type WeaponClass =
  | "fist"
  | "blade"
  | "axe"
  | "blunt"
  | "spear"
  | "polearm"
  | "whip"
  | "thrown"
  | "pistol"
  | "revolver"
  | "smg"
  | "shotgun"
  | "rifle"
  | "dmr"
  | "lmg"
  | "bow"
  | "crossbow"
  | "launcher"
  | "flame"
  | "nailgun"
  | "energy";

export type AbilityKind =
  | "bleed" // value = hp/tick over time
  | "cleave" // value = extra targets hit in an arc
  | "knockback" // value = px/s shove
  | "stun" // value = ms frozen
  | "pierce" // value = enemies a shot passes through
  | "lifesteal" // value = % of damage healed
  | "crit" // value = % chance (2x)
  | "burn" // value = burn dps
  | "execute" // value = % hp threshold for instant kill
  | "chain" // value = jumps to nearby enemies
  | "ricochet" // value = bounces
  | "explosive" // value = blast radius px
  | "incendiary" // value = fire pool seconds
  | "quiet" // value = noise reduction (just a flag-ish)
  | "heavy" // value = bonus vs tough
  | "fast" // value = attack-speed flag
  | "poison" // value = poison dps
  | "freeze" // value = slow %
  | "armorpierce" // value = ignores defense %
  | "vampiric"; // value = % max-hp heal on kill

export interface Ability {
  kind: AbilityKind;
  value: number;
}

export interface BaseDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  icon: string; // icon-class key for the procedural generator (Phase 2)
  tint?: number; // material tint applied to the icon
  desc?: string;
  value?: number; // trade / score value
}

export interface WeaponDef extends BaseDef {
  kind: "weapon";
  hand: Hand;
  wclass: WeaponClass;
  damage: number; // per hit (melee) / per projectile (ranged)
  range: number; // px reach (melee) or effective range (ranged)
  cooldownMs: number; // between swings / shots
  noise: number; // aggro noise on use
  abilities: Ability[];
  twoHanded?: boolean;
  // ranged-only
  ammoType?: string;
  magSize?: number;
  reloadMs?: number;
  pellets?: number; // shotgun pellets per shot
  spread?: number; // radians of spread
  projectileSpeed?: number; // px/s
}

export type StatKey = "hp" | "stamina" | "hunger" | "thirst" | "infection";

export interface ConsumableDef extends BaseDef {
  kind: "consumable";
  effects: Partial<Record<StatKey, number>>; // stat deltas applied on use
  cure?: boolean; // clears infection entirely
}

export interface AmmoDef extends BaseDef {
  kind: "ammo";
  ammoType: string; // the calibre id weapons reference
}

export interface ThrowableDef extends BaseDef {
  kind: "throwable";
  damage: number;
  radius: number;
  effect?: AbilityKind;
}

export interface MaterialDef extends BaseDef {
  kind: "material";
}

export interface ArmorDef extends BaseDef {
  kind: "armor";
  defense: number; // % incoming damage reduced
  slot?: "head" | "body"; // equip slot (default body); body + head stack
}

/** Notes / journals / stash maps (Expansion U2) — found while scavenging; read
 *  via the bag. Maps consume on use and pin a buried cache; notes are flavour. */
export interface ReadableDef extends BaseDef {
  kind: "readable";
  flavor: "note" | "journal" | "map";
}

export type ItemDef = WeaponDef | ConsumableDef | AmmoDef | ThrowableDef | MaterialDef | ArmorDef | ReadableDef;

export function isWeaponDef(d: ItemDef | undefined): d is WeaponDef {
  return !!d && d.kind === "weapon";
}
