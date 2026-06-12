// Combat FX (3D master plan §3.2 fx/): pooled, CPU-animated one-shots driven
// purely by sim events — swing arcs per melee style (slash/thrust/smash with
// the 220/160/310ms fades), muzzle flashes with a pooled light blip, brass
// casings with the eject-arc-settle (ballistic classes only — emitted by the
// sim), blood sprays + gibs coloured by each enemy's BloodProfile (the gore
// identity), electric zap beams, screamer rings, explosion flashes. Caps keep
// totals bounded (≤40 splat quads live, 24 casings, 12 gibs).

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Sim } from "../../sim/Sim";
import type { HostilesSystem } from "../../sim/systems/hostiles";
import { bloodProfileFor } from "../../game/enemies/blood";
import { groundHeightAt, simToWorld } from "../space";
import type { FxTextures } from "./FxTextures";

interface Particle {
  mesh: Mesh;
  vx: number;
  vy: number; // vertical m/s
  vz: number;
  born: number;
  life: number;
  live: boolean;
  settleY: number;
}

interface Flash {
  mesh: Mesh;
  born: number;
  life: number;
  grow: number;
  live: boolean;
  /** False when the material is a shared FxTextures cache entry. */
  ownsMat: boolean;
}

function unlitMat(scene: Scene, color: string, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(`fx_${color}_${alpha}`, scene);
  m.emissiveColor = Color3.FromHexString(color);
  m.disableLighting = true;
  m.alpha = alpha;
  m.specularColor = Color3.Black();
  return m;
}

export class CombatFx {
  private readonly sprays: Particle[] = [];
  private readonly casings: Particle[] = [];
  private readonly gibs: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private readonly bloodMats = new Map<number, StandardMaterial>();
  private readonly brassMat: StandardMaterial;
  private readonly dustMat: StandardMaterial;
  private readonly muzzleLight: PointLight;
  private muzzleOffAt = 0;
  private readonly tmp = new Vector3();

