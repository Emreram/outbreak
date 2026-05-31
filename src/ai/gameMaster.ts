// Assemble the GM request, call the active provider, parse + sanitize, with a
// retry-once-then-offline-then-safe-fallback backstop so a turn NEVER crashes
// the game (CLAUDE.md §8.3, §8.4). The engine validates everything downstream.

import type { GMResponse, GameState, ScenarioResponse, TurnInput } from "../shared/contracts";
import { GM_OUTPUT_SCHEMA, SCENARIO_OUTPUT_SCHEMA, SCENARIO_THEMES } from "../shared/contracts";
import type { LLMProvider } from "./provider";
import { configuredProvider, resolveBrain } from "./provider";
import { createOllamaProvider, detectOllama, pickOllamaModel } from "./ollamaProvider";
import { webllmEnabled, webllmReady, getWebLLMProvider } from "./webllm";
import { ClaudeProvider } from "./claudeProvider";
import { MockProvider } from "./mockProvider";
import { GM_SYSTEM_PROMPT, SCENARIO_SYSTEM_PROMPT } from "./prompts";
import { sanitizeGM } from "../game/outcomes";
import { applyScenario, newGame } from "../game/GameState";
import { randomSeed } from "../game/rng";

// Always-available offline GM, used as the last-resort fallback if the configured
// provider (e.g. Ollama) is unreachable — so the game keeps running anywhere.
const offline = new MockProvider();

type Brain = "webllm" | "ollama" | "claude" | "offline";
let activeBrain: Brain = "offline";
let lastTurnFellBack = false;

/**
 * Pick the brain for THIS call (cheap — Ollama detection is cached internally).
 * The in-browser WebLLM wins when the player has enabled it and the model is
 * loaded; otherwise fall through to the auto/Ollama/offline logic.
 */
async function resolve(): Promise<{ provider: LLMProvider; brain: Brain }> {
  if (webllmEnabled() && webllmReady()) return { provider: getWebLLMProvider(), brain: "webllm" };
  const want = configuredProvider();
  const det = want === "ollama" || want === "auto" ? await detectOllama() : { up: false, models: [] as string[] };
  const brain = resolveBrain(want, det.up);
  const provider =
    brain === "claude"
      ? new ClaudeProvider()
      : brain === "ollama"
        ? createOllamaProvider(pickOllamaModel(det.models))
        : offline;
  return { provider, brain };
}

/** Which brain resolved on the latest call — drives the HUD "GM:" indicator. */
export function getActiveBrain(): Brain {
  return activeBrain;
}

/** True once if a turn that intended a real brain had to fall back to the offline GM. */
export function consumeFellBack(): boolean {
  const f = lastTurnFellBack;
  lastTurnFellBack = false;
  return f;
}

/** Trim GameState for the GM (CLAUDE.md §8.3) — never send the whole history. */
export function buildTurnPayload(state: GameState, input: TurnInput, locationType: string) {
  return {
    game_state: {
      player: state.player,
      inventory: state.inventory,
      worldFlags: state.worldFlags,
      recentEvents: state.recentEvents,
      day: state.day,
      timeOfDay: state.timeOfDay,
      location_type: locationType,
    },
    input,
  };
}

async function callJSON(provider: LLMProvider, system: string, payload: object, schema: object): Promise<unknown> {
  return JSON.parse(await provider.generate(system, payload, schema));
}

/** Resolve one player action into a validated GM outcome. */
export async function runTurn(state: GameState, input: TurnInput, locationType: string): Promise<GMResponse> {
  const { provider, brain } = await resolve();
  activeBrain = brain;
  const payload = buildTurnPayload(state, input, locationType);

  try {
    return sanitizeGM(await callJSON(provider, GM_SYSTEM_PROMPT, payload, GM_OUTPUT_SCHEMA));
  } catch {
    try {
      // retry once (CLAUDE.md §8.4)
      return sanitizeGM(await callJSON(provider, GM_SYSTEM_PROMPT, payload, GM_OUTPUT_SCHEMA));
    } catch {
      if (brain !== "offline") lastTurnFellBack = true; // real brain failed -> note it
      try {
        // configured provider unreachable -> offline GM
        return sanitizeGM(JSON.parse(await offline.generate(GM_SYSTEM_PROMPT, payload, GM_OUTPUT_SCHEMA)));
      } catch {
        return safeFallback();
      }
    }
  }
}

