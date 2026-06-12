// Weapon-in-hand blockouts (animation plan WS4): one tiny box assembly per
// weapon FAMILY, attached to the rig's hand socket and swapped when the
// equipped item changes. Families are total over the 21 WeaponClass values.
// Meshes extend along +X from the socket (the hand points forward).

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponClass } from "../../game/items/types";

export type WeaponFamily = "none" | "blade" | "axe" | "blunt" | "spear" | "pistol" | "long" | "shotgun" | "bow" | "launcher";

const FAMILY: Record<WeaponClass, WeaponFamily> = {
  fist: "none",
  thrown: "none",
  blade: "blade",
  whip: "blade",
  axe: "axe",
  blunt: "blunt",
  spear: "spear",
  polearm: "spear",
  pistol: "pistol",
  revolver: "pistol",
  smg: "long",
  shotgun: "shotgun",
  rifle: "long",
  dmr: "long",
  lmg: "long",
  nailgun: "long",
  energy: "long",
  flame: "long",
  bow: "bow",
  crossbow: "bow",
  launcher: "launcher",
};

export function weaponFamilyFor(wclass: WeaponClass): WeaponFamily {
  return FAMILY[wclass] ?? "none";
}

const STEEL = 0x9aa3ad;
const WOOD = 0x6e5230;
const GUNMETAL = 0x2b2e33;
const DARKWOOD = 0x4a3a26;

const matCache = new Map<number, StandardMaterial>();
function mat(scene: Scene, hex: number): StandardMaterial {
  let m = matCache.get(hex);
  if (!m || m.getScene() !== scene) {
    m = new StandardMaterial(`wpn_${hex.toString(16)}`, scene);
    m.diffuseColor = Color3.FromHexString(`#${(hex & 0xffffff).toString(16).padStart(6, "0")}`);
    m.specularColor = Color3.Black();
    matCache.set(hex, m);
  }
  return m;
}

export interface WeaponNode {
  root: TransformNode;
  dispose(): void;
}

/** Build the family's blockout under a fresh TransformNode (origin = grip). */
export function buildWeapon(scene: Scene, family: WeaponFamily): WeaponNode | null {
  if (family === "none") return null;
  const root = new TransformNode(`weapon_${family}`, scene);
  const box = (w: number, h: number, d: number, hex: number, x: number, y = 0, z = 0): void => {
    const m = CreateBox(`${root.name}_p${root.getChildren().length}`, { width: w, height: h, depth: d }, scene);
    m.material = mat(scene, hex);
    m.parent = root;
    m.position.set(x, y, z);
    m.isPickable = false;
  };
  switch (family) {
    case "blade":
      box(0.08, 0.05, 0.05, DARKWOOD, 0.02); // grip
      box(0.04, 0.04, 0.16, STEEL, 0.08); // cross guard
      box(0.5, 0.025, 0.07, STEEL, 0.34); // blade
      break;
    case "axe":
      box(0.55, 0.04, 0.04, WOOD, 0.24); // haft
      box(0.12, 0.18, 0.04, STEEL, 0.48, 0.04); // head slab
      break;
    case "blunt":
      box(0.5, 0.05, 0.05, WOOD, 0.22); // bat
      box(0.12, 0.08, 0.08, DARKWOOD, 0.46); // tip
      break;
    case "spear":
      box(0.85, 0.035, 0.035, WOOD, 0.38); // shaft
      box(0.14, 0.05, 0.02, STEEL, 0.85); // point
      break;
    case "pistol":
      box(0.2, 0.05, 0.04, GUNMETAL, 0.1, 0.02); // slide
      box(0.05, 0.12, 0.035, GUNMETAL, 0.02, -0.05); // grip (the L)
      break;
    case "long":
      box(0.55, 0.05, 0.04, GUNMETAL, 0.3, 0.02); // barrel/receiver
      box(0.16, 0.09, 0.045, DARKWOOD, 0.0, -0.02); // stock
      box(0.05, 0.1, 0.035, GUNMETAL, 0.16, -0.05); // grip
      break;
    case "shotgun":
      box(0.5, 0.07, 0.06, GUNMETAL, 0.28, 0.02); // fat barrel
      box(0.18, 0.09, 0.05, WOOD, 0.0, -0.02); // stock
      box(0.16, 0.045, 0.05, WOOD, 0.3, -0.04); // pump
      break;
    case "bow":
      box(0.05, 0.34, 0.04, DARKWOOD, 0.06, 0.21, 0); // upper limb
      box(0.05, 0.34, 0.04, DARKWOOD, 0.06, -0.21, 0); // lower limb
      box(0.06, 0.12, 0.05, WOOD, 0.04); // riser
      box(0.005, 0.74, 0.005, 0xd8d2c4, 0.1); // string
      break;
    case "launcher":
      box(0.6, 0.09, 0.09, GUNMETAL, 0.26, 0.03); // tube
      box(0.06, 0.1, 0.04, DARKWOOD, 0.1, -0.05); // grip
      break;
  }
  return {
    root,
    dispose() {
      root.dispose(false, true);
    },
  };
}
