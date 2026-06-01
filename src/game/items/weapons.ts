import type { Ability, AbilityKind, Hand, Rarity, WeaponClass, WeaponDef } from "./types";

// 200+ hand-authored weapons (Phase 1). A compact builder fills sensible per-class
// defaults so each entry only states what's distinctive. Ability `value` meaning:
// crit=% chance, bleed/burn/poison=dps, cleave/pierce/chain/ricochet=count,
// knockback=px/s, stun=ms, lifesteal/execute/armorpierce/freeze/vampiric=%, fast/heavy/quiet=flag.

function a(kind: AbilityKind, value = 1): Ability {
  return { kind, value };
}

interface ClassDefaults {
  range: number;
  cooldownMs: number;
  noise: number;
  projectileSpeed?: number;
  reloadMs?: number;
  mag?: number;
}

const CLASS: Record<WeaponClass, ClassDefaults> = {
  fist: { range: 38, cooldownMs: 300, noise: 8 },
  blade: { range: 46, cooldownMs: 380, noise: 10 },
  axe: { range: 50, cooldownMs: 520, noise: 14 },
  blunt: { range: 48, cooldownMs: 480, noise: 16 },
  spear: { range: 72, cooldownMs: 520, noise: 12 },
  polearm: { range: 80, cooldownMs: 600, noise: 14 },
  whip: { range: 86, cooldownMs: 460, noise: 10 },
  thrown: { range: 170, cooldownMs: 520, noise: 14, projectileSpeed: 540 },
  pistol: { range: 360, cooldownMs: 300, noise: 70, projectileSpeed: 760, reloadMs: 1500, mag: 12 },
  revolver: { range: 380, cooldownMs: 520, noise: 88, projectileSpeed: 780, reloadMs: 2200, mag: 6 },
  smg: { range: 320, cooldownMs: 95, noise: 74, projectileSpeed: 760, reloadMs: 1900, mag: 30 },
  shotgun: { range: 230, cooldownMs: 680, noise: 96, projectileSpeed: 680, reloadMs: 2400, mag: 6 },
  rifle: { range: 460, cooldownMs: 125, noise: 86, projectileSpeed: 880, reloadMs: 2100, mag: 30 },
  dmr: { range: 680, cooldownMs: 620, noise: 96, projectileSpeed: 1000, reloadMs: 2400, mag: 10 },
  lmg: { range: 480, cooldownMs: 85, noise: 92, projectileSpeed: 900, reloadMs: 4500, mag: 100 },
  bow: { range: 500, cooldownMs: 760, noise: 8, projectileSpeed: 640, reloadMs: 800, mag: 1 },
  crossbow: { range: 520, cooldownMs: 1100, noise: 10, projectileSpeed: 720, reloadMs: 1300, mag: 1 },
  launcher: { range: 520, cooldownMs: 1500, noise: 112, projectileSpeed: 520, reloadMs: 3200, mag: 1 },
  flame: { range: 150, cooldownMs: 60, noise: 70, projectileSpeed: 420, reloadMs: 3000, mag: 100 },
  nailgun: { range: 300, cooldownMs: 110, noise: 30, projectileSpeed: 700, reloadMs: 1800, mag: 20 },
  energy: { range: 480, cooldownMs: 120, noise: 55, projectileSpeed: 1100, reloadMs: 2200, mag: 40 },
};

