// Locomotion sampling (animation plan WS3) — pure. The 2D-parity sway
// numbers (Enemy.applySway + Player.update) live ONLY here; limb amplitude
// scales with speedFrac (anti-foot-slide, plan D5) while the parity
// frequencies stay the phase source. Archetype layers carry each movement
// class's identity: crawler arm-drag heave, runner pump, lurcher
// gather-crouch, stalker low-creep, bloated waddle (via the mandated
// engine/anim.ts gaitPose reuse), erratic twitch. The additive layer holds
// breathe + hash-gated idle twitches.

import { gaitPose, GAITS } from "../../engine/anim";
import type { ActorAnimSpec, LocoInput, Pose } from "./AnimController";

const TAU = Math.PI * 2;

/** Verbatim parity constants — the motion identity. */
export const HUMANOID_PARITY = {
  crawler: { amp: 0.2, freq: 0.006 },
  fast: { amp: 0.22, freq: 0.022 },
  standard: { amp: 0.12, freq: 0.008 },
  stalkerCreepMult: 0.5,
  lurcherCycleMs: 850,
  lurcherPauseAt: 450,
  survivorWalk: { amp: 0.07, freq: 0.021 },
  survivorSprint: { amp: 0.1, freq: 0.042 },
  breathe: { amp: 0.015, freq: 0.0045 },
} as const;

export type SwayClass = "crawler" | "fast" | "standard";

export function swayClassOf(spec: ActorAnimSpec): SwayClass {
  if (spec.movement === "crawler") return "crawler";
  if (spec.fast) return "fast";
  return "standard";
}

/** Stride phase for a humanoid at sim time t (parity frequency × hash offset). */
export function phaseFor(spec: ActorAnimSpec, timeMs: number): number {
  if (spec.archetype === "survivor") {
    // the caller scales time by sprint (player parity handled in playerPhase)
    return timeMs * HUMANOID_PARITY.survivorWalk.freq + spec.hash * TAU;
  }
  return timeMs * HUMANOID_PARITY[swayClassOf(spec)].freq + spec.hash * TAU;
}

/** Player parity phase: walk 0.021/ms, sprint 0.042/ms (Player.update). */
export function playerPhase(timeMs: number, sprinting: boolean): number {
  return timeMs * (sprinting ? HUMANOID_PARITY.survivorSprint.freq : HUMANOID_PARITY.survivorWalk.freq);
}

/** Sway amplitude for the yaw-wobble layer (parity + creep). */
export function swayAmpFor(spec: ActorAnimSpec, inp: LocoInput): number {
  if (spec.archetype === "survivor") {
    return inp.moving ? (inp.sprintFrac > 0.5 ? HUMANOID_PARITY.survivorSprint.amp : HUMANOID_PARITY.survivorWalk.amp) : 0;
  }
  let amp = HUMANOID_PARITY[swayClassOf(spec)].amp;
  if (inp.creep) amp *= HUMANOID_PARITY.stalkerCreepMult;
  return amp;
}

