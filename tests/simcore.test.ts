// /src/sim integration (3D master plan M1): boot the full system roster on a
// fixed seed, run fixed steps headlessly, and verify the extracted WorldScene
// behaviors end-to-end — movement + collision on real terrain, survival decay
// cadence, the world clock + phase advance, enemy spawn/chase/attack, the
// melee kill pipeline (XP + corpse + events), drops magnet + pickup, the
// search channel completing into flags + loot, and death.

import { createGameSim } from "../src/sim/createGameSim";
import { SIM_STEP } from "../src/sim/Sim";
import { newGame } from "../src/game/GameState";
import { getZombie } from "../src/game/enemies/catalog";
import { skillXp } from "../src/game/skills";
import { hasItem } from "../src/game/inventory";
import { SEG_MS } from "../src/sim/systems/clock";
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

/** Run n fixed steps (16.67ms frames). */
function run(sim: { frame(ms: number): number }, steps: number): void {
  for (let i = 0; i < steps; i++) sim.frame(SIM_STEP * 1000);
}

// --- boot + spawn placement -----------------------------------------------------
const state = newGame("simcore-test-seed");
const { sim, clock, hostiles, combat, drops, scavenge } = createGameSim(state);
{
  // Assert: spawn is centred on a loaded, walkable chunk ring.
  ok(sim.world.loadedChunks().length === 25, `boot loads the 5×5 ring (${sim.world.loadedChunks().length})`);
  ok(sim.world.walkable(Math.floor(sim.player.x / TILE_SIZE), Math.floor(sim.player.y / TILE_SIZE)), "player spawns on a walkable tile");
  ok(state.player.x === sim.player.x && state.player.y === sim.player.y, "GameState position mirrors the sim");
}

// --- movement + clock + decay cadence ---------------------------------------------
{
  // Arrange.
  const x0 = sim.player.x;
  const hunger0 = state.player.hunger;
  const phase0 = state.timeOfDay;
  // Act: hold east for 2 seconds of fixed steps.
  sim.input.moveX = 1;
  run(sim, 120);
  sim.input.moveX = 0;
  // Assert: ~190px/s × 2s (modulo a wall in the way — accept any real progress).
  ok(sim.player.x - x0 > 150, `held east moves the player (${(sim.player.x - x0).toFixed(0)}px in 2s)`);
  ok(state.player.hunger <= hunger0 - 1, "hunger decays on the 2s cadence");
  ok(state.timeOfDay === phase0, "phase hasn't advanced yet (45s segment)");
}

{
  // Act: advance the clock a full segment (45s) — phase changes, events fire.
  let phaseEvent = "";
  sim.events.on("phaseChanged", (p) => (phaseEvent = p.phase));
  clock.segAcc = SEG_MS - 100; // fast-forward to the segment edge
  run(sim, 12);
  // Assert.
  ok(state.timeOfDay !== "day" || phaseEvent !== "", `clock advanced the phase (now ${state.timeOfDay})`);
  ok(phaseEvent === state.timeOfDay, "phaseChanged event carried the new phase");
}

// --- enemy chase + contact damage ---------------------------------------------------
{
  // Arrange: a shambler right next to the player, world otherwise calm.
  const def = getZombie("shambler")!;
  const e = hostiles.spawnEnemy(sim, def, sim.player.x + 60, sim.player.y)!;
  const hp0 = state.player.hp;
  // Act: stand still for 3 seconds — it should close and claw.
  run(sim, 180);
  // Assert.
  ok(e.state === "chase", "adjacent shambler aggroes (noise + aggro radius)");
  ok(state.player.hp < hp0, `contact attacks land (hp ${hp0} → ${state.player.hp})`);
  ok(state.recentEvents.some((l) => l.includes("Claws") || l.includes("Bitten")), "the hit wrote a recent event");
}

// --- melee kill pipeline ---------------------------------------------------------------
{
  // Arrange: a fresh target adjacent (ambient waves may have joined by now —
  // track THIS enemy, not the list). Top the player up first.
  state.player.hp = 100;
  state.player.stamina = 100;
  const target = hostiles.enemies[0] ?? hostiles.spawnEnemy(sim, getZombie("shambler")!, sim.player.x + 30, sim.player.y)!;
  const xp0 = skillXp(state, "combat");
  const kills0 = hostiles.kills;
  const corpses0 = hostiles.corpses.length;
  let removed = false;
  sim.events.on("enemyRemoved", () => (removed = true));
  // Act: swing until THIS one dies (fists, cooldown-gated, ~0.5s per swing).
  for (let i = 0; i < 60 && hostiles.enemies.includes(target); i++) {
    combat.meleeAttack(sim);
    run(sim, 30);
  }
  // Assert.
  ok(!hostiles.enemies.includes(target), "melee swings put the shambler down");
  ok(hostiles.kills > kills0, "kill counter incremented");
  ok(skillXp(state, "combat") > xp0, "combat XP granted on the kill");
  ok(hostiles.corpses.length > corpses0, "a searchable corpse record remains");
  ok(removed, "enemyRemoved event fired for the view layer");
  // Clean the arena so later sections are hermetic (despawn stragglers, heal).
  hostiles.enemies.length = 0;
  state.player.hp = 100;
  state.player.infection = 0;
  sim.grabbedUntil = -1;
}

// --- drops magnet + pickup --------------------------------------------------------------
{
  // Arrange: drop a stack right at the player's feet (inside the 44px magnet).
  const qty0 = state.inventory.find((i) => i.item === "Cloth")?.qty ?? 0;
  let picked = false;
  sim.events.on("pickup", (p) => (picked = picked || p.item === "Cloth"));
  // Act.
  drops.spawnDrop(sim, sim.player.x + 10, sim.player.y, "Cloth", 2);
  run(sim, 30); // magnet flight is 160ms
  // Assert.
  ok(picked, "the magnet vacuumed the drop into the bag");
  ok((state.inventory.find((i) => i.item === "Cloth")?.qty ?? 0) === qty0 + 2, "inventory gained the stack");
}

// --- search channel ----------------------------------------------------------------------
{
  // Arrange: a synthetic searchable right here (records are plain data).
  const rec = { gid: "t_test_1", kind: "crate", x: sim.player.x + 8, y: sim.player.y, searched: false };
  scavenge.startSearch(sim, { kind: rec.kind, x: rec.x, y: rec.y, prop: rec });
  ok(scavenge.search !== null, "search channel opened");
  ok(sim.searchNoise > 0, "rummaging raises the noise model");
  // Act: hold E for the full channel (crate = 1300ms).
  sim.input.interact = true;
  run(sim, 90);
  sim.input.interact = false;
  // Assert.
  ok(scavenge.search === null, "channel completed and closed");
  ok(rec.searched, "the prop is marked searched");
  ok(state.worldFlags.includes("searched_t_test_1"), "the searched flag persisted to state");
  ok(sim.searchNoise === 0, "noise resets after the search");
}

// --- death door ---------------------------------------------------------------------------
{
  // Arrange / Act: starve the player to zero hp via the infection door.
  let died = "";
  sim.events.on("death", (d) => (died = d.reason));
  state.player.infection = 100;
  run(sim, 130); // next decay tick detects it
  // Assert.
  ok(sim.dead && died.length > 0, `death door closes the run ("${died}")`);
  const x = sim.player.x;
  sim.input.moveX = 1;
  run(sim, 30);
  ok(sim.player.x === x, "the world freezes after death");
}

console.log(fail === 0 ? "ALL SIM CORE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
