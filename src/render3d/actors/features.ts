// LookSpec feature add-ons (graphics plan WS7 / master plan §3.6.3): the
// catalog's Feature flags (bone/blood/spikes/glow/sacs/plates/tatters/horns/
// drip) become small socketed boxes on the blockout rigs — the same data that
// drives the 2D sprites carries silhouette + identity in 3D. Palette hexes
// match zombieSprites.ts.

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export interface FeatureHost {
  scene: Scene;
  name: string;
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  bodyW: number; // depth across shoulders (z extent)
  bodyD: number; // along facing (x extent)
  bodyH: number;
  bodyY: number; // body centre height
  headSize: number;
  headY: number;
  accent?: number;
  mat: (hex: number, emissive?: number) => import("@babylonjs/core/Materials/standardMaterial").StandardMaterial;
}

function addBox(h: FeatureHost, tag: string, w: number, hgt: number, d: number, hex: number, x: number, y: number, z: number, emissive = 0): Mesh {
  const m = CreateBox(`${h.name}_${tag}`, { width: w, height: hgt, depth: d }, h.scene);
  m.material = h.mat(hex, emissive);
  m.parent = h.root;
  m.position.set(x, y, z);
  m.isPickable = false;
  return m;
}

/** Attach the def's features; returns the created meshes (disposed with root). */
export function attachFeatures(h: FeatureHost, features: readonly string[] | undefined): Mesh[] {
  if (!features || features.length === 0) return [];
  const out: Mesh[] = [];
  for (const f of features) {
    switch (f) {
      case "plates": // riot/armor plates front + back
        out.push(addBox(h, "plateF", 0.05, h.bodyH * 0.7, h.bodyW * 0.9, 0x3a4250, h.bodyD * 0.55, h.bodyY, 0));
        out.push(addBox(h, "plateB", 0.05, h.bodyH * 0.6, h.bodyW * 0.8, 0x3a4250, -h.bodyD * 0.55, h.bodyY, 0));
        break;
      case "horns":
        out.push(addBox(h, "hornL", 0.06, 0.18, 0.06, 0xe8e2d0, h.headSize * 0.1, h.headY + h.headSize * 0.55, h.headSize * 0.3));
        out.push(addBox(h, "hornR", 0.06, 0.18, 0.06, 0xe8e2d0, h.headSize * 0.1, h.headY + h.headSize * 0.55, -h.headSize * 0.3));
        break;
      case "spikes":
        for (let i = 0; i < 3; i++) {
          out.push(addBox(h, `spike${i}`, 0.07, 0.16 + (i === 1 ? 0.06 : 0), 0.07, 0xcfc6ad, -h.bodyD * 0.45, h.bodyY + h.bodyH * (0.3 - i * 0.25), 0));
        }
        break;
      case "sacs": // bloated pustules, faint toxic glow
        out.push(addBox(h, "sacL", h.bodyD * 0.4, 0.16, 0.16, 0x96dc5a, h.bodyD * 0.2, h.bodyY - h.bodyH * 0.15, h.bodyW * 0.52, 0x2c4a14));
        out.push(addBox(h, "sacR", h.bodyD * 0.35, 0.14, 0.14, 0x96dc5a, -h.bodyD * 0.1, h.bodyY + h.bodyH * 0.1, -h.bodyW * 0.52, 0x2c4a14));
        break;
      case "bone": // exposed spine ridge
        out.push(addBox(h, "spine", 0.05, h.bodyH * 0.9, 0.08, 0xd8d0b8, -h.bodyD * 0.5, h.bodyY, 0));
        break;
      case "blood": // soaked patch
        out.push(addBox(h, "gore", 0.04, h.bodyH * 0.45, h.bodyW * 0.5, 0x961414, h.bodyD * 0.52, h.bodyY - h.bodyH * 0.1, h.bodyW * 0.1));
        break;
      case "tatters": { // torn cloth flaps at the waist (accent colour)
        const c = h.accent ?? 0x4a4036;
        out.push(addBox(h, "tatL", 0.05, 0.26, h.bodyW * 0.3, c, h.bodyD * 0.3, h.bodyY - h.bodyH * 0.55, h.bodyW * 0.25));
        out.push(addBox(h, "tatR", 0.05, 0.2, h.bodyW * 0.26, c, h.bodyD * 0.1, h.bodyY - h.bodyH * 0.58, -h.bodyW * 0.3));
        break;
      }
      case "glow": // emissive chest seam
        out.push(addBox(h, "glow", 0.03, h.bodyH * 0.5, 0.07, 0x9be7ff, h.bodyD * 0.53, h.bodyY, 0, 0x4a90c8));
        break;
      case "drip": // toxic dribble under the jaw
        out.push(addBox(h, "drip", 0.05, 0.14, 0.05, 0x78c850, h.headSize * 0.4, h.headY - h.headSize * 0.55, 0, 0x1e3c0f));
        break;
      default:
        break;
    }
  }
  return out;
}