/** The continuous locomotion layer for humanoids (zombies + survivor). */
export function sampleHumanoidLocomotion(spec: ActorAnimSpec, inp: LocoInput, pose: Pose): void {
  const φ = inp.phaseRad;
  const sway = Math.sin(φ) * swayAmpFor(spec, inp);
  pose.yawOffset = -sway;
  pose.roll = sway * 0.6;

  const sf = Math.min(1.2, inp.speedFrac);
  const moving = inp.moving;
  const crawler = spec.movement === "crawler";

  if (moving && !crawler) {
    const swing = Math.sin(φ) * 0.55 * sf;
    pose.armL.swingY = swing;
    pose.armR.swingY = -swing;
    pose.armL.liftZ = -0.08 + Math.cos(φ) * 0.06 * sf;
    pose.armR.liftZ = -0.08 - Math.cos(φ) * 0.06 * sf;
    pose.elbowL = 0.16 + Math.max(0, Math.sin(φ)) * 0.22 * sf;
    pose.elbowR = 0.16 + Math.max(0, -Math.sin(φ)) * 0.22 * sf;
    const hip = Math.sin(φ) * 0.5 * sf;
    pose.hipL = -hip;
    pose.hipR = hip;
    // the swinging-through leg bends at the knee
    pose.kneeL = Math.max(0, -Math.sin(φ)) * 0.5 * sf;
    pose.kneeR = Math.max(0, Math.sin(φ)) * 0.5 * sf;
    pose.scaleY *= 1 + Math.sin(2 * φ) * 0.02 * sf; // footfall bob
    pose.pitch += 0.06 * sf + inp.sprintFrac * 0.16; // drive lean
    pose.headPitch += -Math.sin(2 * φ) * 0.05 * sf; // head counter-bob
  } else if (!crawler) {
    pose.armL.liftZ = -0.08;
    pose.armR.liftZ = -0.08;
    pose.elbowL = 0.12;
    pose.elbowR = 0.12;
  }

  // --- archetype identity layers -------------------------------------------
  if (crawler) {
    // arm-drag heave: alternating pulls, head-down body surge
    const pull = Math.sin(φ);
    pose.armL.swingY = pull * 0.9;
    pose.armR.swingY = -Math.sin(φ + 0.55) * 0.9;
    pose.armL.liftZ = -0.28 + Math.max(0, pull) * 0.22;
    pose.armR.liftZ = -0.28 + Math.max(0, -pull) * 0.22;
    pose.elbowL = 0.35;
    pose.elbowR = 0.35;
    pose.pitch += 0.32;
    if (moving) pose.scaleY *= 1 + Math.max(0, pull) * 0.05;
  }
  if (spec.movement === "lurcher" && inp.pauseGather) {
    pose.scaleY *= 0.93; // the gather-crouch (replaces the frozen frame)
    pose.pitch += 0.1;
    pose.armL.liftZ -= 0.15;
    pose.armR.liftZ -= 0.15;
  }
  if (inp.creep) {
    pose.pitch += 0.18;
    pose.scaleY *= 0.95;
  }
  if (spec.archetype === "bloated") {
    const gp = gaitPose(GAITS.shelled, φ, Math.max(0.4, sf), false); // waddle roll
    pose.roll += gp.sway;
    pose.scaleY *= 1 + gp.scaleYMul;
  }
  if (spec.movement === "erratic") {
    pose.headYaw += Math.sin(inp.timeMs * 0.082 + spec.hash * 7) * 0.09; // ~13Hz twitch
    pose.roll += Math.sin(inp.timeMs * 0.011 + spec.hash * 11) * 0.05;
  }
  if (spec.fast && moving) {
    pose.elbowL = 0.9; // runner arm pump
    pose.elbowR = 0.9;
    pose.armL.liftZ += 0.18;
    pose.armR.liftZ += 0.18;
  }
}

/** Additive micro-layer: breathe at rest + hash-gated idle head twitches. */
export function humanoidAdditive(spec: ActorAnimSpec, inp: LocoInput, pose: Pose, suppress: number): void {
  const k = 1 - suppress;
  if (k <= 0) return;
  if (!inp.moving) {
    pose.scaleY *= 1 + Math.sin(inp.timeMs * HUMANOID_PARITY.breathe.freq) * HUMANOID_PARITY.breathe.amp * k;
  }
  // occasional head tilt (deterministic per rig, period 3–7s)
  const period = 3000 + spec.hash * 4000;
  const tt = (inp.timeMs + spec.hash * period) % period;
  if (tt < 420) {
    const f = Math.sin((tt / 420) * Math.PI);
    pose.headYaw += f * 0.32 * k * (spec.hash > 0.5 ? 1 : -1);
  }
}

/**
 * Foot-plant detector: a stride plants each foot once (at the sin extremes,
 * φ = π/2 and 3π/2). Returns +1 (left), -1 (right) or 0.
 */
export function footPlants(prevPhase: number, phase: number): -1 | 0 | 1 {
  const idx = (p: number): number => Math.floor((p - Math.PI / 2) / Math.PI);
  const a = idx(prevPhase);
  const b = idx(phase);
  if (b === a) return 0;
  return b % 2 === 0 ? -1 : 1;
}
