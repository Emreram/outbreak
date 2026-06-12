// One-shot action + stance library (animation plan WS3–WS5) — pure samplers
// that blend weighted channel offsets into the Pose. WS3 ships the stun
// stance + registry assembly; WS4 adds the player combat set; WS5 the enemy
// reactions. Quadruped locomotion lives in quadGait.ts (WS7) but shares the
// registries here.

import type { ActionDef, AnimRegistry, StanceSampler } from "./AnimController";
import { clamp01, easeInCubic, easeInQuad, easeOutCubic, easeOutQuad, lerp } from "./easing";
import { humanoidAdditive, sampleHumanoidLocomotion } from "./locomotion";
import { sampleQuadGait } from "./quadGait";

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

  /** Spawn claw-up (WS6): rises out of the ground, arms reaching. */
  spawn: {
    durationMs: 240,
    priority: 90,
    rampMs: 240, // ramp = duration → weight fades the WHOLE action out smoothly
    sample: (t01, _w, pose) => {
      const k = easeOutCubic(t01);
      pose.rootY += -0.6 * (1 - k);
      pose.scaleY *= 0.7 + 0.3 * k;
      pose.armL.liftZ += 1.2 * (1 - t01);
      pose.armR.liftZ += 1.1 * (1 - t01);
      pose.headPitch += -0.25 * (1 - t01);
    },
  },

  // --- enemy reactions (animation plan WS5) -----------------------------------
  /** Contact-attack lunge: forward snap + clawing arms + a bite of the head. */
  enemy_lunge: {
    durationMs: 240,
    priority: 60,
    rampMs: 50,
    sample: (t01, w, pose) => {
      const out = t01 < 0.4 ? easeOutCubic(seg(t01, 0, 0.4)) : 1 - easeOutQuad(seg(t01, 0.4, 1));
      pose.rootX += 0.18 * out * w;
      pose.armL.liftZ += 0.5 * out * w;
      pose.armR.liftZ += 0.55 * out * w;
      pose.armL.swingY += 0.35 * out * w;
      pose.armR.swingY += -0.35 * out * w;
      pose.headPitch += 0.22 * out * w; // the bite
      pose.pitch += 0.12 * out * w;
    },
  },
  /** Hit stagger: recoil along the impact direction + head snap + shuffle.
   *  opts.dirX/dirY = impact direction in sim space; the controller can't see
   *  facing, so the recoil rides rootX (backward along facing ≈ away for
   *  frontal hits) plus a roll kick for side reads. */
  stagger: {
    durationMs: 200,
    priority: 80,
    rampMs: 45,
    sample: (t01, w, pose, _inp, opts) => {
      const k = (1 - easeOutQuad(t01)) * w;
      const power = Math.min(1.4, opts.power ?? 1);
      pose.rootX += -0.12 * k * power;
      pose.headYaw += (opts.dirX !== undefined && opts.dirX < 0 ? -0.4 : 0.4) * k;
      pose.roll += (opts.dirY !== undefined && opts.dirY < 0 ? -0.1 : 0.1) * k;
      pose.scaleY *= 1 - 0.06 * k;
      pose.hipL += 0.18 * k; // the half-step shuffle
      pose.hipR += -0.12 * k;
    },
  },
  /** Spitter wind-up: head rears back then thrusts with a neck stretch. */
  spit: {
    durationMs: 280,
    priority: 60,
    rampMs: 50,
    sample: (t01, w, pose) => {
      if (t01 < 0.32) {
        const k = easeOutQuad(seg(t01, 0, 0.32)) * w;
        pose.headPitch += -0.35 * k; // rear back
        pose.pitch += -0.06 * k;
      } else {
        const s = (1 - seg(t01, 0.65, 1)) * easeInCubic(seg(t01, 0.32, 0.65));
        pose.headPitch += 0.4 * s * w; // the thrust
        pose.scaleY *= 1 + 0.05 * s * w; // neck stretch
        pose.pitch += 0.1 * s * w;
      }
    },
  },
  /** Screamer: arms thrown up, chest heaving at 2× — synced to the 500ms ring. */
  scream: {
    durationMs: 520,
    priority: 60,
    rampMs: 80,
    sample: (t01, w, pose) => {
      const hold = Math.sin(Math.min(1, t01 * 1.3) * Math.PI); // rise, hold, fall
      pose.armL.liftZ += 1.3 * hold * w;
      pose.armR.liftZ += 1.3 * hold * w;
      pose.headPitch += -0.3 * hold * w; // head back, throat open
      pose.scaleY *= 1 + 0.06 * hold * Math.abs(Math.sin(t01 * Math.PI * 4)) * w; // 2× heave
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
  /** Mid-leap stretch (WS5): elongated body, arms trailing, nose down. */
  leap_stretch: (w, pose) => {
    pose.scaleY *= 1 + 0.12 * w;
    pose.pitch += 0.18 * w;
    pose.armL.liftZ += -0.35 * w;
    pose.armR.liftZ += -0.35 * w;
    pose.armL.swingY += -0.4 * w;
    pose.armR.swingY += 0.4 * w;
    pose.rootY += 0.12 * w; // a skim of airtime
  },
  /** Knockback tumble (WS5): rolling stumble while flung backward. */
  tumble: (w, pose, inp) => {
    pose.roll += Math.sin(inp.timeMs * 0.02) * 0.3 * w;
    pose.scaleY *= 1 - 0.1 * w;
    pose.armL.liftZ += 0.45 * w; // arms flail up
    pose.armR.liftZ += 0.45 * w;
    pose.headPitch += -0.2 * w;
  },
};

export const HUMANOID_REGISTRY: AnimRegistry = {
  locomotion: sampleHumanoidLocomotion,
  actions: ACTIONS,
  stances: STANCES,
  additive: humanoidAdditive,
};

/** Quadruped registry — real gaits (bound/gallop/trot) live in quadGait.ts. */
export const QUAD_REGISTRY: AnimRegistry = {
  locomotion: sampleQuadGait,
  actions: ACTIONS,
  stances: STANCES,
};