/** Author a fresh opening scenario for a new run (CLAUDE.md §8.6). */
export async function generateScenario(theme?: string): Promise<ScenarioResponse> {
  const { provider, brain } = await resolve();
  activeBrain = brain;
  const chosen = theme ?? SCENARIO_THEMES[Math.floor(Math.random() * SCENARIO_THEMES.length)];
  const payload = { kind: "scenario", theme: chosen };

  try {
    return sanitizeScenario(await callJSON(provider, SCENARIO_SYSTEM_PROMPT, payload, SCENARIO_OUTPUT_SCHEMA), chosen);
  } catch {
    if (brain !== "offline") lastTurnFellBack = true;
    try {
      return sanitizeScenario(JSON.parse(await offline.generate(SCENARIO_SYSTEM_PROMPT, payload, SCENARIO_OUTPUT_SCHEMA)), chosen);
    } catch {
      return defaultScenario(chosen);
    }
  }
}

export function randomTheme(): string {
  return SCENARIO_THEMES[Math.floor(Math.random() * SCENARIO_THEMES.length)];
}

/** Build a complete fresh run: a seed + a generated opening scenario folded in.
 *  A provided player name overrides the scenario's suggested name. */
export async function newRunState(seed?: string, name?: string): Promise<{ state: GameState; intro: string }> {
  const s = seed ?? randomSeed();
  const scenario = await generateScenario();
  const gs = newGame(s);
  applyScenario(gs, scenario);
  if (name && name.trim()) gs.player.name = name.trim().slice(0, 24);
  return { state: gs, intro: scenario.intro_narrative };
}

function safeFallback(): GMResponse {
  return {
    narrative: "Nothing of note happens. The ruined street holds its breath.",
    state_changes: { hp: 0, stamina: 0, hunger: 0, thirst: 0, infection: 0 },
    inventory_add: [],
    inventory_remove: [],
    world_flags_add: [],
    spawns: [],
    discovered: { name: null, type: null, x: null, y: null },
    next_interaction: { type: "free_text", prompt: "What do you do?", options: [] },
    game_over: false,
    game_over_reason: "",
  };
}

function sanitizeScenario(raw: unknown, theme: string): ScenarioResponse {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(o.starting_items)
    ? o.starting_items
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && typeof (x as Record<string, unknown>).item === "string")
        .map((x) => ({ item: String(x.item), qty: Math.max(1, Math.trunc(Number(x.qty) || 1)) }))
    : [];
  const fb = defaultScenario(theme);
  return {
    intro_narrative: typeof o.intro_narrative === "string" && o.intro_narrative.trim() ? o.intro_narrative : fb.intro_narrative,
    player_name: typeof o.player_name === "string" && o.player_name.trim() ? o.player_name : fb.player_name,
    start_location: typeof o.start_location === "string" && o.start_location.trim() ? o.start_location : fb.start_location,
    starting_items: items.length ? items : fb.starting_items,
    starting_goal: typeof o.starting_goal === "string" && o.starting_goal.trim() ? o.starting_goal : fb.starting_goal,
    difficulty_modifier: typeof o.difficulty_modifier === "number" && Number.isFinite(o.difficulty_modifier) ? o.difficulty_modifier : 1.0,
  };
}

function defaultScenario(theme: string): ScenarioResponse {
  return {
    intro_narrative: `The outbreak caught everyone off guard. You come to amid the ${theme}, alone, with the dead already walking. Whatever happens next is up to you.`,
    player_name: "Survivor",
    start_location: "a ruined street",
    starting_items: [
      { item: "Water Bottle", qty: 1 },
      { item: "Bandage", qty: 1 },
    ],
    starting_goal: "Find supplies and stay alive.",
    difficulty_modifier: 1.0,
  };
}
