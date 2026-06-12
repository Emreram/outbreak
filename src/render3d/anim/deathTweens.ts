// Death tween samplers (animation plan WS6) — pure. Three variants, each
// ending EXACTLY on the poseCorpse channel contract (DEATH_END, asserted in
// tests) so the corpses-map handover is byte-identical to the instant path:
//   flop    180ms — keels over, easeInQuad
//   crumple 260ms — collapses (scaleY dips) then tips
//   launch  220ms — flung along the kill direction with a yaw tumble
// The WorldView dying list drives these on sim time and applies the channels
// to the rig root (rotZFrac of side·π/2, slide start→corpse position, lift,
// scaleY, yawSpin).

import { clamp01, easeInCubic, easeInQuad, easeOutBack, easeOutQuad } from "./easing";

export type DeathVariant = "flop" | "crumple" | "launch";

export interface DeathSample {
  /** 0..1 of the final side·π/2 roll. */
  rotZFrac: number;
  /** 0..1 interpolation from the kill spot to the corpse record position. */
  slide: number;
  /** Vertical lift in meters (launch arc). */
  lift: number;
  scaleY: number;
  /** Extra yaw spin in radians (launch tumble). */
  yawSpin: number;
}

/** The t=1 contract — must match poseCorpse's root channels. yawSpin ends at
 *  finalYawSpin(variant); WorldView bakes it into the corpse yaw so the
 *  handover is continuous. */
export const DEATH_END = { rotZFrac: 1, slide: 1, lift: 0, scaleY: 1 } as const;

/** The persistent tumble each variant leaves in the corpse's final yaw. */
export function finalYawSpin(variant: DeathVariant): number {
  return variant === "launch" ? Math.PI * 1.5 : 0;
}

export const DEATH_DURATION: Record<DeathVariant, number> = {
  flop: 180,
  crumple: 260,
  launch: 220,
};

/** Variant pick from the kill context (crit/explosive ⇒ launch; else 70/30). */
export function pickDeathVariant(ctx: { crit?: boolean; explosive?: boolean; hash: number }): DeathVariant {
  if (ctx.crit || ctx.explosive) return "launch";
  return ctx.hash < 0.7 ? "flop" : "crumple";
}

function seg(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

export function sampleDeath(variant: DeathVariant, t01: number, out: DeathSample): DeathSample {
  const t = clamp01(t01);
  out.rotZFrac = 0;
  out.slide = 1;
  out.lift = 0;
  out.scaleY = 1;
  out.yawSpin = 0;
  switch (variant) {
    case "flop":
      out.rotZFrac = easeInQuad(t);
      break;
    case "crumple": {
      // collapse first (scaleY → 0.55 by 54%), then tip while recovering
      if (t < 0.54) {
        out.scaleY = 1 - 0.45 * easeInQuad(seg(t, 0, 0.54));
        out.rotZFrac = 0.12 * seg(t, 0, 0.54);
      } else {
        const s = seg(t, 0.54, 1);
        out.rotZFrac = 0.12 + 0.88 * easeInCubic(s);
        out.scaleY = 0.55 + 0.45 * s; // back to 1 by the sprawl
      }
      break;
    }
    case "launch": {
      out.slide = Math.min(1, easeOutBack(t)); // flung with a settle read
      out.rotZFrac = easeOutQuad(t);
      out.lift = Math.sin(t * Math.PI) * 0.3;
      out.yawSpin = finalYawSpin("launch") * easeOutQuad(t); // tumble persists
      break;
    }
  }
  if (t >= 1) {
    out.rotZFrac = DEATH_END.rotZFrac;
    out.slide = DEATH_END.slide;
    out.lift = DEATH_END.lift;
    out.scaleY = DEATH_END.scaleY;
    out.yawSpin = finalYawSpin(variant);
  }
  return out;
}
