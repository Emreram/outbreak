// Phase 4 — Game Master pipeline (CLAUDE.md §8.4, §8.5).
// Validation/repair of GM output, the apply pipeline (clamp/inventory/flags/
// discover/death), the offline GM's schema-validity across intents, and an
// end-to-end turn through gameMaster (defaults to the offline provider in Node).

import { sanitizeGM, applyOutcome } from "../src/game/outcomes";
import { newGame } from "../src/game/GameState";
import { isArmed } from "../src/game/inventory";
import { MockProvider } from "../src/ai/mockProvider";
import { runTurn, newRunState } from "../src/ai/gameMaster";
import { resolveBrain } from "../src/ai/provider";
import { pickOllamaModel } from "../src/ai/ollamaProvider";
import type { GMResponse } from "../src/shared/contracts";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

function validShape(gm: GMResponse): boolean {
  const sc = gm.state_changes;
  const keys = ["hp", "stamina", "hunger", "thirst", "infection"] as const;
  if (!keys.every((k) => typeof sc[k] === "number")) return false;
  if (typeof gm.narrative !== "string" || gm.narrative.length === 0) return false;
  if (gm.next_interaction.type !== "free_text" && gm.next_interaction.type !== "choices") return false;
  if (gm.next_interaction.type === "choices" && gm.next_interaction.options.length !== 4) return false;
  if (gm.next_interaction.type === "free_text" && gm.next_interaction.options.length !== 0) return false;
  return Array.isArray(gm.spawns) && typeof gm.game_over === "boolean";
}

// --- sanitizeGM: garbage in -> safe out ---
const g1 = sanitizeGM(null);
ok(validShape(g1) && g1.narrative === "Nothing of note happens.", "sanitize(null) -> safe default");

const g2 = sanitizeGM({ next_interaction: { type: "choices", options: ["a"] } });
ok(g2.next_interaction.type === "choices" && g2.next_interaction.options.length === 4, "choices padded to exactly 4");

const g3 = sanitizeGM({
  narrative: "x",
  spawns: [{ type: "dragon", count: 3 }, { type: "zombie", count: 99 }],
  state_changes: { hp: -9999, stamina: "bad", hunger: 5, thirst: 0, infection: 0 },
  inventory_add: [{ item: "Knife", qty: -2 }, { qty: 1 }],
});
ok(g3.spawns.length === 1 && g3.spawns[0].type === "zombie" && g3.spawns[0].count === 6, "invalid spawn type dropped, count capped");
ok(g3.state_changes.hp === -100 && g3.state_changes.stamina === 0, "delta clamped to -100, non-number -> 0");
ok(g3.inventory_add.length === 1 && g3.inventory_add[0].qty === 1, "bad inventory_add entries dropped/fixed");

// --- encounter_over: optional, strict-boolean, defaults false ---
ok(sanitizeGM({ narrative: "x", encounter_over: true }).encounter_over === true, "encounter_over passes through sanitize");
ok(sanitizeGM({ narrative: "x" }).encounter_over === false, "encounter_over defaults false when omitted");
const gDanger = sanitizeGM({ narrative: "threat", encounter_over: false, next_interaction: { type: "choices", prompt: "Decide", options: ["a", "b", "c", "d"] } });
ok(gDanger.encounter_over === false && gDanger.next_interaction.options.length === 4, "danger keeps encounter open with 4 choices");

// --- applyOutcome ---
let s = newGame("t");
applyOutcome(s, sanitizeGM({ narrative: "hit", state_changes: { hp: -200, stamina: 0, hunger: 0, thirst: 0, infection: 0 } }));
ok(s.player.hp === 0, "huge negative hp delta clamps to 0");

s = newGame("t");
const res = applyOutcome(
  s,
  sanitizeGM({
    narrative: "loot + flag",
    inventory_add: [{ item: "Pistol", qty: 1 }],
    inventory_remove: [{ item: "Gold Bar", qty: 5 }],
    world_flags_add: ["cleared_pharmacy", "cleared_pharmacy"],
    discovered: { name: "Bunker", type: "shelter", x: 100, y: 200 },
  }),
);
ok(s.inventory.some((i) => i.item === "Pistol"), "inventory_add applied");
ok(s.worldFlags.filter((f) => f === "cleared_pharmacy").length === 1, "world flags deduped");
ok(s.knownLocations.length === 1 && res.discovered?.name === "Bunker", "discovered with coords added");
ok(s.recentEvents.length === 1, "recentEvents got a summary line");

s = newGame("t");
const dres = applyOutcome(s, sanitizeGM({ narrative: "end", state_changes: { hp: 0, stamina: 0, hunger: 0, thirst: 0, infection: 100 }, game_over: false }));
ok(dres.gameOver === true && s.player.infection === 100, "infection delta to 100 -> gameOver");