  constructor(
    private readonly scene: Scene,
    sim: Sim,
    hostiles: HostilesSystem,
    private readonly fxTex?: FxTextures,
  ) {
    this.brassMat = unlitMat(scene, "#b8923a");
    this.dustMat = unlitMat(scene, "#8a7f6a", 0.55);
    this.muzzleLight = new PointLight("muzzle", new Vector3(0, -10, 0), scene);
    this.muzzleLight.diffuse = Color3.FromHexString("#ffe08a");
    this.muzzleLight.intensity = 0;
    this.muzzleLight.range = 9;

    const bloodMat = (enemyId?: number): StandardMaterial => {
      const e = enemyId !== undefined ? hostiles.enemies.find((x) => x.id === enemyId) : undefined;
      const hexNum = e ? bloodProfileFor(e.def).spray : 0xcc2222;
      let m = this.bloodMats.get(hexNum);
      if (!m) {
        m = unlitMat(scene, `#${(hexNum & 0xffffff).toString(16).padStart(6, "0")}`);
        this.bloodMats.set(hexNum, m);
      }
      return m;
    };

    sim.events.on("splat", ({ x, y, dirX, dirY, power, enemyId }) => {
      const m = bloodMat(enemyId);
      const n = Math.min(8, Math.ceil(5 * power));
      for (let i = 0; i < n; i++) {
        const p = this.alloc(this.sprays, 40, 0.05, m);
        const wp = simToWorld(x, y, 0.7 + groundHeightAt(x, y), this.tmp);
        p.mesh.position.set(wp.x, wp.y, wp.z);
        const baseA = dirX !== undefined && dirY !== undefined ? Math.atan2(dirY, dirX) : Math.random() * Math.PI * 2;
        const a = baseA + (Math.random() - 0.5) * 1.4; // ±40°
        const sp = (1.5 + Math.random() * 4.5) * (0.85 + power * 0.35);
        p.vx = Math.cos(a) * sp;
        p.vz = Math.sin(a) * sp;
        p.vy = 1.2 + Math.random() * 1.6;
        p.life = 260 + Math.random() * 440;
        p.born = performance.now();
        p.settleY = 0.02 + groundHeightAt(x, y);
        p.live = true;
      }
    });

    sim.events.on("gibs", ({ x, y, enemyId }) => {
      const m = bloodMat(enemyId);
      for (let i = 0; i < 4; i++) {
        const p = this.alloc(this.gibs, 12, 0.1, m);
        const wp = simToWorld(x, y, 0.5, this.tmp);
        p.mesh.position.set(wp.x, wp.y, wp.z);
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 3;
        p.vx = Math.cos(a) * sp;
        p.vz = Math.sin(a) * sp;
        p.vy = 2 + Math.random() * 2;
        p.life = 900;
        p.born = performance.now();
        p.settleY = 0.05;
        p.live = true;
      }
    });

    sim.events.on("casing", ({ x, y, angle }) => {
      const p = this.alloc(this.casings, 24, 0.035, this.brassMat);
      const wp = simToWorld(x, y, 0.9, this.tmp);
      p.mesh.position.set(wp.x, wp.y, wp.z);
      const side = angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5));
      const sp = 0.5 + Math.random() * 0.4;
      p.vx = Math.cos(side) * sp;
      p.vz = Math.sin(side) * sp;
      p.vy = 1.6 + Math.random() * 0.8;
      p.life = 4000; // settles, lingers, fades
      p.born = performance.now();
      p.settleY = 0.03;
      p.live = true;
    });

    sim.events.on("muzzle", ({ x, y, angle }) => {
      const wp = simToWorld(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20, 0.95, this.tmp);
      this.muzzleLight.position.set(wp.x, wp.y + 0.3, wp.z);
      this.muzzleLight.intensity = 18;
      this.muzzleOffAt = performance.now() + 90;
      const f = this.flash("#ffe08a", 0.5, 90, 1.6, false, undefined, this.fxTex?.additive("soft", "#ffe08a", 0.7));
      f.mesh.position.set(wp.x, wp.y, wp.z);
    });

    sim.events.on("swing", ({ x, y, facing, style }) => {
      const life = style === "smash" ? 310 : style === "thrust" ? 160 : 220;
      const color = style === "smash" ? "#d8cfc0" : "#cfe8ff";
      const f = this.flash(color, 1, life, style === "slash" ? 1.35 : 1.15, true);
      const wp = simToWorld(x + Math.cos(facing) * 24, y + Math.sin(facing) * 24, 0.75, this.tmp);
      f.mesh.position.set(wp.x, wp.y, wp.z);
      f.mesh.rotation.set(Math.PI / 2, -facing + (style === "thrust" ? 0 : Math.PI / 2), 0);
      f.mesh.scaling.setAll(style === "thrust" ? 0.5 : 1);
      if (style === "thrust") f.mesh.scaling.x = 2.2; // a lance, not a fan
    });

    sim.events.on("zap", ({ x0, y0, x1, y1 }) => {
      const a = simToWorld(x0, y0, 0.9);
      const b = simToWorld(x1, y1, 0.9);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const f = this.flash("#9be7ff", 0.9, 160, 1, true, CreateBox(`zap${performance.now()}`, { width: len, height: 0.05, depth: 0.05 }, this.scene));
      f.mesh.position.set((a.x + b.x) / 2, 0.9, (a.z + b.z) / 2);
      f.mesh.rotation.y = -Math.atan2(dz, dx);
    });

    sim.events.on("screamRing", ({ x, y }) => {
      const ring = CreateTorus(`ring${performance.now()}`, { diameter: 1, thickness: 0.06, tessellation: 24 }, this.scene);
      const f = this.flash("#ff8aa0", 0.7, 500, 6, true, ring);
      const wp = simToWorld(x, y, 0.5, this.tmp);
      f.mesh.position.set(wp.x, wp.y, wp.z);
    });

    sim.events.on("explosion", ({ x, y, radius }) => {
      const f = this.flash("#ffa23f", 0.85, 220, 2.5, false, undefined, this.fxTex?.additive("glow", "#ffa23f", 0.85));
      const wp = simToWorld(x, y, 0.6, this.tmp);
      f.mesh.position.set(wp.x, wp.y, wp.z);
      f.mesh.scaling.setAll(Math.max(1, (radius / 32) * 0.8));
    });

    sim.events.on("toxicCloud", ({ x, y }) => {
      const f = this.flash("#8fd14a", 0.18, 4000, 1.3, false, undefined, this.fxTex?.additive("soft", "#8fd14a", 0.2));
      const wp = simToWorld(x, y, 0.6, this.tmp);
      f.mesh.position.set(wp.x, wp.y, wp.z);
      f.mesh.scaling.setAll(2.4);
    });
  }

  /** Gold spark burst — chest-open flourish (animation plan WS8). */
  sparks(xPx: number, yPx: number, n = 8): void {
    for (let i = 0; i < n; i++) {
      const p = this.alloc(this.sprays, 40, 0.045, this.brassMat);
      const wp = simToWorld(xPx, yPx, 0.45 + groundHeightAt(xPx, yPx), this.tmp);
      p.mesh.position.set(wp.x, wp.y, wp.z);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 0.9;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 1.4 + Math.random() * 1.2;
      p.life = 380 + Math.random() * 180;
      p.born = performance.now();
      p.settleY = 0.03 + groundHeightAt(xPx, yPx);
      p.live = true;
    }
  }

  /** Footstep/landing dust puff at a sim position (animation plan WS3). */
  dust(xPx: number, yPx: number, n = 2): void {
    for (let i = 0; i < n; i++) {
      const p = this.alloc(this.sprays, 40, 0.05, this.dustMat);
      const wp = simToWorld(xPx, yPx, 0.06 + groundHeightAt(xPx, yPx), this.tmp);
      p.mesh.position.set(wp.x, wp.y, wp.z);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.3 + Math.random() * 0.5;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 0.5 + Math.random() * 0.5;
      p.life = 280 + Math.random() * 140;
      p.born = performance.now();
      p.settleY = 0.02 + groundHeightAt(xPx, yPx);
      p.live = true;
    }
  }

  private alloc(pool: Particle[], cap: number, size: number, m: StandardMaterial): Particle {
    let p = pool.find((q) => !q.live);
    if (!p && pool.length < cap) {
      const mesh = CreateBox(`fxp${pool.length}_${size}`, { size }, this.scene);
      mesh.isPickable = false;
      p = { mesh, vx: 0, vy: 0, vz: 0, born: 0, life: 0, live: false, settleY: 0.02 };
      pool.push(p);
    }
    if (!p) p = pool[0];
    p.mesh.material = m;
    p.mesh.setEnabled(true);
    return p;
  }

  private flash(
    color: string,
    alpha: number,
    life: number,
    grow: number,
    keepMesh = false,
    mesh?: Mesh,
    sharedMat?: StandardMaterial,
  ): Flash {
    const m = mesh ?? CreateDisc(`flash${performance.now()}_${Math.random()}`, { radius: 0.5, tessellation: 18 }, this.scene);
    if (!mesh) m.rotation.x = Math.PI / 2;
    m.material = sharedMat ?? unlitMat(this.scene, color, alpha);
    m.isPickable = false;
    m.visibility = 1;
    const f: Flash = { mesh: m, born: performance.now(), life, grow, live: true, ownsMat: !sharedMat };
    this.flashes.push(f);
    void keepMesh;
    return f;
  }

  update(): void {
    const now = performance.now();
    if (this.muzzleLight.intensity > 0 && now >= this.muzzleOffAt) this.muzzleLight.intensity = 0;

    for (const pool of [this.sprays, this.gibs, this.casings]) {
      for (const p of pool) {
        if (!p.live) continue;
        const age = now - p.born;
        if (age > p.life) {
          p.live = false;
          p.mesh.setEnabled(false);
          continue;
        }
        const dt = 1 / 60;
        if (p.mesh.position.y > p.settleY) {
          p.vy -= 9.8 * dt;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y = Math.max(p.settleY, p.mesh.position.y + p.vy * dt);
          p.mesh.position.z += p.vz * dt;
          p.mesh.rotation.x += 0.2;
          p.mesh.rotation.z += 0.17;
        }
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const t = (now - f.born) / f.life;
      if (t >= 1) {
        if (f.ownsMat) f.mesh.material?.dispose(); // shared FxTextures mats stay cached
        f.mesh.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      // per-mesh fade (visibility) so shared materials never mutate
      f.mesh.visibility *= 0.93;
      f.mesh.scaling.x = f.mesh.scaling.x * (1 + (f.grow - 1) * 0.02);
      f.mesh.scaling.y = f.mesh.scaling.y * (1 + (f.grow - 1) * 0.02);
      f.mesh.scaling.z = f.mesh.scaling.z * (1 + (f.grow - 1) * 0.02);
    }
  }
}
