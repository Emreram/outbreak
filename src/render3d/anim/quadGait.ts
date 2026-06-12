// Quadruped gaits (animation plan WS7) — pure samplers for the QuadRig
// channel mapping (applyQuadPose: armL/R = front legs, hipL/R = hind legs,
// headPitch/Yaw = neck, torsoTwist = tail wag). On a +X-facing quadruped the
// Pose.roll channel (root.rotation.z) reads as body PITCH — the hop arc and
// gallop rock ride it.
//
// Three real gaits, reusing the engine/anim.ts GAITS feel table (mandated):
//   rabbit — BOUND 3.2Hz: pairs in phase [0,0,π,π], parabolic hop
//            rootY = max(0, sin φ)²·0.22m, legs tucking mid-air
//   deer   — GALLOP on GAITS.equine via gaitPose (rotary footfall offsets,
//            neck dipping 0.12 into the drive)
//   boar   — TROT on GAITS.quadruped via gaitPose (diagonal pairs)
// The view accumulates phase per the engine/anim.ts idiom
// (`gaitT += dt/1000 · strideHz · speedFrac · 2π` — strides slow with the
// body, so feet never slide) with flee panic running the stride ×1.35.
// The 2D yaw-sway parity (±0.14 fleeing / ±0.12 calm at 0.02 rad/ms,
// per-rig phase hash) stays the yawOffset source, verbatim.

import type { ActorAnimSpec, LocoInput, Pose } from "./AnimController";
import { GAITS, gaitPose } from "../../engine/anim";

const TAU = Math.PI * 2;

/** Base stride rates (Hz at full speed). Deer/boar take theirs from the
 *  mandated GAITS table; the rabbit bound is its own beat. */
export const QUAD_STRIDE_HZ: Record<string, number> = {
  rabbit: 3.2,
  deer: GAITS.equine.strideHz,
  boar: GAITS.quadruped.strideHz,
};

export const FLEE_STRIDE_MULT = 1.35;

/** Stride rate for the view's phase accumulator. */
export function quadStrideRate(kind: string, fleeing: boolean): number {
  return (QUAD_STRIDE_HZ[kind] ?? GAITS.quadruped.strideHz) * (fleeing ? FLEE_STRIDE_MULT : 1);
}

/** Rotary gallop footfall offsets: LF, RF, HL, HR. */
const GALLOP_OFFSETS = [0, 0.15 * TAU, 0.65 * TAU, 0.5 * TAU] as const;

/** AnimRegistry.locomotion for quadrupeds. inp.sprintFrac carries the flee
 *  flag (>0.5), inp.phaseRad the accumulated stride phase. */
export function sampleQuadGait(spec: ActorAnimSpec, inp: LocoInput, pose: Pose): void {
  const φ = inp.phaseRad;
  const sf = Math.min(1, inp.speedFrac);
  const fleeing = inp.sprintFrac > 0.5;

  // 2D parity yaw sway — always on, exactly the Animal.update numbers.
  pose.yawOffset = -Math.sin(inp.timeMs * 0.02 + spec.hash * TAU) * (fleeing ? 0.14 : 0.12);

  if (!inp.moving) {
    // graze/idle: slow breathe + head dipping toward the ground
    pose.scaleY *= 1 + Math.sin(inp.timeMs * 0.0045 + spec.hash * TAU) * 0.02;
    pose.headPitch += 0.05 + Math.sin(inp.timeMs * 0.0011 + spec.hash * TAU) * 0.06;
    pose.torsoTwist += Math.sin(inp.timeMs * 0.006 + spec.hash * TAU) * 0.15; // tail idles
    return;
  }

  switch (spec.archetype) {
    case "rabbit": {
      // bound: both pairs move together, hind a half-stride behind the front
      const air = Math.max(0, Math.sin(φ));
      pose.rootY += air * air * 0.22 * sf;
      const tuck = air * air * 0.5 * sf;
      const front = Math.sin(φ) * 0.7 * sf;
      const hind = Math.sin(φ + Math.PI) * 0.8 * sf;
      pose.armL.swingY = front + tuck * 0.6;
      pose.armR.swingY = front + tuck * 0.6;
      pose.hipL = hind + tuck;
      pose.hipR = hind + tuck;
      pose.roll += Math.cos(φ) * 0.15 * sf; // nose up on the rise, down landing
      pose.headPitch += -air * 0.1; // head extends in flight
      pose.torsoTwist += Math.sin(φ) * 0.2; // tail flag
      break;
    }
    case "deer": {
      // gallop: the equine canter rock + bob come straight from GAITS (reuse)
      const g = gaitPose(GAITS.equine, φ, sf, false);
      pose.scaleY *= 1 + g.scaleYMul;
      pose.roll += g.sway * 1.2; // the rock reads as pitch on a quad
      pose.armL.swingY = Math.sin(φ + GALLOP_OFFSETS[0]) * 0.65 * sf;
      pose.armR.swingY = Math.sin(φ + GALLOP_OFFSETS[1]) * 0.65 * sf;
      pose.hipL = Math.sin(φ + GALLOP_OFFSETS[2]) * 0.7 * sf;
      pose.hipR = Math.sin(φ + GALLOP_OFFSETS[3]) * 0.7 * sf;
      pose.rootY += Math.max(0, Math.sin(φ + 1.1)) * 0.06 * sf; // suspension skim
      pose.headPitch += Math.sin(φ) * 0.12 * sf; // the neck dip
      pose.torsoTwist += Math.sin(φ * 0.5) * 0.12;
      break;
    }
    default: {
      // boar (and any future quad): trot — strict diagonal pairs off GAITS
      const g = gaitPose(GAITS.quadruped, φ, sf, false);
      pose.scaleY *= 1 + g.scaleYMul;
      pose.roll += g.sway * 0.8;
      const a = Math.sin(φ) * 0.5 * sf;
      const b = Math.sin(φ + Math.PI) * 0.5 * sf;
      pose.armL.swingY = a;
      pose.hipR = a; // diagonal pair 1
      pose.armR.swingY = b;
      pose.hipL = b; // diagonal pair 2
      pose.headPitch += 0.12 + Math.sin(φ * 2) * 0.04 * sf; // snout low, rooting
      pose.torsoTwist += Math.sin(φ) * 0.18;
      break;
    }
  }
}
