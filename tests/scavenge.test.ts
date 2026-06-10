// "Search everything" scavenging (Expansion U1): every searchable prop kind routes
// to a real loot source, flags round-trip on GameState, and the playing-dead roll
// is deterministic per seed+prop (no save-scum re-rolls).

import { SEARCHABLE_PROPS, CORPSE_BODY, isSearchableKind, searchFlag, isPropSearched, markSearched, playsDead } from "../src/game/scavenge";
import { rollLoot } from "../src/game/items/lootTables";
import { createRng } from "../src/game/rng";
import { newGame } from "../src/game/GameState";

// localStorage shim for Node (GameState persists via localStorage).
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

// Every searchable kind's loot source yields items (the SOURCES key exists).
{
  const rng = createRng("scav-test");
  let allYield = true;
  for (const [kind, def] of Object.entries(SEARCHABLE_PROPS)) {
    const out = rollLoot(def.source, rng, 3, 0);
    if (out.length === 0) {
      allYield = false;
      console.log(`  source ${def.source} (${kind}) yielded nothing over 3 rolls`);
    }
  }
  ok(allYield, "every searchable kind routes to a yielding loot source");
  ok(rollLoot(CORPSE_BODY.source, rng, 3, 0).length > 0, "fallen-body source yields");
}

// Durations + empty chances stay in sane, tuned bands.
{
  const defs = Object.values(SEARCHABLE_PROPS);
  ok(defs.every((d) => d.ms >= 800 && d.ms <= 3000), "search durations within 0.8–3s");
  ok(defs.every((d) => d.emptyChance >= 0.2 && d.emptyChance <= 0.8), "empty chance within 20–80% (thin by design)");
  ok(defs.every((d) => d.label.length > 0), "every searchable has a hint label");
}

// Kind gate + flag round-trip.
{
  ok(isSearchableKind("car") && isSearchableKind("dumpster") && isSearchableKind("corpse_soldier"), "core kinds searchable");
  ok(!isSearchableKind("tree") && !isSearchableKind("streetlight") && !isSearchableKind("sign"), "scenery is not searchable");

  const s = newGame("scav-seed");
  const gid = "20_20_p3";
  ok(!isPropSearched(s, gid), "fresh prop unsearched");
  markSearched(s, gid);
  ok(isPropSearched(s, gid), "markSearched flips the flag");
  ok(s.worldFlags.includes(searchFlag(gid)), "flag stored as searched_<gid>");
  const n = s.worldFlags.length;
  markSearched(s, gid);
  ok(s.worldFlags.length === n, "markSearched dedupes");
}

// Playing-dead: deterministic per (seed, gid, day); odds rise with day but cap.
{
  const a = playsDead("seedA", "10_10_p5", 2);
  for (let i = 0; i < 5; i++) ok2(playsDead("seedA", "10_10_p5", 2) === a, i === 0, "playing-dead roll is deterministic (no save-scum)");
  let hits = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) if (playsDead("seedB", `g${i}`, 0)) hits++;
  const rate = hits / N;
  ok(rate > 0.02 && rate < 0.12, `day-0 playing-dead rate ~6% (got ${(rate * 100).toFixed(1)}%)`);
  let hitsLate = 0;
  for (let i = 0; i < N; i++) if (playsDead("seedB", `g${i}`, 30)) hitsLate++;
  ok(hitsLate / N <= 0.22 && hitsLate > hits, "late-day rate higher but capped (≤18%+noise)");
}

// Helper: only log the first of a repeated assertion (keeps output tight).
function ok2(cond: boolean, log: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.log(`FAIL: ${msg}`);
  } else if (log) {
    console.log(`ok  : ${msg}`);
  }
}

console.log(failed === 0 ? "ALL SCAVENGE CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
