// Interactive buildings (Expansion U5): the mood classifier is deterministic,
// lands in the tuned distribution bands, respects pried/cleared/rescued flag
// overrides + the base claim, and camp rosters are stable per (seed, chunk).

import { buildingState, effectiveState, priedFlag, clearedFlag, rescuedFlag, priedLootBonus } from "../src/game/world/buildingStates";
import { campRoster, npcGoneFlag, NPC_TIERS } from "../src/game/npcs";
import { generateChunk } from "../src/game/worldgen";
import { newGame } from "../src/game/GameState";
import type { Building } from "../src/game/world/tiles";

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

function fakeBuilding(gid: string, type: Building["type"]): Building {
  return { gid, type, tx: 0, ty: 0, tw: 5, th: 5, door: { x: 2, y: 0 }, center: { x: 80, y: 80 } };
}

// Determinism + distribution over real generated buildings.
{
  const moods: Record<string, number> = { normal: 0, boarded: 0, infested: 0, trapped: 0 };
  let total = 0;
  let deterministic = true;
  for (let cy = 14; cy <= 26; cy++) {
    for (let cx = 14; cx <= 26; cx++) {
      for (const b of generateChunk("moods", cx, cy).buildings) {
        const m = buildingState("moods", b);
        if (buildingState("moods", b) !== m) deterministic = false;
        moods[m]++;
        total++;
      }
    }
  }
  console.log(`  ${total} buildings → ${JSON.stringify(moods)}`);
  ok(deterministic, "mood is deterministic per (seed, building)");
  ok(total > 100, "patch holds a meaningful sample");
  ok(moods.normal / total > 0.6, "most buildings stay normal");
  ok(moods.boarded / total > 0.05 && moods.boarded / total < 0.25, "boarded rate in band (~10-18%)");
  ok(moods.infested / total > 0.03 && moods.infested / total < 0.15, "infested rate in band (~8%)");
  ok(moods.trapped / total > 0.005 && moods.trapped / total < 0.08, "trapped survivors rare (~3%)");
}

// Storefronts board up more often than houses.
{
  let stores = 0;
  let houses = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    if (buildingState("w", fakeBuilding(`s${i}`, "grocery")) === "boarded") stores++;
    if (buildingState("w", fakeBuilding(`h${i}`, "house")) === "boarded") houses++;
  }
  ok(stores > houses, `storefronts board up more (${stores} vs ${houses} per ${N})`);
}

// Flag overrides + base claim force "normal".
{
  const s = newGame("ov");
  // find one of each mood deterministically
  const find = (mood: string): Building => {
    for (let i = 0; i < 5000; i++) {
      const b = fakeBuilding(`f${i}`, "house");
      if (buildingState("ov", b) === mood) return b;
    }
    throw new Error("not found");
  };
  const boarded = find("boarded");
  const infested = find("infested");
  const trapped = find("trapped");
  ok(effectiveState("ov", boarded, s) === "boarded", "boarded reads boarded before prying");
  s.worldFlags.push(priedFlag(boarded.gid));
  ok(effectiveState("ov", boarded, s) === "normal", "pried_ flag clears the boards forever");
  ok(priedLootBonus(s, boarded.gid) === 0.4, "pried buildings pay the untouched-loot bonus");
  ok(priedLootBonus(s, "other") === 0, "no bonus elsewhere");
  s.worldFlags.push(clearedFlag(infested.gid));
  ok(effectiveState("ov", infested, s) === "normal", "cleared_ flag empties the infestation");
  s.worldFlags.push(rescuedFlag(trapped.gid));
  ok(effectiveState("ov", trapped, s) === "normal", "rescued_ flag frees the survivor once");
  const claimed = find("infested");
  s.base = { gid: claimed.gid, x: 0, y: 0, name: "home" };
  ok(effectiveState("ov", claimed, s) === "normal", "your claimed base is always safe");
}

// Camp rosters: deterministic, 2-3 residents, exactly one trader, valid tiers.
{
  const a = campRoster("camp-seed", 20, 21, "townsfolk");
  const b = campRoster("camp-seed", 20, 21, "townsfolk");
  ok(JSON.stringify(a) === JSON.stringify(b), "roster deterministic per (seed, chunk)");
  ok(a.length >= 2 && a.length <= 3, `camps hold 2-3 residents (got ${a.length})`);
  ok(a.filter((m) => m.role === "trader").length === 1, "exactly one trader per camp");
  ok(a.every((m) => m.id.startsWith("camp_20_21_")), "ids stable + chunk-keyed");
  ok(a.every((m) => m.tier in NPC_TIERS), "tiers come from the Batch-E table");
  const c = campRoster("camp-seed", 21, 21, "townsfolk");
  ok(JSON.stringify(a.map((m) => m.name)) !== JSON.stringify(c.map((m) => m.name)) || a.length !== c.length, "different camps differ");
  ok(npcGoneFlag("camp_20_21_0") === "npc_gone_camp_20_21_0", "suppression flag shape");
}

console.log(failed === 0 ? "ALL BUILDING-STATE CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
