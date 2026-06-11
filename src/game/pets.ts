// Tamable pets (Companions & Spectacle PR-A): a rarity-tiered creature catalog —
// grounded animals at low rarity, full fantasy at the top (user-approved tone
// break). Pure data + helpers; the scene owns sprites, the tame channel, and the
// follow AI (engine/Pet.ts). Every AI/balance parameter lives HERE (ai-code rule:
// data-driven), and every diet item must resolve in the item catalog
// (dataintegrity-enforced).

import type { Rarity } from "./items/types";
import type { GameState, PetState } from "../shared/contracts";
import { RARITY_META } from "./items/rarity";
import type { Rng } from "./rng";

// The persisted instance shape lives beside the other entity contracts.
export type { PetState } from "../shared/contracts";

export type PetMove = "ground" | "fly" | "swim";
export type PetArchetype = "quadruped" | "equine" | "avian" | "drake" | "serpent" | "shelled";
export type PetFeature = "wings" | "horn" | "flameMane" | "scales" | "glowEyes" | "antlers" | "tusks" | "shell" | "crest";
export type PetAura = "light" | "luck" | "fear" | "regen" | "scout";
export type PetVoice = "dog" | "cat" | "horse" | "bird" | "wolf" | "drake" | "serpent" | "mythic";

export interface PetLook {
  archetype: PetArchetype;
  body: number; // base coat colour (BAKED into the canvas — canvas-tint parity)
  accent?: number; // secondary (mane/wing/shell)
  features?: PetFeature[];
}

export interface PetDef {
  id: string;
  name: string;
  rarity: Rarity;
  move: PetMove;
  hp: number;
  speed: number; // ride multiplier (× PLAYER_SPEED); < RIDE_MIN_SPEED = companion-only
  damage: number; // companion bite/claw per hit
  staminaMax: number; // seconds of flight (fly) / sprint (ground) when ridden (PR-B)
  diet: string[]; // catalog item names that tame + feed it
  tameP: number; // per-attempt tame success (0..1]
  aura?: PetAura; // passive while it's the ACTIVE pet
  look: PetLook;
  voice: PetVoice;
  biomes: string[]; // where it can spawn wild (ambient); epic+ spawn from dens/eggs only
  desc: string;
}

export const MAX_PET_ROSTER = 8;
export const MAX_WILD_PETS = 2; // ambient wild pets alive at once
export const RIDE_MIN_SPEED = 1.4; // defs at/above this are mountable (PR-B)
export const TAME_MS = 2000; // hold-E channel duration
export const FEED_HP = 25;
export const FEED_BOND = 0.25;

const MEAT = ["Raw Meat", "Cooked Meat"];
const FISH = ["Raw Fish", "Cooked Fish"];
const GRAZE = ["Carrot", "Wheat", "Corn"];

function pet(d: PetDef): PetDef {
  return d;
}

