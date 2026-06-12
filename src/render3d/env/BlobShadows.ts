// Blob shadows (graphics plan WS4 / master plan §3.8 Low tier): one disc mesh
// with thin instances written per frame under the player + enemies + animals
// at groundHeightAt + 2cm, scaled by body width. The grounding read when the
// CSM generator is skipped (software rasterizers / mobile). Also the future
// ground-reference under flying mounts.

import "@babylonjs/core/Meshes/thinInstanceMesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Sim } from "../../sim/Sim";
import type { HostilesSystem } from "../../sim/systems/hostiles";
import { groundHeightAt, simToWorld } from "../space";

const CAP = 72;

export class BlobShadows {
  private readonly mesh: Mesh;
  private readonly buf = new Float32Array(CAP * 16);
  private readonly m = new Matrix();
  private readonly q = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly tmp = { x: 0, y: 0, z: 0 };

  constructor(scene: Scene) {
    this.mesh = CreateDisc("blobShadow", { radius: 0.5, tessellation: 14 }, scene);
    const mat = new StandardMaterial("blobShadowMat", scene);
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = Color3.FromHexString("#05080c");
    mat.disableLighting = true;
    mat.alpha = 0.34;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.thinInstanceSetBuffer("matrix", this.buf, 16, false);
    this.mesh.thinInstanceCount = 0;
  }

  update(sim: Sim, hostiles: HostilesSystem, alpha: number): void {
    let n = 0;
    const write = (xPx: number, yPx: number, scale: number): void => {
      if (n >= CAP) return;
      simToWorld(xPx, yPx, groundHeightAt(xPx, yPx) + 0.02, this.tmp);
      this.p.set(this.tmp.x, this.tmp.y, this.tmp.z);
      this.s.set(scale, scale, scale);
      Matrix.ComposeToRef(this.s, this.q, this.p, this.m);
      this.m.copyToArray(this.buf, n * 16);
      n++;
    };
    write(sim.player.x, sim.player.y, 0.85);
    for (const e of hostiles.enemies) {
      write(e.prevX + (e.x - e.prevX) * alpha, e.prevY + (e.y - e.prevY) * alpha, 0.55 + e.def.scale * 0.45);
    }
    for (const a of hostiles.animals) {
      write(a.prevX + (a.x - a.prevX) * alpha, a.prevY + (a.y - a.prevY) * alpha, 0.4 + a.def.scale * 0.35);
    }
    this.mesh.thinInstanceCount = n;
    if (n > 0) this.mesh.thinInstanceBufferUpdated("matrix");
  }
}
