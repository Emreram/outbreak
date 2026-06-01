import type { Rarity } from "../items/types";

// Enemy type system (mirrors the weapon catalog). The GM still emits only the 4
// broad families; the engine rolls a specific ZombieDef from this catalog.

export type EnemyFamily = "zombie" | "zombie_runner" | "survivor_hostile" | "survivor_friendly" | "boss";

// Which loot table a kill rolls (src/game/items/lootTables.ts "enemy:<key>").
export type LootFamily = "zombie" | "zombie_runner" | "survivor_hostile" | "elite" | "boss";

export type Movement = "walker" | "runner" | "leaper" | "crawler" | "stalker" | "erratic" | "lurcher" | "still";

export type ZombieTrait =
  | "biter" // transmits infection (default for undead)
  | "spitter" // fires an acid projectile at the player
  | "screamer" // pulses: raises nearby aggro / summons a couple of minis
  | "exploder" // bursts for AoE damage on death
  | "splitter" // spawns 2-3 mini zombies on death
  | "toxic" // leaves a lingering damage cloud
  | "grabber" // briefly stuns/slows the player on contact
  | "brute" // heavy knockback on contact
  | "electric" // arcs / chains a small shock
  | "frenzied" // speeds up as it loses HP
  | "armored" // takes reduced damage
  | "regenerator" // heals over time
  | "bloated" // big HP pool (and a gas burst)
  | "undying" // revives once at low HP
  | "leaper" // dashes toward the player
  | "fast" // simply quick
  | "acidic" // damages on touch a touch more
  | "shielded"; // front-facing damage reduction

export type BodyArchetype =
  | "humanoid" | "bloated" | "crawler" | "brute" | "lanky" | "child" | "hazmat"
  | "spitter" | "screamer" | "husk" | "armored" | "toxic" | "runner" | "behemoth";

export type Feature = "bone" | "blood" | "spikes" | "glow" | "sacs" | "plates" | "tatters" | "horns" | "drip";

export interface LookSpec {
  body: BodyArchetype;
  skin: number; // base body colour
  accent?: number; // clothing / secondary colour
  eyes?: number; // eye glow colour
  features?: Feature[];
}

export interface ZombieDef {
  id: string;
  name: string;
  family: EnemyFamily;
  lootFamily: LootFamily;
  rarity: Rarity;
  hp: number;
  speed: number; // px/s
  aggro: number; // px detection radius (0 = never aggros)
  damage: number; // hp per hit
  bite: boolean; // transmits infection
  scale: number;
  movement: Movement;
  traits: ZombieTrait[];
  look: LookSpec;
  minDay: number; // earliest day this type can appear
  desc?: string;
}

export const MOVEMENTS: readonly Movement[] = [
  "walker", "runner", "leaper", "crawler", "stalker", "erratic", "lurcher", "still",
];
export const TRAITS: readonly ZombieTrait[] = [
  "biter", "spitter", "screamer", "exploder", "splitter", "toxic", "grabber", "brute",
  "electric", "frenzied", "armored", "regenerator", "bloated", "undying", "leaper", "fast",
  "acidic", "shielded",
];
export const FAMILIES: readonly EnemyFamily[] = [
  "zombie", "zombie_runner", "survivor_hostile", "survivor_friendly", "boss",
];
