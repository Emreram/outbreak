// Atmosphere particles (graphics plan WS10 / master plan §3.10 + §6.5 phase
// signatures): four CPU pools in the WeatherFx pattern, gated by biome /
// time-of-day / weather and scaled by the tier's ambient density —
//   fireflies  night, safe rural biomes — additive blinking motes
//   leaves     forest daytime — tumbling gold-brown quads
//   mist       dawn (or fog weather) — large soft ground sheets
//   embers/ash volcanic — rising sparks + falling gray flakes

import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { FxTextures } from "../fx/FxTextures";

const FIREFLY_BIOMES = new Set(["forest", "grassland", "parkland", "lake", "riverbank", "farmland", "marsh"]);
const LEAF_BIOMES = new Set(["forest", "dense_woods", "parkland"]);

interface Mote {
  mesh: Mesh;
  x: number; // world meters (camera-relative respawn volume)
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
}

function pool(scene: Scene, name: string, n: number, size: number, mat: import("@babylonjs/core/Materials/standardMaterial").StandardMaterial, billboard = true): Mote[] {
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) {
    const mesh = CreatePlane(`${name}${i}`, { size }, scene);
    mesh.material = mat;
    if (billboard) mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    out.push({ mesh, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: Math.random() * 7 });
  }
  return out;
}

export class AmbientFx {
  private readonly fireflies: Mote[];
  private readonly leaves: Mote[];
  private readonly mist: Mote[];
  private readonly embers: Mote[];

  constructor(scene: Scene, fxTex: FxTextures, density: number) {
    this.fireflies = pool(scene, "fly", Math.round(24 * density), 0.07, fxTex.additive("soft", "#d8f08a", 0.85));
    this.leaves = pool(scene, "leaf", Math.round(30 * density), 0.1, fxTex.decal("soft", 0xb8862f, 0.9));
    const mistMat = fxTex.additive("soft", "#aebdc6", 0.16);
    this.mist = pool(scene, "mist", Math.round(8 * density), 7, mistMat, false);
    for (const m of this.mist) m.mesh.rotation.x = Math.PI / 2; // flat sheets
    this.embers = pool(scene, "ember", Math.round(48 * density), 0.06, fxTex.additive("soft", "#ff7b3a", 0.9));
  }

  private toggle(poolArr: Mote[], on: boolean, cx: number, cz: number, spawn: (m: Mote) => void): void {
    for (const m of poolArr) {
      if (on && !m.mesh.isEnabled()) {
        spawn(m);
        m.x += cx;
        m.z += cz;
        m.mesh.setEnabled(true);
      } else if (!on && m.mesh.isEnabled()) {
        m.mesh.setEnabled(false);
      }
    }
  }

  update(biome: string, glow: number, weather: string | undefined, t: number, cx: number, cz: number, dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    const now = performance.now() / 1000;

    const wantFireflies = glow > 0.45 && FIREFLY_BIOMES.has(biome);
    const wantLeaves = glow < 0.2 && LEAF_BIOMES.has(biome);
    const wantMist = (t > 0.06 && t < 0.24) || weather === "fog";
    const wantEmbers = biome === "volcanic";

    this.toggle(this.fireflies, wantFireflies, cx, cz, (m) => {
      m.x = (Math.random() - 0.5) * 24;
      m.z = (Math.random() - 0.5) * 24;
      m.y = 0.4 + Math.random() * 1.4;
    });
    this.toggle(this.leaves, wantLeaves, cx, cz, (m) => {
      m.x = (Math.random() - 0.5) * 26;
      m.z = (Math.random() - 0.5) * 26;
      m.y = 2 + Math.random() * 2;
      m.vy = -(0.25 + Math.random() * 0.3);
    });
    this.toggle(this.mist, wantMist, cx, cz, (m) => {
      m.x = (Math.random() - 0.5) * 30;
      m.z = (Math.random() - 0.5) * 30;
      m.y = 0.25 + Math.random() * 0.25;
      m.vx = 0.12 + Math.random() * 0.1;
    });
    this.toggle(this.embers, wantEmbers, cx, cz, (m) => {
      m.x = (Math.random() - 0.5) * 26;
      m.z = (Math.random() - 0.5) * 26;
      m.y = Math.random() * 2;
      m.vy = 0.4 + Math.random() * 0.5;
    });

    // animate live pools
    for (const m of this.fireflies) {
      if (!m.mesh.isEnabled()) continue;
      m.x += Math.sin(now * 0.7 + m.phase) * 0.35 * dt;
      m.z += Math.cos(now * 0.6 + m.phase * 1.3) * 0.35 * dt;
      m.y += Math.sin(now * 0.9 + m.phase * 2.1) * 0.2 * dt;
      m.mesh.position.set(m.x, m.y, m.z);
      m.mesh.visibility = 0.25 + 0.75 * Math.max(0, Math.sin(now * (1 / 1.2) * Math.PI * 2 + m.phase * 5));
      this.recycle(m, cx, cz, 16);
    }
    for (const m of this.leaves) {
      if (!m.mesh.isEnabled()) continue;
      m.y += m.vy * dt;
      m.x += Math.sin(now * 1.1 + m.phase) * 0.5 * dt;
      m.mesh.position.set(m.x, m.y, m.z);
      m.mesh.rotation.z += dt * (1 + m.phase * 0.2);
      if (m.y < 0.05) {
        m.y = 2.5 + Math.random() * 2;
        m.x = cx + (Math.random() - 0.5) * 26;
        m.z = cz + (Math.random() - 0.5) * 26;
      }
      this.recycle(m, cx, cz, 16);
    }
    for (const m of this.mist) {
      if (!m.mesh.isEnabled()) continue;
      m.x += m.vx * dt;
      m.mesh.position.set(m.x, m.y, m.z);
      m.mesh.visibility = 0.7 + 0.3 * Math.sin(now * 0.2 + m.phase);
      this.recycle(m, cx, cz, 20);
    }
    for (const m of this.embers) {
      if (!m.mesh.isEnabled()) continue;
      m.y += m.vy * dt;
      m.x += Math.sin(now * 1.4 + m.phase) * 0.3 * dt;
      m.mesh.position.set(m.x, m.y, m.z);
      if (m.y > 5) {
        m.y = 0;
        m.x = cx + (Math.random() - 0.5) * 26;
        m.z = cz + (Math.random() - 0.5) * 26;
      }
      this.recycle(m, cx, cz, 16);
    }
  }

  /** Keep motes inside the camera-following volume. */
  private recycle(m: Mote, cx: number, cz: number, r: number): void {
    if (Math.abs(m.x - cx) > r) m.x = cx + (Math.random() - 0.5) * r * 1.6;
    if (Math.abs(m.z - cz) > r) m.z = cz + (Math.random() - 0.5) * r * 1.6;
  }
}
