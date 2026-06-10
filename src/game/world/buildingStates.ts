import { createRng } from "../rng";
import type { GameState } from "../../shared/contracts";
import type { Building, BuildingType } from "./tiles";

// Interactive buildings (Expansion U5): a pure, deterministic classifier gives
// some buildings a STORY — boarded up (pry for untouched loot), infested (they
// burst out when disturbed), or hiding a trapped survivor. Persisted overrides
// live as worldFlags (pried_/cleared_/rescued_<gid>); the tile grid is NEVER
// mutated — the scene overlays sprites/colliders on top.

export type BuildingMood = "normal" | "boarded" | "infested" | "trapped";

// Shops got boarded first when the panic hit.
const STOREFRONTS = new Set<BuildingType>([
  "grocery", "pharmacy", "hardware_store", "gas_station", "mall", "diner", "police_station",
]);

export function buildingState(seed: string, b: Building): BuildingMood {
  const rng = createRng(`${seed}:bld:${b.gid}`);
  const x = rng.next();
  const boardedP = STOREFRONTS.has(b.type) ? 0.18 : 0.1;
  if (x < boardedP) return "boarded";
  if (x < boardedP + 0.08) return "infested";
  if (x < boardedP + 0.08 + 0.03) return "trapped";
  return "normal";
}

export const priedFlag = (gid: string): string => `pried_${gid}`;
export const clearedFlag = (gid: string): string => `cleared_${gid}`;
export const rescuedFlag = (gid: string): string => `rescued_${gid}`;

/** The building's CURRENT mood: the deterministic roll, resolved against the
 *  player's history (pried/cleared/rescued flags) and their base claim. */
export function effectiveState(seed: string, b: Building, state: GameState): BuildingMood {
  if (state.base?.gid === b.gid) return "normal"; // home is safe by definition
  const mood = buildingState(seed, b);
  if (mood === "boarded" && state.worldFlags.includes(priedFlag(b.gid))) return "normal";
  if (mood === "infested" && state.worldFlags.includes(clearedFlag(b.gid))) return "normal";
  if (mood === "trapped" && state.worldFlags.includes(rescuedFlag(b.gid))) return "normal";
  return mood;
}

/** Untouched (pried-open) buildings reward the effort with richer containers. */
export function priedLootBonus(state: GameState, gid: string | undefined): number {
  return gid && state.worldFlags.includes(priedFlag(gid)) ? 0.4 : 0;
}
