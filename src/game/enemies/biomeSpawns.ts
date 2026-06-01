import type { ZombieDef, ZombieTrait, BodyArchetype } from "./types";

// Biome-aware spawn flavour (Living World). Instead of authoring a separate roster
// per biome, we BIAS the existing 100+ catalog toward the kinds of dead that belong
// in a place: bloated drowned in the marshes, charred husks + exploders on the lava
// fields, fast feral runners in the woods, armoured remnants at the old checkpoints,
// toxic spitters around the hospital, etc. Because blood.ts derives gore from the
// same traits/body/skin, a biome-appropriate variant automatically bleeds correctly
// (ash on the volcanic charred, bile on the marsh bloated…). Pure data + a multiplier.

export interface BiomeAffinity {
  /** Multiply a def's spawn weight per matching trait. */
  traits?: Partial<Record<ZombieTrait, number>>;
  /** Multiply per matching body archetype. */
  body?: Partial<Record<BodyArchetype, number>>;
  /** 0..1 chance to upgrade a plain "zombie" request to a "zombie_runner" here. */
  runnerBias?: number;
}

export const BIOME_AFFINITY: Record<string, BiomeAffinity> = {
  // Wetlands: the drowned + the rotted-bloated, with a toxic edge.
  marsh: { traits: { bloated: 3, toxic: 2, grabber: 1.6 }, body: { bloated: 3, crawler: 1.5 } },
  wetland: { traits: { bloated: 3, toxic: 2, grabber: 1.6 }, body: { bloated: 3, crawler: 1.5 } },
  riverbank: { traits: { bloated: 2, toxic: 1.5 }, body: { bloated: 2 } },
  lake: { traits: { bloated: 2.5 }, body: { bloated: 2.5 } },
  // Volcanic / scorched: charred husks that burst.
  volcanic: { traits: { exploder: 3, frenzied: 2, fast: 1.5 }, body: { husk: 3 } },
  badlands: { traits: { armored: 1.8, brute: 1.6 }, body: { husk: 1.8, armored: 1.6 } },
  // Woods: feral, fast, leaping things.
  forest: { traits: { fast: 2.4, frenzied: 1.8, leaper: 1.8 }, body: { runner: 2.2 }, runnerBias: 0.4 },
  dense_woods: { traits: { fast: 2.6, frenzied: 2, leaper: 2 }, body: { runner: 2.4 }, runnerBias: 0.5 },
  parkland: { traits: { fast: 1.6 }, runnerBias: 0.2 },
  grassland: { traits: { fast: 1.5 }, runnerBias: 0.2 },
  // Old military checkpoints: armoured + shielded remnants.
  military_base: { traits: { armored: 3, shielded: 2.4, brute: 1.6 }, body: { armored: 3, brute: 1.6 } },
  // Medical zones: toxic spitters + screamers (failed containment).
  hospital_zone: { traits: { toxic: 3, spitter: 2.4, screamer: 1.6 }, body: { spitter: 2.4, toxic: 2.4, hazmat: 2 } },
  // Heavy industry: electrified + brutish.
  industrial: { traits: { electric: 2.4, brute: 1.8 }, body: { brute: 1.8 } },
  warehouse_district: { traits: { brute: 1.6, armored: 1.5 } },
  trainyard: { traits: { brute: 1.6, electric: 1.5 } },
  // Built-up cores: dense crowds of plain biters (handled by counts elsewhere).
  downtown: { traits: { biter: 1.4, grabber: 1.4 } },
  police_district: { traits: { armored: 2, shielded: 1.8 } },
};

/** Spawn-weight multiplier for a def in a biome (1 if the biome has no affinity). */
export function affinityMult(def: ZombieDef, aff: BiomeAffinity | undefined): number {
  if (!aff) return 1;
  let m = 1;
  if (aff.traits) for (const t of def.traits) m *= aff.traits[t] ?? 1;
  if (aff.body) m *= aff.body[def.look.body] ?? 1;
  return m;
}

/** The affinity record for a biome id, or undefined. */
export function affinityFor(biome: string | undefined): BiomeAffinity | undefined {
  return biome ? BIOME_AFFINITY[biome] : undefined;
}
