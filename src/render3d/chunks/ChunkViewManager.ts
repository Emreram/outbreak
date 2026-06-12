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
import type { ShadowDirector } from "../env/ShadowDirector";
import { meshChunk } from "./ChunkMesher";
import { seedHash } from "./groundShade";
import { createTileAtlas } from "./TileAtlas";
import { createChunkMaterials, type FluidMaterials } from "./materials";

export class ChunkViewManager {
  readonly materials: FluidMaterials;
  private readonly views = new Map<string, Mesh[]>();
  private readonly queue: { cx: number; cy: number }[] = [];
  private readonly atlasMat: StandardMaterial;
  private readonly colorMat: StandardMaterial;
  /** Shadow hookup (WS4) — chunk walls/trees cast, ground receives. Passed at
   *  construction because the initial ring meshes immediately. */
  private readonly shadows: ShadowDirector | null;
  /** Per-run hash seed for the WS5 vertex-shade jitter. */
  private readonly seedNum: number;

  constructor(
    private readonly scene: Scene,
    private readonly store: SimChunkStore,
    events: EventBus,
    shadows?: ShadowDirector,
  ) {
    this.shadows = shadows ?? null;
    this.seedNum = seedHash(store.seed, "vjit");
    const atlas = createTileAtlas(scene);
    this.atlasMat = new StandardMaterial("chunkAtlasMat", scene);
    this.atlasMat.diffuseTexture = atlas;
    this.atlasMat.specularColor = Color3.Black();

    this.colorMat = new StandardMaterial("chunkColorMat", scene);
    this.colorMat.specularColor = Color3.Black();

    this.materials = createChunkMaterials(scene);

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
    const m = meshChunk(this.scene, data, this.seedNum);
    const meshes: Mesh[] = [];
    const bind = (mesh: Mesh | null, mat: StandardMaterial | FluidMaterials["water"]): void => {
      if (!mesh) return;
      mesh.material = mat;
      meshes.push(mesh);
    };
    bind(m.ground, this.atlasMat);
    bind(m.walls, this.atlasMat);
    bind(m.trees, this.colorMat);
    bind(m.detail, this.colorMat);
    bind(m.water, this.materials.water);
    bind(m.lava, this.materials.lava);
    bind(m.roofs, this.materials.roof);
    this.views.set(k, meshes);

    // Shadows (WS4): ground + walls receive; walls + trees cast (the custom
    // ShaderMaterial fluids/roofs do neither — called out in the plan).
    if (this.shadows?.enabled) {
      if (m.ground) m.ground.receiveShadows = true;
      if (m.walls) m.walls.receiveShadows = true;
      const casters: Mesh[] = [];
      if (m.walls) casters.push(m.walls);
      if (m.trees) casters.push(m.trees);
      this.shadows.setChunkCasters(k, casters);
    }
  }

  private drop(cx: number, cy: number): void {
    const k = `${cx},${cy}`;
    const meshes = this.views.get(k);
    if (!meshes) return;
    this.shadows?.dropChunk(k);
    for (const mesh of meshes) mesh.dispose();
    this.views.delete(k);
  }

  dispose(): void {
    for (const meshes of this.views.values()) for (const mesh of meshes) mesh.dispose();
    this.views.clear();
  }
}
