// Modular blockout actors v2 (graphics plan WS7 / master plan §3.6 fallback
// path): articulated figures composed from the SAME LookSpec data as the 2D
// sprites — body archetype dimensions from zombieSprites' dims table, skin/
// accent/eye palettes, feature add-ons, swinging legs and shoulder-pivoted
// arms — animated procedurally by the anim.ts/Enemy.applySway gait math (sway
// → yaw wobble + half roll, bob → scaleY, swing → hip/shoulder rotation).
// The body material is cloned per rig so hit-flashes can pulse it. The game
// still animates with zero GLB files.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ZombieDef } from "../../game/enemies/types";
import { attachFeatures } from "./features";
import { newPose, resetPose, type Pose } from "../anim/AnimController";

/** Body archetype canvas dims (bw, bh, headR, headOff, armLen) — the EXACT
 *  zombieSprites.ts table; 64px canvas ≙ ~1.8m figure → scale px·0.028m. */
const DIMS: Record<string, [number, number, number, number, number]> = {
  bloated: [17, 16, 6, 12, 7],
  crawler: [16, 9, 6, 12, 11],
  brute: [18, 15, 8, 13, 11],
  behemoth: [21, 19, 10, 15, 13],
  lanky: [9, 14, 6, 12, 15],
  child: [9, 8, 6, 9, 6],
  hazmat: [14, 13, 8, 12, 9],
  spitter: [12, 11, 9, 12, 8],
  screamer: [11, 11, 9, 12, 8],
  husk: [10, 10, 6, 11, 11],
  armored: [15, 13, 7, 12, 9],
  toxic: [13, 12, 7, 12, 10],
  runner: [11, 10, 6, 13, 13],
  humanoid: [13, 11, 7, 12, 10],
};
const PX = 0.028; // 2D canvas px → meters

function hex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
}

const matCache = new Map<string, StandardMaterial>();
let blockoutMaxLights = 4;

/** Raise the forward-light cap on actor materials (WS9 light pool). Call once
 *  at boot, before any rigs build. */
export function setBlockoutMaxLights(n: number): void {
  blockoutMaxLights = n;
}

function mat(scene: Scene, color: number, emissive = 0): StandardMaterial {
  const key = `${color}|${emissive}`;
  let m = matCache.get(key);
  if (!m || m.getScene() !== scene) {
    m = new StandardMaterial(`bo_${key}`, scene);
    m.diffuseColor = Color3.FromHexString(hex(color));
    if (emissive) m.emissiveColor = Color3.FromHexString(hex(emissive)).scale(0.8);
    m.specularColor = Color3.Black();
    m.maxSimultaneousLights = blockoutMaxLights;
    matCache.set(key, m);
  }
  return m;
}

export interface HumanoidRig {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  /** Per-rig body material — hit-flash pulses its emissive. */
  bodyMat: StandardMaterial;
  armL: TransformNode;
  armR: TransformNode;
  hipL: TransformNode | null;
  hipR: TransformNode | null;
  /** Rig v3 joints (animation plan WS2). */
  torso: TransformNode;
  neck: TransformNode;
  elbowL: TransformNode;
  elbowR: TransformNode;
  kneeL: TransformNode | null;
  kneeR: TransformNode | null;
  handL: TransformNode;
  handR: TransformNode;
  baseY: number;
  dispose(): void;
}

export interface HumanoidLook {
  skin: number;
  accent?: number;
  eyes?: number;
  archetype?: string; // BodyArchetype, defaults humanoid
  scale?: number;
  crawler?: boolean;
  /** Override the head colour (the survivor: jacket body + skin head). */
  headColor?: number;
  /** LookSpec feature flags (plates/horns/sacs/…). */
  features?: readonly string[];
}

