// Survival systems (CLAUDE.md §12): hunger/thirst/stamina decay, and the damage
// that follows from neglecting them. Called on a fixed survival tick by the
// scene. Day/night modulation and infection-from-bites arrive in Phase 6.

import type { GameState } from "../shared/contracts";
import { clampStat, pushRecentEvent } from "./GameState";
import { decayMods } from "./perks";

export interface DecayRates {
  hunger: number; // drop per tick
  thirst: number; // drop per tick (thirst falls faster than hunger)
  staminaRegen: number; // recovered per tick while not exerting
  starveDamage: number; // HP lost per tick while starving/dehydrated
  infectionTick: number; // infection rise per tick once infected (>0)
}

export const DEFAULT_DECAY: DecayRates = {
  hunger: 1,
  thirst: 1.4,
  staminaRegen: 6,
  starveDamage: 2,
  infectionTick: 1.5,
};

/** Decay rates adjusted by the player's perks (Iron Gut / Marathoner / Hardy / …). */
export function ratesFor(s: GameState): DecayRates {
  const m = decayMods(s);
  return {
    hunger: DEFAULT_DECAY.hunger * m.hunger,
    thirst: DEFAULT_DECAY.thirst * m.thirst,
    staminaRegen: DEFAULT_DECAY.staminaRegen * m.staminaRegen,
    starveDamage: DEFAULT_DECAY.starveDamage,
    infectionTick: DEFAULT_DECAY.infectionTick * m.infection,
  };
}

/** Advance survival stats by one tick. Mutates state through clamped helpers. */
export function applyDecay(s: GameState, rates: DecayRates = DEFAULT_DECAY): void {
  const p = s.player;

  p.hunger = clampStat(p.hunger - rates.hunger);
  p.thirst = clampStat(p.thirst - rates.thirst);
  p.stamina = clampStat(p.stamina + rates.staminaRegen); // resting regen; sprint drain comes later

  // Starvation / dehydration chips away at HP.
  if (p.hunger <= 0 || p.thirst <= 0) {
    const before = p.hp;
    p.hp = clampStat(p.hp - rates.starveDamage);
    if (before > 0 && p.hp <= 0) pushRecentEvent(s, "Collapsed from starvation.");
  }

  // Once infected, it only climbs (until cured) — reaching 100 = death.
  if (p.infection > 0) {
    p.infection = clampStat(p.infection + rates.infectionTick);
  }
}

// --- environmental status: burning (lava/fire) & wet (water) -------------------
// Stored on player.status as scene-clock ms timestamps so it survives a mid-fire
// autosave. The scene refreshes burning each frame the player stands in a hazard
// and ticks the damage on the survival cadence; water douses fire.

const BURN_DAMAGE_PER_TICK = 8; // HP lost per survival tick (~2s) while burning

/** Set the player alight for `durationMs` (lava/fire). Soaked bodies won't catch;
 *  otherwise the burn timer is extended, not reset, so leaving the hazard lets it lapse. */
export function ignitePlayer(s: GameState, durationMs: number, now: number): void {
  const st = (s.player.status ??= {});
  if (st.wetUntil !== undefined && now < st.wetUntil) return; // soaked → resists ignition
  st.burningUntil = Math.max(st.burningUntil ?? 0, now + durationMs);
}

/** Soak the player for `durationMs` (water): douses any fire + briefly fireproof. */
export function soakPlayer(s: GameState, durationMs: number, now: number): void {
  const st = (s.player.status ??= {});
  st.wetUntil = Math.max(st.wetUntil ?? 0, now + durationMs);
  st.burningUntil = undefined; // water puts the fire out
}

/** Is the player currently on fire? */
export function isBurning(s: GameState, now: number): boolean {
  const u = s.player.status?.burningUntil;
  return u !== undefined && now < u;
}

/** Advance the burning damage-over-time by one survival tick. Returns HP lost. */
export function tickBurning(s: GameState, now: number): number {
  if (!isBurning(s, now)) return 0;
  const before = s.player.hp;
  s.player.hp = clampStat(s.player.hp - BURN_DAMAGE_PER_TICK);
  if (before > 0 && s.player.hp <= 0) pushRecentEvent(s, "Burned alive.");
  return before - s.player.hp;
}