export const PETS: Record<string, PetDef> = Object.fromEntries(
  [
    // --- common: the strays and the steadfast --------------------------------
    pet({
      id: "stray_dog", name: "Stray Dog", rarity: "common", move: "ground", hp: 32, speed: 1.1, damage: 4,
      staminaMax: 5, diet: ["Canned Food", "Snacks", ...MEAT], tameP: 0.95, look: { archetype: "quadruped", body: 0x9a7b4f, accent: 0x6e5636 },
      voice: "dog", biomes: ["suburb", "parkland", "grassland", "commercial_strip"], desc: "Loyal to whoever still shares their food.",
    }),
    pet({
      id: "cat", name: "Cat", rarity: "common", move: "ground", hp: 22, speed: 1.0, damage: 3,
      staminaMax: 4, diet: [...FISH, "Raw Meat"], tameP: 0.8, aura: "luck", look: { archetype: "quadruped", body: 0x4a4a52, accent: 0x2e2e34 },
      voice: "cat", biomes: ["suburb", "downtown", "commercial_strip", "parkland"], desc: "Keeps its own counsel — and finds things you'd miss.",
    }),
    pet({
      id: "goat", name: "Goat", rarity: "common", move: "ground", hp: 30, speed: 1.2, damage: 4,
      staminaMax: 5, diet: GRAZE, tameP: 0.9, look: { archetype: "quadruped", body: 0xd8d2c4, accent: 0x8a8478, features: ["antlers"] },
      voice: "wolf", biomes: ["farmland", "grassland", "badlands"], desc: "Eats anything. Fears nothing it should.",
    }),
    pet({
      id: "pony", name: "Pony", rarity: "common", move: "ground", hp: 45, speed: 1.5, damage: 4,
      staminaMax: 6, diet: GRAZE, tameP: 0.85, look: { archetype: "equine", body: 0xb08a5a, accent: 0x6e5636 },
      voice: "horse", biomes: ["farmland", "grassland"], desc: "Small, sure-footed, and faster than walking.",
    }),
    // --- uncommon -------------------------------------------------------------
    pet({
      id: "horse", name: "Horse", rarity: "uncommon", move: "ground", hp: 60, speed: 2.0, damage: 5,
      staminaMax: 8, diet: GRAZE, tameP: 0.7, look: { archetype: "equine", body: 0x7a5236, accent: 0x3a2c1e },
      voice: "horse", biomes: ["farmland", "grassland"], desc: "The apocalypse's most honest engine.",
    }),
    pet({
      id: "wolf", name: "Wolf", rarity: "uncommon", move: "ground", hp: 48, speed: 1.25, damage: 7,
      staminaMax: 6, diet: MEAT, tameP: 0.6, look: { archetype: "quadruped", body: 0x6e7078, accent: 0x4a4c52 },
      voice: "wolf", biomes: ["forest", "dense_woods"], desc: "Half threat, half guardian. Feed it well.",
    }),
    pet({
      id: "falcon", name: "Falcon", rarity: "uncommon", move: "fly", hp: 20, speed: 1.0, damage: 5,
      staminaMax: 10, diet: ["Raw Meat", "Raw Fish"], tameP: 0.55, aura: "scout", look: { archetype: "avian", body: 0x8a6f4f, accent: 0xd8d2c4, features: ["wings"] },
      voice: "bird", biomes: ["grassland", "badlands", "coast"], desc: "Eyes for miles — the map fills in around you.",
    }),
    pet({
      id: "donkey", name: "Donkey", rarity: "uncommon", move: "ground", hp: 55, speed: 1.6, damage: 4,
      staminaMax: 9, diet: GRAZE, tameP: 0.75, aura: "luck", look: { archetype: "equine", body: 0x8a8478, accent: 0x5a564c },
      voice: "horse", biomes: ["farmland", "badlands"], desc: "Stubborn, tireless, weirdly lucky.",
    }),
    // --- rare -------------------------------------------------------------------
    pet({
      id: "dire_wolf", name: "Dire Wolf", rarity: "rare", move: "ground", hp: 75, speed: 1.6, damage: 10,
      staminaMax: 8, diet: MEAT, tameP: 0.45, aura: "fear", look: { archetype: "quadruped", body: 0x3c3e46, accent: 0x23242a, features: ["glowEyes"] },
      voice: "wolf", biomes: ["dense_woods"], desc: "The dead remember being prey around it.",
    }),
    pet({
      id: "stag", name: "Great Stag", rarity: "rare", move: "ground", hp: 65, speed: 2.2, damage: 6,
      staminaMax: 9, diet: GRAZE, tameP: 0.5, look: { archetype: "equine", body: 0xa97a4a, accent: 0x6b4a2a, features: ["antlers"] },
      voice: "horse", biomes: ["forest", "dense_woods"], desc: "Crowned king of the quiet woods.",
    }),
    pet({
      id: "raven", name: "Raven", rarity: "rare", move: "fly", hp: 18, speed: 1.0, damage: 4,
      staminaMax: 12, diet: ["Raw Meat", "Snacks"], tameP: 0.45, aura: "scout", look: { archetype: "avian", body: 0x23242a, accent: 0x3c3e46, features: ["wings", "glowEyes"] },
      voice: "bird", biomes: ["forest", "marsh", "badlands"], desc: "It watched the world end. Now it watches for you.",
    }),
    pet({
      id: "snapping_turtle", name: "Snapping Turtle", rarity: "rare", move: "swim", hp: 80, speed: 1.6, damage: 6,
      staminaMax: 20, diet: FISH, tameP: 0.5, look: { archetype: "shelled", body: 0x5a6e46, accent: 0x3c4a30, features: ["shell"] },
      voice: "serpent", biomes: ["marsh", "lake", "riverbank"], desc: "A slow ferry with an armoured hull.",
    }),
    pet({
      id: "warhorse", name: "Warhorse", rarity: "rare", move: "ground", hp: 90, speed: 2.4, damage: 8,
      staminaMax: 10, diet: GRAZE, tameP: 0.4, look: { archetype: "equine", body: 0x2e2e34, accent: 0x1a1a1e },
      voice: "horse", biomes: ["farmland", "grassland"], desc: "Bred for cavalry. The cavalry never came.",
    }),
    // --- epic: where the world stops being explicable -----------------------------
    pet({
      id: "griffin", name: "Griffin", rarity: "epic", move: "fly", hp: 100, speed: 2.4, damage: 11,
      staminaMax: 8, diet: MEAT, tameP: 0.35, look: { archetype: "drake", body: 0xc9a35a, accent: 0xe8dcc0, features: ["wings", "crest"] },
      voice: "drake", biomes: [], desc: "Half eagle, half lion, all sky.",
    }),
    pet({
      id: "kelpie", name: "Kelpie", rarity: "epic", move: "swim", hp: 85, speed: 2.6, damage: 9,
      staminaMax: 20, diet: FISH, tameP: 0.35, look: { archetype: "serpent", body: 0x3f6f93, accent: 0x9be7ff, features: ["crest", "scales"] },
      voice: "serpent", biomes: [], desc: "A horse the water dreamed up.",
    }),
    pet({
      id: "shadow_panther", name: "Shadow Panther", rarity: "epic", move: "ground", hp: 80, speed: 2.6, damage: 12,
      staminaMax: 9, diet: ["Cooked Meat", "Raw Meat"], tameP: 0.3, aura: "fear", look: { archetype: "quadruped", body: 0x1c1c22, accent: 0x2e2240, features: ["glowEyes"] },
      voice: "cat", biomes: [], desc: "You see its eyes. Then you see nothing.",
    }),
    pet({
      id: "razorback", name: "Razorback", rarity: "epic", move: "ground", hp: 120, speed: 2.0, damage: 12,
      staminaMax: 8, diet: ["Potato", "Corn", "Raw Meat"], tameP: 0.35, look: { archetype: "quadruped", body: 0x5a4636, accent: 0x3a2c1e, features: ["tusks"] },
      voice: "wolf", biomes: [], desc: "A boar grown past all reason.",
    }),
    // --- legendary -------------------------------------------------------------
    pet({
      id: "unicorn", name: "Unicorn", rarity: "legendary", move: "ground", hp: 110, speed: 2.8, damage: 9,
      staminaMax: 12, diet: ["Carrot", "Dried Fruit"], tameP: 0.28, aura: "regen", look: { archetype: "equine", body: 0xe8eef4, accent: 0xcfd8e8, features: ["horn"] },
      voice: "mythic", biomes: [], desc: "Proof the world still keeps one promise.",
    }),
    pet({
      id: "dragonling", name: "Dragonling", rarity: "legendary", move: "fly", hp: 95, speed: 2.6, damage: 13,
      staminaMax: 9, diet: ["Cooked Meat", "Cooked Fish"], tameP: 0.28, look: { archetype: "drake", body: 0x8a3a2a, accent: 0xff7a2a, features: ["wings", "scales", "glowEyes"] },
      voice: "drake", biomes: [], desc: "Young, furnace-hearted, and growing.",
    }),
    pet({
      id: "hippogriff", name: "Hippogriff", rarity: "legendary", move: "fly", hp: 105, speed: 2.8, damage: 11,
      staminaMax: 10, diet: ["Cooked Meat", "Carrot"], tameP: 0.25, look: { archetype: "drake", body: 0xb6bac0, accent: 0x6e7078, features: ["wings"] },
      voice: "drake", biomes: [], desc: "Storm-grey wings over horse's heart.",
    }),
    // --- mythic ------------------------------------------------------------------
    pet({
      id: "phoenix", name: "Phoenix", rarity: "mythic", move: "fly", hp: 90, speed: 3.0, damage: 12,
      staminaMax: 12, diet: ["Dried Fruit", "Cooked Meat"], tameP: 0.25, aura: "light", look: { archetype: "avian", body: 0xff7a2a, accent: 0xffd23f, features: ["wings", "flameMane", "glowEyes"] },
      voice: "mythic", biomes: [], desc: "It has died before. It isn't worried.",
    }),
    pet({
      id: "ancient_dragon", name: "Ancient Dragon", rarity: "mythic", move: "fly", hp: 150, speed: 3.2, damage: 16,
      staminaMax: 14, diet: ["Cooked Meat", "MRE"], tameP: 0.2, aura: "fear", look: { archetype: "drake", body: 0x2e4636, accent: 0x9bff6a, features: ["wings", "scales", "glowEyes", "crest"] },
      voice: "mythic", biomes: [], desc: "Older than the outbreak. Older than the city.",
    }),
    pet({
      id: "tide_serpent", name: "Tide Serpent", rarity: "mythic", move: "swim", hp: 130, speed: 3.2, damage: 14,
      staminaMax: 26, diet: FISH, tameP: 0.22, look: { archetype: "serpent", body: 0x1d3a55, accent: 0x6fc3ff, features: ["scales", "crest", "glowEyes"] },
      voice: "serpent", biomes: [], desc: "Rivers part around it. So do leviathans.",
    }),
    pet({
      id: "nightmare", name: "Nightmare", rarity: "mythic", move: "ground", hp: 115, speed: 3.0, damage: 13,
      staminaMax: 12, diet: ["Cooked Meat", "Carrot"], tameP: 0.22, aura: "fear", look: { archetype: "equine", body: 0x1a1a1e, accent: 0xff5a2a, features: ["flameMane", "glowEyes"] },
      voice: "mythic", biomes: [], desc: "Hoofbeats out of a fever dream.",
    }),
  ].map((d) => [d.id, d]),
);

