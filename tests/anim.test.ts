// Animation core (Animation Pass PR 1): the frame-cycle picker (2-step and the
// 4-step contact–pass–contact–pass), the fallback-chain resolver that keeps
// generated single-frame art from flickering against procedural frames, the
// per-archetype gait math (bounded, speed-monotone, covering every pet
// archetype), and the prop-sway field.

import {
  frameFor, resolveFrames, gaitPose, swayAngle, posPhase, meleeStyleFor,
  GAITS, SWAY_SPECS, type FrameSet,
} from "../src/engine/anim";
import { PETS, type PetArchetype } from "../src/game/pets";
import { wantsFrameC } from "../src/engine/zombieSprites";
import { BALLISTIC_CLASSES } from "../src/game/combat";
import { WEAPONS } from "../src/game/items/weapons";
import { allZombies } from "../src/game/enemies/catalog";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const TAU = Math.PI * 2;

// --- frameFor: 2-step and 4-step cycles ------------------------------------------
{
  const two: FrameSet = { idle: "i", a: "A", b: "B" };
  ok(frameFor(two, false, 1.2) === "i", "at rest the cycle settles on the idle frame");
  ok(frameFor(two, true, 0.1) === "A" && frameFor(two, true, Math.PI + 0.1) === "B", "2-step toggles on the sine's sign");

  const four: FrameSet = { idle: "i", a: "A", b: "B", pass: "P" };
  const seq = [0.1, Math.PI / 2 + 0.1, Math.PI + 0.1, (3 * Math.PI) / 2 + 0.1].map((p) => frameFor(four, true, p));
  ok(seq.join("") === "APBP", `4-step runs contact–pass–contact–pass (${seq.join("")})`);
  ok(frameFor(four, true, 0.1 + TAU * 3) === "A", "phase wraps cleanly across whole strides");
  ok(frameFor(four, true, -0.2) === "P", "negative phase stays in range (no NaN frame)");
}

// --- resolveFrames: the four fallback-chain cases ---------------------------------
{
  const have = (keys: string[]) => (k: string) => keys.includes(k);
  // (1)/(3): base + _b both exist → a real cycle
  const pair = resolveFrames(have(["pet_x", "pet_x_b"]), "pet_x", { b: "pet_x_b" });
  ok(pair.b === "pet_x_b", "a present _b frame cycles");
  // (2): _b missing → collapses onto a (a free no-op swap; gait carries motion)
  const single = resolveFrames(have(["pet_x"]), "pet_x", { b: "pet_x_b" });
  ok(single.b === "pet_x" && single.idle === "pet_x", "a missing _b collapses onto the base frame");
  // pass frame only joins the set when it really exists (4-step is opt-in)
  const noPass = resolveFrames(have(["k", "k_b"]), "k", { b: "k_b", pass: "k_p" });
  ok(noPass.pass === undefined, "a missing pass frame keeps the cycle 2-step");
  const withPass = resolveFrames(have(["k", "k_b", "k_p"]), "k", { b: "k_b", pass: "k_p" });
  ok(withPass.pass === "k_p", "a present pass frame upgrades to the 4-step");
  // idle defaults to the base
  ok(resolveFrames(have(["k"]), "k").idle === "k", "idle defaults to the base frame");
}

