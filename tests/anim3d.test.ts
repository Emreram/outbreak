// render3d/anim core (animation plan WS1): easing bounds/monotonicity, the
// AnimController priority/replacement/envelope/determinism rules, and the
// poseHumanoid wrapper's bit-parity with the v2 walk math. Pure modules only
// (Babylon-free) under the esbuild Node runner.

import {
  clamp01,
  easeInCubic,
  easeInOutSine,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  envelope,
} from "../src/render3d/anim/easing";
import {
  AnimController,
  newLocoInput,
  newPose,
  resetPose,
  type ActorAnimSpec,
  type AnimRegistry,
  type Pose,
} from "../src/render3d/anim/AnimController";
import { applyPose, fillBasicWalkPose, type PoseRig } from "../src/render3d/actors/Blockout";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- easing ---------------------------------------------------------------------
{
  const fams: [string, (t: number) => number][] = [
    ["easeInQuad", easeInQuad],
    ["easeInCubic", easeInCubic],
    ["easeOutQuad", easeOutQuad],
    ["easeOutCubic", easeOutCubic],
    ["easeInOutSine", easeInOutSine],
    ["easeOutBack", easeOutBack],
  ];
  let endpoints = true;
  for (const [, f] of fams) {
    if (Math.abs(f(0)) > 1e-9 || Math.abs(f(1) - 1) > 1e-9) endpoints = false;
  }
  ok(endpoints, "every curve hits f(0)=0 and f(1)=1");

  let monotone = true;
  for (const [name, f] of fams) {
    if (name === "easeOutBack") continue; // overshoots by design
    for (let i = 0; i < 50; i++) {
      if (f((i + 1) / 50) < f(i / 50) - 1e-9) monotone = false;
    }
  }
  ok(monotone, "the monotone family never decreases");

  let peak = 0;
  for (let i = 0; i <= 200; i++) peak = Math.max(peak, easeOutBack(i / 200));
  ok(peak > 1.0 && peak <= 1.11, `easeOutBack overshoots ≤ 1.11 (peak ${peak.toFixed(3)})`);
  ok(clamp01(-2) === 0 && clamp01(3) === 1 && clamp01(0.4) === 0.4, "clamp01 bounds");

  // trapezoid envelope: ramps in, plateaus, ramps out, zero outside
  ok(envelope(-1, 300, 100) === 0 && envelope(301, 300, 100) === 0, "envelope is zero outside the track");
  ok(envelope(50, 300, 100) === 0.5 && envelope(150, 300, 100) === 1 && envelope(250, 300, 100) === 0.5, "envelope ramps 0.5→1→0.5");
}

// --- AnimController priority / replacement / envelope ------------------------------
{
  // Arrange: a fake registry with instrumented actions and a no-op locomotion.
  const calls: string[] = [];
  const mk = (priority: number, durationMs = 300) => ({
    durationMs,
    priority,
    sample: (t01: number, w: number, pose: Pose) => {
      calls.push(`${priority}`);
      pose.rootX = w; // expose the envelope through a channel
      void t01;
    },
  });
  const registry: AnimRegistry = {
    locomotion: () => undefined,
    actions: { low: mk(40), mid: mk(60), hit: mk(80), death: mk(100) },
    stances: {
      aim: (w, pose) => {
        pose.torsoTwist = w;
      },
    },
  };
  const spec: ActorAnimSpec = { kind: "humanoid", archetype: "humanoid", scale: 1, hash: 0.5 };
  const c = new AnimController(spec, registry);
  const inp = newLocoInput();

  // Act/Assert: priority rules.
  ok(c.play("mid"), "an action starts on an idle controller");
  ok(!c.play("low") && c.current() === "mid", "lower priority is dropped");
  ok(c.play("hit") && c.current() === "hit", "higher priority replaces");
  ok(c.play("hit") && c.current() === "hit", "equal priority restarts/replaces");
  ok(c.play("death") && !c.play("hit") && c.current() === "death", "death outranks hit");

  // Envelope continuity: weight steps bounded by dt/ramp.
  let prevW = 0;
  let maxStep = 0;
  for (let i = 0; i < 40; i++) {
    const p = c.tick(16, inp);
    maxStep = Math.max(maxStep, Math.abs(p.rootX - prevW));
    prevW = p.rootX;
  }
  ok(maxStep <= 16 / 130 + 1e-6, `action weight ramps smoothly (max step ${maxStep.toFixed(3)})`);
  ok(c.current() === null, "action expires after its duration");

  // Stance ramp.
  c.setStance("aim");
  c.tick(75, inp);
  const half = c.tick(0, inp).torsoTwist;
  c.tick(150, inp);
  const full = c.tick(0, inp).torsoTwist;
  ok(half > 0.3 && half < 0.7 && Math.abs(full - 1) < 1e-6, `stance weight ramps over 150ms (${half.toFixed(2)}→${full.toFixed(2)})`);
  c.setStance(null);
  c.tick(300, inp);
  ok(c.tick(0, inp).torsoTwist === 0, "stance releases to zero");
}