export const PET_IDS: readonly string[] = Object.keys(PETS);

export function getPetDef(id: string): PetDef | undefined {
  return PETS[id];
}

export function isRideable(def: PetDef): boolean {
  return def.speed >= RIDE_MIN_SPEED;
}

/** Bond sweetens the deal: +4% speed and +4% damage per bond level. */
export function bondedSpeed(def: PetDef, bond: number): number {
  return def.speed * (1 + 0.04 * Math.max(0, Math.min(5, bond)));
}
export function bondedDamage(def: PetDef, bond: number): number {
  return Math.round(def.damage * (1 + 0.04 * Math.max(0, Math.min(5, bond))));
}

/** Tame odds for a given bait: right diet = full odds; the COOKED variant of a raw
 *  diet item charms 30% better; wrong food never works (the channel won't start). */
export function tameChance(def: PetDef, bait: string): number {
  if (!def.diet.includes(bait)) return 0;
  const upgraded = bait.startsWith("Cooked") && def.diet.some((d) => d === bait.replace("Cooked", "Raw"));
  return Math.min(1, def.tameP * (upgraded ? 1.3 : 1));
}

/** The bait the player holds for this pet (first matching diet item), if any. */
export function baitFor(def: PetDef, has: (item: string) => boolean): string | null {
  for (const d of def.diet) if (has(d)) return d;
  return null;
}

