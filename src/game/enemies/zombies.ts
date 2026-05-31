import type { BodyArchetype, EnemyFamily, Feature, LootFamily, Movement, ZombieDef, ZombieTrait } from "./types";
import type { Rarity } from "../items/types";
import { rarityRank } from "../items/rarity";

// 100+ hand-authored zombie/enemy types. A compact builder fills sensible defaults
// (bite by family, loot family, aggro). Each entry is unique in name + stats + look
// + traits. minDay gates nastier types to later days; rarity drives spawn weight.

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function defaultLoot(fam: EnemyFamily, r: Rarity): LootFamily {
  if (fam === "boss") return "boss";
  if (fam === "survivor_hostile" || fam === "survivor_friendly") return "survivor_hostile";
  if (fam === "zombie_runner") return "zombie_runner";
  return rarityRank(r) >= 3 ? "elite" : "zombie";
}

// Skin / accent palette
const ROT = 0x6b8f5a;
const ROT2 = 0x5a7a4a;
const ROT3 = 0x7a9a6a;
const PALE = 0x9aa39a;
const FROST = 0x8aa0b8;
const TOXIC = 0x8fd14a;
const CHAR = 0x39302c;
const BLOATC = 0x6a8a9a;
const GRAY = 0x7a8070;
const BONE = 0xcfc6ad;
const EYE_RED = 0xff3030;
const EYE_BLUE = 0x6fc3ff;
const EYE_GRN = 0x9bff6a;
const EYE_PUR = 0xb368ff;
const EYE_YEL = 0xffd23f;

interface ZIn {
  n: string;
  fam?: EnemyFamily;
  loot?: LootFamily;
  r: Rarity;
  hp: number;
  spd: number;
  aggro?: number;
  dmg: number;
  bite?: boolean;
  scale?: number;
  mv?: Movement;
  tr?: ZombieTrait[];
  body: BodyArchetype;
  skin: number;
  accent?: number;
  eyes?: number;
  feat?: Feature[];
  minDay?: number;
  desc?: string;
}

function Z(p: ZIn): ZombieDef {
  const family = p.fam ?? "zombie";
  return {
    id: slug(p.n),
    name: p.n,
    family,
    lootFamily: p.loot ?? defaultLoot(family, p.r),
    rarity: p.r,
    hp: p.hp,
    speed: p.spd,
    aggro: p.aggro ?? (family === "survivor_friendly" ? 0 : 160),
    damage: p.dmg,
    bite: p.bite ?? (family === "zombie" || family === "zombie_runner" || family === "boss"),
    scale: p.scale ?? 0.8,
    movement: p.mv ?? "walker",
    traits: p.tr ?? [],
    look: { body: p.body, skin: p.skin, accent: p.accent, eyes: p.eyes, features: p.feat },
    minDay: p.minDay ?? 0,
    desc: p.desc,
  };
}

