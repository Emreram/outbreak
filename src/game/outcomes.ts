// VALIDATE + APPLY the Game Master's proposed outcome (CLAUDE.md §5, §8.5).
// "The AI proposes, the engine disposes." Nothing here trusts the GM: every
// field is sanitized, every stat clamped, every item checked. This is the safety
// net that stops a model (local or cloud) from breaking the game.

import type {
  Discovered,
  GMResponse,
  GameState,
  InventoryItem,
  KnownLocation,
  NextInteraction,
  Spawn,
  SpawnType,
} from "../shared/contracts";
import { clampStat, isDead, pushRecentEvent } from "./GameState";
import { addItem, removeItem } from "./inventory";

const SPAWN_TYPES: ReadonlySet<string> = new Set<SpawnType>([
  "zombie",
  "zombie_runner",
  "survivor_hostile",
  "survivor_friendly",
]);
const MAX_SPAWN = 6;
const MAX_DELTA = 100;
const DEFAULT_OPTIONS = ["Wait and watch", "Search the area", "Move on", "Ready yourself"];

export interface ApplyResult {
  narrative: string;
  gameOver: boolean;
  reason: string;
  spawns: Spawn[];
  discovered?: KnownLocation;
  interaction: NextInteraction;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}
function clampDelta(v: unknown): number {
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, num(v)));
}
function posInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.trunc(v)) : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce arbitrary parsed JSON into a safe, complete GMResponse. A real LLM may
 * emit garbage or omit fields; this repairs it so the game never crashes.
 */
export function sanitizeGM(raw: unknown): GMResponse {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const sc = (typeof o.state_changes === "object" && o.state_changes !== null ? o.state_changes : {}) as Record<string, unknown>;
  const ni = (typeof o.next_interaction === "object" && o.next_interaction !== null ? o.next_interaction : {}) as Record<string, unknown>;

  const type: NextInteraction["type"] = ni.type === "choices" ? "choices" : "free_text";
  let options: string[] = Array.isArray(ni.options) ? ni.options.filter((x): x is string => typeof x === "string") : [];
  if (type === "choices") {
    options = options.slice(0, 4);
    while (options.length < 4) options.push(DEFAULT_OPTIONS[options.length] ?? "Wait");
  } else {
    options = [];
  }

  const narrative = str(o.narrative).trim() || "Nothing of note happens.";

  return {
    narrative,
    state_changes: {
      hp: clampDelta(sc.hp),
      stamina: clampDelta(sc.stamina),
      hunger: clampDelta(sc.hunger),
      thirst: clampDelta(sc.thirst),
      infection: clampDelta(sc.infection),
    },
    inventory_add: Array.isArray(o.inventory_add)
      ? o.inventory_add
          .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null && typeof (a as Record<string, unknown>).item === "string")
          .map((a) => {
            const it: InventoryItem = { item: str(a.item), qty: posInt(a.qty, 1) };
            if (typeof a.note === "string") it.note = a.note;
            return it;
          })
      : [],
    inventory_remove: Array.isArray(o.inventory_remove)
      ? o.inventory_remove
          .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null && typeof (a as Record<string, unknown>).item === "string")
          .map((a) => ({ item: str(a.item), qty: posInt(a.qty, 1) }))
      : [],
    world_flags_add: Array.isArray(o.world_flags_add)
      ? o.world_flags_add.filter((x): x is string => typeof x === "string")
      : [],
    spawns: Array.isArray(o.spawns)
      ? o.spawns
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && SPAWN_TYPES.has(String((s as Record<string, unknown>).type)))
          .map((s) => {
            const sp: Spawn = { type: s.type as SpawnType, count: Math.min(MAX_SPAWN, posInt(s.count, 1)) };
            if (typeof s.reason === "string") sp.reason = s.reason;
            return sp;
          })
      : [],
    discovered: sanitizeDiscovered(o.discovered),
    next_interaction: { type, prompt: str(ni.prompt) || "What do you do?", options },
    game_over: o.game_over === true,
    game_over_reason: str(o.game_over_reason),
  };
}

function sanitizeDiscovered(raw: unknown): Discovered {
  const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    name: typeof d.name === "string" ? d.name : null,
    type: typeof d.type === "string" ? d.type : null,
    x: typeof d.x === "number" && Number.isFinite(d.x) ? d.x : null,
    y: typeof d.y === "number" && Number.isFinite(d.y) ? d.y : null,
  };
}

/**
 * Apply a (sanitized) GM response to the authoritative GameState. Returns what
 * the scene needs to act on (spawns to instantiate, discovery, game-over).
 */
export function applyOutcome(state: GameState, gm: GMResponse): ApplyResult {
  const p = state.player;

  // 1) stat deltas, clamped
  p.hp = clampStat(p.hp + gm.state_changes.hp);
  p.stamina = clampStat(p.stamina + gm.state_changes.stamina);
  p.hunger = clampStat(p.hunger + gm.state_changes.hunger);
  p.thirst = clampStat(p.thirst + gm.state_changes.thirst);
  p.infection = clampStat(p.infection + gm.state_changes.infection);

  // 2) inventory (cap/merge on add; clamp/ignore-unheld on remove)
  for (const a of gm.inventory_add) addItem(state, a.item, a.qty, a.note);
  for (const r of gm.inventory_remove) removeItem(state, r.item, r.qty);

  // keep equipment consistent: a GM-removed weapon can't stay equipped
  const held = (name?: string) => !!name && state.inventory.some((i) => i.item === name);
  if (!held(state.equippedMelee)) state.equippedMelee = undefined;
  if (!held(state.equippedRanged)) {
    state.equippedRanged = undefined;
    state.loadedAmmo = 0;
  }

  // 3) world flags — append + dedupe
  for (const f of gm.world_flags_add) {
    if (!state.worldFlags.includes(f)) state.worldFlags.push(f);
  }

  // 4) discovered location -> knownLocations (needs real coords; dedupe by name)
  let discovered: KnownLocation | undefined;
  const d = gm.discovered;
  if (d.name && d.type && d.x !== null && d.y !== null) {
    if (!state.knownLocations.some((k) => k.name === d.name)) {
      discovered = { name: d.name, type: d.type, x: d.x, y: d.y };
      state.knownLocations.push(discovered);
    }
  }

  // 5) death re-check (GM-declared or stat-driven)
  const gameOver = gm.game_over || isDead(state);
  const reason =
    gm.game_over_reason ||
    (p.infection >= 100 ? "The infection took you." : p.hp <= 0 ? "Your wounds were too much." : "");

  // 6) rolling event log
  pushRecentEvent(state, summarize(gm.narrative));

  return {
    narrative: gm.narrative,
    gameOver,
    reason,
    spawns: gm.spawns,
    discovered,
    interaction: gm.next_interaction,
  };
}

/** Trim a narrative to a short one-line recentEvents entry. */
function summarize(narrative: string): string {
  const first = narrative.split(/(?<=[.!?])\s/)[0] ?? narrative;
  return first.length > 90 ? first.slice(0, 87) + "…" : first;
}