/** Darken a packed RGB (boot tints on shins). */
function dim(hex: number, f: number): number {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** Build a humanoid figure facing +X (sim convention), origin at the feet.
 *  Rig v3 (animation plan WS2): root → torso pivot (body/band/shoulders/neck —
 *  lean ≠ feet) with two-segment arms (shoulder→elbow→hand socket), and root →
 *  hip pivots with thigh/knee/shin splits. ~25 nodes, ≤13 meshes. */
export function buildHumanoid(scene: Scene, name: string, look: HumanoidLook): HumanoidRig {
  const d = DIMS[look.archetype ?? "humanoid"] ?? DIMS.humanoid;
  const s = (look.scale ?? 1) * PX;
  const [bw, bh, headR, , armLen] = d;
  const crawler = look.crawler ?? look.archetype === "crawler";
  const sc = look.scale ?? 1;

  const root = new TransformNode(name, scene);
  const bodyW = bw * s * 2.0; // z extent (across shoulders)
  const bodyD = bh * s * 1.6; // x extent (along facing)
  const legH = crawler ? 0 : 0.34 * sc;
  const bodyH = crawler ? 0.5 * sc : 0.92 * sc;
  const bodyY = crawler ? bodyH / 2 + 0.05 : legH + bodyH / 2 - 0.04;

  // torso pivot at the waist: body, shoulders and neck lean from here
  const torsoY = crawler ? 0.05 : legH - 0.04;
  const torso = new TransformNode(`${name}_torso`, scene);
  torso.parent = root;
  torso.position.y = torsoY;

  const body = CreateBox(`${name}_body`, { width: bodyD, height: bodyH, depth: bodyW }, scene);
  const bodyMat = mat(scene, look.skin).clone(`${name}_bodyMat`);
  body.material = bodyMat;
  body.parent = torso;
  body.position.y = bodyY - torsoY;

  // accent: a torso band (the torn-clothing accent colour)
  if (look.accent !== undefined) {
    const band = CreateBox(`${name}_band`, { width: bodyD * 1.02, height: bodyH * 0.3, depth: bodyW * 1.02 }, scene);
    band.material = mat(scene, look.accent);
    band.parent = body;
    band.position.y = -bodyH * 0.18;
    band.isPickable = false;
  }

  // neck pivot at the collar; head + eyes ride it
  const headSize = headR * s * 2.4;
  const headY = crawler ? bodyH + 0.12 : bodyY + bodyH / 2 + headSize / 2 - 0.02;
  const neck = new TransformNode(`${name}_neck`, scene);
  neck.parent = torso;
  neck.position.set(crawler ? bodyD * 0.5 : bodyD * 0.15, headY - headSize / 2 - torsoY + 0.01, 0);
  const head = CreateBox(`${name}_head`, { size: headSize }, scene);
  head.material = mat(scene, look.headColor ?? look.skin);
  head.parent = neck;
  head.position.y = headSize / 2;

  // emissive eye strip on the face (+x) — reads at 20m, replaces head glow
  const eyeColor = look.eyes && look.eyes !== 0x140d0d ? look.eyes : 0;
  if (eyeColor) {
    const eyes = CreateBox(`${name}_eyes`, { width: 0.02, height: headSize * 0.16, depth: headSize * 0.62 }, scene);
    eyes.material = mat(scene, eyeColor, eyeColor);
    eyes.parent = head;
    eyes.position.set(headSize * 0.51, headSize * 0.08, 0);
    eyes.isPickable = false;
  }

  // two-segment arms: shoulder pivot → upper arm → elbow pivot → forearm →
  // hand socket (weapon attach)
  const armW = 0.09 * sc + 0.03;
  const armL3 = armLen * s * 1.7;
  const segLen = armL3 / 2;
  const shoulderY = crawler ? bodyH * 0.6 : bodyY + bodyH * 0.36;
  const mkArm = (side: 1 | -1): { shoulder: TransformNode; elbow: TransformNode; hand: TransformNode } => {
    const shoulder = new TransformNode(`${name}_sh${side}`, scene);
    shoulder.parent = torso;
    shoulder.position.set(bodyD * 0.3, shoulderY - torsoY, side * bodyW * 0.45);
    const upper = CreateBox(`${name}_uarm${side}`, { width: segLen, height: armW, depth: armW }, scene);
    upper.material = mat(scene, look.skin);
    upper.parent = shoulder;
    upper.position.x = segLen / 2;
    upper.isPickable = false;
    const elbow = new TransformNode(`${name}_el${side}`, scene);
    elbow.parent = shoulder;
    elbow.position.x = segLen;
    const fore = CreateBox(`${name}_farm${side}`, { width: segLen, height: armW * 0.9, depth: armW * 0.9 }, scene);
    fore.material = mat(scene, look.skin);
    fore.parent = elbow;
    fore.position.x = segLen / 2;
    fore.isPickable = false;
    const hand = new TransformNode(`${name}_hand${side}`, scene);
    hand.parent = elbow;
    hand.position.x = segLen;
    return { shoulder, elbow, hand };
  };
  const aL = mkArm(1);
  const aR = mkArm(-1);

  // two-segment legs: hip pivot → thigh → knee pivot → shin (boot-tinted tip)
  let hipL: TransformNode | null = null;
  let hipR: TransformNode | null = null;
  let kneeL: TransformNode | null = null;
  let kneeR: TransformNode | null = null;
  if (!crawler) {
    const legW = Math.max(0.07, bodyW * 0.26);
    const legColor = look.accent !== undefined ? look.accent : look.skin;
    const thighLen = legH * 0.52;
    const shinLen = legH - thighLen + 0.04;
    const mkLeg = (side: 1 | -1): { hip: TransformNode; knee: TransformNode } => {
      const hip = new TransformNode(`${name}_hip${side}`, scene);
      hip.parent = root;
      hip.position.set(0, legH + 0.02, side * bodyW * 0.22);
      const thigh = CreateBox(`${name}_thigh${side}`, { width: legW * 1.1, height: thighLen, depth: legW }, scene);
      thigh.material = mat(scene, legColor);
      thigh.parent = hip;
      thigh.position.y = -thighLen / 2;
      thigh.isPickable = false;
      const knee = new TransformNode(`${name}_knee${side}`, scene);
      knee.parent = hip;
      knee.position.y = -thighLen;
      const shin = CreateBox(`${name}_shin${side}`, { width: legW, height: shinLen, depth: legW * 0.95 }, scene);
      shin.material = mat(scene, dim(legColor, 0.6)); // darker "boot" read
      shin.parent = knee;
      shin.position.y = -shinLen / 2;
      shin.isPickable = false;
      return { hip, knee };
    };
    const lL = mkLeg(1);
    const lR = mkLeg(-1);
    hipL = lL.hip;
    hipR = lR.hip;
    kneeL = lL.knee;
    kneeR = lR.knee;
  }

  // feature add-ons from the catalog LookSpec
  attachFeatures(
    {
      scene,
      name,
      root,
      body,
      head,
      bodyW,
      bodyD,
      bodyH,
      bodyY,
      headSize,
      headY,
      accent: look.accent,
      mat: (h, e) => mat(scene, h, e ?? 0),
    },
    look.features,
  );

  body.isPickable = false;
  head.isPickable = false;
  return {
    root,
    body,
    head,
    bodyMat,
    armL: aL.shoulder,
    armR: aR.shoulder,
    hipL,
    hipR,
    torso,
    neck,
    elbowL: aL.elbow,
    elbowR: aR.elbow,
    kneeL,
    kneeR,
    handL: aL.hand,
    handR: aR.hand,
    baseY: 0,
    dispose() {
      bodyMat.dispose();
      root.dispose(false, true); // disposes all child meshes
    },
  };
}

export function lookOfZombie(def: ZombieDef): HumanoidLook {
  return {
    skin: def.look.skin,
    accent: def.look.accent,
    eyes: def.look.eyes,
    archetype: def.look.body,
    scale: def.scale,
    crawler: def.movement === "crawler",
    features: def.look.features,
  };
}

// --- pose application (animation plan WS1) -----------------------------------

interface V3Like {
  x: number;
  y: number;
  z: number;
}

interface NodeLike {
  rotation: V3Like;
  scaling: V3Like;
  position: V3Like;
}

/** Structural rig slice so headless tests drive applyPose with plain objects.
 *  TransformNodes satisfy it; v3 joints are optional until WS2 adds them. */
export interface PoseRig {
  root: NodeLike;
  armL: NodeLike;
  armR: NodeLike;
  hipL?: NodeLike | null;
  hipR?: NodeLike | null;
  torso?: NodeLike | null;
  neck?: NodeLike | null;
  elbowL?: NodeLike | null;
  elbowR?: NodeLike | null;
  kneeL?: NodeLike | null;
  kneeR?: NodeLike | null;
}

/**
 * Write a composed Pose onto rig transforms. Channel conventions (model faces
 * +X; positive rotation.z raises a +X limb):
 *   yawOffset → root yaw added to -facing (locomotion passes -sway: 2D parity)
 *   roll → root.rotation.z · pitch (fwd lean, +down) → torso.rotation.z = -pitch
 *   armX.swingY → shoulder rotation.y · armX.liftZ → shoulder rotation.z (+ = raise)
 *   elbowX (+ = curl inward) → elbow rotation.y (mirrored R)
 *   hipX → hip rotation.z (direct) · kneeX (+ = bend back) → knee rotation.z = -knee
 *   headPitch (+ = nod down) → neck rotation.z = -headPitch · headYaw → neck rotation.y
 *   rootY/rootX → position offsets — MUST be applied after the view sets
 *   root.position from the sim (the view re-sets it every frame, so adding here
 *   never accumulates).
 */
export function applyPose(rig: PoseRig, pose: Readonly<Pose>, facing: number): void {
  rig.root.rotation.y = -facing + pose.yawOffset;
  rig.root.rotation.z = pose.roll;
  rig.root.scaling.y = pose.scaleY;
  if (pose.rootY !== 0) rig.root.position.y += pose.rootY;
  if (pose.rootX !== 0) {
    rig.root.position.x += Math.cos(facing) * pose.rootX;
    rig.root.position.z += Math.sin(facing) * pose.rootX;
  }
  rig.armL.rotation.y = pose.armL.swingY;
  rig.armL.rotation.z = pose.armL.liftZ;
  rig.armR.rotation.y = pose.armR.swingY;
  rig.armR.rotation.z = pose.armR.liftZ;
  if (rig.hipL) rig.hipL.rotation.z = pose.hipL;
  if (rig.hipR) rig.hipR.rotation.z = pose.hipR;
  if (rig.torso) {
    rig.torso.rotation.z = -pose.pitch;
    rig.torso.rotation.y = pose.torsoTwist;
  }
  if (rig.neck) {
    rig.neck.rotation.z = -pose.headPitch;
    rig.neck.rotation.y = pose.headYaw;
  }
  if (rig.elbowL) rig.elbowL.rotation.y = pose.elbowL;
  if (rig.elbowR) rig.elbowR.rotation.y = -pose.elbowR;
  if (rig.kneeL) rig.kneeL.rotation.z = -pose.kneeL;
  if (rig.kneeR) rig.kneeR.rotation.z = -pose.kneeR;
}

const scratchPose: Pose = newPose();

/** Fill a Pose with the v2 walk math (sway/bob/counter-swing) — the cheap
 *  far-LOD locomotion and the wrapper body below. Exported for tests. */
export function fillBasicWalkPose(
  pose: Pose,
  phaseRad: number,
  moving: boolean,
  sway: number,
  bob: number,
  armSwing: number,
): Pose {
  pose.yawOffset = -sway;
  pose.roll = sway * 0.6;
  pose.scaleY = 1 + bob;
  const swing = moving ? Math.sin(phaseRad) * armSwing : 0;
  pose.armL.swingY = swing;
  pose.armR.swingY = -swing;
  pose.armL.liftZ = -0.08 + (moving ? Math.cos(phaseRad) * 0.06 : 0); // slight reach droop
  pose.armR.liftZ = -0.08 - (moving ? Math.cos(phaseRad) * 0.06 : 0);
  const step = moving ? Math.sin(phaseRad) * Math.min(0.55, armSwing * 0.8) : 0;
  pose.hipL = -step;
  pose.hipR = step;
  return pose;
}

/** Per-frame humanoid pose: facing yaw + sway + bob + counter-swinging limbs.
 *  Now a thin wrapper over the Pose pipeline (bit-parity with the v2 math —
 *  asserted in tests); kept permanently as the far-LOD path (plan D9). */
export function poseHumanoid(
  rig: HumanoidRig,
  facing: number,
  phaseRad: number,
  moving: boolean,
  sway: number,
  bob: number,
  armSwing: number,
): void {
  const p = resetPose(scratchPose);
  fillBasicWalkPose(p, phaseRad, moving, sway, bob, armSwing);
  applyPose(rig, p, facing);
}

/** Repose a rig as a fallen corpse: rolled flat, sunk to the ground. The
 *  death tweens (WS6) end EXACTLY on these channel values — keep in sync with
 *  anim/deathTweens.ts DEATH_END. */
export function poseCorpse(rig: HumanoidRig, xM: number, yM: number, zM: number, side: 1 | -1, yaw: number): void {
  rig.root.rotation.set(0, yaw, (side * Math.PI) / 2);
  rig.root.scaling.y = 1;
  rig.root.position.set(xM, yM + 0.16, zM);
  rig.armL.rotation.set(0, 0.5, 0);
  rig.armR.rotation.set(0, -0.4, 0);
  if (rig.hipL) rig.hipL.rotation.set(0, 0, 0.25);
  if (rig.hipR) rig.hipR.rotation.set(0, 0, -0.2);
  // v3 joints rest at zero so the sprawl reads clean
  rig.torso.rotation.set(0, 0, 0);
  rig.neck.rotation.set(0, 0, 0);
  rig.elbowL.rotation.set(0, 0.3, 0);
  rig.elbowR.rotation.set(0, -0.25, 0);
  if (rig.kneeL) rig.kneeL.rotation.set(0, 0, -0.2);
  if (rig.kneeR) rig.kneeR.rotation.set(0, 0, -0.15);
  rig.bodyMat.emissiveColor.set(0, 0, 0);
}

export interface QuadRig {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  /** Leg pivots: [frontL, frontR, hindL, hindR] (animation plan WS2). */
  legs: TransformNode[];
  neck: TransformNode;
  tail: TransformNode;
  dispose(): void;
}

/** Small quadruped blockout (rabbit/deer/boar + ground pets), facing +X —
 *  v2 with hip-height leg pivots, a neck node and a tail wag node. */
export function buildQuadruped(scene: Scene, name: string, color: number, scale: number, accent?: number): QuadRig {
  const root = new TransformNode(name, scene);
  const L = 0.7 * scale + 0.2;
  const H = 0.32 * scale + 0.12;
  const legLen = 0.14 + H * 0.2;
  const bodyY = legLen + H / 2 - 0.02;
  const body = CreateBox(`${name}_body`, { width: L, height: H, depth: L * 0.45 }, scene);
  body.material = mat(scene, color);
  body.parent = root;
  body.position.y = bodyY;

  const neck = new TransformNode(`${name}_neck`, scene);
  neck.parent = root;
  neck.position.set(L * 0.42, bodyY + H * 0.3, 0);
  const head = CreateBox(`${name}_head`, { size: H * 0.8 }, scene);
  head.material = mat(scene, accent ?? color);
  head.parent = neck;
  head.position.set(L * 0.16, H * 0.22, 0);

  const legs: TransformNode[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new TransformNode(`${name}_legp${i}`, scene);
    pivot.parent = root;
    pivot.position.set((i < 2 ? 1 : -1) * L * 0.32, legLen + 0.02, (i % 2 ? 1 : -1) * L * 0.18);
    const leg = CreateBox(`${name}_leg${i}`, { width: 0.07, height: legLen + 0.04, depth: 0.07 }, scene);
    leg.material = mat(scene, dim(color, 0.78));
    leg.parent = pivot;
    leg.position.y = -(legLen + 0.04) / 2;
    leg.isPickable = false;
    legs.push(pivot);
  }

  const tail = new TransformNode(`${name}_tail`, scene);
  tail.parent = root;
  tail.position.set(-L * 0.5, bodyY + H * 0.25, 0);
  const tailMesh = CreateBox(`${name}_tailm`, { width: L * 0.22, height: 0.05, depth: 0.05 }, scene);
  tailMesh.material = mat(scene, dim(color, 0.85));
  tailMesh.parent = tail;
  tailMesh.position.x = -L * 0.11;
  tailMesh.isPickable = false;

  body.isPickable = false;
  head.isPickable = false;
  return {
    root,
    body,
    head,
    legs,
    neck,
    tail,
    dispose() {
      root.dispose(false, true);
    },
  };
}

/** Write a Pose onto a quadruped (channel mapping: armL/armR = front legs,
 *  hipL/hipR = hind legs, headPitch/Yaw = neck, torsoTwist = tail wag). */
export function applyQuadPose(rig: QuadRig, pose: Readonly<Pose>, facing: number): void {
  rig.root.rotation.y = -facing + pose.yawOffset;
  rig.root.rotation.z = pose.roll;
  rig.root.scaling.y = pose.scaleY;
  if (pose.rootY !== 0) rig.root.position.y += pose.rootY;
  if (pose.rootX !== 0) {
    rig.root.position.x += Math.cos(facing) * pose.rootX;
    rig.root.position.z += Math.sin(facing) * pose.rootX;
  }
  rig.legs[0].rotation.z = pose.armL.swingY;
  rig.legs[1].rotation.z = pose.armR.swingY;
  rig.legs[2].rotation.z = pose.hipL;
  rig.legs[3].rotation.z = pose.hipR;
  rig.neck.rotation.z = -pose.headPitch;
  rig.neck.rotation.y = pose.headYaw;
  rig.tail.rotation.y = pose.torsoTwist;
}