// --- common / uncommon walkers -------------------------------------------------
const WALKERS: ZombieDef[] = [
  Z({ n: "Shambler", r: "common", hp: 14, spd: 55, dmg: 6, body: "humanoid", skin: ROT, feat: ["blood"], desc: "The everyman of the apocalypse." }),
  Z({ n: "Fresh Corpse", r: "common", hp: 12, spd: 58, dmg: 5, body: "humanoid", skin: ROT3 }),
  Z({ n: "Rotter", r: "common", hp: 16, spd: 50, dmg: 6, body: "humanoid", skin: ROT2, feat: ["blood", "drip"] }),
  Z({ n: "Pale Walker", r: "common", hp: 14, spd: 54, dmg: 6, body: "humanoid", skin: PALE }),
  Z({ n: "Office Drone", r: "common", hp: 14, spd: 56, dmg: 6, body: "humanoid", skin: ROT, accent: 0x33415a, feat: ["tatters"] }),
  Z({ n: "Commuter", r: "common", hp: 14, spd: 58, dmg: 6, body: "humanoid", skin: ROT3, accent: 0x444 }),
  Z({ n: "Mallrat", r: "common", hp: 13, spd: 60, dmg: 5, body: "humanoid", skin: ROT3, accent: 0xd14a8a }),
  Z({ n: "Ragged One", r: "common", hp: 15, spd: 52, dmg: 6, body: "humanoid", skin: ROT2, feat: ["tatters"] }),
  Z({ n: "Worker Stiff", r: "common", hp: 15, spd: 54, dmg: 6, body: "humanoid", skin: ROT, accent: 0xffa23f }),
  Z({ n: "Nurse", r: "common", hp: 13, spd: 56, dmg: 6, body: "humanoid", skin: 0x9ab0a0, accent: 0xe8eef4 }),
  Z({ n: "Janitor", r: "common", hp: 16, spd: 50, dmg: 6, body: "humanoid", skin: ROT, accent: 0x2a3a4a }),
  Z({ n: "Suit Walker", r: "common", hp: 14, spd: 56, dmg: 6, body: "humanoid", skin: ROT, accent: 0x111 }),
  Z({ n: "Gas Ghoul", r: "common", hp: 13, spd: 55, dmg: 5, body: "humanoid", skin: ROT, accent: 0xd13a2a }),
  Z({ n: "Bloodied Walker", r: "uncommon", hp: 16, spd: 56, dmg: 7, body: "humanoid", skin: ROT, eyes: EYE_RED, feat: ["blood", "glow"] }),
  Z({ n: "Sunbaked Husk", r: "uncommon", hp: 12, spd: 58, dmg: 6, body: "husk", skin: BONE, feat: ["bone"] }),
  Z({ n: "Frostbitten", r: "uncommon", hp: 16, spd: 48, dmg: 7, body: "humanoid", skin: FROST, minDay: 1 }),
  Z({ n: "Waterlogged", r: "uncommon", hp: 18, spd: 44, dmg: 7, body: "bloated", skin: BLOATC, minDay: 1, feat: ["drip"] }),
  Z({ n: "Cop Walker", r: "uncommon", hp: 18, spd: 56, dmg: 8, body: "humanoid", skin: ROT, accent: 0x23303f, tr: ["armored"], feat: ["plates"], minDay: 1 }),
  Z({ n: "Biker", r: "uncommon", hp: 18, spd: 64, dmg: 8, body: "humanoid", skin: ROT, accent: 0x111, feat: ["tatters"] }),
  Z({ n: "Linebacker", r: "uncommon", hp: 22, spd: 58, dmg: 8, body: "brute", skin: ROT, accent: 0x5a2a2a, scale: 0.92, tr: ["brute"], minDay: 1 }),
  Z({ n: "Drowned", r: "uncommon", hp: 17, spd: 46, dmg: 7, body: "bloated", skin: 0x5a7a7a, minDay: 1, feat: ["drip"] }),
  Z({ n: "Ash Walker", r: "uncommon", hp: 15, spd: 52, dmg: 8, body: "husk", skin: CHAR, eyes: EYE_YEL, feat: ["bone", "glow"], minDay: 1 }),
  Z({ n: "Maimed", r: "common", hp: 12, spd: 50, dmg: 5, body: "humanoid", skin: ROT2, feat: ["bone", "blood"] }),
  Z({ n: "Twitcher", r: "uncommon", hp: 13, spd: 70, dmg: 6, body: "humanoid", skin: ROT3, mv: "erratic", eyes: EYE_GRN, feat: ["glow"] }),
  Z({ n: "Hollow", r: "common", hp: 14, spd: 54, dmg: 6, body: "humanoid", skin: PALE, eyes: 0x222 }),
  Z({ n: "Vagrant", r: "common", hp: 15, spd: 52, dmg: 6, body: "humanoid", skin: ROT2, accent: 0x6b4a2a, feat: ["tatters"] }),
];