// discovered without coords is ignored
s = newGame("t");
applyOutcome(s, sanitizeGM({ narrative: "n", discovered: { name: "X", type: "y", x: null, y: null } }));
ok(s.knownLocations.length === 0, "discovered without coords ignored");

// applyOutcome surfaces encounterOver for the scene's bounded-loop decision
s = newGame("t");
ok(applyOutcome(s, sanitizeGM({ narrative: "n", encounter_over: true })).encounterOver === true, "applyOutcome surfaces encounterOver");
ok(applyOutcome(newGame("t"), sanitizeGM({ narrative: "n" })).encounterOver === false, "applyOutcome encounterOver defaults false");

// --- MockProvider: schema-valid across intents ---
async function main() {
  const mock = new MockProvider();
  const intents = [
    "I search the shelves",
    "I attack the zombie",
    "I rest for a while",
    "I sprint away",
    "I climb up to scout",
    "I do a cartwheel and sing",
  ];
  for (const value of intents) {
    const payload = { game_state: { location_type: "pharmacy", player: { hp: 80 }, inventory: [{ item: "Crowbar", qty: 1 }] }, input: { mode: "free_text", value } };
    const gm = sanitizeGM(JSON.parse(await mock.generate("", payload, {})));
    ok(validShape(gm), `mock turn valid: "${value}"`);
  }

  // Calm, exploratory intents resolve in ONE turn and hand control back (no chain).
  for (const value of ["I scout the area", "I drink some water", "I barricade the door"]) {
    const payload = { game_state: { location_type: "pharmacy", player: { hp: 80 }, inventory: [{ item: "Water Bottle", qty: 1 }] }, input: { mode: "free_text", value } };
    const gm = sanitizeGM(JSON.parse(await mock.generate("", payload, {})));
    ok(gm.encounter_over === true && gm.next_interaction.type === "free_text", `calm intent auto-closes: "${value}"`);
  }

  const scen = JSON.parse(await mock.generate("", { kind: "scenario", theme: "overrun hospital" }, {})) as Record<string, unknown>;
  ok(
    typeof scen.intro_narrative === "string" &&
      typeof scen.player_name === "string" &&
      Array.isArray(scen.starting_items) &&
      typeof scen.difficulty_modifier === "number",
    "mock scenario has required fields",
  );

  // --- end-to-end through gameMaster (defaults to offline provider in Node) ---
  const state = newGame("e2e");
  const gm = await runTurn(state, { mode: "free_text", value: "I search the grocery for food" }, "grocery");
  ok(validShape(gm), "runTurn returns a valid GMResponse");
  applyOutcome(state, gm);
  const p = state.player;
  ok(
    [p.hp, p.stamina, p.hunger, p.thirst, p.infection].every((v) => v >= 0 && v <= 100),
    "after applyOutcome all stats in 0..100",
  );

  // new-run scenario integration (Phase 6/7)
  const run = await newRunState("run-seed");
  ok(
    run.state.seed === "run-seed" && run.state.inventory.length > 0 && run.intro.length > 0,
    "newRunState builds a scenario run (seed + items + intro)",
  );
  ok(run.state.player.hp === 100 && run.state.difficultyModifier > 0, "new run state is sane");

  const armed = newGame("x");
  ok(!isArmed(armed), "fresh survivor is unarmed");
  armed.inventory.push({ item: "Crowbar", qty: 1 });
  ok(isArmed(armed), "isArmed detects a weapon");

  const named = await newRunState("name-seed", "Alex");
  ok(named.state.player.name === "Alex", "newRunState applies the provided player name");
  ok((named.state.goal ?? "").length > 0, "newRunState sets a run objective (goal) for the HUD");
  ok(newGame("d0").day === 0, "a fresh run starts at Day 0 (outbreak hour zero)");

  // Provider resolution (real-AI wiring).
  ok(resolveBrain("mock", true) === "offline", "mock -> offline brain");
  ok(resolveBrain("claude", false) === "claude", "claude -> claude brain");
  ok(resolveBrain("ollama", false) === "ollama", "explicit ollama tries ollama even if probe missed");
  ok(resolveBrain("auto", true) === "ollama", "auto + ollama up -> ollama brain");
  ok(resolveBrain("auto", false) === "offline", "auto + ollama down -> offline brain");

  // Model auto-pick: prefer a known-good family, else first installed, else default.
  ok(pickOllamaModel(["mistral:7b", "llama3.1:8b"]) === "llama3.1:8b", "pickOllamaModel prefers llama3.1");
  ok(pickOllamaModel(["customthing:1b"]) === "customthing:1b", "pickOllamaModel falls back to first installed");
  ok(pickOllamaModel([]) === "llama3.1", "pickOllamaModel defaults when none installed");

  console.log(fail === 0 ? "ALL GM CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
