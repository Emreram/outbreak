// Natural disasters — the PURE core (Phaser-free, testable): types, the live
// telegraph→active→expired lifecycle, the active-phase intensity envelope, an
// in-zone test, and the context-driven scheduler. The engine (WorldScene) owns
// the live VFX + physical effects and writes the lasting DisasterZone scar; this
// module only decides what/when and does the math. Two tiers per the design:
// common disasters telegraph generously and spare the base; rare "cataclysms" are
// bigger, barely warn, and can wreck it.

import type { DisasterKind } from "../shared/contracts";
import type { Rng } from "./rng";
import { TILE_SIZE } from "./constants";

export type DisasterPhase = "telegraph" | "active" | "expired";

/** A live, in-progress disaster (transient — not saved; the scar it leaves is a
 *  DisasterZone on GameState). Timestamps are scene-clock ms. The `activated`/
 *  `scarred` flags are mutated by the engine to fire one-shot effects exactly once. */
export interface LiveDisaster {
  id: string;
  kind: DisasterKind;
  x: number; // epicentre, GLOBAL world pixels
  y: number;
  radius: number; // tiles
  cataclysm: boolean;
  startedAt: number;
  telegraphMs: number;
  activeMs: number;
  activated?: boolean;
}

/** What scheduleDisaster decides; the engine adds id/epicentre/clock to make it live. */
export interface DisasterSpec {
  kind: DisasterKind;
  cataclysm: boolean;
  radius: number;
  telegraphMs: number;
  activeMs: number;
}

export function disasterPhase(d: LiveDisaster, now: number): DisasterPhase {
  const e = now - d.startedAt;
  if (e < d.telegraphMs) return "telegraph";
  if (e < d.telegraphMs + d.activeMs) return "active";
  return "expired";
}
export const isTelegraphing = (d: LiveDisaster, now: number): boolean => disasterPhase(d, now) === "telegraph";
export const isActive = (d: LiveDisaster, now: number): boolean => disasterPhase(d, now) === "active";
export const isExpired = (d: LiveDisaster, now: number): boolean => disasterPhase(d, now) === "expired";

/** Active-phase intensity (0..1): quick ramp-up, plateau, ease-down. 0 outside active. */
export function intensityAt(d: LiveDisaster, now: number): number {
  const e = now - d.startedAt - d.telegraphMs;
  if (e <= 0 || e >= d.activeMs) return 0;
  const f = e / d.activeMs;
  if (f < 0.2) return f / 0.2;
  if (f > 0.75) return (1 - f) / 0.25;
  return 1;
}

/** Is a world-pixel point inside the disaster's circle? */
export function inZone(d: { x: number; y: number; radius: number }, x: number, y: number): boolean {
  const r = d.radius * TILE_SIZE;
  const dx = x - d.x;
  const dy = y - d.y;
  return dx * dx + dy * dy <= r * r;
}

/** Decide whether/what disaster to spawn this roll, given the day, weather, and the
 *  biome under the player. Returns null on the calm early days or a declined roll. */
export function scheduleDisaster(rng: Rng, day: number, weather: string | undefined, biome: string): DisasterSpec | null {
  if (day < 2) return null; // calm opening days — let the player find their feet
  const wet = weather === "rain" || weather === "storm";

  let kind: DisasterKind;
  if (weather === "storm" && rng.chance(0.6)) kind = "storm_lightning";
  else if (biome === "volcanic" && rng.chance(0.7)) kind = "eruption";
  else {
    const r = rng.next();
    if (wet && r < 0.45) kind = "flood";
    else if (!wet && r < 0.5) kind = "wildfire";
    else kind = "earthquake";
  }

  // Rare destructive tier, slowly more likely as the days mount.
  const cataclysm = rng.chance(Math.min(0.18, 0.03 + day * 0.012));
  const radius = cataclysm ? rng.int(16, 26) : rng.int(7, 13);
  const telegraphMs = cataclysm ? rng.int(1400, 2600) : rng.int(3200, 5200);
  const burst = kind === "earthquake" || kind === "storm_lightning";
  const activeMs = burst ? rng.int(1800, 3400) : rng.int(6000, 11000);
  return { kind, cataclysm, radius, telegraphMs, activeMs };
}
