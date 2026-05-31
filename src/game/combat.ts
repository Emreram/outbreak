import type { GameState } from "../shared/contracts";
import type { Rng } from "./rng";
import { equippedMeleeDef, equippedRangedDef } from "./inventory";
import type { WeaponDef } from "./items/types";

// Pure combat math: turn the equipped weapon's def + abilities into a resolved hit.
// The scene applies the result (damage, FX, status) — keeping mechanics testable.

function val(w: WeaponDef, kind: string): number {
  return w.abilities.find((a) => a.kind === kind)?.value ?? 0;
}

export interface MeleeHit {
  damage: number;
  crit: boolean;
  cleave: number; // extra targets in the arc
  knockback: number; // px/s
  bleed: number; // dps
  bleedMs: number;
  stunMs: number;
  lifestealHp: number; // hp healed to the player per target hit
  executePct: number; // instakill if target hp% <= this
  noise: number;
  range: number;
  cooldownMs: number;
}

export function meleeOutcome(state: GameState, rng: Rng): MeleeHit {
  const w = equippedMeleeDef(state);
  let damage = w.damage;
  const critPct = val(w, "crit");
  const crit = critPct > 0 && rng.next() * 100 < critPct;
  if (crit) damage = Math.round(damage * 2);
  const bleed = val(w, "bleed");
  const lifesteal = val(w, "lifesteal");
  return {
    damage,
    crit,
    cleave: val(w, "cleave"),
    knockback: val(w, "knockback"),
    bleed,
    bleedMs: bleed > 0 ? 2500 : 0,
    stunMs: val(w, "stun"),
    lifestealHp: lifesteal > 0 ? Math.max(1, Math.round(damage * (lifesteal / 100))) : 0,
    executePct: val(w, "execute"),
    noise: w.noise,
    range: w.range,
    cooldownMs: w.cooldownMs,
  };
}

export interface ShotPlan {
  weapon: WeaponDef;
  damage: number;
  pellets: number;
  spread: number;
  crit: boolean;
  bleed: number;
  bleedMs: number;
  stunMs: number;
  knockback: number;
  pierce: number;
  explosive: number; // blast radius (0 = none)
  burn: number;
  executePct: number;
  noise: number;
  range: number;
  speed: number;
  cooldownMs: number;
}

/** Resolve one trigger pull for the equipped gun (per-projectile damage). */
export function shotOutcome(state: GameState, rng: Rng): ShotPlan | undefined {
  const w = equippedRangedDef(state);
  if (!w) return undefined;
  let damage = w.damage;
  const critPct = val(w, "crit");
  const crit = critPct > 0 && rng.next() * 100 < critPct;
  if (crit) damage = Math.round(damage * 2);
  const bleed = val(w, "bleed");
  return {
    weapon: w,
    damage,
    pellets: w.pellets ?? 1,
    spread: w.spread ?? 0,
    crit,
    bleed,
    bleedMs: bleed > 0 ? 2500 : 0,
    stunMs: val(w, "stun"),
    knockback: val(w, "knockback"),
    pierce: val(w, "pierce"),
    explosive: val(w, "explosive"),
    burn: val(w, "burn"),
    executePct: val(w, "execute"),
    noise: w.noise,
    range: w.range,
    speed: w.projectileSpeed ?? 700,
    cooldownMs: w.cooldownMs,
  };
}
