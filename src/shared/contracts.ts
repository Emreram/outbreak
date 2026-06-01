// =============================================================================
// SHARED CONTRACTS — the single source of truth for the data shapes exchanged
// between the game (engine + game logic) and the AI Game Master (any provider).
// Imported by client and (optional) server. See CLAUDE.md §7 and §8.
// =============================================================================

// ---- Core game state (CLAUDE.md §7) ----

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

export interface InventoryItem {
  item: string;
  qty: number;
  note?: string;
}

export interface KnownLocation {
  name: string;
  type: string;
  x: number;
  y: number;
}

export interface PlayerState {
  name: string;
  hp: number; // 0–100
  stamina: number; // 0–100
  hunger: number; // 0–100 (0 = starving)
  thirst: number; // 0–100
  infection: number; // 0–100 (100 = turned/dead)
  x: number;
  y: number;
}

export interface GameState {
  seed: string; // run seed (map + RNG reproducibility)
  day: number;
  timeOfDay: TimeOfDay;
  player: PlayerState;
  inventory: InventoryItem[];
  worldFlags: string[]; // e.g. "cleared_pharmacy_3", "ally_marcus_alive"
  recentEvents: string[]; // rolling last ~6 events for GM context
  knownLocations: KnownLocation[];
  difficultyModifier: number; // set by the run's scenario
  goal?: string; // the run's short-term objective (from the AI scenario), shown in-game
  equippedMelee?: string; // inventory item name of the equipped melee weapon
  equippedRanged?: string; // inventory item name of the equipped gun
  loadedAmmo?: number; // rounds in the chambered magazine of the equipped gun
  background?: string; // chosen background/class id (character creation)
  perks?: string[]; // active perk ids from the background
  appearance?: { color?: number }; // survivor sprite tint
}

/** Choices from the character-creation screen, applied after the AI scenario. */
export interface CharacterCreation {
  background?: string; // background id
  color?: number; // appearance tint
  difficulty?: number; // multiplier (Easy 0.8 … Nightmare 1.5)
}

// ---- GM turn I/O (CLAUDE.md §8.2–8.4) ----

export type InteractionType = "free_text" | "choices";

export type SpawnType =
  | "zombie"
  | "zombie_runner"
  | "survivor_hostile"
  | "survivor_friendly";

export interface StateChanges {
  hp: number;
  stamina: number;
  hunger: number;
  thirst: number;
  infection: number;
}

export interface Spawn {
  type: SpawnType;
  count: number;
  reason?: string;
}

export interface Discovered {
  name: string | null;
  type: string | null;
  x: number | null;
  y: number | null;
}

export interface NextInteraction {
  type: InteractionType;
  prompt: string;
  options: string[]; // EXACTLY 4 strings if type === "choices", else []
}

/** The GM's proposed outcome for a turn. The engine VALIDATES this before applying. */
export interface GMResponse {
  narrative: string;
  state_changes: StateChanges;
  inventory_add: InventoryItem[];
  inventory_remove: { item: string; qty: number }[];
  world_flags_add: string[];
  spawns: Spawn[];
  discovered: Discovered;
  next_interaction: NextInteraction;
  game_over: boolean;
  game_over_reason: string;
  /** GM/engine signal that the moment is resolved → return to free exploration.
   *  Optional so older/real-LLM output that omits it stays valid (treated false). */
  encounter_over?: boolean;
}

// ---- Player input for a turn (CLAUDE.md §8.3) ----

export type InputMode = "free_text" | "choice";

export interface TurnInput {
  mode: InputMode;
  value: string;
}

/** Trimmed state + the player's action, sent to the provider each turn. */
export interface TurnPayload {
  game_state: Partial<GameState> & { location_type?: string };
  input: TurnInput;
}

// ---- New-run scenario generation (CLAUDE.md §8.6) ----

export interface ScenarioResponse {
  intro_narrative: string;
  player_name: string;
  start_location: string;
  starting_items: InventoryItem[];
  starting_goal: string;
  difficulty_modifier: number;
}

export const SCENARIO_THEMES: readonly string[] = [
  "winter outbreak",
  "military quarantine zone",
  "rural farmland collapse",
  "downtown high-rise",
  "overrun hospital",
  "highway exodus",
  "flooded district",
  "prison break",
];

// =============================================================================
// JSON SCHEMAS — passed as Ollama's `format` parameter to force schema-valid
// output (CLAUDE.md §8.4). Kept here so the schema lives beside the TS types it
// mirrors (one source of truth). Used by gameMaster.ts in Phase 4.
// =============================================================================

export const GM_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    narrative: { type: "string" },
    state_changes: {
      type: "object",
      properties: {
        hp: { type: "integer" },
        stamina: { type: "integer" },
        hunger: { type: "integer" },
        thirst: { type: "integer" },
        infection: { type: "integer" },
      },
      required: ["hp", "stamina", "hunger", "thirst", "infection"],
    },
    inventory_add: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          qty: { type: "integer" },
          note: { type: "string" },
        },
        required: ["item", "qty"],
      },
    },
    inventory_remove: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          qty: { type: "integer" },
        },
        required: ["item", "qty"],
      },
    },
    world_flags_add: { type: "array", items: { type: "string" } },
    spawns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["zombie", "zombie_runner", "survivor_hostile", "survivor_friendly"],
          },
          count: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["type", "count"],
      },
    },
    discovered: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
    next_interaction: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["free_text", "choices"] },
        prompt: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["type", "prompt", "options"],
    },
    game_over: { type: "boolean" },
    game_over_reason: { type: "string" },
    encounter_over: { type: "boolean" },
  },
  required: ["narrative", "state_changes", "next_interaction", "game_over"],
};

export const SCENARIO_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intro_narrative: { type: "string" },
    player_name: { type: "string" },
    start_location: { type: "string" },
    starting_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          qty: { type: "integer" },
        },
        required: ["item", "qty"],
      },
    },
    starting_goal: { type: "string" },
    difficulty_modifier: { type: "number" },
  },
  required: [
    "intro_narrative",
    "player_name",
    "start_location",
    "starting_items",
    "starting_goal",
    "difficulty_modifier",
  ],
};