// --- determinism ----------------------------------------------------------------------
{
  const registry: AnimRegistry = {
    locomotion: (spec, inp, pose) => {
      pose.hipL = Math.sin(inp.phaseRad) * 0.5;
      void spec;
    },
    actions: {
      hit: {
        durationMs: 200,
        priority: 80,
        sample: (t01, w, pose) => {
          pose.rootX -= 0.1 * w * (1 - t01);
        },
      },
    },
    stances: {},
    additive: (spec, inp, pose, suppress) => {
      pose.scaleY += Math.sin(inp.timeMs * 0.0045) * 0.015 * (1 - suppress);
      void spec;
    },
  };
  const spec: ActorAnimSpec = { kind: "humanoid", archetype: "runner", scale: 1, hash: 0.3 };
  const script = (c: AnimController): number[] => {
    const inp = newLocoInput();
    const out: number[] = [];
    for (let i = 0; i < 30; i++) {
      inp.timeMs += 16;
      inp.phaseRad += 0.2;
      inp.moving = true;
      if (i === 5) c.play("hit");
      const p = c.tick(16, inp);
      out.push(p.hipL, p.rootX, p.scaleY);
    }
    return out;
  };
  const a = script(new AnimController(spec, registry));
  const b = script(new AnimController(spec, registry));
  ok(a.length === b.length && a.every((v, i) => v === b[i]), "identical scripts produce identical poses");
}

// --- wrapper bit-parity with the v2 math -------------------------------------------------
{
  // Arrange: a plain-object fake rig + the documented v2 expectations.
  const node = () => ({ rotation: { x: 0, y: 0, z: 0 }, scaling: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 } });
  const rig: PoseRig = { root: node(), armL: node(), armR: node(), hipL: node(), hipR: node() };
  const facing = 0.7;
  const phase = 1.3;
  const sway = 0.11;
  const bob = 0.02;
  const armSwing = 0.55;

  // Act: pose via the new pipeline.
  const p = fillBasicWalkPose(resetPose(newPose()), phase, true, sway, bob, armSwing);
  applyPose(rig, p, facing);

  // Assert: every channel equals the v2 formulae bit-for-bit.
  const swing = Math.sin(phase) * armSwing;
  const step = Math.sin(phase) * Math.min(0.55, armSwing * 0.8);
  ok(rig.root.rotation.y === -(facing + sway), "root yaw = -(facing + sway)");
  ok(rig.root.rotation.z === sway * 0.6, "root roll = sway · 0.6");
  ok(rig.root.scaling.y === 1 + bob, "root scaleY = 1 + bob");
  ok(rig.armL.rotation.y === swing && rig.armR.rotation.y === -swing, "arm swing parity");
  ok(
    rig.armL.rotation.z === -0.08 + Math.cos(phase) * 0.06 && rig.armR.rotation.z === -0.08 - Math.cos(phase) * 0.06,
    "arm droop parity",
  );
  ok(rig.hipL!.rotation.z === -step && rig.hipR!.rotation.z === step, "hip counter-swing parity");
  ok(rig.root.position.x === 0 && rig.root.position.y === 0, "no positional drift at rootX/rootY = 0");

  // Idle: limbs settle, breathe channel untouched by the wrapper.
  const pi = fillBasicWalkPose(resetPose(newPose()), phase, false, 0, 0.01, armSwing);
  applyPose(rig, pi, facing);
  ok(rig.armL.rotation.y === 0 && rig.hipL!.rotation.z === 0, "idle zeroes swings");
  ok(rig.armL.rotation.z === -0.08, "idle keeps the reach droop");
}


