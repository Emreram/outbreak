// Sun shadows (graphics plan WS4 / master plan §3.8): one
// CascadedShadowGenerator (2 cascades, map size by tier, PCF medium,
// shadowMaxZ 60m) with a managed renderList synced to chunk streaming and
// actor lifecycle — chunk walls/trees/detail within 1 ring of the player,
// whitelisted prop pools (thin instances cast as a group), one body mesh per
// actor. Receivers are flagged by ChunkViewManager/PropInstancer. On the Low
// tier the generator is skipped entirely (BlobShadows carries grounding).
// autoCalcDepthBounds only on High — the min/max depth reducer is the most
// driver-divergent piece of the stack.

import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { QualityCaps } from "../quality";

export class ShadowDirector {
  private readonly generator: CascadedShadowGenerator | null = null;
  /** Chunk-key → casters; only chunks near the player are in the live list. */
  private readonly chunkCasters = new Map<string, AbstractMesh[]>();
  private readonly poolCasters = new Set<AbstractMesh>();
  private readonly actorCasters = new Set<AbstractMesh>();
  private lastCx = NaN;
  private lastCy = NaN;
  private listDirty = true;

  constructor(sun: DirectionalLight, caps: QualityCaps) {
    if (caps.shadows !== "csm" || caps.shadowMapSize === 0) {
      sun.shadowEnabled = false;
      return;
    }
    try {
      const g = new CascadedShadowGenerator(caps.shadowMapSize, sun);
      g.numCascades = 2;
      g.lambda = 0.8;
      g.stabilizeCascades = true;
      g.shadowMaxZ = 60;
      g.autoCalcDepthBounds = caps.csmAutoDepthBounds;
      g.usePercentageCloserFiltering = true;
      g.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      g.bias = 0.01;
      g.normalBias = 0.4;
      g.transparencyShadow = false;
      sun.shadowMinZ = 1;
      sun.shadowMaxZ = 80;
      this.generator = g;
    } catch (e) {
      console.warn("CSM unavailable — shadows off:", e);
      sun.shadowEnabled = false;
      this.generator = null;
    }
  }

  get enabled(): boolean {
    return this.generator !== null;
  }

  /** Chunk lifecycle (called by ChunkViewManager). */
  setChunkCasters(key: string, meshes: AbstractMesh[]): void {
    this.chunkCasters.set(key, meshes);
    this.listDirty = true;
  }

  dropChunk(key: string): void {
    this.chunkCasters.delete(key);
    this.listDirty = true;
  }

  /** Long-lived casters (prop thin-instance pools — cast as a group). */
  addPoolCaster(mesh: AbstractMesh): void {
    if (this.poolCasters.has(mesh)) return;
    this.poolCasters.add(mesh);
    this.listDirty = true;
  }

  /** Actor body meshes (one per rig — silhouette is enough at 2 cascades). */
  addActorCaster(mesh: AbstractMesh): void {
    if (this.actorCasters.has(mesh)) return;
    this.actorCasters.add(mesh);
    this.listDirty = true;
  }

  removeActorCaster(mesh: AbstractMesh): void {
    if (this.actorCasters.delete(mesh)) this.listDirty = true;
  }

  /** Per frame: rebuild the renderList only when the player's chunk or the
   *  caster sets changed — never per frame in steady state. */
  update(playerCx: number, playerCy: number): void {
    if (!this.generator) return;
    if (playerCx !== this.lastCx || playerCy !== this.lastCy) {
      this.lastCx = playerCx;
      this.lastCy = playerCy;
      this.listDirty = true;
    }
    if (!this.listDirty) return;
    this.listDirty = false;
    const map = this.generator.getShadowMap();
    if (!map) return;
    const list: AbstractMesh[] = [];
    for (const [key, meshes] of this.chunkCasters) {
      const comma = key.indexOf(",");
      const cx = Number(key.slice(0, comma));
      const cy = Number(key.slice(comma + 1));
      if (Math.max(Math.abs(cx - playerCx), Math.abs(cy - playerCy)) > 1) continue;
      for (const m of meshes) list.push(m);
    }
    for (const m of this.poolCasters) list.push(m);
    for (const m of this.actorCasters) list.push(m);
    map.renderList = list;
  }
}
