// Natural-disaster scheduling + lifecycle invariants (Living World, pure core).
// The lifecycle must run telegraph→active→expired in order, intensity must be 0
// during the warning and ramp within the active window, in-zone math must be
// circular, and the scheduler must respect the calm-start gate, context weighting,
// and the rare-cataclysm tier.

import {
  disasterPhase,
  intensityAt,
  inZone,
  isActive,
  scheduleDisaster,
  type LiveDisaster,
} from "../src/game/disasters";
import { createRng } from "../src/game/rng";
import { TILE_SIZE } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const live = (over: Partial<LiveDisaster> = {}): LiveDisaster => ({
  id: "d", kind: "wildfire", x: 1000, y: 1000, radius: 10,
  cataclysm: false, startedAt: 0, telegraphMs: 4000, activeMs: 8000, ...over,
});

// --- lifecycle ordering ---
{
  const d = live();
  ok(disasterPhase(d, 0) === "telegraph", "fresh disaster is telegraphing");
  ok(disasterPhase(d, 2000) === "telegraph", "still telegraphing before the warning ends");
  ok(disasterPhase(d, 5000) === "active", "active once the warning elapses");
  ok(disasterPhase(d, 11000) === "active", "still active within its window");
  ok(disasterPhase(d, 13000) === "expired", "expired after telegraph+active");
}

// --- intensity envelope ---
{
  const d = live();
  ok(intensityAt(d, 1000) === 0, "no intensity while telegraphing");
  ok(intensityAt(d, 4000) === 0, "no intensity exactly at activation boundary");
  ok(intensityAt(d, 8000) > 0.9, "intensity plateaus mid-active");
  ok(intensityAt(d, 12001) === 0, "no intensity once expired");
  const ramp = intensityAt(d, 4400); // 0.05 into active → 25% of ramp
  ok(ramp > 0 && ramp < 1, "intensity ramps up at the start of the active phase");
}

// --- in-zone (circular) ---
{
  const d = live({ x: 0, y: 0, radius: 5 });
  ok(inZone(d, 0, 0), "epicentre is in zone");
  ok(inZone(d, 4 * TILE_SIZE, 0), "a point within the radius is in zone");
  ok(!inZone(d, 6 * TILE_SIZE, 0), "a point beyond the radius is out of zone");
  ok(isActive(live(), 6000), "isActive agrees with disasterPhase");
}

// --- scheduler: calm-start gate ---
{
  const rng = createRng("sched");
  ok([...Array(50)].every(() => scheduleDisaster(rng, 0, "clear", "forest") === null), "no disasters on day 0/1 (calm start)");
}

// --- scheduler: storms favour lightning; volcanic favours eruption ---
{
  const rng = createRng("sched2");
  const stormKinds = new Set([...Array(200)].map(() => scheduleDisaster(rng, 6, "storm", "grassland")?.kind));
  ok(stormKinds.has("storm_lightning"), "storms can spawn lightning");
  const volc = new Set([...Array(200)].map(() => scheduleDisaster(rng, 6, "clear", "volcanic")?.kind));
  ok(volc.has("eruption"), "volcanic biome can erupt");
}

// --- scheduler: cataclysms are the rare tier ---
{
  const rng = createRng("sched3");
  let cat = 0;
  let total = 0;
  for (let i = 0; i < 4000; i++) {
    const s = scheduleDisaster(rng, 6, "clear", "suburb");
    if (s) {
      total++;
      if (s.cataclysm) cat++;
    }
  }
  const rate = cat / total;
  ok(rate > 0 && rate < 0.25, `cataclysms are rare (${(100 * rate).toFixed(1)}% of disasters)`);
}

console.log(fail === 0 ? "ALL DISASTER CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
