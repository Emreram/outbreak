// Weather FX (3D master plan §3.10, CPU tier): a recycled pool of streak
// quads raining inside a camera-following volume — rain 140 streaks, storm
// 220 + wind shear. Fog weather is handled by TimeOfDayDirector's density
// boost; this layer adds the visible precipitation. (GPU particles are the
// M7 high-tier upgrade; this is the always-works floor.)

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { isWet } from "../../game/weather";

const POOL = 220;
const VOL_XZ = 34; // meters around the camera target
const VOL_Y = 16;

export class WeatherFx {
  private readonly drops: { mesh: Mesh; vy: number; vx: number }[] = [];
  private active = 0;

  constructor(scene: Scene) {
    const mat = new StandardMaterial("rainMat", scene);
    mat.emissiveColor = Color3.FromHexString("#9fc8e0");
    mat.disableLighting = true;
    mat.alpha = 0.42;
    for (let i = 0; i < POOL; i++) {
      const mesh = CreateBox(`rain${i}`, { width: 0.012, height: 0.5, depth: 0.012 }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.drops.push({ mesh, vy: 0, vx: 0 });
    }
  }

  update(weather: string | undefined, cx: number, cz: number, dtMs: number): void {
    const storm = weather === "storm";
    const want = isWet(weather) ? (storm ? POOL : 140) : 0;
    if (want !== this.active) {
      for (let i = 0; i < POOL; i++) this.drops[i].mesh.setEnabled(i < want);
      for (let i = this.active; i < want; i++) this.respawn(this.drops[i], cx, cz, true);
      this.active = want;
    }
    if (this.active === 0) return;
    const dt = Math.min(0.05, dtMs / 1000);
    for (let i = 0; i < this.active; i++) {
      const d = this.drops[i];
      d.mesh.position.y -= d.vy * dt;
      d.mesh.position.x += d.vx * dt;
      if (d.mesh.position.y < 0) this.respawn(d, cx, cz, false);
      // keep the volume centred on the camera as the player moves
      if (Math.abs(d.mesh.position.x - cx) > VOL_XZ || Math.abs(d.mesh.position.z - cz) > VOL_XZ) {
        this.respawn(d, cx, cz, true);
      }
      d.mesh.rotation.z = -d.vx * 0.04;
    }
  }

  private respawn(d: { mesh: Mesh; vy: number; vx: number }, cx: number, cz: number, anyHeight: boolean): void {
    d.mesh.position.set(
      cx + (Math.random() - 0.5) * VOL_XZ * 2,
      anyHeight ? Math.random() * VOL_Y : VOL_Y,
      cz + (Math.random() - 0.5) * VOL_XZ * 2,
    );
    d.vy = 13 + Math.random() * 5;
    d.vx = d.vy * 0.12 * (this.active > 150 ? 2.2 : 0.6); // storm shear
  }
}
