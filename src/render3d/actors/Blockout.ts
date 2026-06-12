// Modular blockout actors (3D master plan §3.6 fallback path): capsule+box
// figures composed from the SAME LookSpec data as the 2D sprites — body
// archetype dimensions from zombieSprites' dims table, skin/accent/eye
// palettes, simple feature add-ons — animated procedurally by porting the
// anim.ts/Enemy.applySway gait math onto transforms (sway → roll, bob →
// scaleY, arm swing → the 2-frame A/B alternation). The game animates with
// zero GLB files; manifest GLBs upgrade this later without touching callers.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ZombieDef } from "../../game/enemies/types";

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
function mat(scene: Scene, color: number, emissive = 0): StandardMaterial {
  const key = `${color}|${emissive}`;
  let m = matCache.get(key);
  if (!m || m.getScene() !== scene) {
    m = new StandardMaterial(`bo_${key}`, scene);
    m.diffuseColor = Color3.FromHexString(hex(color));
    if (emissive) m.emissiveColor = Color3.FromHexString(hex(emissive)).scale(0.8);
    m.specularColor = Color3.Black();
    matCache.set(key, m);
  }
  return m;
}

export interface HumanoidRig {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  armL: Mesh;
  armR: Mesh;
  /** Standing height of the body centre (for ground placement). */
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
}

/** Build a humanoid figure facing +X (sim convention), origin at the feet. */
export function buildHumanoid(scene: Scene, name: string, look: HumanoidLook): HumanoidRig {
  const d = DIMS[look.archetype ?? "humanoid"] ?? DIMS.humanoid;
  const s = (look.scale ?? 1) * PX;
  const [bw, bh, headR, , armLen] = d;
  const crawler = look.crawler ?? look.archetype === "crawler";

  const root = new TransformNode(name, scene);
  const bodyW = bw * s * 2.0;
  const bodyD = bh * s * 1.6;
  const bodyH = crawler ? 0.5 * (look.scale ?? 1) : 1.0 * (look.scale ?? 1);
  const body = CreateBox(`${name}_body`, { width: bodyD, height: bodyH, depth: bodyW }, scene);
  body.material = mat(scene, look.skin);
  body.parent = root;
  body.position.y = crawler ? bodyH / 2 + 0.05 : bodyH / 2 + 0.3;

  // accent: a torso band (the torn-clothing accent colour)
  if (look.accent !== undefined) {
    const band = CreateBox(`${name}_band`, { width: bodyD * 1.02, height: bodyH * 0.3, depth: bodyW * 1.02 }, scene);
    band.material = mat(scene, look.accent);
    band.parent = body;
    band.position.y = -bodyH * 0.18;
  }

  const headSize = headR * s * 2.4;
  const head = CreateBox(`${name}_head`, { size: headSize }, scene);
  head.material = mat(scene, look.headColor ?? look.skin, look.eyes && look.eyes !== 0x140d0d ? look.eyes : 0);
  head.parent = root;
  head.position.y = crawler ? bodyH + 0.12 : bodyH + 0.3 + headSize / 2 - 0.02;
  head.position.x = crawler ? bodyD * 0.5 : bodyD * 0.15; // crawlers lead with the head

  const armW = 0.09 * (look.scale ?? 1) + 0.03;
  const armL3 = armLen * s * 1.7;
  const armL = CreateBox(`${name}_armL`, { width: armL3, height: armW, depth: armW }, scene);
  const armR = CreateBox(`${name}_armR`, { width: armL3, height: armW, depth: armW }, scene);
  armL.material = mat(scene, look.skin);
  armR.material = mat(scene, look.skin);
  armL.parent = root;
  armR.parent = root;
  // zombies reach forward (+x facing); pivot at the shoulder via offset
  const shoulderY = crawler ? bodyH * 0.6 : bodyH * 0.85 + 0.3;
  armL.position.set(bodyD * 0.3 + armL3 / 2, shoulderY, bodyW * 0.45);
  armR.position.set(bodyD * 0.3 + armL3 / 2, shoulderY, -bodyW * 0.45);

  for (const m of [body, head, armL, armR]) m.isPickable = false;
  return {
    root,
    body,
    head,
    armL,
    armR,
    baseY: 0,
    dispose() {
      root.dispose(false, false);
      body.dispose();
      head.dispose();
      armL.dispose();
      armR.dispose();
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
  };
}

/** Per-frame humanoid pose: facing yaw + sway roll + bob + A/B arm swing.
 *  swayAmp/freq follow Enemy.applySway (or Player.update for the survivor). */
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
  rig.root.rotation.y = -(facing + sway); // sim angle → RH yaw (model faces +X)
  rig.root.rotation.z = sway * 0.6;
  rig.root.scaling.y = 1 + bob;
  const swing = moving ? Math.sin(phaseRad) * armSwing : 0;
  rig.armL.rotation.y = swing;
  rig.armR.rotation.y = -swing;
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