// --- crawlers & lurchers -------------------------------------------------------
const CRAWLERS: ZombieDef[] = [
  Z({ n: "Crawler", r: "uncommon", hp: 12, spd: 40, dmg: 7, scale: 0.62, body: "crawler", skin: ROT2, mv: "crawler", feat: ["blood"], desc: "Drags itself by the arms — easy to miss underfoot." }),
  Z({ n: "Dragger", r: "uncommon", hp: 14, spd: 36, dmg: 8, scale: 0.6, body: "crawler", skin: ROT, mv: "crawler", feat: ["bone"] }),
  Z({ n: "Creeper", r: "rare", hp: 14, spd: 44, dmg: 8, scale: 0.62, body: "crawler", skin: TOXIC, mv: "crawler", tr: ["toxic"], eyes: EYE_GRN, feat: ["glow", "drip"], minDay: 2 }),
  Z({ n: "Lurcher", r: "uncommon", hp: 18, spd: 58, dmg: 8, body: "lanky", skin: PALE, mv: "lurcher", scale: 0.86 }),
  Z({ n: "Stalker", r: "rare", hp: 16, spd: 74, dmg: 9, body: "lanky", skin: 0x4a4a5a, mv: "stalker", eyes: EYE_PUR, feat: ["glow"], minDay: 2, desc: "Goes still when you look at it. Then it doesn't." }),
  Z({ n: "Skitterer", r: "rare", hp: 11, spd: 92, dmg: 7, scale: 0.58, body: "crawler", skin: 0x6a5a7a, mv: "erratic", eyes: EYE_PUR, feat: ["spikes"], minDay: 2 }),
  Z({ n: "Limbless", r: "common", hp: 10, spd: 30, dmg: 6, scale: 0.55, body: "crawler", skin: ROT2, feat: ["bone", "blood"] }),
  Z({ n: "Ankle-Biter", r: "uncommon", hp: 9, spd: 64, dmg: 6, scale: 0.5, body: "child", skin: ROT3, mv: "erratic", tr: ["fast"] }),
];

// --- runners (fast) ------------------------------------------------------------
const RUNNERS: ZombieDef[] = [
  Z({ n: "Runner", fam: "zombie_runner", r: "uncommon", hp: 18, spd: 132, dmg: 9, body: "runner", skin: ROT, eyes: EYE_RED, tr: ["fast"], feat: ["glow"], minDay: 1 }),
  Z({ n: "Sprinter", fam: "zombie_runner", r: "uncommon", hp: 16, spd: 150, dmg: 8, body: "runner", skin: ROT3, mv: "runner", tr: ["fast"], minDay: 1 }),
  Z({ n: "Lunatic", fam: "zombie_runner", r: "rare", hp: 18, spd: 140, dmg: 10, body: "runner", skin: 0x8a4a4a, mv: "erratic", eyes: EYE_RED, tr: ["fast", "frenzied"], feat: ["blood", "glow"], minDay: 2 }),
  Z({ n: "Leaper", fam: "zombie_runner", r: "rare", hp: 17, spd: 120, dmg: 11, body: "lanky", skin: 0x6a7a4a, mv: "leaper", tr: ["leaper"], feat: ["spikes"], minDay: 2, desc: "Closes the gap in one terrible bound." }),
  Z({ n: "Pouncer", fam: "zombie_runner", r: "rare", hp: 16, spd: 128, dmg: 12, body: "lanky", skin: 0x7a5a3a, mv: "leaper", tr: ["leaper", "grabber"], eyes: EYE_YEL, minDay: 3 }),
  Z({ n: "Feral", fam: "zombie_runner", r: "uncommon", hp: 19, spd: 138, dmg: 9, body: "runner", skin: ROT2, mv: "runner", tr: ["fast"], feat: ["tatters"], minDay: 1 }),
  Z({ n: "Rabid", fam: "zombie_runner", r: "rare", hp: 17, spd: 146, dmg: 10, body: "runner", skin: 0x9a5a4a, tr: ["fast", "frenzied"], eyes: EYE_RED, feat: ["drip"], minDay: 2 }),
  Z({ n: "Greyhound", fam: "zombie_runner", r: "rare", hp: 15, spd: 168, dmg: 9, body: "lanky", skin: GRAY, mv: "runner", tr: ["fast"], minDay: 3 }),
  Z({ n: "Screech-Runner", fam: "zombie_runner", r: "epic", hp: 20, spd: 134, dmg: 10, body: "screamer", skin: 0x7a4a6a, tr: ["fast", "screamer"], eyes: EYE_PUR, feat: ["glow"], minDay: 3 }),
  Z({ n: "Marathoner", fam: "zombie_runner", r: "uncommon", hp: 22, spd: 124, dmg: 9, body: "runner", skin: ROT, tr: ["fast"], minDay: 2 }),
  Z({ n: "Jolt", fam: "zombie_runner", r: "epic", hp: 18, spd: 144, dmg: 11, body: "runner", skin: 0x4a6a8a, tr: ["fast", "electric"], eyes: EYE_BLUE, feat: ["glow", "spikes"], minDay: 4 }),
  Z({ n: "Whiplash", fam: "zombie_runner", r: "rare", hp: 17, spd: 156, dmg: 10, body: "lanky", skin: 0x6a4a5a, mv: "leaper", tr: ["fast", "leaper"], minDay: 3 }),
  Z({ n: "Hunter", fam: "zombie_runner", r: "epic", hp: 24, spd: 138, dmg: 12, body: "lanky", skin: 0x3a4a3a, mv: "stalker", eyes: EYE_GRN, tr: ["fast", "leaper", "grabber"], feat: ["glow"], minDay: 4 }),
  Z({ n: "Dasher", fam: "zombie_runner", r: "uncommon", hp: 16, spd: 152, dmg: 8, body: "runner", skin: ROT3, tr: ["fast"], minDay: 1 }),
  Z({ n: "Bloodhound", fam: "zombie_runner", r: "rare", hp: 19, spd: 142, dmg: 11, aggro: 320, body: "runner", skin: 0x8a4a4a, tr: ["fast"], eyes: EYE_RED, feat: ["blood"], minDay: 3, desc: "Smells you from blocks away." }),
];