/** Wild ambient spawns: commons dominate, rare unlocks with the day; epic+ NEVER
 *  spawns ambient (dens + eggs only). Rarity-weighted within the biome's pool. */
export function rollWildPet(rng: Rng, biome: string, day: number): PetDef | null {
  const pool = Object.values(PETS).filter((p) => {
    if (!p.biomes.includes(biome)) return false;
    const rank = RARITY_META[p.rarity].rank;
    if (rank >= 3) return false; // epic+ = dens/eggs only
    if (rank === 2 && day < 2) return false; // rares wait a couple of days
    return true;
  });
  if (pool.length === 0) return null;
  const weights = pool.map((p) => RARITY_META[p.rarity].weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Den species (epic+ wonders) — deterministic per den so it can't be re-rolled. */
export function denSpecies(rng: Rng): PetDef {
  const pool = Object.values(PETS).filter((p) => RARITY_META[p.rarity].rank >= 3);
  const weights = pool.map((p) => RARITY_META[p.rarity].weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[0];
}

/** Roll an egg hatch: a random species OF that rarity (deterministic per rng). */
export function hatchSpecies(rng: Rng, rarity: Rarity): PetDef {
  const pool = Object.values(PETS).filter((p) => p.rarity === rarity);
  return pool.length ? pool[Math.floor(rng.next() * pool.length) % pool.length] : PETS.stray_dog;
}

export const denFlag = (cx: number, cy: number): string => `den_${cx}_${cy}`;

// --- roster helpers (pure GameState mutations; the scene owns sprites) ----------

export function activePet(s: GameState): PetState | undefined {
  return s.pets?.find((p) => p.active);
}

export function getPetState(s: GameState, id: string): PetState | undefined {
  return s.pets?.find((p) => p.id === id);
}

/** Add a freshly-tamed/hatched pet. Becomes active if nothing else is out.
 *  Returns null when the roster is full. */
export function addPet(s: GameState, species: string): PetState | null {
  s.pets = s.pets ?? [];
  if (s.pets.length >= MAX_PET_ROSTER) return null;
  const def = PETS[species] ?? PETS.stray_dog;
  s.petCounter = (s.petCounter ?? 0) + 1;
  const p: PetState = { id: `pet_${s.petCounter}`, species: def.id, bond: 0, hp: def.hp };
  if (!activePet(s)) p.active = true;
  s.pets.push(p);
  return p;
}

/** Make this pet the active companion (everyone else goes to the stable). */
export function setActivePet(s: GameState, id: string): PetState | undefined {
  let chosen: PetState | undefined;
  for (const p of s.pets ?? []) {
    p.active = p.id === id;
    if (p.active) chosen = p;
  }
  return chosen;
}

export function removePet(s: GameState, id: string): void {
  if (!s.pets) return;
  const i = s.pets.findIndex((p) => p.id === id);
  if (i >= 0) s.pets.splice(i, 1);
}

/** Feed the pet: heal + bond (caller consumes the item + handles FX). */
export function feedPet(p: PetState): void {
  const def = PETS[p.species] ?? PETS.stray_dog;
  p.hp = Math.min(def.hp, p.hp + FEED_HP);
  p.bond = Math.min(5, +(p.bond + FEED_BOND).toFixed(2));
}
