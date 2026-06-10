import { createRng } from "./rng";
import type { GameState } from "../shared/contracts";

// "Search everything" scavenging (Expansion U1): a curated set of world props is
// searchable with a hold-E channel. Yields are deliberately THIN (chests stay the
// real prize); searching takes time and makes noise. Pure data + helpers — the
// scene owns the channel, ChunkManager owns the streamed sprites.

export interface SearchableDef {
  source: string; // lootTables SOURCES key
  ms: number; // hold-to-search duration
  emptyChance: number; // chance the search turns up nothing
  label: string; // hint text ("Hold E to search the …")
}

export const SEARCHABLE_PROPS: Record<string, SearchableDef> = {
  car: { source: "scav_vehicle", ms: 1700, emptyChance: 0.5, label: "car" },
  wreck: { source: "scav_vehicle", ms: 1500, emptyChance: 0.6, label: "wreck" },
  dumpster: { source: "scav_street", ms: 1600, emptyChance: 0.45, label: "dumpster" },
  barrel: { source: "scav_street", ms: 1200, emptyChance: 0.65, label: "barrel" },
  crate: { source: "scav_street", ms: 1300, emptyChance: 0.55, label: "crate" },
  hay: { source: "scav_street", ms: 1300, emptyChance: 0.65, label: "hay pile" },
  corpse: { source: "scav_corpse", ms: 1500, emptyChance: 0.45, label: "body" },
  corpse_soldier: { source: "scav_military", ms: 1800, emptyChance: 0.35, label: "fallen soldier" },
  fridge_prop: { source: "scav_domestic", ms: 1400, emptyChance: 0.5, label: "fridge" },
  shelf: { source: "scav_domestic", ms: 1300, emptyChance: 0.55, label: "shelf" },
  locker_prop: { source: "scav_domestic", ms: 1400, emptyChance: 0.5, label: "locker" },
  bookshelf: { source: "scav_domestic", ms: 1300, emptyChance: 0.6, label: "bookshelf" },
  desk: { source: "scav_domestic", ms: 1200, emptyChance: 0.55, label: "desk" },
};

/** Loot table used when looting a fallen zombie's body (converted corpse). */
export const CORPSE_BODY: SearchableDef = { source: "scav_corpse", ms: 1400, emptyChance: 0.55, label: "body" };

/** Extra aggro noise emitted while rummaging (added to the enemy noise sum). */
export const SEARCH_NOISE = 110;

export function isSearchableKind(kind: string): boolean {
  return kind in SEARCHABLE_PROPS;
}

export function searchFlag(gid: string): string {
  return `searched_${gid}`;
}

export function isPropSearched(state: GameState, gid: string): boolean {
  return state.worldFlags.includes(searchFlag(gid));
}

export function markSearched(state: GameState, gid: string): void {
  if (!isPropSearched(state, gid)) state.worldFlags.push(searchFlag(gid));
}

/** A "corpse" prop might not be dead. Deterministic per seed+prop (no save-scum
 *  re-rolls); the odds creep up with the day so late-game streets stay tense. */
export function playsDead(seed: string, gid: string, day: number): boolean {
  return createRng(`${seed}:pd:${gid}`).chance(Math.min(0.18, 0.06 + day * 0.01));
}