// --- gait math: bounded, toggling, speed-monotone, archetype-complete --------------
{
  const archetypes = new Set(Object.values(PETS).map((p) => p.look.archetype));
  const missing = [...archetypes].filter((a) => !GAITS[a as PetArchetype]);
  ok(missing.length === 0, `every pet archetype has a gait${missing.length ? " — MISSING: " + missing.join(",") : ""}`);

  let bounded = true;
  let togglesPerStride = 0;
  let lastB = false;
  for (const [name, spec] of Object.entries(GAITS)) {
    for (let i = 0; i <= 200; i++) {
      const ph = (i / 200) * TAU;
      for (const mounted of [false, true]) {
        const p = gaitPose(spec, ph, 1, mounted);
        const ampCap = (spec.swayAmp + (spec.sBend ?? 0)) * spec.mountedMult + 1e-9;
        if (Math.abs(p.sway) > ampCap) bounded = false;
        if (Math.abs(p.scaleYMul) > spec.bobAmp * spec.mountedMult + 1e-9) bounded = false;
      }
      if (name === "quadruped") {
        // offset the window so the toggle points (π, 2π) land strictly inside it
        const b = gaitPose(spec, 0.01 + ph, 1, false).frameB;
        if (i > 0 && b !== lastB) togglesPerStride++;
        lastB = b;
      }
    }
  }
  ok(bounded, "sway + bob stay inside their per-archetype amplitude caps");
  ok(togglesPerStride === 2, `frameB toggles exactly twice per stride (${togglesPerStride})`);

  const slow = gaitPose(GAITS.avian, 1, 0.3, false).flapHz;
  const fast = gaitPose(GAITS.avian, 1, 1, false).flapHz;
  ok(fast > slow, `wing flap rate rises with speed (${slow.toFixed(2)} → ${fast.toFixed(2)}Hz)`);

  const walked = gaitPose(GAITS.equine, Math.PI / 4, 1, false);
  const ridden = gaitPose(GAITS.equine, Math.PI / 4, 1, true);
  ok(Math.abs(ridden.sway) > Math.abs(walked.sway), "a ridden mount moves with heavier amplitude");
}

// --- prop sway field ----------------------------------------------------------------
{
  ok(Object.keys(SWAY_SPECS).length >= 6, `a swaying dressing layer (${Object.keys(SWAY_SPECS).length} kinds)`);
  let inRange = true;
  for (const spec of Object.values(SWAY_SPECS)) {
    for (let t = 0; t < 20000; t += 250) {
      if (Math.abs(swayAngle(spec, t, 1.7)) > spec.amp + 1e-9) inRange = false;
    }
    if (!(spec.originY > 0.5 && spec.originY <= 1)) inRange = false;
  }
  ok(inRange, "sway angles stay inside amp and pivots sit at the root");
  ok(posPhase(100, 200) === posPhase(100, 200), "position phase is deterministic");
  ok(posPhase(100, 200) !== posPhase(132, 200), "neighbours don't sway in lockstep");
  const ph = posPhase(987, 654);
  ok(ph >= 0 && ph < TAU, "phase lands in [0, 2π)");
}

// --- zombie frame-C gate: bounded and aimed at the expressive movers ---------------
{
  const all = allZombies();
  const c = all.filter((d) => wantsFrameC(d));
  ok(c.length > 0 && c.length < all.length, `frame C is selective (${c.length}/${all.length} types)`);
  ok(c.length === all.filter((d) => wantsFrameC(d)).length, "wantsFrameC is deterministic");
  ok(all.filter((d) => d.family === "zombie_runner").every((d) => wantsFrameC(d)), "every runner earns the 4-step");
}

// --- combat FX routing (Anim PR 4) -------------------------------------------------
{
  const meleeClasses = [...new Set(WEAPONS.filter((w) => w.hand === "melee").map((w) => w.wclass))];
  const styles = new Set(meleeClasses.map((c) => meleeStyleFor(c)));
  ok(meleeClasses.every((c) => ["slash", "thrust", "smash"].includes(meleeStyleFor(c))), `every melee class routes to a swing style (${meleeClasses.length} classes)`);
  ok(styles.size === 3, `all three swing styles are actually used (${[...styles].join(", ")})`);
  ok(meleeStyleFor("spear") === "thrust" && meleeStyleFor("blunt") === "smash" && meleeStyleFor("blade") === "slash", "the marquee mappings hold");

  const ranged = WEAPONS.filter((w) => w.hand === "ranged");
  ok(ranged.some((w) => BALLISTIC_CLASSES.has(w.wclass)) && ranged.some((w) => !BALLISTIC_CLASSES.has(w.wclass)), "casings eject from some guns and never from bows/energy");
  ok(!BALLISTIC_CLASSES.has("bow") && !BALLISTIC_CLASSES.has("launcher") && !BALLISTIC_CLASSES.has("flame") && !BALLISTIC_CLASSES.has("energy"), "the no-brass classes are excluded");
}

console.log(fail === 0 ? "ALL ANIM CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
