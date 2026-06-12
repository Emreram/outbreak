// One-shot action + stance library (animation plan WS3–WS5) — pure samplers
// that blend weighted channel offsets into the Pose. WS3 ships the stun
// stance + registry assembly; WS4 adds the player combat set; WS5 the enemy
// reactions. Quadruped locomotion lives in quadGait.ts (WS7) but shares the
// registries here.

import type { ActionDef, ActorAnimSpec, AnimRegistry, LocoInput, Pose, StanceSampler } from "./AnimController";
import { humanoidAdditive, sampleHumanoidLocomotion } from "./locomotion";

export const ACTIONS: Record<string, ActionDef> = {
  // WS4/WS5 fill this table; placeholders proving the envelope live in tests.
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
