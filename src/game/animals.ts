// Wild animal defs (Feature 6) — pure data, lifted out of engine/Animal.ts so
// the renderer-agnostic sim (and headless tests) can use them without Phaser.
// engine/Animal.ts re-imports from here; values unchanged.

export type AnimalKind = "rabbit" | "deer" | "boar";

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  hp: number;
  speed: number;
  scale: number;
  drops: { item: string; qty: number }[];
}

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  rabbit: { kind: "rabbit", name: "Rabbit", hp: 8, speed: 130, scale: 0.55, drops: [{ item: "Raw Meat", qty: 1 }, { item: "Hide", qty: 1 }] },
  deer: { kind: "deer", name: "Deer", hp: 22, speed: 140, scale: 0.95, drops: [{ item: "Raw Meat", qty: 2 }, { item: "Hide", qty: 1 }, { item: "Bone", qty: 1 }] },
  boar: { kind: "boar", name: "Boar", hp: 34, speed: 110, scale: 0.85, drops: [{ item: "Raw Meat", qty: 3 }, { item: "Hide", qty: 1 }, { item: "Bone", qty: 2 }] },
};
