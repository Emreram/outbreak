// Animation core (AAA Animation Pass PR 1) — the pure math behind every frame
// swap, gait, and sway in the game. Zero imports by design: each entity keeps
// its own phase accumulator and calls these from its existing update(); tests
// bundle this file trivially. The codebase idiom this formalizes: "manual
// setTexture swap between sibling keys, driven by a sine phase, plus rotation
// sway" — bob is ALWAYS scaleY, never position (the arcade body is authoritative).

/** A frame cycle: 2-step [a,b] by sine sign, or 4-step [a,pass,b,pass] when a
 *  pass (mid-stride) frame exists; idle at rest. */
export interface FrameSet {
  idle: string;
  a: string;
  b: string;
  pass?: string;
}

/** Structural sprite slice so this module imports nothing. */
export interface FrameSprite {
  texture: { key: string };
  setTexture(key: string): unknown;
  scene: { textures: { exists(k: string): boolean } };
}

const TAU = Math.PI * 2;

/** The frame for a stride phase (radians). 4-step cycles change every quarter
 *  phase (contact–pass–contact–pass); 2-step toggles on the sine's sign. */
export function frameFor(f: FrameSet, moving: boolean, phaseRad: number): string {
  if (!moving) return f.idle;
  if (f.pass) {
    const q = Math.floor((((phaseRad % TAU) + TAU) % TAU) / (Math.PI / 2)); // 0..3
    return q === 0 ? f.a : q === 1 ? f.pass : q === 2 ? f.b : f.pass;
  }
  return Math.sin(phaseRad) >= 0 ? f.a : f.b;
}

/** Swap with the exists + no-op guard every entity used to hand-roll. */
export function applyFrame(spr: FrameSprite, key: string): void {
  if (spr.texture.key !== key && spr.scene.textures.exists(key)) spr.setTexture(key);
}

/** Build a FrameSet, collapsing missing keys onto `a` — the fallback chain:
 *  a generated single-frame sprite simply cycles a↔a (a free no-op) while the
 *  gait layer carries its motion; procedural pairs cycle for real. */
export function resolveFrames(
  exists: (k: string) => boolean,
  base: string,
  opts?: { idle?: string; b?: string; pass?: string },
): FrameSet {
  const idle = opts?.idle && exists(opts.idle) ? opts.idle : base;
  const b = opts?.b && exists(opts.b) ? opts.b : base;
  const f: FrameSet = { idle, a: base, b };
  if (opts?.pass && exists(opts.pass)) f.pass = opts.pass;
  return f;
}

// --- gait motion layer ----------------------------------------------------------
// Per-archetype locomotion FEEL: stride frequency, body sway, footfall bob. The
// same spec drives a free pet and (amplified) its ridden mount, and animates
// single-frame generated sprites that have no second frame to swap.

export interface GaitSpec {
  strideHz: number; // stride cycles per second at full speed
  swayAmp: number; // rotation ± radians while moving
  bobAmp: number; // scaleY pulse ± (footfall compression)
  sBend?: number; // serpent secondary half-rate S-wave amplitude
  mountedMult: number; // amplitude multiplier when ridden — a rider feels the gait
}

/** Keyed by PetArchetype (pets.ts) — coverage asserted in tests. */
export const GAITS: Record<string, GaitSpec> = {
  quadruped: { strideHz: 2.6, swayAmp: 0.07, bobAmp: 0.03, mountedMult: 1.2 }, // trot
  equine: { strideHz: 1.9, swayAmp: 0.05, bobAmp: 0.055, mountedMult: 1.35 }, // canter rock
  avian: { strideHz: 2.2, swayAmp: 0.04, bobAmp: 0.02, mountedMult: 1.2 },
  drake: { strideHz: 2.0, swayAmp: 0.08, bobAmp: 0.035, mountedMult: 1.3 },
  serpent: { strideHz: 1.6, swayAmp: 0.05, bobAmp: 0.015, sBend: 0.12, mountedMult: 1.25 },
  shelled: { strideHz: 1.3, swayAmp: 0.11, bobAmp: 0.02, mountedMult: 1.15 }, // waddle roll
};

export interface GaitPose {
  sway: number; // add to facing rotation
  scaleYMul: number; // multiply into scaleY as (1 + scaleYMul)
  frameB: boolean; // which 2-step frame this phase wants
  flapHz: number; // wing flap rate (avian/drake overlays; caller ×1.5 airborne)
}

/** Pose for a stride phase. Callers accumulate phase as
 *  `gaitT += dt/1000 * strideHz * speedFrac * 2π` so strides slow with the body. */
export function gaitPose(spec: GaitSpec, phaseRad: number, speedFrac: number, mounted: boolean): GaitPose {
  const m = mounted ? spec.mountedMult : 1;
  const s = Math.sin(phaseRad);
  const sway = s * spec.swayAmp * m + (spec.sBend ? Math.sin(phaseRad * 0.5) * spec.sBend * m : 0);
  // footfall bob: two beats per stride, scaled down at a walk
  const scaleYMul = Math.sin(phaseRad * 2) * spec.bobAmp * m * Math.max(0.4, speedFrac);
  return { sway, scaleYMul, frameB: s < 0, flapHz: 1.6 + speedFrac * 1.2 };
}

// --- prop sway (consumed by the world-animation PR; constants live here so every
// motion number in the game is in one file) --------------------------------------

export interface SwaySpec {
  amp: number; // rotation ± radians at full gust
  freqHz: number; // base sway frequency
  originY: number; // pivot point (fraction of sprite height — the root/trunk)
}

export const SWAY_SPECS: Record<string, SwaySpec> = {
  tree: { amp: 0.022, freqHz: 0.16, originY: 0.88 },
  pine: { amp: 0.018, freqHz: 0.14, originY: 0.9 },
  bush: { amp: 0.03, freqHz: 0.22, originY: 0.85 },
  reeds: { amp: 0.07, freqHz: 0.45, originY: 0.95 },
  cattail: { amp: 0.06, freqHz: 0.4, originY: 0.95 },
  flowers: { amp: 0.04, freqHz: 0.3, originY: 0.85 },
};

/** Sway angle at a moment: a base sine plus a slow gust modulation whose phase
 *  is position-coupled — wind visibly TRAVELS across a treeline. */
export function swayAngle(spec: SwaySpec, timeMs: number, phaseHash: number): number {
  const t = timeMs / 1000;
  const gust = 0.65 + 0.35 * Math.sin(t * 0.13 + phaseHash * 0.5);
  return Math.sin(t * spec.freqHz * TAU + phaseHash) * spec.amp * gust;
}

/** Deterministic 0..2π phase from a world position (decor-hash convention) —
 *  neighbours never sway in lockstep, and no RNG stream is touched. */
export function posPhase(x: number, y: number): number {
  const h = ((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)) >>> 0;
  return ((h % 1000) / 1000) * TAU;
}