// --- special undead (trait-driven) --------------------------------------------
const SPECIALS: ZombieDef[] = [
  Z({ n: "Spitter", r: "rare", hp: 16, spd: 48, dmg: 6, body: "spitter", skin: TOXIC, tr: ["spitter"], eyes: EYE_GRN, feat: ["sacs", "glow", "drip"], minDay: 2, desc: "Hawks a glob of acid across the street." }),
  Z({ n: "Acid Spitter", r: "epic", hp: 18, spd: 50, dmg: 7, body: "spitter", skin: 0x6fb030, tr: ["spitter", "acidic"], eyes: EYE_GRN, feat: ["sacs", "drip", "glow"], minDay: 3 }),
  Z({ n: "Bile Thrower", r: "rare", hp: 20, spd: 44, dmg: 7, body: "spitter", skin: 0x7a8a3a, tr: ["spitter", "toxic"], feat: ["sacs", "drip"], minDay: 3 }),
  Z({ n: "Screamer", r: "rare", hp: 15, spd: 56, dmg: 5, body: "screamer", skin: 0x8a6a8a, tr: ["screamer"], eyes: EYE_PUR, feat: ["glow"], minDay: 2, desc: "Its shriek brings friends." }),
  Z({ n: "Banshee", r: "epic", hp: 18, spd: 60, dmg: 6, body: "screamer", skin: 0x9a6aaa, tr: ["screamer"], eyes: EYE_PUR, feat: ["glow", "horns"], minDay: 4 }),
  Z({ n: "Bloater", r: "rare", hp: 38, spd: 38, dmg: 9, scale: 1.05, body: "bloated", skin: BLOATC, tr: ["bloated", "exploder", "toxic"], feat: ["sacs", "drip"], minDay: 2, desc: "Don't be standing next to it when it pops." }),
  Z({ n: "Gasbag", r: "uncommon", hp: 30, spd: 36, dmg: 8, scale: 1.0, body: "bloated", skin: 0x7a9a5a, tr: ["bloated", "exploder"], feat: ["sacs"], minDay: 2 }),
  Z({ n: "Boomer", r: "rare", hp: 28, spd: 40, dmg: 8, scale: 1.0, body: "bloated", skin: 0x9a7a4a, tr: ["exploder"], feat: ["sacs", "drip"], minDay: 2 }),
  Z({ n: "Splitter", r: "epic", hp: 30, spd: 44, dmg: 8, scale: 1.0, body: "bloated", skin: 0x6a7a8a, tr: ["splitter"], feat: ["sacs"], minDay: 3, desc: "Kill it and you've made three problems." }),
  Z({ n: "Brood Mother", r: "legendary", hp: 60, spd: 36, dmg: 10, scale: 1.15, body: "bloated", skin: 0x7a5a6a, tr: ["splitter", "bloated", "screamer"], eyes: EYE_PUR, feat: ["sacs", "drip", "horns"], minDay: 5 }),
  Z({ n: "Armored Walker", r: "rare", hp: 32, spd: 50, dmg: 9, body: "armored", skin: ROT, accent: 0x3a4250, tr: ["armored"], feat: ["plates"], minDay: 2 }),
  Z({ n: "Riot Husk", r: "epic", hp: 40, spd: 52, dmg: 10, body: "armored", skin: ROT, accent: 0x23262b, tr: ["armored", "shielded"], feat: ["plates"], minDay: 3, desc: "Still wearing the gear that didn't save it." }),
  Z({ n: "Juggernaut Zed", r: "epic", hp: 55, spd: 46, dmg: 13, scale: 1.1, body: "brute", skin: ROT2, accent: 0x2a2a2a, tr: ["armored", "brute"], feat: ["plates"], minDay: 4 }),
  Z({ n: "Regenerator", r: "epic", hp: 30, spd: 52, dmg: 9, body: "humanoid", skin: 0x7aaf6a, tr: ["regenerator"], eyes: EYE_GRN, feat: ["glow", "drip"], minDay: 4, desc: "Hurt it fast or not at all." }),
  Z({ n: "Reviver", r: "epic", hp: 24, spd: 54, dmg: 9, body: "humanoid", skin: 0x8a8aaf, tr: ["undying"], eyes: EYE_BLUE, feat: ["glow"], minDay: 4 }),
  Z({ n: "Toxic Walker", r: "rare", hp: 20, spd: 46, dmg: 8, body: "toxic", skin: TOXIC, tr: ["toxic"], eyes: EYE_GRN, feat: ["drip", "glow"], minDay: 2 }),
  Z({ n: "Plague Carrier", r: "epic", hp: 26, spd: 48, dmg: 9, body: "toxic", skin: 0x6f9a3a, tr: ["toxic", "screamer"], feat: ["sacs", "drip"], minDay: 4 }),
  Z({ n: "Grabber", r: "rare", hp: 22, spd: 58, dmg: 8, body: "lanky", skin: 0x5a5a4a, tr: ["grabber"], feat: ["spikes"], minDay: 3, desc: "Latches on and won't let go." }),
  Z({ n: "Clinger", r: "uncommon", hp: 16, spd: 70, dmg: 7, scale: 0.7, body: "child", skin: ROT3, tr: ["grabber", "fast"], minDay: 2 }),
  Z({ n: "Brute", r: "epic", hp: 50, spd: 48, dmg: 14, scale: 1.12, body: "brute", skin: ROT, tr: ["brute"], feat: ["bone"], minDay: 3 }),
  Z({ n: "Smasher", r: "rare", hp: 40, spd: 50, dmg: 12, scale: 1.05, body: "brute", skin: ROT2, tr: ["brute"], minDay: 3 }),
  Z({ n: "Static Zed", r: "epic", hp: 24, spd: 56, dmg: 9, body: "humanoid", skin: 0x4a6a8a, tr: ["electric"], eyes: EYE_BLUE, feat: ["glow", "spikes"], minDay: 4 }),
  Z({ n: "Live Wire", r: "legendary", hp: 30, spd: 60, dmg: 11, body: "lanky", skin: 0x3a5a8a, tr: ["electric", "fast"], eyes: EYE_BLUE, feat: ["glow", "spikes"], minDay: 5 }),
  Z({ n: "Hazmat Zed", r: "rare", hp: 26, spd: 50, dmg: 8, body: "hazmat", skin: 0xffd23f, accent: 0x222, tr: ["toxic", "armored"], feat: ["plates"], minDay: 3, desc: "Sealed in, sealed wrong." }),
  Z({ n: "Frenzied", r: "rare", hp: 20, spd: 84, dmg: 10, body: "runner", skin: 0x8a4a4a, tr: ["frenzied", "fast"], eyes: EYE_RED, feat: ["blood"], minDay: 3 }),
  Z({ n: "Spiker", r: "rare", hp: 24, spd: 52, dmg: 10, body: "armored", skin: 0x5a4a4a, tr: ["acidic"], feat: ["spikes", "bone"], minDay: 3 }),
];

