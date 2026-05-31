// The single authoritative game state (CLAUDE.md §7) plus the helpers that keep
// it legal: stat clamping, death detection, new-run creation, and localStorage
// persistence. Nothing else may mutate stats without clamping — this is the
// engine's authority over hard mechanics (CLAUDE.md §5, §14).

import type { GameState, ScenarioResponse } from "../shared/contracts";
import { addItem, autoEquip, hasItem, removeItem } from "./inventory";
import { getItemDef } from "./items/catalog";

export const STAT_MIN = 0;
export const STAT_MAX = 100;

/** Clamp any stat into its legal 0–100 range. */
export function clampStat(v: number): number {
  if (Number.isNaN(v)) return STAT_MIN;
  return Math.max(STAT_MIN, Math.min(STAT_MAX, v));
}

/** Death condition (CLAUDE.md §7): no HP, or fully turned. */
export function isDead(s: GameState): boolean {
  return s.player.hp <= STAT_MIN || s.player.infection >= STAT_MAX;
}

/** A fresh run. The scenario generator (Phase 7) will later author the opening. */
export function newGame(seed: string): GameState {
  return {
    seed,
    day: 0, // hour zero — the outbreak is just beginning
    timeOfDay: "day",
    player: {
      name: "Survivor",
      hp: 100,
      stamina: 100,
      hunger: 80,
      thirst: 75,
      infection: 0,
      x: 0,
      y: 0,
    },
    // A small starting kit so the inventory + HUD have something to show.
    inventory: [
      { item: "Canned Food", qty: 2 },
      { item: "Water Bottle", qty: 2 },
      { item: "Bandage", qty: 1 },
    ],
    worldFlags: [],
    recentEvents: [],
    knownLocations: [],
    difficultyModifier: 1.0,
    goal: "",
  };
}

/** Fold a generated opening scenario into a fresh run (CLAUDE.md §8.6). */
export function applyScenario(gs: GameState, sc: ScenarioResponse): void {
  gs.player.name = sc.player_name || gs.player.name;
  gs.difficultyModifier = Number.isFinite(sc.difficulty_modifier) ? sc.difficulty_modifier : 1;
  gs.inventory = [];
  for (const it of sc.starting_items) addItem(gs, it.item, it.qty, it.note);
  if (gs.inventory.length === 0) addItem(gs, "Water Bottle", 1);
  gs.goal = sc.starting_goal || "";
  gs.recentEvents = [`Goal: ${sc.starting_goal}`];
  for (const it of gs.inventory) autoEquip(gs, it.item); // wield any starter weapon
}

/** Use one consumable from the inventory, applying its clamped effects. */
export function useConsumable(s: GameState, name: string): boolean {
  const d = getItemDef(name);
  if (!d || d.kind !== "consumable" || !hasItem(s, name)) return false;
  removeItem(s, name, 1);
  const p = s.player;
  for (const k of Object.keys(d.effects) as (keyof typeof d.effects)[]) {
    p[k] = clampStat(p[k] + (d.effects[k] ?? 0));
  }
  if (d.cure) p.infection = 0;
  return true;
}

/** Append a one-line event and keep only the last ~6 (CLAUDE.md §7, §8.5). */
export function pushRecentEvent(s: GameState, line: string, keep = 6): void {
  s.recentEvents.push(line);
  if (s.recentEvents.length > keep) {
    s.recentEvents.splice(0, s.recentEvents.length - keep);
  }
}

// --- persistence (localStorage; CLAUDE.md §4, §7) --------------------------

const SAVE_KEY = "outbreak_save_v1";

export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable / quota — non-fatal, just skip persisting.
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Light shape check so a corrupt/old save is treated as "no save". */
function isValidState(v: unknown): v is GameState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<GameState>;
  if (typeof s.seed !== "string" || !Array.isArray(s.inventory)) return false;
  const p = s.player as unknown as Record<string, unknown> | undefined;
  if (typeof p !== "object" || p === null) return false;
  return (["hp", "stamina", "hunger", "thirst", "infection", "x", "y"] as const).every(
    (k) => typeof p[k] === "number",
  );
}
