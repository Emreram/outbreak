// Opening arc (Expansion U3, extended by Companions PR-D): the reducer advances
// through arm → scavenge → befriend the stray → reach → dawn, labels track
// progress, the befriend step auto-skips when it can't teach (a pet already on
// the roster, or a cursor carried past day 0 — including OLD saves whose index
// predates the step), the safehouse is deterministic + on land, and old saves
// with no cursor fall back cleanly.

import { OPENING_CHAIN, newObjectives, currentStep, objectiveLabel, notifyObjective, skipSatisfiedSteps, arcSafehouse } from "../src/game/objectives";
import { addPet } from "../src/game/pets";
import { biomeAt } from "../src/game/world/biomes";
import { findSpawnChunk } from "../src/game/world/spawn";
import { newGame } from "../src/game/GameState";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let failed = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) failed++;
}

// Fresh runs carry the cursor; old saves without one are inert.
{
  const s = newGame("arc-seed");
  ok(!!s.objectives && s.objectives.chain === "opening" && s.objectives.step === 0, "newGame seeds the opening chain");
  ok(currentStep(s)?.kind === "equip_weapon", "first step: arm yourself");
  ok((objectiveLabel(s) ?? "").includes("1/5"), "banner shows step 1/5");

  const old = newGame("old");
  old.objectives = undefined; // simulate a pre-U3 save
  ok(currentStep(old) === null && objectiveLabel(old) === null, "no cursor → banner falls back to the run goal");
  const r = notifyObjective(old, { kind: "dawn" });
  ok(!r.advanced, "events are no-ops without a cursor");
}

// Full walk-through: events advance steps in order, off-step events are ignored.
{
  const s = newGame("arc-seed");
  ok(!notifyObjective(s, { kind: "dawn" }).advanced, "dawn ignored while still on step 1");
  const r1 = notifyObjective(s, { kind: "weapon_equipped" });
  ok(r1.advanced && r1.stepDone && !r1.chainDone, "equipping advances to step 2");
  ok(currentStep(s)?.kind === "search_n", "step 2 is the scavenge counter");

  for (let i = 0; i < 3; i++) {
    const r = notifyObjective(s, { kind: "container_searched" });
    ok(r.advanced && !r.stepDone, `search ${i + 1}/4 ticks progress without completing`);
  }
  ok((objectiveLabel(s) ?? "").includes("(3/4)"), "banner shows live progress (3/4)");
  const r2 = notifyObjective(s, { kind: "container_searched" });
  ok(r2.stepDone, "4th search completes the scavenge step");

  ok(currentStep(s)?.kind === "tame_pet", "step 3 is befriending the stray (PR-D)");
  ok(!notifyObjective(s, { kind: "chunk_entered", cx: 0, cy: 0 }).advanced, "reaching chunks doesn't satisfy the stray");
  const rb = notifyObjective(s, { kind: "pet_tamed" });
  ok(rb.stepDone, "taming completes the befriend step");

  const t = arcSafehouse(s.seed);
  ok(!notifyObjective(s, { kind: "chunk_entered", cx: t.cx + 5, cy: t.cy }).advanced, "wrong chunk doesn't count");
  const r3 = notifyObjective(s, { kind: "chunk_entered", cx: t.cx, cy: t.cy });
  ok(r3.stepDone, "entering the safehouse chunk completes step 4");

  const r4 = notifyObjective(s, { kind: "dawn" });
  ok(r4.stepDone && r4.chainDone && s.objectives?.done === true, "dawn completes the chain");
  ok(!notifyObjective(s, { kind: "dawn" }).advanced, "finished chains ignore further events");
  ok(objectiveLabel(s) === null, "banner releases back to the run goal when done");
}

// Befriend auto-skip: a roster pet (tamed during arm/scavenge) skips the step
// silently as the cursor advances into it.
{
  const s = newGame("skip-seed");
  addPet(s, "cat"); // befriended something before the chain reached the stray
  notifyObjective(s, { kind: "weapon_equipped" });
  for (let i = 0; i < 4; i++) notifyObjective(s, { kind: "container_searched" });
  ok(currentStep(s)?.kind === "reach_marker", "a roster pet auto-skips befriend on advance");
}

// Stale cursors: skipSatisfiedSteps unblocks saves sitting ON the step.
{
  const s = newGame("stale-seed");
  s.objectives = { chain: "opening", step: 2, progress: 0 }; // parked on befriend
  s.day = 3; // an old save carried past day 0 — the stray window is gone
  skipSatisfiedSteps(s);
  ok(currentStep(s)?.kind === "reach_marker", "day>0 cursors skip befriend (old-save migration)");

  const f = newGame("fresh-day0");
  f.objectives = { chain: "opening", step: 2, progress: 0 };
  skipSatisfiedSteps(f);
  ok(currentStep(f)?.kind === "tame_pet", "a petless day-0 run KEEPS the befriend step (the stray is coming)");
}

// Safehouse: deterministic, near spawn, on land.
{
  const a = arcSafehouse("safeh-1");
  const b = arcSafehouse("safeh-1");
  ok(a.cx === b.cx && a.cy === b.cy, "safehouse deterministic per seed");
  const spawn = findSpawnChunk("safeh-1");
  const d = Math.hypot(a.cx - spawn.x, a.cy - spawn.y);
  ok(d >= 1 && d <= 4, `safehouse a short expedition out (${d.toFixed(1)} chunks)`);
  const biome = biomeAt("safeh-1", a.cx, a.cy);
  ok(biome.id !== "ocean" && biome.id !== "lake", "safehouse lands on dry ground");
  ok(OPENING_CHAIN.length === 5, "chain is the designed 5 steps");
  void newObjectives;
}

console.log(failed === 0 ? "ALL OBJECTIVE CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
