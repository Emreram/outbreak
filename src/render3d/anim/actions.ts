// One-shot action + stance library (animation plan WS3–WS5) — pure samplers
// that blend weighted channel offsets into the Pose. WS3 ships the stun
// stance + registry assembly; WS4 adds the player combat set; WS5 the enemy
// reactions. Quadruped locomotion lives in quadGait.ts (WS7) but shares the
// registries here.

import type { ActionDef, ActorAnimSpec, AnimRegistry, LocoInput, Pose, StanceSampler } from "./AnimController";
import { clamp01, easeInCubic, easeInQuad, easeOutCubic, easeOutQuad, lerp } from "./easing";
import { humanoidAdditive, sampleHumanoidLocomotion } from "./locomotion";

/** Segment helper: progress 0..1 inside [a,b] of the track (clamped). */
function seg(t01: number, a: number, b: number): number {
  return clamp01((t01 - a) / (b - a));
}

export const ACTIONS: Record<string, ActionDef> = {
  // --- player melee (animation plan WS4; styles match the swing event) ------
  attack_slash: {
    durationMs: 320,
    priority: 60,
    rampMs: 60,
    sample: (t01, w, pose) => {
      if (t01 < 0.28) {
        const k = easeOutQuad(seg(t01, 0, 0.28)) * w; // windup: arm back, torso coils
        pose.armR.swingY += -0.9 * k;
        pose.armR.liftZ += 0.25 * k;
        pose.torsoTwist += -0.35 * k;
      } else if (t01 < 0.56) {
        const s = easeInCubic(seg(t01, 0.28, 0.56)); // the 90ms sweep
        pose.armR.swingY += lerp(-0.9, 1.15, s) * w;
        pose.armR.liftZ += 0.2 * w;
        pose.torsoTwist += lerp(-0.35, 0.32, s) * w;
        pose.rootX += 0.12 * Math.sin(s * Math.PI) * w;
      } else {
        const r = 1 - easeOutQuad(seg(t01, 0.56, 1)); // recover
        pose.armR.swingY += 1.15 * r * w;
        pose.torsoTwist += 0.32 * r * w;
      }
    },
  },
  attack_thrust: {
    durationMs: 260,
    priority: 60,
    rampMs: 50,
    sample: (t01, w, pose) => {
      // Player.lunge curve parity: ~110ms out, ~150ms back
      const out = t01 < 0.42 ? easeOutCubic(seg(t01, 0, 0.42)) : 1 - easeOutQuad(seg(t01, 0.42, 1));
      pose.rootX += 0.22 * out * w;
      pose.armR.liftZ += 0.18 * out * w;
      pose.armR.swingY += 0.2 * out * w;
      pose.elbowR += -0.18 * out * w; // straighten into the stab
      pose.pitch += 0.08 * out * w;
    },
  },
  attack_smash: {
    durationMs: 380,
    priority: 60,
    rampMs: 70,
    sample: (t01, w, pose) => {
      if (t01 < 0.37) {
        const k = easeOutQuad(seg(t01, 0, 0.37)) * w; // both arms overhead
        pose.armL.liftZ += 1.25 * k;
        pose.armR.liftZ += 1.35 * k;
        pose.elbowL += 0.3 * k;
        pose.elbowR += 0.3 * k;
        pose.scaleY *= 1 + 0.04 * k;
      } else if (t01 < 0.58) {
        const s = easeInQuad(seg(t01, 0.37, 0.58)); // the crunch
        pose.armL.liftZ += lerp(1.25, -0.45, s) * w;
        pose.armR.liftZ += lerp(1.35, -0.5, s) * w;
        pose.scaleY *= 1 - 0.1 * s * w;
        pose.pitch += 0.22 * s * w;
        pose.rootX += 0.06 * s * w;
      } else {
        const r = 1 - easeOutQuad(seg(t01, 0.58, 1));
        pose.armL.liftZ += -0.45 * r * w;
        pose.armR.liftZ += -0.5 * r * w;
        pose.scaleY *= 1 - 0.1 * r * w;
        pose.pitch += 0.22 * r * w;
      }
    },
  },
  /** Gun kick (§3.7's 100–120ms recoil window). */
  fire_recoil: {
    durationMs: 120,
    priority: 40,
    rampMs: 35,
    sample: (t01, w, pose) => {
      const k = (1 - t01) * w;
      pose.rootX += -0.06 * k;
      pose.armR.liftZ += 0.14 * k;
      pose.torsoTwist += 0.08 * k;
      pose.headPitch += -0.05 * k;
    },
  },
  /** Player takes a hit: backward squash (Player.recoil parity curve). */
  hit_recoil: {
    durationMs: 160,
    priority: 80,
    rampMs: 50,
    sample: (t01, w, pose) => {
      const k = (1 - easeOutQuad(t01)) * w;
      pose.rootX += -0.1 * k;
      pose.scaleY *= 1 - 0.08 * k;
      pose.headPitch += -0.12 * k;
    },
  },
};

