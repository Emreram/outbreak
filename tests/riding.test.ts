// Rideable mounts (Companions & Spectacle PR-B): the collision gate that lets
// wings clear everything and swimmers cross open water (the pure rule behind the
// Phaser processCallback), mounted-texture coverage for every rideable species,
// and the flight-economy numbers that make flying usable but bounded.

import {
  PETS, isRideable, bondedSpeed, mountPassesTile,
  FLIGHT_DRAIN_PER_S, FLIGHT_REGEN_PER_S, RIDE_MIN_SPEED, TRAMPLE_RANK,
} from "../src/game/pets";
import { Tile } from "../src/game/world/tiles";
import { RARITY_META } from "../src/game/items/rarity";
import { mountableSpriteIds, mountedFrameAKey, mountedFrameBKey, mountedTexKey } from "../src/engine/petSprites";
import { GAITS, gaitPose } from "../src/engine/anim";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- the mount collision gate (drives the chunk-layer processCallback) ----------
{
  const solids = [Tile.Wall, Tile.Water, Tile.Tree, Tile.Rubble, Tile.Rail, Tile.DeepWater, Tile.Basalt];

  // airborne: every solid is cleared, whatever the mount
  ok(solids.every((t) => mountPassesTile("fly", true, t)), "airborne clears every solid tile");

  // swimming (grounded): open water passes, hard solids still collide
  ok(mountPassesTile("swim", false, Tile.Water) && mountPassesTile("swim", false, Tile.DeepWater), "a swimmer passes open + deep water");
  ok(!mountPassesTile("swim", false, Tile.Wall) && !mountPassesTile("swim", false, Tile.Tree) && !mountPassesTile("swim", false, Tile.Basalt), "a swimmer still hits walls/trees/rock");

  // ground mounts and feet: nothing passes
  ok(solids.every((t) => !mountPassesTile("ground", false, t)), "a grounded ground-mount passes nothing");
  ok(solids.every((t) => !mountPassesTile(undefined, false, t)), "on foot nothing passes");

  // a flier that has LANDED behaves like a ground mount
  ok(!mountPassesTile("fly", false, Tile.Water), "a landed flier collides with water again");
}

// --- mounted-texture coverage + rideability bands --------------------------------
{
  const rideable = Object.values(PETS).filter((d) => isRideable(d));
  const mounted = new Set(mountableSpriteIds());
  const missing = rideable.filter((d) => !mounted.has(d.id)).map((d) => d.id);
  ok(rideable.length >= 10, `a real stable to choose from (${rideable.length} rideable species)`);
  ok(missing.length === 0, `every rideable species has a mounted composite${missing.length ? " — MISSING: " + missing.join(",") : ""}`);
  ok(mountableSpriteIds().every((id) => PETS[id] && PETS[id].speed >= RIDE_MIN_SPEED), "no mounted art for companion-only pets");

  // all three traversal classes are actually rideable
  const moves = new Set(rideable.map((d) => d.move));
  ok(moves.has("ground") && moves.has("fly") && moves.has("swim"), "you can ride a runner, a flier, and a swimmer");

  // the saddle never breaks the speed sanity band, even at max bond
  ok(rideable.every((d) => bondedSpeed(d, 5) <= 4), "max-bond ride speed stays sane (≤4×)");
}

// --- flight economy ----------------------------------------------------------------
{
  ok(FLIGHT_REGEN_PER_S > FLIGHT_DRAIN_PER_S, "wings rest faster than they tire (flight is sustainable)");
  const fliers = Object.values(PETS).filter((d) => d.move === "fly" && isRideable(d));
  ok(fliers.length >= 3, `enough rideable fliers to matter (${fliers.length})`);
  ok(fliers.every((d) => d.staminaMax / FLIGHT_DRAIN_PER_S >= 6), "every rideable flier holds the air ≥6s");
  // scout birds stay perch-pets: not every flier carries a rider
  ok(Object.values(PETS).some((d) => d.move === "fly" && !isRideable(d)), "small birds remain companion-only");
}

// --- riding animation (Anim PR 2): frames, wings, gait coverage --------------------
{
  const rideable = Object.values(PETS).filter((d) => isRideable(d));

  // gallop frame keys follow the established naming so the composer + scene agree
  ok(
    rideable.every((d) => {
      const base = mountedTexKey(d.id);
      return mountedFrameAKey(d.id) === base + "_a" && mountedFrameBKey(d.id) === base + "_b";
    }),
    "mounted gallop frame keys round-trip the naming convention",
  );

  // every rideable FLIER carries the wings feature — the mounted wing overlay
  // keys off it, so a wingless flying mount would be the PR-B bug reborn
  const fliers = rideable.filter((d) => d.move === "fly");
  const wingless = fliers.filter((d) => !d.look.features?.includes("wings"));
  ok(fliers.length >= 3 && wingless.length === 0, `every rideable flier has wings for the saddle overlay${wingless.length ? " — MISSING: " + wingless.map((d) => d.id).join(",") : ""}`);

  // the mounted gait must exist and feel heavier than the free gait
  const archetypes = [...new Set(rideable.map((d) => d.look.archetype))];
  ok(archetypes.every((a) => GAITS[a] !== undefined), "every rideable archetype has a gait spec");
  ok(
    archetypes.every((a) => {
      const free = gaitPose(GAITS[a], Math.PI / 3, 1, false);
      const ridden = gaitPose(GAITS[a], Math.PI / 3, 1, true);
      return Math.abs(ridden.sway) > Math.abs(free.sway);
    }),
    "a ridden mount moves with heavier amplitude than a free one",
  );
}

// --- trample gate ---------------------------------------------------------------------
{
  const tramplers = Object.values(PETS).filter(
    (d) => d.move === "ground" && isRideable(d) && RARITY_META[d.rarity].rank >= TRAMPLE_RANK,
  );
  ok(tramplers.length >= 2, `epic+ ground mounts shoulder the dead aside (${tramplers.map((d) => d.id).join(", ")})`);
  ok(RARITY_META[PETS.pony.rarity].rank < TRAMPLE_RANK, "a pony does not trample hordes");
}

console.log(fail === 0 ? "ALL RIDING CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