interface WInput {
  n: string;
  c: WeaponClass;
  h: Hand;
  r: Rarity;
  dmg: number;
  icon: string;
  ab?: Ability[];
  ammo?: string;
  mag?: number;
  reload?: number;
  pellets?: number;
  spread?: number;
  two?: boolean;
  range?: number;
  cd?: number;
  noise?: number;
  pspeed?: number;
  tint?: number;
  desc?: string;
  val?: number;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function W(p: WInput): WeaponDef {
  const d = CLASS[p.c];
  const ranged = p.h === "ranged";
  const def: WeaponDef = {
    id: slug(p.n),
    kind: "weapon",
    name: p.n,
    rarity: p.r,
    icon: p.icon,
    hand: p.h,
    wclass: p.c,
    damage: p.dmg,
    range: p.range ?? d.range,
    cooldownMs: p.cd ?? d.cooldownMs,
    noise: p.noise ?? d.noise,
    abilities: p.ab ?? [],
  };
  if (p.tint !== undefined) def.tint = p.tint;
  if (p.desc) def.desc = p.desc;
  if (p.val !== undefined) def.value = p.val;
  if (p.two) def.twoHanded = true;
  if (ranged) {
    def.ammoType = p.ammo;
    def.magSize = p.mag ?? d.mag ?? 1;
    def.reloadMs = p.reload ?? d.reloadMs ?? 1800;
    def.projectileSpeed = p.pspeed ?? d.projectileSpeed ?? 700;
    if (p.pellets) def.pellets = p.pellets;
    if (p.spread !== undefined) def.spread = p.spread;
  }
  return def;
}

// --- MELEE: blades --------------------------------------------------------
const BLADES: WeaponDef[] = [
  W({ n: "Shiv", c: "blade", h: "melee", r: "common", dmg: 2, icon: "knife", ab: [a("fast")], desc: "A sharpened scrap of metal." }),
  W({ n: "Box Cutter", c: "blade", h: "melee", r: "common", dmg: 2, icon: "knife", ab: [a("fast"), a("bleed", 1)] }),
  W({ n: "Kitchen Knife", c: "blade", h: "melee", r: "common", dmg: 3, icon: "knife" }),
  W({ n: "Steak Knife", c: "blade", h: "melee", r: "common", dmg: 3, icon: "knife", ab: [a("fast")] }),
  W({ n: "Hunting Knife", c: "blade", h: "melee", r: "uncommon", dmg: 4, icon: "knife", ab: [a("bleed", 1)] }),
  W({ n: "Combat Knife", c: "blade", h: "melee", r: "uncommon", dmg: 5, icon: "knife", ab: [a("bleed", 2)] }),
  W({ n: "Karambit", c: "blade", h: "melee", r: "rare", dmg: 5, icon: "knife", ab: [a("crit", 20), a("fast")] }),
  W({ n: "Bowie Knife", c: "blade", h: "melee", r: "rare", dmg: 6, icon: "knife", ab: [a("bleed", 2)] }),
  W({ n: "Tactical Dagger", c: "blade", h: "melee", r: "epic", dmg: 7, icon: "knife", ab: [a("crit", 22), a("bleed", 2)] }),
  W({ n: "Trench Knife", c: "blade", h: "melee", r: "epic", dmg: 7, icon: "knife", ab: [a("bleed", 2), a("armorpierce", 30)] }),
  W({ n: "Obsidian Shard", c: "blade", h: "melee", r: "legendary", dmg: 9, icon: "knife", tint: 0x2a2440, ab: [a("bleed", 3), a("crit", 25)], desc: "Volcanic glass, impossibly sharp." }),
  W({ n: "Ripper's Fang", c: "blade", h: "melee", r: "mythic", dmg: 11, icon: "knife", tint: 0xff5a6e, ab: [a("bleed", 4), a("lifesteal", 18), a("crit", 25)], desc: "It drinks." }),
  W({ n: "Broken Sword", c: "blade", h: "melee", r: "common", dmg: 4, icon: "sword" }),
  W({ n: "Short Sword", c: "blade", h: "melee", r: "uncommon", dmg: 6, icon: "sword", ab: [a("cleave", 1)] }),
  W({ n: "Cavalry Saber", c: "blade", h: "melee", r: "rare", dmg: 7, icon: "sword", ab: [a("cleave", 1), a("crit", 18)] }),
  W({ n: "Longsword", c: "blade", h: "melee", r: "rare", dmg: 8, icon: "sword", ab: [a("cleave", 2)] }),
  W({ n: "Estoc", c: "blade", h: "melee", r: "epic", dmg: 9, icon: "sword", ab: [a("armorpierce", 50), a("crit", 18)] }),
  W({ n: "Claymore", c: "blade", h: "melee", r: "epic", dmg: 10, icon: "sword", two: true, ab: [a("cleave", 2), a("knockback", 180), a("heavy")] }),
  W({ n: "Flamberge", c: "blade", h: "melee", r: "legendary", dmg: 12, icon: "sword", two: true, ab: [a("cleave", 2), a("bleed", 3)] }),
  W({ n: "Knight's Greatsword", c: "blade", h: "melee", r: "legendary", dmg: 13, icon: "sword", two: true, tint: 0xd9e2ec, ab: [a("cleave", 2), a("crit", 20)] }),
  W({ n: "Dragontooth Blade", c: "blade", h: "melee", r: "mythic", dmg: 15, icon: "sword", two: true, tint: 0xff7a3f, ab: [a("cleave", 2), a("burn", 4), a("crit", 22)], desc: "Forged in a fire that never went out." }),
  W({ n: "Worn Katana", c: "blade", h: "melee", r: "uncommon", dmg: 6, icon: "katana", ab: [a("crit", 18)] }),
  W({ n: "Katana", c: "blade", h: "melee", r: "rare", dmg: 8, icon: "katana", ab: [a("crit", 20), a("bleed", 2)] }),
  W({ n: "Masterwork Katana", c: "blade", h: "melee", r: "epic", dmg: 10, icon: "katana", ab: [a("crit", 25), a("bleed", 2), a("fast")] }),
  W({ n: "Nodachi", c: "blade", h: "melee", r: "epic", dmg: 11, icon: "katana", two: true, ab: [a("cleave", 2), a("crit", 20)] }),
  W({ n: "Soul Katana", c: "blade", h: "melee", r: "legendary", dmg: 13, icon: "katana", tint: 0x9be7ff, ab: [a("crit", 28), a("execute", 12), a("bleed", 3)] }),
  W({ n: "Tetsu-no-Oni", c: "blade", h: "melee", r: "mythic", dmg: 16, icon: "katana", tint: 0xff5a6e, ab: [a("crit", 30), a("execute", 15), a("lifesteal", 15)], desc: "The demon's iron." }),
  W({ n: "Cleaver", c: "blade", h: "melee", r: "common", dmg: 4, icon: "machete" }),
  W({ n: "Rusty Machete", c: "blade", h: "melee", r: "common", dmg: 4, icon: "machete", tint: 0x8a6a3a }),
  W({ n: "Machete", c: "blade", h: "melee", r: "uncommon", dmg: 5, icon: "machete", ab: [a("cleave", 1)] }),
  W({ n: "Gut-Hook Machete", c: "blade", h: "melee", r: "rare", dmg: 6, icon: "machete", ab: [a("bleed", 3), a("cleave", 1)] }),
  W({ n: "Kukri", c: "blade", h: "melee", r: "rare", dmg: 6, icon: "machete", ab: [a("cleave", 1), a("crit", 18)] }),
  W({ n: "Heavy Machete", c: "blade", h: "melee", r: "epic", dmg: 8, icon: "machete", ab: [a("cleave", 2), a("knockback", 140)] }),
  W({ n: "Reaper Machete", c: "blade", h: "melee", r: "legendary", dmg: 10, icon: "machete", ab: [a("cleave", 2), a("bleed", 3)] }),
  W({ n: "Bonecleaver", c: "blade", h: "melee", r: "mythic", dmg: 13, icon: "machete", tint: 0xe8e2d0, ab: [a("cleave", 2), a("execute", 14), a("bleed", 3)] }),
];

// --- MELEE: axes ----------------------------------------------------------
const AXES: WeaponDef[] = [
  W({ n: "Hatchet", c: "axe", h: "melee", r: "common", dmg: 4, icon: "hatchet" }),
  W({ n: "Rusty Axe", c: "axe", h: "melee", r: "common", dmg: 4, icon: "axe", tint: 0x8a6a3a }),
  W({ n: "Hand Axe", c: "axe", h: "melee", r: "uncommon", dmg: 5, icon: "hatchet" }),
  W({ n: "Fire Axe", c: "axe", h: "melee", r: "uncommon", dmg: 6, icon: "axe", tint: 0xd13a2a, ab: [a("cleave", 1)] }),
  W({ n: "Tomahawk", c: "axe", h: "melee", r: "rare", dmg: 6, icon: "hatchet", ab: [a("crit", 18), a("fast")] }),
  W({ n: "Felling Axe", c: "axe", h: "melee", r: "rare", dmg: 7, icon: "axe", two: true, ab: [a("heavy"), a("cleave", 1)] }),
  W({ n: "Pickaxe", c: "axe", h: "melee", r: "uncommon", dmg: 5, icon: "axe", ab: [a("armorpierce", 50)] }),
  W({ n: "Ice Axe", c: "axe", h: "melee", r: "uncommon", dmg: 5, icon: "hatchet", ab: [a("bleed", 2)] }),
  W({ n: "Splitting Maul", c: "axe", h: "melee", r: "rare", dmg: 8, icon: "axe", two: true, ab: [a("heavy"), a("knockback", 160)] }),
  W({ n: "Battle Axe", c: "axe", h: "melee", r: "epic", dmg: 9, icon: "axe", two: true, ab: [a("cleave", 2), a("knockback", 160)] }),
  W({ n: "Double-Bit Axe", c: "axe", h: "melee", r: "epic", dmg: 9, icon: "axe", two: true, ab: [a("cleave", 2), a("bleed", 3)] }),
  W({ n: "Berserker Axe", c: "axe", h: "melee", r: "legendary", dmg: 11, icon: "axe", two: true, ab: [a("cleave", 2), a("lifesteal", 14), a("knockback", 160)] }),
  W({ n: "Executioner's Axe", c: "axe", h: "melee", r: "legendary", dmg: 12, icon: "axe", two: true, tint: 0x2a2a2a, ab: [a("execute", 18), a("heavy")] }),
  W({ n: "Crimson Cleaver", c: "axe", h: "melee", r: "mythic", dmg: 14, icon: "axe", tint: 0xc41d3a, ab: [a("bleed", 4), a("lifesteal", 18), a("cleave", 2)] }),
  W({ n: "Worldsplitter", c: "axe", h: "melee", r: "mythic", dmg: 15, icon: "axe", two: true, tint: 0xffa23f, ab: [a("cleave", 3), a("knockback", 220), a("execute", 15)], desc: "The ground remembers it." }),
];

// --- MELEE: blunt ---------------------------------------------------------
const BLUNT: WeaponDef[] = [
  W({ n: "Baton", c: "blunt", h: "melee", r: "common", dmg: 3, icon: "club", ab: [a("stun", 250)] }),
  W({ n: "Lead Pipe", c: "blunt", h: "melee", r: "common", dmg: 4, icon: "pipe" }),
  W({ n: "Wooden Bat", c: "blunt", h: "melee", r: "common", dmg: 4, icon: "bat" }),
  W({ n: "Tire Iron", c: "blunt", h: "melee", r: "common", dmg: 4, icon: "pipe", ab: [a("armorpierce", 25)] }),
  W({ n: "Pipe Wrench", c: "blunt", h: "melee", r: "common", dmg: 4, icon: "pipe", ab: [a("stun", 200)] }),
  W({ n: "Mallet", c: "blunt", h: "melee", r: "common", dmg: 4, icon: "hammer", ab: [a("stun", 250)] }),
  W({ n: "Aluminum Bat", c: "blunt", h: "melee", r: "uncommon", dmg: 5, icon: "bat", ab: [a("knockback", 140)] }),
  W({ n: "Cricket Bat", c: "blunt", h: "melee", r: "uncommon", dmg: 5, icon: "bat", ab: [a("knockback", 150)] }),
  W({ n: "Crowbar", c: "blunt", h: "melee", r: "uncommon", dmg: 5, icon: "pipe", ab: [a("armorpierce", 40)] }),
  W({ n: "Police Baton", c: "blunt", h: "melee", r: "uncommon", dmg: 4, icon: "club", ab: [a("stun", 400)] }),
  W({ n: "Spiked Club", c: "blunt", h: "melee", r: "uncommon", dmg: 6, icon: "club", ab: [a("bleed", 2)] }),
  W({ n: "Meat Tenderizer", c: "blunt", h: "melee", r: "uncommon", dmg: 5, icon: "hammer", ab: [a("stun", 300)] }),
  W({ n: "Nail Bat", c: "blunt", h: "melee", r: "uncommon", dmg: 6, icon: "bat", ab: [a("bleed", 2)] }),
  W({ n: "Spiked Bat", c: "blunt", h: "melee", r: "rare", dmg: 7, icon: "bat", ab: [a("bleed", 3), a("knockback", 150)] }),
  W({ n: "Riot Baton", c: "blunt", h: "melee", r: "rare", dmg: 5, icon: "club", ab: [a("stun", 500), a("knockback", 160)] }),
  W({ n: "Flanged Mace", c: "blunt", h: "melee", r: "rare", dmg: 8, icon: "mace", ab: [a("armorpierce", 50), a("knockback", 160)] }),
  W({ n: "Sledgehammer", c: "blunt", h: "melee", r: "rare", dmg: 9, icon: "sledge", two: true, ab: [a("heavy"), a("knockback", 200)] }),
  W({ n: "Morning Star", c: "blunt", h: "melee", r: "epic", dmg: 10, icon: "mace", ab: [a("bleed", 3), a("knockback", 170)] }),
  W({ n: "Concrete Hammer", c: "blunt", h: "melee", r: "epic", dmg: 10, icon: "sledge", two: true, ab: [a("heavy"), a("stun", 450)] }),
  W({ n: "War Hammer", c: "blunt", h: "melee", r: "epic", dmg: 11, icon: "hammer", two: true, ab: [a("heavy"), a("knockback", 200), a("armorpierce", 50)] }),
  W({ n: "Skullcrusher", c: "blunt", h: "melee", r: "legendary", dmg: 12, icon: "mace", ab: [a("execute", 16), a("heavy")] }),
  W({ n: "Thunder Maul", c: "blunt", h: "melee", r: "legendary", dmg: 13, icon: "sledge", two: true, tint: 0x6fc3ff, ab: [a("knockback", 240), a("stun", 500), a("heavy")] }),
  W({ n: "Gravewarden Maul", c: "blunt", h: "melee", r: "mythic", dmg: 15, icon: "sledge", two: true, tint: 0x9aa3ad, ab: [a("heavy"), a("armorpierce", 60), a("knockback", 240)] }),
  W({ n: "Doomhammer", c: "blunt", h: "melee", r: "mythic", dmg: 16, icon: "hammer", two: true, tint: 0xffa23f, ab: [a("knockback", 260), a("stun", 600), a("execute", 14)], desc: "Judgement, with a handle." }),
];

// --- MELEE: spears & polearms --------------------------------------------
const SPEARS: WeaponDef[] = [
  W({ n: "Sharpened Stick", c: "spear", h: "melee", r: "common", dmg: 3, icon: "spear" }),
  W({ n: "Makeshift Spear", c: "spear", h: "melee", r: "common", dmg: 4, icon: "spear", ab: [a("pierce", 1)] }),
  W({ n: "Pitchfork", c: "spear", h: "melee", r: "uncommon", dmg: 5, icon: "spear", ab: [a("pierce", 1)] }),
  W({ n: "Spear", c: "spear", h: "melee", r: "uncommon", dmg: 6, icon: "spear", ab: [a("pierce", 1)] }),
  W({ n: "Bident", c: "spear", h: "melee", r: "rare", dmg: 7, icon: "spear", ab: [a("pierce", 1), a("bleed", 2)] }),
  W({ n: "Boar Spear", c: "spear", h: "melee", r: "rare", dmg: 7, icon: "spear", two: true, ab: [a("pierce", 2), a("knockback", 150)] }),
  W({ n: "Trench Pike", c: "spear", h: "melee", r: "rare", dmg: 7, icon: "spear", two: true, ab: [a("pierce", 2), a("armorpierce", 40)] }),
  W({ n: "Dragoon Lance", c: "spear", h: "melee", r: "legendary", dmg: 12, icon: "spear", two: true, ab: [a("pierce", 2), a("knockback", 200), a("armorpierce", 50)] }),
  W({ n: "Partisan", c: "polearm", h: "melee", r: "rare", dmg: 8, icon: "polearm", two: true, ab: [a("pierce", 2)] }),
  W({ n: "Glaive", c: "polearm", h: "melee", r: "epic", dmg: 9, icon: "polearm", two: true, ab: [a("cleave", 2)] }),
  W({ n: "Halberd", c: "polearm", h: "melee", r: "epic", dmg: 9, icon: "polearm", two: true, ab: [a("cleave", 2), a("pierce", 1)] }),
  W({ n: "War Scythe", c: "polearm", h: "melee", r: "epic", dmg: 10, icon: "polearm", two: true, ab: [a("cleave", 2), a("bleed", 3)] }),
  W({ n: "Naginata", c: "polearm", h: "melee", r: "legendary", dmg: 11, icon: "polearm", two: true, ab: [a("cleave", 2), a("crit", 20)] }),
  W({ n: "Voidreaper Glaive", c: "polearm", h: "melee", r: "mythic", dmg: 14, icon: "polearm", two: true, tint: 0xb368ff, ab: [a("cleave", 3), a("execute", 15)], desc: "It reaps a little extra." }),
];

// --- MELEE: whips, fists, thrown ------------------------------------------
const EXOTIC: WeaponDef[] = [
  W({ n: "Bullwhip", c: "whip", h: "melee", r: "common", dmg: 3, icon: "whip", ab: [a("stun", 250)] }),
  W({ n: "Chain Whip", c: "whip", h: "melee", r: "uncommon", dmg: 5, icon: "whip", ab: [a("cleave", 1)] }),
  W({ n: "Barbed Whip", c: "whip", h: "melee", r: "rare", dmg: 6, icon: "whip", ab: [a("bleed", 3)] }),
  W({ n: "Meteor Hammer", c: "whip", h: "melee", r: "epic", dmg: 9, icon: "whip", ab: [a("knockback", 180), a("cleave", 1)] }),
  W({ n: "Kusarigama", c: "whip", h: "melee", r: "legendary", dmg: 11, icon: "whip", ab: [a("bleed", 3), a("cleave", 2)] }),
  W({ n: "Brass Knuckles", c: "fist", h: "melee", r: "common", dmg: 3, icon: "fist", ab: [a("fast")] }),
  W({ n: "Nunchaku", c: "fist", h: "melee", r: "uncommon", dmg: 5, icon: "fist", ab: [a("fast"), a("stun", 200)] }),
  W({ n: "Spiked Gauntlet", c: "fist", h: "melee", r: "uncommon", dmg: 5, icon: "fist", ab: [a("bleed", 2), a("fast")] }),
  W({ n: "Cestus", c: "fist", h: "melee", r: "rare", dmg: 6, icon: "fist", ab: [a("crit", 20), a("fast")] }),
  W({ n: "Power Fist", c: "fist", h: "melee", r: "epic", dmg: 9, icon: "fist", ab: [a("knockback", 200), a("stun", 350)] }),
  W({ n: "Throwing Knives", c: "thrown", h: "melee", r: "uncommon", dmg: 4, icon: "star", ab: [a("bleed", 2)] }),
  W({ n: "Throwing Stars", c: "thrown", h: "melee", r: "uncommon", dmg: 4, icon: "star", ab: [a("bleed", 2), a("fast")] }),
  W({ n: "Chakram", c: "thrown", h: "melee", r: "rare", dmg: 6, icon: "star", ab: [a("cleave", 1), a("ricochet", 2)] }),
];

// --- RANGED: pistols ------------------------------------------------------
const PISTOLS: WeaponDef[] = [
  W({ n: "Zip Gun", c: "pistol", h: "ranged", r: "common", dmg: 5, icon: "pistol", ammo: "9mm", mag: 1, reload: 2600 }),
  W({ n: "Pocket Pistol", c: "pistol", h: "ranged", r: "common", dmg: 6, icon: "pistol", ammo: "9mm", mag: 6, reload: 1700 }),
  W({ n: "Flintlock", c: "pistol", h: "ranged", r: "common", dmg: 9, icon: "pistol", ammo: "357", mag: 1, reload: 3000 }),
  W({ n: "9mm Pistol", c: "pistol", h: "ranged", r: "uncommon", dmg: 7, icon: "pistol", ammo: "9mm", mag: 12 }),
  W({ n: "Compact Pistol", c: "pistol", h: "ranged", r: "uncommon", dmg: 7, icon: "pistol", ammo: "9mm", mag: 10 }),
  W({ n: "Service Pistol", c: "pistol", h: "ranged", r: "uncommon", dmg: 8, icon: "pistol", ammo: "9mm", mag: 15 }),
  W({ n: "Dart Pistol", c: "pistol", h: "ranged", r: "uncommon", dmg: 5, icon: "pistol", ammo: "9mm", mag: 6, ab: [a("poison", 3)] }),
  W({ n: "Tactical Pistol", c: "pistol", h: "ranged", r: "rare", dmg: 9, icon: "pistol", ammo: "9mm", mag: 17, ab: [a("crit", 15)] }),
  W({ n: "Machine Pistol", c: "pistol", h: "ranged", r: "rare", dmg: 6, icon: "pistol", ammo: "9mm", mag: 18, cd: 110, ab: [a("fast")] }),
  W({ n: "Suppressed Pistol", c: "pistol", h: "ranged", r: "rare", dmg: 8, icon: "pistol", ammo: "9mm", mag: 12, noise: 18, ab: [a("quiet")] }),
  W({ n: ".45 Pistol", c: "pistol", h: "ranged", r: "rare", dmg: 10, icon: "pistol", ammo: "45acp", mag: 8 }),
  W({ n: "Twin Berettas", c: "pistol", h: "ranged", r: "epic", dmg: 9, icon: "pistol", ammo: "9mm", mag: 30, cd: 150, ab: [a("fast")] }),
  W({ n: "Heavy Pistol", c: "pistol", h: "ranged", r: "epic", dmg: 12, icon: "pistol", ammo: "45acp", mag: 10, ab: [a("knockback", 120)] }),
  W({ n: "Match Pistol", c: "pistol", h: "ranged", r: "epic", dmg: 11, icon: "pistol", ammo: "45acp", mag: 12, ab: [a("crit", 25)] }),
  W({ n: "Hand Cannon", c: "pistol", h: "ranged", r: "epic", dmg: 14, icon: "pistol", ammo: "50ae", mag: 7, ab: [a("knockback", 160), a("crit", 15)] }),
  W({ n: "Golden Pistol", c: "pistol", h: "ranged", r: "legendary", dmg: 14, icon: "pistol", tint: 0xffd23f, ammo: "45acp", mag: 14, ab: [a("crit", 22), a("lifesteal", 10)] }),
  W({ n: "Deadeye .50", c: "pistol", h: "ranged", r: "legendary", dmg: 18, icon: "pistol", ammo: "50ae", mag: 6, ab: [a("crit", 25), a("armorpierce", 50)] }),
  W({ n: "Phoenix Sidearm", c: "pistol", h: "ranged", r: "mythic", dmg: 20, icon: "pistol", tint: 0xff7a3f, ammo: "50ae", mag: 9, ab: [a("crit", 25), a("burn", 4), a("knockback", 160)], desc: "Reborn every reload." }),
];

// --- RANGED: revolvers ----------------------------------------------------
const REVOLVERS: WeaponDef[] = [
  W({ n: "Snub Revolver", c: "revolver", h: "ranged", r: "uncommon", dmg: 8, icon: "revolver", ammo: "357", mag: 5 }),
  W({ n: "Service Revolver", c: "revolver", h: "ranged", r: "uncommon", dmg: 9, icon: "revolver", ammo: "357", mag: 6 }),
  W({ n: "Peacemaker", c: "revolver", h: "ranged", r: "rare", dmg: 10, icon: "revolver", ammo: "357", mag: 6 }),
  W({ n: ".357 Revolver", c: "revolver", h: "ranged", r: "rare", dmg: 11, icon: "revolver", ammo: "357", mag: 6, ab: [a("crit", 18)] }),
  W({ n: "Viper Revolver", c: "revolver", h: "ranged", r: "rare", dmg: 10, icon: "revolver", ammo: "357", mag: 6, ab: [a("poison", 3)] }),
  W({ n: "Magnum Revolver", c: "revolver", h: "ranged", r: "epic", dmg: 14, icon: "revolver", ammo: "357", mag: 6, ab: [a("knockback", 150), a("crit", 18)] }),
  W({ n: ".44 Magnum", c: "revolver", h: "ranged", r: "epic", dmg: 15, icon: "revolver", ammo: "50ae", mag: 6, ab: [a("knockback", 160)] }),
  W({ n: "Hunting Revolver", c: "revolver", h: "ranged", r: "epic", dmg: 16, icon: "revolver", ammo: "50ae", mag: 5, ab: [a("armorpierce", 50)] }),
  W({ n: "Hand of Judgement", c: "revolver", h: "ranged", r: "legendary", dmg: 19, icon: "revolver", tint: 0xffd23f, ammo: "50ae", mag: 6, ab: [a("execute", 14), a("crit", 22)] }),
  W({ n: "Doomsday .500", c: "revolver", h: "ranged", r: "mythic", dmg: 24, icon: "revolver", tint: 0xff5a6e, ammo: "50ae", mag: 5, ab: [a("execute", 15), a("knockback", 220), a("crit", 20)] }),
];

// --- RANGED: SMGs ---------------------------------------------------------
const SMGS: WeaponDef[] = [
  W({ n: "Improvised SMG", c: "smg", h: "ranged", r: "common", dmg: 4, icon: "smg", ammo: "9mm", mag: 20, ab: [a("fast")] }),
  W({ n: "9mm SMG", c: "smg", h: "ranged", r: "uncommon", dmg: 5, icon: "smg", ammo: "9mm", mag: 25, ab: [a("fast")] }),
  W({ n: "Compact SMG", c: "smg", h: "ranged", r: "uncommon", dmg: 5, icon: "smg", ammo: "9mm", mag: 30, ab: [a("fast")] }),
  W({ n: "PDW", c: "smg", h: "ranged", r: "rare", dmg: 6, icon: "smg", ammo: "9mm", mag: 40, ab: [a("fast")] }),
  W({ n: "Tactical SMG", c: "smg", h: "ranged", r: "rare", dmg: 6, icon: "smg", ammo: "9mm", mag: 32, ab: [a("fast"), a("crit", 12)] }),
  W({ n: ".45 SMG", c: "smg", h: "ranged", r: "rare", dmg: 7, icon: "smg", ammo: "45acp", mag: 25, ab: [a("fast")] }),
  W({ n: "Suppressed SMG", c: "smg", h: "ranged", r: "rare", dmg: 6, icon: "smg", ammo: "9mm", mag: 30, noise: 20, ab: [a("fast"), a("quiet")] }),
  W({ n: "Riot SMG", c: "smg", h: "ranged", r: "rare", dmg: 6, icon: "smg", ammo: "9mm", mag: 32, ab: [a("fast"), a("knockback", 90)] }),
  W({ n: "Dart SMG", c: "smg", h: "ranged", r: "rare", dmg: 5, icon: "smg", ammo: "9mm", mag: 30, ab: [a("fast"), a("poison", 2)] }),
  W({ n: "Vector SMG", c: "smg", h: "ranged", r: "epic", dmg: 7, icon: "smg", ammo: "45acp", mag: 33, cd: 80, ab: [a("fast")] }),
  W({ n: "Bullpup SMG", c: "smg", h: "ranged", r: "epic", dmg: 7, icon: "smg", ammo: "9mm", mag: 36, ab: [a("fast"), a("crit", 14)] }),
  W({ n: "Spectre SMG", c: "smg", h: "ranged", r: "epic", dmg: 8, icon: "smg", ammo: "9mm", mag: 30, noise: 20, ab: [a("fast"), a("quiet"), a("crit", 12)] }),
  W({ n: "Hailstorm SMG", c: "smg", h: "ranged", r: "legendary", dmg: 9, icon: "smg", ammo: "45acp", mag: 40, cd: 75, ab: [a("fast"), a("crit", 15), a("bleed", 2)] }),
  W({ n: "Leadstorm", c: "smg", h: "ranged", r: "mythic", dmg: 11, icon: "smg", tint: 0xff5a6e, ammo: "45acp", mag: 50, cd: 70, ab: [a("fast"), a("crit", 18), a("burn", 3)] }),
];

// --- RANGED: shotguns -----------------------------------------------------
const SHOTGUNS: WeaponDef[] = [
  W({ n: "Sawed-off Shotgun", c: "shotgun", h: "ranged", r: "uncommon", dmg: 4, icon: "shotgun", ammo: "12ga", mag: 2, pellets: 6, spread: 0.36, ab: [a("knockback", 120)] }),
  W({ n: "Pump Shotgun", c: "shotgun", h: "ranged", r: "uncommon", dmg: 4, icon: "shotgun", ammo: "12ga", mag: 6, pellets: 8, spread: 0.3, ab: [a("knockback", 120)] }),
  W({ n: "Coach Gun", c: "shotgun", h: "ranged", r: "rare", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 2, pellets: 9, spread: 0.38, ab: [a("knockback", 140)] }),
  W({ n: "Double-Barrel", c: "shotgun", h: "ranged", r: "rare", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 2, pellets: 10, spread: 0.4, ab: [a("knockback", 150)] }),
  W({ n: "Combat Shotgun", c: "shotgun", h: "ranged", r: "rare", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 8, pellets: 8, spread: 0.28 }),
  W({ n: "Tactical Shotgun", c: "shotgun", h: "ranged", r: "rare", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 7, pellets: 8, spread: 0.26, ab: [a("crit", 12)] }),
  W({ n: "Breaching Shotgun", c: "shotgun", h: "ranged", r: "uncommon", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 5, pellets: 6, spread: 0.2, ab: [a("armorpierce", 40)] }),
  W({ n: "Slug Gun", c: "shotgun", h: "ranged", r: "rare", dmg: 12, icon: "shotgun", ammo: "12ga", mag: 5, pellets: 1, spread: 0.02, range: 420, ab: [a("armorpierce", 50)] }),
  W({ n: "Auto Shotgun", c: "shotgun", h: "ranged", r: "epic", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 10, pellets: 9, spread: 0.3, cd: 320, ab: [a("fast")] }),
  W({ n: "Riot Shotgun", c: "shotgun", h: "ranged", r: "epic", dmg: 5, icon: "shotgun", ammo: "12ga", mag: 8, pellets: 10, spread: 0.32, ab: [a("knockback", 170)] }),
  W({ n: "Street Sweeper", c: "shotgun", h: "ranged", r: "epic", dmg: 4, icon: "shotgun", ammo: "12ga", mag: 12, pellets: 8, spread: 0.34, cd: 300, ab: [a("fast")] }),
  W({ n: "Boomstick", c: "shotgun", h: "ranged", r: "legendary", dmg: 6, icon: "shotgun", ammo: "12ga", mag: 2, pellets: 12, spread: 0.45, ab: [a("knockback", 200), a("crit", 18)] }),
  W({ n: "Dragon's Breath", c: "shotgun", h: "ranged", r: "legendary", dmg: 5, icon: "shotgun", tint: 0xff7a3f, ammo: "12ga", mag: 6, pellets: 8, spread: 0.3, ab: [a("burn", 4), a("incendiary", 3)] }),
  W({ n: "Hellfire Shotgun", c: "shotgun", h: "ranged", r: "mythic", dmg: 7, icon: "shotgun", tint: 0xff5a6e, ammo: "12ga", mag: 8, pellets: 10, spread: 0.3, ab: [a("burn", 5), a("explosive", 50)] }),
];

// --- RANGED: rifles -------------------------------------------------------
const RIFLES: WeaponDef[] = [
  W({ n: "Makeshift Carbine", c: "rifle", h: "ranged", r: "common", dmg: 6, icon: "rifle", ammo: "556", mag: 10 }),
  W({ n: "Lever-Action", c: "rifle", h: "ranged", r: "uncommon", dmg: 11, icon: "rifle", ammo: "357", mag: 8, cd: 520, reload: 2400 }),
  W({ n: "Hunting Rifle", c: "rifle", h: "ranged", r: "uncommon", dmg: 12, icon: "rifle", ammo: "762", mag: 5, cd: 500, reload: 2200, ab: [a("crit", 18)] }),
  W({ n: "Carbine", c: "rifle", h: "ranged", r: "rare", dmg: 9, icon: "rifle", ammo: "556", mag: 30 }),
  W({ n: "Assault Rifle", c: "rifle", h: "ranged", r: "rare", dmg: 10, icon: "rifle", ammo: "556", mag: 30, ab: [a("fast")] }),
  W({ n: "Bullpup Rifle", c: "rifle", h: "ranged", r: "rare", dmg: 10, icon: "rifle", ammo: "556", mag: 30, ab: [a("fast"), a("crit", 12)] }),
  W({ n: "Suppressed Rifle", c: "rifle", h: "ranged", r: "rare", dmg: 10, icon: "rifle", ammo: "556", mag: 30, noise: 26, ab: [a("fast"), a("quiet")] }),
  W({ n: "Carbine Elite", c: "rifle", h: "ranged", r: "epic", dmg: 11, icon: "rifle", ammo: "556", mag: 40, ab: [a("fast")] }),
  W({ n: "Tactical Rifle", c: "rifle", h: "ranged", r: "epic", dmg: 11, icon: "rifle", ammo: "556", mag: 30, ab: [a("fast"), a("crit", 15)] }),
  W({ n: "Commando Rifle", c: "rifle", h: "ranged", r: "epic", dmg: 12, icon: "rifle", ammo: "762", mag: 24, ab: [a("fast")] }),
  W({ n: "Battle Rifle", c: "rifle", h: "ranged", r: "epic", dmg: 13, icon: "rifle", ammo: "762", mag: 20, ab: [a("fast"), a("armorpierce", 40)] }),
  W({ n: "Heavy Rifle", c: "rifle", h: "ranged", r: "epic", dmg: 14, icon: "rifle", ammo: "762", mag: 20, ab: [a("armorpierce", 50), a("knockback", 90)] }),
  W({ n: "Pulse Rifle", c: "rifle", h: "ranged", r: "legendary", dmg: 12, icon: "rifle", tint: 0x6fc3ff, ammo: "556", mag: 45, ab: [a("fast"), a("crit", 15), a("chain", 1)] }),
  W({ n: "Dragoon Rifle", c: "rifle", h: "ranged", r: "legendary", dmg: 15, icon: "rifle", ammo: "762", mag: 25, ab: [a("armorpierce", 50), a("crit", 18)] }),
  W({ n: "Vandal", c: "rifle", h: "ranged", r: "mythic", dmg: 16, icon: "rifle", tint: 0xff5a6e, ammo: "762", mag: 30, ab: [a("fast"), a("crit", 20), a("bleed", 3)] }),
  W({ n: "Stormbringer", c: "rifle", h: "ranged", r: "mythic", dmg: 14, icon: "rifle", tint: 0xb368ff, ammo: "556", mag: 50, ab: [a("fast"), a("chain", 2), a("burn", 3)] }),
];

// --- RANGED: DMR / snipers ------------------------------------------------
const SNIPERS: WeaponDef[] = [
  W({ n: "Marksman Rifle", c: "dmr", h: "ranged", r: "rare", dmg: 18, icon: "sniper", ammo: "308", mag: 10, ab: [a("crit", 25)] }),
  W({ n: "Scoped Rifle", c: "dmr", h: "ranged", r: "rare", dmg: 16, icon: "sniper", ammo: "762", mag: 10, ab: [a("crit", 25)] }),
  W({ n: "Hunter DMR", c: "dmr", h: "ranged", r: "rare", dmg: 18, icon: "sniper", ammo: "762", mag: 12, ab: [a("crit", 22), a("bleed", 3)] }),
  W({ n: "Semi-Auto Sniper", c: "dmr", h: "ranged", r: "epic", dmg: 22, icon: "sniper", ammo: "308", mag: 10, ab: [a("crit", 28)] }),
  W({ n: "DMR", c: "dmr", h: "ranged", r: "epic", dmg: 20, icon: "sniper", ammo: "308", mag: 20, ab: [a("crit", 25), a("armorpierce", 50)] }),
  W({ n: "Recon Rifle", c: "dmr", h: "ranged", r: "epic", dmg: 21, icon: "sniper", ammo: "308", mag: 15, noise: 30, ab: [a("crit", 25), a("quiet")] }),
  W({ n: "Bolt-Action Sniper", c: "dmr", h: "ranged", r: "epic", dmg: 28, icon: "sniper", ammo: "308", mag: 5, cd: 1100, reload: 2600, ab: [a("crit", 30), a("armorpierce", 50)] }),
  W({ n: "Phantom Sniper", c: "dmr", h: "ranged", r: "legendary", dmg: 33, icon: "sniper", tint: 0x9be7ff, ammo: "308", mag: 5, cd: 1000, noise: 28, ab: [a("quiet"), a("crit", 30), a("execute", 15)] }),
  W({ n: "Winter's Howl", c: "dmr", h: "ranged", r: "legendary", dmg: 34, icon: "sniper", tint: 0x6fc3ff, ammo: "308", mag: 6, cd: 1000, ab: [a("freeze", 40), a("crit", 28), a("pierce", 1)] }),
  W({ n: "Anti-Materiel Rifle", c: "dmr", h: "ranged", r: "legendary", dmg: 40, icon: "sniper", two: true, ammo: "50ae", mag: 5, cd: 1200, reload: 3000, ab: [a("armorpierce", 80), a("pierce", 2), a("knockback", 200)] }),
  W({ n: "Voidlance Rail", c: "dmr", h: "ranged", r: "mythic", dmg: 46, icon: "sniper", two: true, tint: 0xb368ff, ammo: "308", mag: 4, cd: 1100, ab: [a("pierce", 3), a("chain", 1), a("execute", 18)] }),
  W({ n: "Railgun", c: "dmr", h: "ranged", r: "mythic", dmg: 50, icon: "sniper", two: true, tint: 0x6fc3ff, ammo: "308", mag: 3, cd: 1200, reload: 2800, ab: [a("pierce", 4), a("armorpierce", 90), a("execute", 18)] }),
];

// --- RANGED: LMGs ---------------------------------------------------------
const LMGS: WeaponDef[] = [
  W({ n: "Light Machine Gun", c: "lmg", h: "ranged", r: "rare", dmg: 9, icon: "lmg", ammo: "556", mag: 100, ab: [a("fast")] }),
  W({ n: "Suppression LMG", c: "lmg", h: "ranged", r: "rare", dmg: 8, icon: "lmg", ammo: "556", mag: 120, ab: [a("fast"), a("knockback", 80)] }),
  W({ n: "Squad LMG", c: "lmg", h: "ranged", r: "epic", dmg: 10, icon: "lmg", ammo: "762", mag: 100, ab: [a("fast"), a("armorpierce", 40)] }),
  W({ n: "Belt-Fed MG", c: "lmg", h: "ranged", r: "epic", dmg: 9, icon: "lmg", ammo: "762", mag: 150, ab: [a("fast"), a("knockback", 90)] }),
  W({ n: "Heavy LMG", c: "lmg", h: "ranged", r: "epic", dmg: 12, icon: "lmg", two: true, ammo: "762", mag: 80, ab: [a("fast"), a("armorpierce", 50)] }),
  W({ n: "Minigun", c: "lmg", h: "ranged", r: "legendary", dmg: 8, icon: "lmg", two: true, ammo: "556", mag: 300, cd: 50, reload: 5000, ab: [a("fast"), a("crit", 12)] }),
  W({ n: "Reaper LMG", c: "lmg", h: "ranged", r: "legendary", dmg: 11, icon: "lmg", two: true, ammo: "762", mag: 100, ab: [a("fast"), a("armorpierce", 50), a("knockback", 90)] }),
  W({ n: "Devastator", c: "lmg", h: "ranged", r: "mythic", dmg: 13, icon: "lmg", two: true, tint: 0xff5a6e, ammo: "762", mag: 200, ab: [a("fast"), a("burn", 3), a("crit", 14)] }),
];

// --- RANGED: bows & crossbows ---------------------------------------------
const BOWS: WeaponDef[] = [
  W({ n: "Makeshift Bow", c: "bow", h: "ranged", r: "common", dmg: 6, icon: "bow", ammo: "arrow", reload: 900, ab: [a("quiet")] }),
  W({ n: "Hunting Bow", c: "bow", h: "ranged", r: "uncommon", dmg: 10, icon: "bow", ammo: "arrow", reload: 800, ab: [a("quiet"), a("bleed", 2)] }),
  W({ n: "Recurve Bow", c: "bow", h: "ranged", r: "rare", dmg: 13, icon: "bow", ammo: "arrow", reload: 750, ab: [a("quiet"), a("crit", 18)] }),
  W({ n: "Compound Bow", c: "bow", h: "ranged", r: "epic", dmg: 17, icon: "bow", ammo: "arrow", reload: 700, ab: [a("quiet"), a("crit", 20), a("pierce", 1)] }),
  W({ n: "War Bow", c: "bow", h: "ranged", r: "legendary", dmg: 22, icon: "bow", ammo: "arrow", reload: 700, ab: [a("quiet"), a("pierce", 2), a("execute", 12)] }),
  W({ n: "Phantom Bow", c: "bow", h: "ranged", r: "mythic", dmg: 26, icon: "bow", tint: 0x9be7ff, ammo: "arrow", reload: 600, ab: [a("quiet"), a("pierce", 2), a("chain", 1), a("execute", 15)] }),
  W({ n: "Light Crossbow", c: "crossbow", h: "ranged", r: "uncommon", dmg: 11, icon: "crossbow", ammo: "bolt", reload: 1300, ab: [a("quiet")] }),
  W({ n: "Crossbow", c: "crossbow", h: "ranged", r: "rare", dmg: 15, icon: "crossbow", ammo: "bolt", reload: 1200, ab: [a("quiet"), a("armorpierce", 40)] }),
  W({ n: "Repeating Crossbow", c: "crossbow", h: "ranged", r: "epic", dmg: 9, icon: "crossbow", ammo: "bolt", mag: 6, reload: 1800, cd: 320, ab: [a("quiet"), a("fast")] }),
  W({ n: "Heavy Crossbow", c: "crossbow", h: "ranged", r: "epic", dmg: 20, icon: "crossbow", ammo: "bolt", reload: 1500, ab: [a("quiet"), a("pierce", 1), a("knockback", 120)] }),
];

// --- RANGED: launchers, flame, nailgun, energy ----------------------------
const SPECIAL: WeaponDef[] = [
  W({ n: "Nail Gun", c: "nailgun", h: "ranged", r: "common", dmg: 4, icon: "nailgun", ammo: "nail", mag: 20, ab: [a("fast")] }),
  W({ n: "Auto Nailer", c: "nailgun", h: "ranged", r: "uncommon", dmg: 5, icon: "nailgun", ammo: "nail", mag: 30, ab: [a("fast"), a("bleed", 2)] }),
  W({ n: "Flamethrower", c: "flame", h: "ranged", r: "epic", dmg: 6, icon: "flame", two: true, ammo: "fuel", mag: 100, ab: [a("burn", 5), a("incendiary", 3)] }),
  W({ n: "Inferno Cannon", c: "flame", h: "ranged", r: "mythic", dmg: 9, icon: "flame", two: true, tint: 0xff5a6e, ammo: "fuel", mag: 150, ab: [a("burn", 6), a("incendiary", 4), a("explosive", 40)] }),
  W({ n: "Pipe-Bomb Launcher", c: "launcher", h: "ranged", r: "epic", dmg: 30, icon: "launcher", two: true, ammo: "rocket", mag: 1, ab: [a("explosive", 70), a("knockback", 200)] }),
  W({ n: "Grenade Launcher", c: "launcher", h: "ranged", r: "legendary", dmg: 40, icon: "launcher", two: true, ammo: "rocket", mag: 6, ab: [a("explosive", 80), a("knockback", 220)] }),
  W({ n: "Rocket Launcher", c: "launcher", h: "ranged", r: "legendary", dmg: 60, icon: "launcher", two: true, ammo: "rocket", mag: 1, reload: 3500, ab: [a("explosive", 100), a("knockback", 240), a("armorpierce", 60)] }),
  W({ n: "RPG-7", c: "launcher", h: "ranged", r: "mythic", dmg: 80, icon: "launcher", two: true, tint: 0xff5a6e, ammo: "rocket", mag: 1, reload: 3800, ab: [a("explosive", 120), a("knockback", 260), a("pierce", 2)] }),
  W({ n: "Tesla Coil", c: "energy", h: "ranged", r: "legendary", dmg: 14, icon: "energy", tint: 0x6fc3ff, ammo: "cell", mag: 40, ab: [a("chain", 3), a("stun", 300), a("fast")] }),
  W({ n: "Cryo Gun", c: "energy", h: "ranged", r: "legendary", dmg: 10, icon: "energy", tint: 0x9be7ff, ammo: "cell", mag: 50, ab: [a("freeze", 50), a("fast")] }),
  W({ n: "Plasma Rifle", c: "energy", h: "ranged", r: "mythic", dmg: 22, icon: "energy", tint: 0xb368ff, ammo: "cell", mag: 30, ab: [a("burn", 4), a("pierce", 2), a("chain", 1)] }),
];

export const WEAPONS: readonly WeaponDef[] = Object.freeze([
  ...BLADES,
  ...AXES,
  ...BLUNT,
  ...SPEARS,
  ...EXOTIC,
  ...PISTOLS,
  ...REVOLVERS,
  ...SMGS,
  ...SHOTGUNS,
  ...RIFLES,
  ...SNIPERS,
  ...LMGS,
  ...BOWS,
  ...SPECIAL,
]);

/** Bare fists — the fallback when nothing is equipped. */
export const FISTS: WeaponDef = {
  id: "fists",
  name: "Fists",
  kind: "weapon",
  rarity: "common",
  icon: "fist",
  hand: "melee",
  wclass: "fist",
  damage: 1,
  range: 36,
  cooldownMs: 300,
  noise: 6,
  abilities: [],
};
