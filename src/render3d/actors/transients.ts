// World-object transients (animation plan WS8): the pooled chest-lid flourish.
// Opening a chest spawns a hinged lid over the prop that swings −110° open
// (transientCurves.lidAngle), holds, then fades — paired with a gold spark
// burst (CombatFx.sparks) and a 700ms warm light blip through the LightPool.
// Pure cosmetics on the performance clock (same as the decal/float pools);
// the chest PROP and its sim state are untouched.

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CombatFx } from "../fx/CombatFx";
import type { LightPool } from "../env/LightPool";
import { groundHeightAt, simToWorld } from "../space";
import { LID_OPEN_MS, lidAngle } from "../anim/transientCurves";

const LID_POOL = 6;
const LID_HOLD_MS = 500;
const LID_FADE_MS = 320;
const LID_LIFE_MS = LID_OPEN_MS + LID_HOLD_MS + LID_FADE_MS;
const BLIP_MS = 700;

interface Lid {
  pivot: TransformNode;
  mesh: Mesh;
  mat: StandardMaterial;
  born: number;
  live: boolean;
}

let blipSeq = 1;

export class Transients {
  private readonly lids: Lid[] = [];
  private readonly blips: { id: string; src: { intensity: number }; born: number }[] = [];
  private readonly tmp = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly fx: CombatFx,
  ) {}

  /** Optional warm-light hookup (main3d installs the pool). */
  lights: LightPool | null = null;

  /** Chest-open flourish at a sim position. */
  openChest(xPx: number, yPx: number): void {
    const wp = simToWorld(xPx, yPx, groundHeightAt(xPx, yPx), this.tmp);
    const lid = this.alloc();
    // hinge at the back-top edge; the lid plate extends forward from it
    lid.pivot.position.set(wp.x, wp.y + 0.42, wp.z - 0.21);
    lid.pivot.rotation.set(0, 0, 0);
    lid.mesh.position.set(0, 0.02, 0.21);
    lid.mat.alpha = 1;
    lid.born = performance.now();
    lid.live = true;
    lid.pivot.setEnabled(true);

    this.fx.sparks(xPx, yPx);
    if (this.lights) {
      const src = {
        id: `chestblip${blipSeq++}`,
        x: xPx,
        y: yPx,
        h: 0.7,
        color: 0xffd27a,
        intensity: 2.2,
        range: 6,
        flicker: 0.4,
      };
      this.lights.register(src);
      this.blips.push({ id: src.id, src, born: performance.now() });
    }
  }

  update(nowMs: number): void {
    for (const lid of this.lids) {
      if (!lid.live) continue;
      const age = nowMs - lid.born;
      if (age >= LID_LIFE_MS) {
        lid.live = false;
        lid.pivot.setEnabled(false);
        continue;
      }
      lid.pivot.rotation.x = -lidAngle(age); // −110° swings up and back
      if (age > LID_OPEN_MS + LID_HOLD_MS) lid.mat.alpha = 1 - (age - LID_OPEN_MS - LID_HOLD_MS) / LID_FADE_MS;
    }
    for (let i = this.blips.length - 1; i >= 0; i--) {
      const b = this.blips[i];
      const t = (nowMs - b.born) / BLIP_MS;
      if (t >= 1) {
        this.lights?.unregister(b.id);
        this.blips.splice(i, 1);
      } else {
        b.src.intensity = 2.2 * (1 - t); // decay read live by the pool
      }
    }
  }

  private alloc(): Lid {
    let lid = this.lids.find((l) => !l.live);
    if (!lid && this.lids.length < LID_POOL) {
      const pivot = new TransformNode(`lidp${this.lids.length}`, this.scene);
      const mesh = CreateBox(`lid${this.lids.length}`, { width: 0.46, height: 0.05, depth: 0.42 }, this.scene);
      const mat = new StandardMaterial(`lidm${this.lids.length}`, this.scene);
      mat.diffuseColor = Color3.FromHexString("#7a5a34");
      mat.emissiveColor = Color3.FromHexString("#2a1d0e"); // reads in low light
      mat.specularColor = Color3.Black();
      mesh.material = mat;
      mesh.parent = pivot;
      mesh.isPickable = false;
      lid = { pivot, mesh, mat, born: 0, live: false };
      this.lids.push(lid);
    }
    if (!lid) lid = this.lids[0];
    return lid;
  }
}