export const STANCES: Record<string, StanceSampler> = {
  /** Stun: dazed squash + slow 1.2Hz roll wobble (replaces the flat squash). */
  dizzy: (w, pose, inp) => {
    pose.scaleY *= 1 - 0.12 * w;
    pose.roll += Math.sin(inp.timeMs * 0.0075) * 0.16 * w;
    pose.headYaw += Math.sin(inp.timeMs * 0.0058) * 0.3 * w;
    pose.armL.liftZ -= 0.1 * w;
    pose.armR.liftZ -= 0.1 * w;
  },
  /** Ranged aim (WS4): both arms forward, torso + head track the cursor. */
  aim: (w, pose, inp) => {
    const twist = Math.max(-0.9, Math.min(0.9, inp.aimDeltaYaw));
    pose.torsoTwist += twist * w;
    pose.headYaw += twist * 0.6 * w;
    pose.armR.liftZ += 0.32 * w; // raise to a level hold
    pose.armR.swingY += 0.1 * w;
    pose.armL.liftZ += 0.22 * w;
    pose.armL.swingY += 0.4 * w; // support hand crosses in
    pose.elbowL += 0.35 * w;
    pose.elbowR += 0.1 * w;
  },
  /** Reload fiddle (WS4): weapon lowered, off-hand pumping at ~1.6Hz. */
  reload_loop: (w, pose, inp) => {
    pose.armR.liftZ += 0.05 * w;
    pose.armL.liftZ += 0.1 * w;
    pose.armL.swingY += (0.45 + Math.sin(inp.timeMs * 0.0101) * 0.3) * w;
    pose.elbowL += (0.5 + Math.sin(inp.timeMs * 0.0101) * 0.3) * w;
    pose.headPitch += 0.16 * w;
  },
  /** Hold-to-search rummage (WS8 binds it): arms working low + body bob. */
  rummage_loop: (w, pose, inp) => {
    pose.pitch += 0.14 * w;
    pose.armL.liftZ += (-0.18 + Math.sin(inp.timeMs * 0.012) * 0.12) * w;
    pose.armR.liftZ += (-0.18 + Math.sin(inp.timeMs * 0.012 + 2.1) * 0.12) * w;
    pose.elbowL += 0.4 * w;
    pose.elbowR += 0.4 * w;
    pose.scaleY *= 1 - 0.03 * w;
  },
};

export const HUMANOID_REGISTRY: AnimRegistry = {
  locomotion: sampleHumanoidLocomotion,
  actions: ACTIONS,
  stances: STANCES,
  additive: humanoidAdditive,
};

/** Quadruped registry — locomotion is installed by quadGait (WS7); until
 *  then a minimal sway keeps animals alive. */
export const QUAD_REGISTRY: AnimRegistry = {
  locomotion: (spec: ActorAnimSpec, inp: LocoInput, pose: Pose): void => {
    const sway = Math.sin(inp.phaseRad) * (inp.speedFrac > 0.9 ? 0.14 : 0.12);
    pose.yawOffset = -sway;
    if (inp.moving) pose.scaleY *= 1 + Math.sin(inp.phaseRad * 1.4) * 0.04;
    void spec;
  },
  actions: ACTIONS,
  stances: STANCES,
};
