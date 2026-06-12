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
import type { LightPool } from "../env/LightPool";
import { TILE_SIZE } from "../../game/constants";
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
  /** Light-pool hookup (WS9): lava centroids + doorway night lights. */
  private readonly lights: LightPool | null;
  private readonly lightIds = new Map<string, string[]>();

  constructor(
    private readonly scene: Scene,
    private readonly store: SimChunkStore,
    events: EventBus,
    shadows?: ShadowDirector,
    lights?: LightPool,
    maxLights = 4,
  ) {
    this.shadows = shadows ?? null;
    this.lights = lights ?? null;
    this.seedNum = seedHash(store.seed, "vjit");
    const atlas = createTileAtlas(scene);
    this.atlasMat = new StandardMaterial("chunkAtlasMat", scene);
    this.atlasMat.diffuseTexture = atlas;
    this.atlasMat.specularColor = Color3.Black();

    this.colorMat = new StandardMaterial("chunkColorMat", scene);
    this.atlasMat.maxSimultaneousLights = maxLights; // Babylon's default 4 drops pool lights
    this.colorMat.maxSimultaneousLights = maxLights;
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

    // Light sources (WS9): lava centroid + a warm doorway light per building.
    if (this.lights) {
      const ids: string[] = [];
      if (m.lavaCenterPx) {
        const lid = `lava_${k}`;
        this.lights.register({ id: lid, x: m.lavaCenterPx.x, y: m.lavaCenterPx.y, h: 0.6, color: 0xff7a2a, intensity: 14, range: 15, flicker: 1 });
        ids.push(lid);
      }
      for (const b of data.buildings) {
        const doorPx = (b.door.x + 0.5) * TILE_SIZE;
        const doorPy = (b.door.y + 0.5) * TILE_SIZE;
        const dx = doorPx - b.center.x;
        const dy = doorPy - b.center.y;
        const len = Math.hypot(dx, dy) || 1;
        const lid = `win_${b.gid}`;
        this.lights.register({
          id: lid,
          x: doorPx + (dx / len) * 24,
          y: doorPy + (dy / len) * 24,
          h: 1.5,
          color: 0xffc26b,
          intensity: 7,
          range: 9,
          flicker: 0.25,
          nightOnly: true,
        });
        ids.push(lid);
      }
      if (ids.length > 0) this.lightIds.set(k, ids);
    }

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
    const lids = this.lightIds.get(k);
    if (lids) {
      for (const lid of lids) this.lights?.unregister(lid);
      this.lightIds.delete(k);
    }
    for (const mesh of meshes) mesh.dispose();
    this.views.delete(k);
  }

  dispose(): void {
    for (const meshes of this.views.values()) for (const mesh of meshes) mesh.dispose();
    this.views.clear();
  }
}
