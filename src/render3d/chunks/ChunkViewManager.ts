// Mirrors the SimChunkStore streaming ring into Babylon meshes (3D master plan
// §3.5): chunks already resident are meshed at attach, later loads are queued
// and meshed one per frame (the ≤4ms/frame meshing budget), unloads dispose.
// The hysteresis ring itself lives in the sim store — this is a pure view.

import type { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { EventBus } from "../../sim/events";
import type { SimChunkStore } from "../../sim/world";
import { meshChunk } from "./ChunkMesher";

export class ChunkViewManager {
  private readonly views = new Map<string, Mesh[]>();
  private readonly queue: { cx: number; cy: number }[] = [];
  private readonly material: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly store: SimChunkStore,
    events: EventBus,
  ) {
    this.material = new StandardMaterial("chunkMat", scene);
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = true;

    for (const lc of store.loadedChunks()) this.build(lc.cx, lc.cy);
    events.on("chunkLoaded", ({ cx, cy }) => this.queue.push({ cx, cy }));
    events.on("chunkUnloaded", ({ cx, cy }) => this.drop(cx, cy));
  }

  /** Mesh at most one queued chunk per frame (amortised meshing budget). */
  update(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.build(next.cx, next.cy);
  }

  private build(cx: number, cy: number): void {
    const k = `${cx},${cy}`;
    if (this.views.has(k)) this.drop(cx, cy);
    const data = this.store.chunkData(cx, cy);
    if (!data) return; // unloaded again before its turn in the queue
    const m = meshChunk(this.scene, data);
    const meshes: Mesh[] = [];
    for (const mesh of [m.ground, m.solids]) {
      if (!mesh) continue;
      mesh.material = this.material;
      meshes.push(mesh);
    }
    this.views.set(k, meshes);
  }

  private drop(cx: number, cy: number): void {
    const k = `${cx},${cy}`;
    const meshes = this.views.get(k);
    if (!meshes) return;
    for (const mesh of meshes) mesh.dispose();
    this.views.delete(k);
  }

  dispose(): void {
    for (const meshes of this.views.values()) for (const mesh of meshes) mesh.dispose();
    this.views.clear();
    this.material.dispose();
  }
}
