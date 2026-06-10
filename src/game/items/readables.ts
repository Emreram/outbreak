import type { ReadableDef } from "./types";

// Readable items (Expansion U2). Deliberately NOT in the generic loot pools —
// they enter the world only through explicit injection points: scavenge searches,
// set-piece containers, and rare zombie drops (see notes.ts / WorldScene).

export const READABLES: readonly ReadableDef[] = Object.freeze([
  {
    id: "weathered_note",
    name: "Weathered Note",
    kind: "readable",
    flavor: "note",
    rarity: "common",
    icon: "note",
    desc: "A scrap of someone's last days. Read it from the bag.",
    value: 2,
  },
  {
    id: "survivor_journal",
    name: "Survivor Journal",
    kind: "readable",
    flavor: "journal",
    rarity: "uncommon",
    icon: "note",
    desc: "Pages of hard-won lessons. Read it from the bag.",
    value: 6,
  },
  {
    id: "stash_map",
    name: "Stash Map",
    kind: "readable",
    flavor: "map",
    rarity: "rare",
    icon: "map",
    desc: "Someone marked a cache out there. Reading it pins the spot on your map.",
    value: 14,
  },
] satisfies ReadableDef[]);