// --- hostile survivors ---------------------------------------------------------
const SURVIVORS: ZombieDef[] = [
  Z({ n: "Looter", fam: "survivor_hostile", r: "uncommon", hp: 22, spd: 88, dmg: 8, body: "humanoid", skin: 0xd9b48a, accent: 0x3a4a2a, bite: false, feat: ["tatters"], minDay: 1 }),
  Z({ n: "Raider", fam: "survivor_hostile", r: "rare", hp: 28, spd: 92, dmg: 10, body: "humanoid", skin: 0xd9b48a, accent: 0x5a2a2a, bite: false, tr: ["armored"], feat: ["plates"], minDay: 2 }),
  Z({ n: "Bandit", fam: "survivor_hostile", r: "uncommon", hp: 24, spd: 90, dmg: 9, body: "humanoid", skin: 0xc9a47a, accent: 0x2a2a2a, bite: false, minDay: 2 }),
  Z({ n: "Marauder", fam: "survivor_hostile", r: "rare", hp: 30, spd: 86, dmg: 11, body: "brute", skin: 0xd9b48a, accent: 0x3a3a2a, bite: false, tr: ["brute"], scale: 0.9, minDay: 3 }),
  Z({ n: "Cultist", fam: "survivor_hostile", r: "rare", hp: 22, spd: 90, dmg: 9, body: "humanoid", skin: 0xc9a47a, accent: 0x5a2a5a, bite: false, eyes: EYE_PUR, feat: ["glow", "tatters"], minDay: 3 }),
  Z({ n: "Gunner", fam: "survivor_hostile", r: "epic", hp: 26, spd: 84, dmg: 8, body: "humanoid", skin: 0xd9b48a, accent: 0x23303f, bite: false, tr: ["spitter"], minDay: 4, desc: "Takes pot-shots from a distance." }),
  Z({ n: "Brawler", fam: "survivor_hostile", r: "uncommon", hp: 28, spd: 88, dmg: 10, body: "brute", skin: 0xd9b48a, accent: 0x444, bite: false, tr: ["brute"], minDay: 2 }),
  Z({ n: "Scavenger", fam: "survivor_hostile", r: "common", hp: 20, spd: 90, dmg: 7, body: "humanoid", skin: 0xc9a47a, accent: 0x6b4a2a, bite: false, feat: ["tatters"], minDay: 1 }),
  Z({ n: "Zealot", fam: "survivor_hostile", r: "epic", hp: 30, spd: 96, dmg: 11, body: "humanoid", skin: 0xc9a47a, accent: 0x6a1a1a, bite: false, tr: ["frenzied"], eyes: EYE_RED, feat: ["tatters"], minDay: 4 }),
  Z({ n: "Warlord", fam: "survivor_hostile", r: "legendary", hp: 48, spd: 90, dmg: 13, scale: 0.95, body: "armored", skin: 0xd9b48a, accent: 0x1a1a1a, bite: false, tr: ["armored", "brute"], feat: ["plates"], minDay: 6 }),
  Z({ n: "Sniper", fam: "survivor_hostile", r: "epic", hp: 22, spd: 80, dmg: 12, aggro: 360, body: "lanky", skin: 0xd9b48a, accent: 0x3a4a2a, bite: false, tr: ["spitter"], minDay: 5 }),
  Z({ n: "Pyro", fam: "survivor_hostile", r: "epic", hp: 26, spd: 84, dmg: 10, body: "hazmat", skin: 0xd13a2a, accent: 0x222, bite: false, tr: ["toxic", "spitter"], minDay: 5 }),
];

