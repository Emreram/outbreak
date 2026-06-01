// Shared player-intent classifier (pure, no Phaser — three-layer rule §5).
// Maps free-text/choice input to a coarse intent. Used by BOTH the offline
// director (mockProvider) to shape outcomes AND the scene (WorldScene) to pick
// the in-world animation that plays the action out. One source of truth so the
// two never drift.

export type Intent =
  | "search" | "rest" | "fight" | "flee" | "hide" | "eat" | "drink"
  | "heal" | "talk" | "barricade" | "scout" | "free";

/** Coarse intent from the player's words. Lowercases defensively so callers can
 *  pass raw text or a pre-lowercased string. */
export function classifyIntent(input: string): Intent {
  const v = input.toLowerCase();
  const has = (...k: string[]) => k.some((w) => v.includes(w));
  if (has("search", "loot", "scaveng", "rummage", "ransack", "grab", "open", "raid", "look for", "find")) return "search";
  if (has("rest", "sleep", "wait", "camp", "catch your breath", "recover", "sit")) return "rest";
  if (has("fight", "attack", "kill", "shoot", "swing", "smash", "stab", "bash", "hit ")) return "fight";
  if (has("flee", "run", "escape", "retreat", "sprint", "get away", "bolt")) return "flee";
  if (has("hide", "sneak", "crouch", "quiet", "stealth", "duck", "cover")) return "hide";
  if (has("eat", "food", "hungry")) return "eat";
  if (has("drink", "water", "thirst")) return "drink";
  if (has("heal", "bandage", "patch", "treat", "medicine", "first aid", "wound")) return "heal";
  if (has("talk", "help", "trade", "greet", "approach", "call out", "negotiate", "shout")) return "talk";
  if (has("barricade", "fortify", "board up", "block", "build", "secure", "lock")) return "barricade";
  if (has("scout", "scan", "observe", "climb", "roof", "survey", "look around", "lookout", "peek")) return "scout";
  return "free";
}
