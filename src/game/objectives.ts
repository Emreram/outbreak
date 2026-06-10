import { createRng } from "./rng";
import type { GameState } from "../shared/contracts";
import { biomeAt } from "./world/biomes";
import { SPAWN_CHUNK, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "./constants";

// Opening arc (Expansion U3): the first COMPLETABLE objective chain — a short,
// guided first day (arm yourself → scavenge → reach a marked safehouse → survive
// to dawn → reward). Pure reducer over a dumb persisted cursor
// (GameState.objectives = {chain, step, progress, done?}); definitions live here
// so saves stay tiny and old saves (no cursor) simply show the plain run goal.

export type ObjectiveEventKind = "weapon_equipped" | "container_searched" | "chunk_entered" | "dawn";

export interface ObjectiveEvent {
  kind: ObjectiveEventKind;
  cx?: number; // chunk_entered only
  cy?: number;
}

export interface ObjectiveStep {
  id: string;
  kind: "equip_weapon" | "search_n" | "reach_marker" | "survive_dawn";
  need: number;
  label: (progress: number, need: number) => string;
}

export const OPENING_CHAIN: readonly ObjectiveStep[] = [
  { id: "arm", kind: "equip_weapon", need: 1, label: () => "Arm yourself — equip any weapon" },
  { id: "scavenge", kind: "search_n", need: 4, label: (p, n) => `Scavenge the area — search containers or wrecks (${p}/${n})` },
  { id: "safehouse", kind: "reach_marker", need: 1, label: () => "Reach the marked safehouse (M for map)" },
  { id: "dawn", kind: "survive_dawn", need: 1, label: () => "Survive until dawn" },
];

/** Fresh cursor for a new run. */
export function newObjectives(): NonNullable<GameState["objectives"]> {
  return { chain: "opening", step: 0, progress: 0 };
}

/** The current step, or null when there's no chain / it's finished. */
export function currentStep(state: GameState): ObjectiveStep | null {
  const o = state.objectives;
  if (!o || o.done || o.chain !== "opening") return null;
  return OPENING_CHAIN[o.step] ?? null;
}

/** Banner line for the HUD, or null (→ fall back to the run goal). */
export function objectiveLabel(state: GameState): string | null {
  const o = state.objectives;
  const step = currentStep(state);
  if (!o || !step) return null;
  return `Objective ${o.step + 1}/${OPENING_CHAIN.length}: ${step.label(o.progress, step.need)}`;
}

export interface ObjectiveResult {
  advanced: boolean; // progress moved (rerender the banner)
  stepDone: boolean; // a step completed (toast it)
  chainDone: boolean; // the whole arc completed (grant the reward)
  toast?: string;
}

const NONE: ObjectiveResult = { advanced: false, stepDone: false, chainDone: false };

/** Feed a game event into the chain. Mutates ONLY state.objectives. */
export function notifyObjective(state: GameState, ev: ObjectiveEvent): ObjectiveResult {
  const o = state.objectives;
  const step = currentStep(state);
  if (!o || !step) return NONE;

  const matches =
    (step.kind === "equip_weapon" && ev.kind === "weapon_equipped") ||
    (step.kind === "search_n" && ev.kind === "container_searched") ||
    (step.kind === "survive_dawn" && ev.kind === "dawn") ||
    (step.kind === "reach_marker" &&
      ev.kind === "chunk_entered" &&
      (() => {
        const t = arcSafehouse(state.seed);
        return ev.cx === t.cx && ev.cy === t.cy;
      })());
  if (!matches) return NONE;

  o.progress += 1;
  if (o.progress < step.need) return { advanced: true, stepDone: false, chainDone: false };

  o.step += 1;
  o.progress = 0;
  if (o.step >= OPENING_CHAIN.length) {
    o.done = true;
    return { advanced: true, stepDone: true, chainDone: true, toast: "Opening objective complete!" };
  }
  const next = OPENING_CHAIN[o.step];
  return { advanced: true, stepDone: true, chainDone: false, toast: `Objective: ${next.label(0, next.need)}` };
}

/** The deterministic safehouse chunk for this run: 2–3 chunks from spawn, on a
 *  land biome (re-rolled deterministically if the dice land in water). */
export function arcSafehouse(seed: string): { cx: number; cy: number } {
  const rng = createRng(`${seed}:arc`);
  for (let tries = 0; tries < 16; tries++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = 2 + rng.next();
    const cx = Math.round(SPAWN_CHUNK.x + Math.cos(ang) * dist);
    const cy = Math.round(SPAWN_CHUNK.y + Math.sin(ang) * dist);
    if (cx < 1 || cy < 1 || cx >= WORLD_CHUNKS_X - 1 || cy >= WORLD_CHUNKS_Y - 1) continue;
    const b = biomeAt(seed, cx, cy);
    if (b.id === "ocean" || b.id === "lake") continue;
    return { cx, cy };
  }
  return { cx: SPAWN_CHUNK.x + 2, cy: SPAWN_CHUNK.y };
}