// --- friendly survivors --------------------------------------------------------
const FRIENDLIES: ZombieDef[] = [
  Z({ n: "Wanderer", fam: "survivor_friendly", r: "common", hp: 14, spd: 40, dmg: 0, bite: false, body: "humanoid", skin: 0x9affa6, accent: 0x3a5236 }),
  Z({ n: "Refugee", fam: "survivor_friendly", r: "uncommon", hp: 16, spd: 38, dmg: 0, bite: false, body: "humanoid", skin: 0x9affa6, accent: 0x6b4a2a, feat: ["tatters"] }),
  Z({ n: "Medic", fam: "survivor_friendly", r: "rare", hp: 18, spd: 42, dmg: 0, bite: false, body: "humanoid", skin: 0x9affa6, accent: 0xe8eef4 }),
];

// --- elites & bosses -----------------------------------------------------------
const BOSSES: ZombieDef[] = [
  Z({ n: "Tank", fam: "boss", r: "epic", hp: 120, spd: 50, dmg: 16, scale: 1.4, aggro: 260, body: "behemoth", skin: ROT2, accent: 0x2a2a2a, tr: ["armored", "brute"], feat: ["plates", "bone"], minDay: 4, desc: "A wall of dead muscle." }),
  Z({ n: "Behemoth", fam: "boss", r: "legendary", hp: 200, spd: 44, dmg: 20, scale: 1.6, aggro: 300, body: "behemoth", skin: 0x5a6a4a, tr: ["armored", "brute", "exploder"], feat: ["plates", "spikes", "bone"], minDay: 6 }),
  Z({ n: "The Bloat King", fam: "boss", r: "legendary", hp: 160, spd: 38, dmg: 14, scale: 1.5, body: "bloated", skin: 0x6a8a7a, tr: ["splitter", "exploder", "toxic", "bloated"], eyes: EYE_GRN, feat: ["sacs", "drip"], minDay: 6 }),
  Z({ n: "Screech Queen", fam: "boss", r: "legendary", hp: 130, spd: 56, dmg: 14, scale: 1.35, body: "screamer", skin: 0x8a5a8a, tr: ["screamer", "splitter"], eyes: EYE_PUR, feat: ["glow", "horns"], minDay: 7 }),
  Z({ n: "Abomination", fam: "boss", r: "mythic", hp: 320, spd: 46, dmg: 24, scale: 1.8, aggro: 340, body: "behemoth", skin: 0x4a3a4a, tr: ["armored", "brute", "regenerator", "splitter"], eyes: EYE_RED, feat: ["plates", "spikes", "bone", "drip"], minDay: 9, desc: "Several people, badly reassembled." }),
  Z({ n: "Patient Zero", fam: "boss", r: "mythic", hp: 260, spd: 58, dmg: 22, scale: 1.45, aggro: 360, body: "humanoid", skin: 0x9a9a6a, tr: ["screamer", "spitter", "frenzied", "regenerator"], eyes: EYE_GRN, feat: ["glow", "drip"], minDay: 9, desc: "Where it all started, still walking." }),
  Z({ n: "The Colossus", fam: "boss", r: "mythic", hp: 400, spd: 40, dmg: 28, scale: 2.0, aggro: 360, body: "behemoth", skin: 0x6a5a4a, tr: ["armored", "brute", "exploder"], feat: ["plates", "bone", "spikes"], minDay: 12 }),
  Z({ n: "Hive Lord", fam: "boss", r: "mythic", hp: 300, spd: 42, dmg: 18, scale: 1.6, body: "bloated", skin: 0x7a6a8a, tr: ["splitter", "screamer", "toxic", "bloated"], eyes: EYE_PUR, feat: ["sacs", "drip", "horns"], minDay: 10 }),
  Z({ n: "Stormcaller", fam: "boss", r: "legendary", hp: 150, spd: 60, dmg: 16, scale: 1.3, body: "lanky", skin: 0x3a5a8a, tr: ["electric", "fast", "screamer"], eyes: EYE_BLUE, feat: ["glow", "spikes"], minDay: 8 }),
  Z({ n: "Warboss", fam: "boss", r: "legendary", hp: 180, spd: 78, dmg: 18, scale: 1.25, body: "armored", skin: 0xd9b48a, accent: 0x1a1a1a, bite: false, tr: ["armored", "brute", "frenzied"], feat: ["plates", "horns"], minDay: 8 }),
  Z({ n: "Mauler", fam: "boss", r: "epic", hp: 110, spd: 64, dmg: 17, scale: 1.3, body: "brute", skin: 0x7a4a4a, tr: ["brute", "frenzied", "leaper"], eyes: EYE_RED, feat: ["bone", "blood"], minDay: 5 }),
  Z({ n: "The Reek", fam: "boss", r: "epic", hp: 100, spd: 40, dmg: 13, scale: 1.3, body: "toxic", skin: 0x6f9a3a, tr: ["toxic", "exploder", "splitter"], eyes: EYE_GRN, feat: ["sacs", "drip", "glow"], minDay: 5 }),
];

export const ZOMBIES: readonly ZombieDef[] = Object.freeze([
  ...WALKERS,
  ...CRAWLERS,
  ...RUNNERS,
  ...SPECIALS,
  ...SURVIVORS,
  ...FRIENDLIES,
  ...BOSSES,
]);
