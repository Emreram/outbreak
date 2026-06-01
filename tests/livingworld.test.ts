// Living world (Feature 10) — pure-logic invariants for the event scheduler + radio:
// valid + day-gated event selection, sane scheduling delays, and compass directions.

import { rollWorldEvent, nextEventDelayMs, compassDir, WORLD_EVENTS } from "../src/game/worldEvents";
import { createRng } from "../src/game/rng";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const rng = createRng("events");

// --- valid kinds + day gating ---
ok(
  [...Array(200)].every(() => (WORLD_EVENTS as readonly string[]).includes(rollWorldEvent(rng, 5, false))),
  "rollWorldEvent always returns a known event kind",
);
const day0 = new Set([...Array(300)].map(() => rollWorldEvent(rng, 0, false)));
ok(![...day0].includes("raiders"), "raiders never fire on day 0 (minDay 2)");
ok([...day0].every((k) => k === "flyover" || k === "supply_drop"), "only flyover/supply_drop are eligible on day 0");
const day5 = new Set([...Array(300)].map(() => rollWorldEvent(rng, 5, true)));
ok(day5.has("horde") && day5.has("raiders"), "hordes + raiders become eligible by day 5");

// --- scheduling: positive, bounded, and rarer-early on average ---
const meanDelay = (day: number, night: boolean) => {
  let sum = 0;
  const N = 400;
  for (let i = 0; i < N; i++) sum += nextEventDelayMs(day, night);
  return sum / N;
};
const early = meanDelay(0, false);
const late = meanDelay(12, false);
ok(early > 30000 && early < 400000, "event delay sits in a sane range (30s–6.5min)");
ok(late < early, "events grow more frequent as the days mount");
ok(meanDelay(3, true) < meanDelay(3, false), "events come faster at night");

// --- compass directions ---
ok(compassDir(1, 0) === "east", "compass: +x is east");
ok(compassDir(0, 1) === "south", "compass: +y is south");
ok(compassDir(0, -1) === "north", "compass: -y is north");
ok(compassDir(-1, 0) === "west", "compass: -x is west");
ok(compassDir(1, 1) === "south-east", "compass: +x+y is south-east");

console.log(fail === 0 ? "ALL LIVING-WORLD CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
