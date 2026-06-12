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

/** Build a humanoid figure facing +X (sim convention), origin at the feet. */
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

  const body = CreateBox(`${name}_body`, { width: bodyD, height: bodyH, depth: bodyW }, scene);
  const bodyMat = mat(scene, look.skin).clone(`${name}_bodyMat`);
  body.material = bodyMat;
  body.parent = root;
  body.position.y = bodyY;

  // accent: a torso band (the torn-clothing accent colour)
  if (look.accent !== undefined) {
    const band = CreateBox(`${name}_band`, { width: bodyD * 1.02, height: bodyH * 0.3, depth: bodyW * 1.02 }, scene);
    band.material = mat(scene, look.accent);
    band.parent = body;
    band.position.y = -bodyH * 0.18;
    band.isPickable = false;
  }

  const headSize = headR * s * 2.4;
  const headY = crawler ? bodyH + 0.12 : bodyY + bodyH / 2 + headSize / 2 - 0.02;
  const head = CreateBox(`${name}_head`, { size: headSize }, scene);
  head.material = mat(scene, look.headColor ?? look.skin);
  head.parent = root;
  head.position.y = headY;
  head.position.x = crawler ? bodyD * 0.5 : bodyD * 0.15;

  // emissive eye strip on the face (+x) — reads at 20m, replaces head glow
  const eyeColor = look.eyes && look.eyes !== 0x140d0d ? look.eyes : 0;
  if (eyeColor) {
    const eyes = CreateBox(`${name}_eyes`, { width: 0.02, height: headSize * 0.16, depth: headSize * 0.62 }, scene);
    eyes.material = mat(scene, eyeColor, eyeColor);
    eyes.parent = head;
    eyes.position.set(headSize * 0.51, headSize * 0.08, 0);
    eyes.isPickable = false;
  }

  // arms on shoulder pivots (swing from the shoulder, not the centre)
  const armW = 0.09 * sc + 0.03;
  const armL3 = armLen * s * 1.7;
  const shoulderY = crawler ? bodyH * 0.6 : bodyY + bodyH * 0.36;
  const mkArm = (side: 1 | -1): TransformNode => {
    const pivot = new TransformNode(`${name}_sh${side}`, scene);
    pivot.parent = root;
    pivot.position.set(bodyD * 0.3, shoulderY, side * bodyW * 0.45);
    const arm = CreateBox(`${name}_arm${side}`, { width: armL3, height: armW, depth: armW }, scene);
    arm.material = mat(scene, look.skin);
    arm.parent = pivot;
    arm.position.x = armL3 / 2;
    arm.isPickable = false;
    return pivot;
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);

  // legs on hip pivots (crawlers drag — no legs)
  let hipL: TransformNode | null = null;
  let hipR: TransformNode | null = null;
  if (!crawler) {
    const legW = Math.max(0.07, bodyW * 0.26);
    const mkLeg = (side: 1 | -1): TransformNode => {
      const hip = new TransformNode(`${name}_hip${side}`, scene);
      hip.parent = root;
      hip.position.set(0, legH + 0.02, side * bodyW * 0.22);
      const leg = CreateBox(`${name}_leg${side}`, { width: legW * 1.1, height: legH + 0.04, depth: legW }, scene);
      leg.material = mat(scene, look.accent !== undefined ? look.accent : look.skin);
      leg.parent = hip;
      leg.position.y = -(legH + 0.04) / 2;
      leg.isPickable = false;
      return hip;
    };
    hipL = mkLeg(1);
    hipR = mkLeg(-1);
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
    armL,
    armR,
    hipL,
    hipR,
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

/** Per-frame humanoid pose: facing yaw + sway + bob + counter-swinging limbs.
 *  The 2D-parity math is unchanged — only the pivots moved to joints. */
export function poseHumanoid(
  rig: HumanoidRig,
  facing: number,
  phaseRad: number,
  moving: boolean,
  sway: number,
  bob: number,
  armSwing: number,
): void {
  // 2D parity: the sprite's rotation = facing + sway (a yaw wobble); 3D adds a
  // half-amplitude roll so the shamble reads as body lean, not twist.
  rig.root.rotation.y = -(facing + sway);
  rig.root.rotation.z = sway * 0.6;
  rig.root.scaling.y = 1 + bob;
  const swing = moving ? Math.sin(phaseRad) * armSwing : 0;
  rig.armL.rotation.y = swing;
  rig.armR.rotation.y = -swing;
  rig.armL.rotation.z = -0.08 + (moving ? Math.cos(phaseRad) * 0.06 : 0); // slight reach droop
  rig.armR.rotation.z = -0.08 - (moving ? Math.cos(phaseRad) * 0.06 : 0);
  if (rig.hipL && rig.hipR) {
    const step = moving ? Math.sin(phaseRad) * Math.min(0.55, armSwing * 0.8) : 0;
    rig.hipL.rotation.z = -step;
    rig.hipR.rotation.z = step;
  }
}

/** Repose a rig as a fallen corpse (WS7): rolled flat, sunk to the ground. */
export function poseCorpse(rig: HumanoidRig, xM: number, yM: number, zM: number, side: 1 | -1, yaw: number): void {
  rig.root.rotation.set(0, yaw, (side * Math.PI) / 2);
  rig.root.scaling.y = 1;
  rig.root.position.set(xM, yM + 0.16, zM);
  rig.armL.rotation.set(0, 0.5, 0);
  rig.armR.rotation.set(0, -0.4, 0);
  if (rig.hipL) rig.hipL.rotation.set(0, 0, 0.25);
  if (rig.hipR) rig.hipR.rotation.set(0, 0, -0.2);
  rig.bodyMat.emissiveColor.set(0, 0, 0);
}

export interface QuadRig {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  dispose(): void;
}

/** Small quadruped blockout (rabbit/deer/boar + ground pets), facing +X. */
export function buildQuadruped(scene: Scene, name: string, color: number, scale: number, accent?: number): QuadRig {
  const root = new TransformNode(name, scene);
  const L = 0.7 * scale + 0.2;
  const H = 0.32 * scale + 0.12;
  const body = CreateBox(`${name}_body`, { width: L, height: H, depth: L * 0.45 }, scene);
  body.material = mat(scene, color);
  body.parent = root;
  body.position.y = H / 2 + 0.12;
  const head = CreateBox(`${name}_head`, { size: H * 0.8 }, scene);
  head.material = mat(scene, accent ?? color);
  head.parent = root;
  head.position.set(L * 0.55, H + 0.1, 0);
  for (let i = 0; i < 4; i++) {
    const leg = CreateBox(`${name}_leg${i}`, { width: 0.07, height: 0.14, depth: 0.07 }, scene);
    leg.material = mat(scene, color);
    leg.parent = root;
    leg.position.set((i < 2 ? 1 : -1) * L * 0.32, 0.07, (i % 2 ? 1 : -1) * L * 0.18);
    leg.isPickable = false;
  }
  body.isPickable = false;
  head.isPickable = false;
  return {
    root,
    body,
    head,
    dispose() {
      root.dispose(false, true);
    },
  };
}
