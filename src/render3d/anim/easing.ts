// Easing kit (animation plan WS1) — pure, zero imports (the engine/anim.ts
// doctrine). Every curve maps [0,1]→[0,1] with f(0)=0, f(1)=1; easeOutBack
// overshoots by design (s = 1.70158, max ≈ 1.1).

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

const BACK_S = 1.70158;

export function easeOutBack(t: number): number {
  const u = t - 1;
  return 1 + u * u * ((BACK_S + 1) * u + BACK_S);
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/** Trapezoid weight envelope for one-shot tracks: ramp in/out over `rampMs`. */
export function envelope(tMs: number, durationMs: number, rampMs: number): number {
  if (tMs <= 0 || tMs >= durationMs) return 0;
  return Math.min(1, tMs / rampMs, (durationMs - tMs) / rampMs);
}
