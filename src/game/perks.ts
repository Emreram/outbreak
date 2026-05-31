import type { GameState } from "../shared/contracts";

// Character perks (granted by a background). Pure modifier helpers the systems
// query — survival decay, damage taken, combat, consumables, loot, stamina.

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
}

export const PERKS: readonly PerkDef[] = Object.freeze([
  { id: "adaptable", name: "Adaptable", desc: "A little better at everything." },
  { id: "marksman", name: "Marksman", desc: "+25% ranged damage." },
  { id: "brawler", name: "Brawler", desc: "+25% melee damage." },
  { id: "tough", name: "Tough", desc: "Take 25% less physical damage." },
  { id: "fireproof", name: "Fireproof", desc: "Take 60% less burn & toxic damage." },
  { id: "field_medic", name: "Field Medic", desc: "Healing items work 50% better." },
  { id: "lucky", name: "Lucky", desc: "Find rarer loot." },
  { id: "iron_gut", name: "Iron Gut", desc: "Hunger & thirst fall 35% slower." },
  { id: "marathoner", name: "Marathoner", desc: "More stamina, less sprint drain." },
  { id: "scrapper", name: "Scrapper", desc: "Find more ammo & materials." },
  { id: "hardy", name: "Hardy", desc: "Infection spreads 40% slower." },
  { id: "quick", name: "Quick", desc: "Attacks & reloads are 20% faster." },
]);

const PERK_IDS = new Set(PERKS.map((p) => p.id));
export function isPerk(id: string): boolean {
  return PERK_IDS.has(id);
}
export function getPerk(id: string): PerkDef | undefined {
  return PERKS.find((p) => p.id === id);
}
export function hasPerk(s: GameState, id: string): boolean {
  return !!s.perks && s.perks.includes(id);
}

export interface DecayMods {
  hunger: number;
  thirst: number;
  staminaRegen: number;
  infection: number;
}
export function decayMods(s: GameState): DecayMods {
  const m: DecayMods = { hunger: 1, thirst: 1, staminaRegen: 1, infection: 1 };
  if (hasPerk(s, "iron_gut")) {
    m.hunger *= 0.65;
    m.thirst *= 0.65;
  }
  if (hasPerk(s, "marathoner")) m.staminaRegen *= 1.4;
  if (hasPerk(s, "hardy")) m.infection *= 0.6;
  if (hasPerk(s, "adaptable")) {
    m.hunger *= 0.92;
    m.thirst *= 0.92;
    m.infection *= 0.92;
  }
  return m;
}

export type DamageKind = "physical" | "burn" | "toxic" | "shock";
export function damageTakenMult(s: GameState, kind: DamageKind = "physical"): number {
  let m = 1;
  if (hasPerk(s, "tough")) m *= 0.75;
  if (hasPerk(s, "adaptable")) m *= 0.93;
  if ((kind === "burn" || kind === "toxic") && hasPerk(s, "fireproof")) m *= 0.4;
  if (kind === "toxic" && hasPerk(s, "hardy")) m *= 0.75;
  return m;
}

export function meleeMult(s: GameState): number {
  let m = 1;
  if (hasPerk(s, "brawler")) m *= 1.25;
  if (hasPerk(s, "adaptable")) m *= 1.08;
  return m;
}
export function rangedMult(s: GameState): number {
  let m = 1;
  if (hasPerk(s, "marksman")) m *= 1.25;
  if (hasPerk(s, "adaptable")) m *= 1.08;
  return m;
}
export function cooldownMult(s: GameState): number {
  return hasPerk(s, "quick") ? 0.8 : 1;
}
export function consumableMult(s: GameState): number {
  let m = 1;
  if (hasPerk(s, "field_medic")) m *= 1.5;
  if (hasPerk(s, "adaptable")) m *= 1.1;
  return m;
}
export function lootLuck(s: GameState): number {
  let b = 0;
  if (hasPerk(s, "lucky")) b += 0.6;
  if (hasPerk(s, "adaptable")) b += 0.1;
  return b;
}
export function ammoMult(s: GameState): number {
  return hasPerk(s, "scrapper") ? 1.6 : 1;
}
export function sprintDrainMult(s: GameState): number {
  return hasPerk(s, "marathoner") ? 0.6 : 1;
}
