import type { Rng } from "./rng";

// Character backgrounds (classes). Each grants a starting loadout (catalog item
// names), signature perk(s), an appearance colour, a small stat lean, and a
// difficulty lean. Applied after the AI scenario in applyCreation().

export type StatKey = "hp" | "stamina" | "hunger" | "thirst" | "infection";

export interface BackgroundDef {
  id: string;
  name: string;
  blurb: string;
  perks: string[];
  items: { item: string; qty: number }[];
  color: number;
  difficulty: number; // <1 easier, >1 harder
  statTweaks?: Partial<Record<StatKey, number>>;
}

export const BACKGROUNDS: readonly BackgroundDef[] = Object.freeze([
  {
    id: "survivor",
    name: "Survivor",
    blurb: "An ordinary person — adaptable, unremarkable, and still breathing.",
    perks: ["adaptable"],
    items: [{ item: "Kitchen Knife", qty: 1 }, { item: "Canned Food", qty: 2 }, { item: "Water Bottle", qty: 2 }, { item: "Bandage", qty: 1 }],
    color: 0x2ec4ff,
    difficulty: 1.0,
  },
  {
    id: "soldier",
    name: "Soldier",
    blurb: "Trained, armed, and calm under fire.",
    perks: ["marksman"],
    items: [{ item: "9mm Pistol", qty: 1 }, { item: "9mm Rounds", qty: 36 }, { item: "Combat Knife", qty: 1 }, { item: "Kevlar Vest", qty: 1 }, { item: "MRE", qty: 1 }],
    color: 0x6b8e23,
    difficulty: 0.9,
  },
  {
    id: "cop",
    name: "Police Officer",
    blurb: "Sworn to protect — now just trying to make it to morning.",
    perks: ["tough", "quick"],
    items: [{ item: "Service Pistol", qty: 1 }, { item: "9mm Rounds", qty: 24 }, { item: "Police Baton", qty: 1 }, { item: "Padded Vest", qty: 1 }],
    color: 0x23303f,
    difficulty: 0.95,
  },
  {
    id: "firefighter",
    name: "Firefighter",
    blurb: "Runs toward danger out of sheer habit.",
    perks: ["fireproof", "tough"],
    items: [{ item: "Fire Axe", qty: 1 }, { item: "First-Aid Kit", qty: 1 }, { item: "Warm Coat", qty: 1 }],
    color: 0xd13a2a,
    difficulty: 0.95,
  },
  {
    id: "paramedic",
    name: "Paramedic",
    blurb: "Knows exactly how to keep a body running.",
    perks: ["field_medic"],
    items: [{ item: "First-Aid Kit", qty: 1 }, { item: "Antibiotics", qty: 2 }, { item: "Painkillers", qty: 2 }, { item: "Kitchen Knife", qty: 1 }, { item: "Bandage", qty: 3 }],
    color: 0xe8eef4,
    difficulty: 1.05,
  },
  {
    id: "scavenger",
    name: "Scavenger",
    blurb: "Has a nose for whatever others left behind.",
    perks: ["lucky"],
    items: [{ item: "Crowbar", qty: 1 }, { item: "Canned Food", qty: 1 }, { item: "Water Bottle", qty: 1 }, { item: "Bandage", qty: 1 }, { item: "Scrap Metal", qty: 3 }],
    color: 0x8a6a3a,
    difficulty: 1.0,
  },
  {
    id: "survivalist",
    name: "Survivalist",
    blurb: "Lived off the land before it died.",
    perks: ["iron_gut"],
    items: [{ item: "Hatchet", qty: 1 }, { item: "MRE", qty: 2 }, { item: "Canteen", qty: 1 }, { item: "Bandage", qty: 1 }],
    color: 0x3a5236,
    difficulty: 0.95,
    statTweaks: { hunger: 15, thirst: 15 },
  },
  {
    id: "athlete",
    name: "Athlete",
    blurb: "Fast, fit, and very motivated to stay that way.",
    perks: ["marathoner"],
    items: [{ item: "Aluminum Bat", qty: 1 }, { item: "Energy Drink", qty: 2 }, { item: "Water Bottle", qty: 1 }],
    color: 0xffd23f,
    difficulty: 1.0,
  },
  {
    id: "mechanic",
    name: "Mechanic",
    blurb: "Can build, break, or jury-rig just about anything.",
    perks: ["scrapper"],
    items: [{ item: "Crowbar", qty: 1 }, { item: "Toolkit", qty: 1 }, { item: "Duct Tape", qty: 2 }, { item: "Nails", qty: 30 }, { item: "Nail Gun", qty: 1 }],
    color: 0xffa23f,
    difficulty: 1.0,
  },
  {
    id: "chef",
    name: "Chef",
    blurb: "Knows food — and what a cleaver can do.",
    perks: ["iron_gut"],
    items: [{ item: "Kitchen Knife", qty: 1 }, { item: "Cooked Meal", qty: 2 }, { item: "Canned Food", qty: 3 }, { item: "Water Bottle", qty: 1 }],
    color: 0xd9a441,
    difficulty: 1.0,
    statTweaks: { hunger: 25 },
  },
  {
    id: "biker",
    name: "Biker",
    blurb: "Hits first, hits hard, asks questions never.",
    perks: ["brawler"],
    items: [{ item: "Aluminum Bat", qty: 1 }, { item: "Leather Jacket", qty: 1 }, { item: "Energy Bar", qty: 2 }],
    color: 0x222222,
    difficulty: 1.0,
  },
  {
    id: "prepper",
    name: "Doomsday Prepper",
    blurb: "Saw it coming. Geared up. Trusts no one.",
    perks: ["tough", "hardy"],
    items: [{ item: "Pump Shotgun", qty: 1 }, { item: "Shotgun Shells", qty: 18 }, { item: "Hatchet", qty: 1 }, { item: "First-Aid Kit", qty: 1 }, { item: "MRE", qty: 2 }, { item: "Riot Gear", qty: 1 }],
    color: 0x5a6a4a,
    difficulty: 1.15,
  },
]);

const BY_ID = new Map<string, BackgroundDef>();
for (const b of BACKGROUNDS) BY_ID.set(b.id, b);

export function getBackground(id: string): BackgroundDef | undefined {
  return BY_ID.get(id);
}

export function randomBackground(rng: Rng): BackgroundDef {
  return rng.pick(BACKGROUNDS);
}
