// World-transient curves (animation plan WS8) — pure math for the chest lid,
// the loot-drop ballistic arc, the magnet flight, and the rummage dust
// cadence. Babylon-free; headless-tested in tests/anim3d.test.ts.

import { clamp01, easeInQuad, easeOutBack } from "./easing";

// --- chest lid -------------------------------------------------------------------

export const LID_OPEN_MS = 320;
/** Fully open: −110° about the back-edge hinge. */
export const LID_MAX_RAD = (-110 * Math.PI) / 180;

/** Lid hinge angle at t (ms since open). easeOutBack character, clamped both
 *  ways: never past −110°, never backward through the closed hinge (the raw
 *  curve is ~−2e-16 at t=0 in floats). */
export function lidAngle(tMs: number): number {
  if (tMs <= 0) return 0;
  return LID_MAX_RAD * clamp01(easeOutBack(clamp01(tMs / LID_OPEN_MS)));
}

// --- loot-drop ballistic arc -----------------------------------------------------
// Spawn pops the drop 0.85m above its rest height; it falls and double-bounces
// with restitution 0.35, coming to rest in ~620ms. Segment times come from the
// closed form T = t1·(1 + 2r + 2r²), so the curve is EXACTLY 0 at DROP_ARC_MS.

export const DROP_ARC_MS = 620;
const DROP_H0 = 0.85;
const REST = 0.35; // velocity restitution per bounce
const T1 = DROP_ARC_MS / (1 + 2 * REST + 2 * REST * REST); // first-fall ms
const G = (2 * DROP_H0) / (T1 / 1000) ** 2; // m/s², solved for the 620ms read

/** Height ABOVE REST (m) at t ms since spawn. 0.85 at t=0, 0 from 620ms on. */
export function dropArcY(tMs: number): number {
  if (tMs >= DROP_ARC_MS) return 0;
  const t1 = T1 / 1000;
  let t = Math.max(0, tMs) / 1000;
  if (t < t1) return DROP_H0 - 0.5 * G * t * t; // the initial fall
  t -= t1;
  let v = G * t1 * REST; // launch speed of bounce 1
  for (let i = 0; i < 2; i++) {
    const dur = (2 * v) / G;
    if (t < dur) return Math.max(0, v * t - 0.5 * G * t * t);
    t -= dur;
    v *= REST;
  }
  return 0;
}

// --- magnet flight ---------------------------------------------------------------
// Mirrors the sim's 160ms vacuum (drops.ts MAGNET_FLIGHT_MS): position eases
// in toward the player and the cube shrinks to 0.4 as it lands in the bag.

export const MAGNET_MS = 160;

export function magnetLerp(tMs: number): number {
  return easeInQuad(clamp01(tMs / MAGNET_MS));
}

export function magnetScale(tMs: number): number {
  return 1 - 0.6 * magnetLerp(tMs);
}

// --- rummage cadence -------------------------------------------------------------

export const RUMMAGE_PULSE_MS = 400;

/** True when the held-search timer crossed a 400ms boundary this frame. */
export function rummagePulse(prevHeldMs: number, heldMs: number): boolean {
  return Math.floor(heldMs / RUMMAGE_PULSE_MS) > Math.floor(Math.max(0, prevHeldMs) / RUMMAGE_PULSE_MS);
}