// --- WS3 locomotion --------------------------------------------------------------------
{
  const { HUMANOID_PARITY, footPlants, phaseFor, playerPhase, sampleHumanoidLocomotion, swayAmpFor } = await import(
    "../src/render3d/anim/locomotion"
  );
  const { newLocoInput, newPose, resetPose } = await import("../src/render3d/anim/AnimController");

  // Arrange: a standard walker spec mid-stride.
  const spec = { kind: "humanoid" as const, archetype: "humanoid", movement: "walker", fast: false, scale: 1, hash: 0 };
  const inp = newLocoInput();
  inp.moving = true;
  inp.speedFrac = 1;
  inp.timeMs = 5000;
  inp.phaseRad = phaseFor(spec, 5000);

  // Assert: parity — phase frequency and sway amplitude match the table.
  ok(Math.abs(inp.phaseRad - 5000 * HUMANOID_PARITY.standard.freq) < 1e-9, "standard phase uses the .008 parity frequency");
  ok(swayAmpFor(spec, inp) === HUMANOID_PARITY.standard.amp, "standard sway amp = .12");
  const fastSpec = { ...spec, fast: true };
  ok(swayAmpFor(fastSpec, inp) === HUMANOID_PARITY.fast.amp, "runner sway amp = .22");
  const creepInp = { ...inp, creep: true };
  ok(swayAmpFor(spec, creepInp) === HUMANOID_PARITY.standard.amp * 0.5, "stalker creep halves the amp");
  ok(playerPhase(1000, false) === 1000 * 0.021 && playerPhase(1000, true) === 1000 * 0.042, "player phase parity .021/.042");

  // Knees never bend negative across a stride; limbs rest at idle.
  const pose = newPose();
  let kneeMin = 9;
  for (let i = 0; i < 64; i++) {
    inp.phaseRad = (i / 64) * Math.PI * 2;
    sampleHumanoidLocomotion(spec, inp, resetPose(pose));
    kneeMin = Math.min(kneeMin, pose.kneeL, pose.kneeR);
  }
  ok(kneeMin >= 0, "knees never hyperextend (bend >= 0)");
  const idle = newLocoInput();
  sampleHumanoidLocomotion(spec, idle, resetPose(pose));
  ok(pose.armL.swingY === 0 && pose.hipL === 0 && pose.kneeL === 0, "idle zeroes the stride channels");

  // Foot plants: exactly two per stride, alternating feet.
  let plants = 0;
  let prev = 0;
  const seen: number[] = [];
  for (let i = 1; i <= 200; i++) {
    const p = (i / 200) * Math.PI * 2;
    const f = footPlants(prev, p);
    if (f !== 0) {
      plants++;
      seen.push(f);
    }
    prev = p;
  }
  ok(plants === 2 && seen[0] !== seen[1], `exactly 2 alternating plants per stride (${plants})`);
}


// --- WS4 player combat actions + weapon families ------------------------------------------
{
  const { ACTIONS } = await import("../src/render3d/anim/actions");
  const { weaponFamilyFor } = await import("../src/render3d/actors/weapons");
  const { newLocoInput, newPose, resetPose } = await import("../src/render3d/anim/AnimController");

  // Arrange/Assert: the family map is total over every WeaponClass.
  const classes = [
    "fist", "blade", "axe", "blunt", "spear", "polearm", "whip", "thrown",
    "pistol", "revolver", "smg", "shotgun", "rifle", "dmr", "lmg",
    "bow", "crossbow", "launcher", "flame", "nailgun", "energy",
  ] as const;
  ok(classes.every((c) => typeof weaponFamilyFor(c) === "string"), "weaponFamilyFor is total over all 21 classes");
  ok(weaponFamilyFor("fist") === "none" && weaponFamilyFor("rifle") === "long" && weaponFamilyFor("crossbow") === "bow", "family routing spot checks");

  // Action table sanity: durations/priorities per the plan.
  ok(ACTIONS.attack_slash.durationMs === 320 && ACTIONS.attack_slash.priority === 60, "slash 320ms @60");
  ok(ACTIONS.attack_thrust.durationMs === 260 && ACTIONS.attack_smash.durationMs === 380, "thrust 260ms, smash 380ms");
  ok(ACTIONS.fire_recoil.durationMs === 120 && ACTIONS.fire_recoil.priority === 40, "fire recoil 120ms @40 (§3.7 window)");
  ok(ACTIONS.hit_recoil.priority === 80, "hit recoil interrupts attacks");

  // Thrust returns rootX to ~0 at t=1 (no drift), slash sweep is monotonic.
  const inp = newLocoInput();
  const pose = newPose();
  ACTIONS.attack_thrust.sample(0.9999, 1, resetPose(pose), inp, {}, { kind: "humanoid", archetype: "survivor", scale: 1, hash: 0 });
  ok(Math.abs(pose.rootX) < 0.01, `thrust lunge returns home (rootX ${pose.rootX.toFixed(3)})`);
  let prev = -99;
  let mono = true;
  for (let i = 0; i <= 10; i++) {
    const t = 0.28 + (i / 10) * 0.27;
    ACTIONS.attack_slash.sample(t, 1, resetPose(pose), inp, {}, { kind: "humanoid", archetype: "survivor", scale: 1, hash: 0 });
    if (pose.armR.swingY < prev - 1e-9) mono = false;
    prev = pose.armR.swingY;
  }
  ok(mono, "slash sweep is monotonic through its window");
}

console.log(fail === 0 ? "ALL ANIM3D CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
