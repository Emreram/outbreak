// Terrain-aware movement & hazard classification (Living World). Pure, Phaser-free,
// and the single source of truth for "what does standing on this tile do?": how much
// it slows you, what footstep FX it kicks up, and whether it damages you. The engine
// (WorldScene) reads the tile under each entity and applies these effects; the AI
// layer is not involved.

import { Tile } from "./world/tiles";

/** A walkable tile that damages whatever stands on it. */
export type TerrainHazard = "lava" | "deepwater";

/** Which footstep/contact FX a tile produces (engine maps these to particles). */
export type StepFx = "none" | "splash" | "mud" | "ember";

export interface TerrainEffect {
  mult: number; // movement-speed multiplier (1 = normal)
  hazard?: TerrainHazard; // present → apply environmental damage while standing here
  stepFx: StepFx; // contact FX cadence
}

const NORMAL: TerrainEffect = { mult: 1, stepFx: "none" };

/**
 * Effect of the tile an entity is standing on. Deep water / DeepWater stay SOLID
 * barriers (handled by collision, never "stood on" in normal play), so they don't
 * appear here — the `deepwater` hazard is reserved for flood-disaster wading.
 */
export function terrainEffect(tile: Tile | number | null | undefined): TerrainEffect {
  switch (tile) {
    case Tile.ShallowWater:
      return { mult: 0.55, stepFx: "splash" };
    case Tile.Mud:
      return { mult: 0.5, stepFx: "mud" };
    case Tile.Lava:
      return { mult: 0.28, hazard: "lava", stepFx: "ember" }; // near-stop + burns
    default:
      return NORMAL;
  }
}

/** True if a tile is a walkable hazard (saves a terrainEffect() alloc at call sites). */
export function isHazardTile(tile: Tile | number | null | undefined): boolean {
  return tile === Tile.Lava;
}
