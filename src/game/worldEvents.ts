// Dynamic world events (Feature 10): a scheduler that, on a timer, fires set-pieces
// that make the world feel alive and reactive — migrating hordes, military flyovers,
// raider ambushes, supply drops, and trader caravans. Pure selection logic; the scene
// enacts each kind with the existing spawn/loot/NPC systems. Frequency + danger scale
// with the effective day (distance/time), reusing the run's escalation curve.

import type { Rng } from "./rng";

export type WorldEventKind =
  | "horde"
  | "flyover"
  | "raiders"
  | "supply_drop"
  | "trader"
  | "dilemma"
  // Heartbeat beacons (U4): visible/audible DISTANT happenings that pin a
  // temporary map marker and resolve into a small scene when investigated.
  | "smoke"
  | "flare"
  | "gunfight"
  | "car_alarm";

export const WORLD_EVENTS: readonly WorldEventKind[] = [
  "horde",
  "flyover",
  "raiders",
  "supply_drop",
  "trader",
  "dilemma",
  "smoke",
  "flare",
  "gunfight",
  "car_alarm",
];

/** The kinds that spawn an investigable beacon rather than acting on the player. */
export const BEACON_EVENTS: readonly WorldEventKind[] = ["smoke", "flare", "gunfight", "car_alarm"];

interface EventWeight {
  kind: WorldEventKind;
  minDay: number; // not eligible before this effective day
  weight: (day: number, night: boolean) => number;
}

const WEIGHTS: EventWeight[] = [
  { kind: "horde", minDay: 1, weight: (d, n) => 2 + d * 0.5 + (n ? 2 : 0) },
  { kind: "raiders", minDay: 2, weight: (d) => 1 + d * 0.4 },
  { kind: "flyover", minDay: 0, weight: () => 1.2 },
  { kind: "supply_drop", minDay: 0, weight: () => 1.6 },
  { kind: "trader", minDay: 1, weight: (d, n) => (n ? 0.5 : 2) - Math.min(1, d * 0.05) },
  // A rare narrative dilemma — the only thing that opens the GM choice/chat modal.
  // Not on day 0 (let the opening stay calm); rare thereafter.
  { kind: "dilemma", minDay: 1, weight: (d, n) => 0.8 + d * 0.05 + (n ? 0.3 : 0) },
  // Heartbeat beacons (U4): the world visibly/audibly DOES things in the distance.
  { kind: "smoke", minDay: 0, weight: (_d, n) => (n ? 0.4 : 1.2) }, // smoke reads by day
  { kind: "flare", minDay: 0, weight: (_d, n) => (n ? 1.4 : 0) }, // flares read by night
  { kind: "gunfight", minDay: 0, weight: (d) => 0.9 + d * 0.05 },
  { kind: "car_alarm", minDay: 0, weight: () => 0.8 },
];

/** Weighted pick of the next world event, gated + scaled by the effective day. */
export function rollWorldEvent(rng: Rng, day: number, night: boolean): WorldEventKind {
  const pool = WEIGHTS.filter((e) => day >= e.minDay);
  const entries = pool.map((e) => ({ kind: e.kind, w: Math.max(0, e.weight(day, night)) }));
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return "supply_drop";
  let x = rng.next() * total;
  for (const e of entries) {
    x -= e.w;
    if (x <= 0) return e.kind;
  }
  return entries[entries.length - 1].kind;
}

/** Milliseconds until the next world event — frequent later/at night, rare early. */
export function nextEventDelayMs(day: number, night: boolean): number {
  const base = 150000; // ~2.5 min baseline
  const dayFactor = 1 / (1 + day * 0.08);
  const nightFactor = night ? 0.7 : 1;
  const jitter = 0.7 + Math.random() * 0.6;
  return Math.round(base * dayFactor * nightFactor * jitter);
}

/** Coarse 8-point compass label for a direction vector (for radio leads). */
export function compassDir(dx: number, dy: number): string {
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = east, +y = south
  const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  const idx = (Math.round(ang / 45) + 8) % 8;
  return dirs[idx];
}
