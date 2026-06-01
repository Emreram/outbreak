import type { ZombieDef } from "./types";

// Per-type blood/gore identity. The engine reads this to spray the *right* fluid
// for the thing it just hit: rotted black-red for the common dead, fresh red for
// living survivors, glowing green bile for the toxic, blue arcs for the electric,
// cold ichor for the frostbitten, soot + embers for the charred, thick pus for
// bloaters, and tar for the truly wrong. Derivation favours traits/body/skin over
// names (names are fragile substrings). Engine layer (fx.ts) only renders these.

export type Fluid = "blood" | "ichor" | "bile" | "frozen" | "ash" | "spark" | "oil";

export interface BloodProfile {
  /** Arterial spray + the main flung droplets. */
  spray: number;
  /** Fine atomised mist — brighter, hangs in the air a beat. */
  mist: number;
  /** Ground pool / lingering decal — the darkest, coagulated tone. */
  pool: number;
  /** Flung gore chunks on a kill. */
  gib: number;
  /** Optional additive accent layer (toxic sheen, electric arc, ember). */
  glow?: number;
  /** Gore quantity multiplier (~0.8 husks → ~1.9 bosses). */
  amount: number;
  /** Fluid family — drives the fluid-specific quirks in splatHit/gibs. */
  fluid: Fluid;
}

// --- palettes ------------------------------------------------------------------
const HUMAN: BloodProfile = { fluid: "blood", spray: 0xc01818, mist: 0xff4a4a, pool: 0x4a0707, gib: 0x7e1010, amount: 1.0 };
const ROTTED: BloodProfile = { fluid: "blood", spray: 0x8e2616, mist: 0xc24a2a, pool: 0x33110a, gib: 0x5c1c10, amount: 0.95 };
const BILE: BloodProfile = { fluid: "bile", spray: 0x8fd14a, mist: 0xc6f06a, pool: 0x2f440f, gib: 0x5c7a1e, glow: 0x9bff5a, amount: 1.1 };
const PUS: BloodProfile = { fluid: "bile", spray: 0xb6c24a, mist: 0xe8ec7a, pool: 0x44470f, gib: 0x6e6a1e, glow: 0xd6ff6a, amount: 1.35 };
const SPARKS: BloodProfile = { fluid: "spark", spray: 0x5fd0ff, mist: 0xcaf4ff, pool: 0x1a4a5e, gib: 0x2a6a82, glow: 0x9be7ff, amount: 0.85 };
const FROZEN: BloodProfile = { fluid: "frozen", spray: 0x6f93b8, mist: 0xc2dcef, pool: 0x1e3448, gib: 0x37526c, amount: 0.85 };
const ASH: BloodProfile = { fluid: "ash", spray: 0x2c2622, mist: 0x6a5a48, pool: 0x100d0b, gib: 0x1c1713, glow: 0xff7a2a, amount: 0.9 };
const ICHOR: BloodProfile = { fluid: "ichor", spray: 0x7aaf4a, mist: 0xbce06a, pool: 0x2a4012, gib: 0x4e6a1e, glow: 0x9bff7a, amount: 1.0 };
const TAR: BloodProfile = { fluid: "oil", spray: 0x241d2c, mist: 0x6a5a7a, pool: 0x100c16, gib: 0x191320, glow: 0xb368ff, amount: 1.6 };

// distinctive skin tones from the catalog (zombies.ts)
const SKIN_TOXIC = 0x8fd14a;
const SKIN_FROST = 0x8aa0b8; // Frostbitten
const SKIN_DROWNED = 0x5a7a7a; // the Drowned's waterlogged grey
const SKIN_CHAR = 0x39302c;

function darken(c: number, f = 0.6): number {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** Resolve the blood identity for an enemy def. Stable + cheap (call once at spawn). */
export function bloodProfileFor(def: ZombieDef): BloodProfile {
  const tr = new Set(def.traits);
  const body = def.look.body;
  const skin = def.look.skin;

  let base: BloodProfile;

  // Living humans bleed human blood regardless of their (mechanical) traits —
  // a gun-toting "spitter" survivor is not toxic. bite:false flags the living.
  if (def.bite === false) base = HUMAN;
  else if (tr.has("electric")) base = SPARKS;
  else if (tr.has("regenerator")) base = ICHOR; // the plague's source (Patient Zero) over its spitter trait
  else if (skin === SKIN_FROST || skin === SKIN_DROWNED) base = FROZEN; // cold/water corpses — before the bloated branch
  else if (tr.has("bloated") || body === "bloated") base = PUS;
  else if (tr.has("toxic") || tr.has("spitter") || tr.has("acidic") || body === "toxic" || body === "spitter" || skin === SKIN_TOXIC) base = BILE;
  else if (skin === SKIN_CHAR) base = ASH;
  else base = ROTTED;

  // The big dead bleed in buckets; the Abomination runs black.
  if (def.family === "boss" || body === "behemoth") {
    if (def.id === "abomination") return { ...TAR, amount: Math.min(1.9, TAR.amount + 0.3) };
    return { ...base, amount: Math.min(1.9, base.amount + 0.55), pool: darken(base.pool, 0.75) };
  }
  return base;
}
