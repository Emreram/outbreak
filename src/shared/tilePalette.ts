// The tile colour identity — one fill/line pair per Tile enum value. Lifted out
// of engine/textures.ts (Phaser path) so the Babylon renderer's blockout meshes
// and atlas port share the EXACT same palette without importing Phaser (3D
// master plan §3.5: "carries the current palette/identity"). textures.ts
// re-exports this, so the Phaser path is unchanged.

import { Tile } from "../game/world/tiles";

export const TILE_COLORS: Record<Tile, { fill: number; line: number }> = {
  [Tile.Road]: { fill: 0x33373d, line: 0x2a2e33 },
  [Tile.Sidewalk]: { fill: 0x6c727a, line: 0x5b616a },
  [Tile.Floor]: { fill: 0x5a4a38, line: 0x4a3c2d },
  [Tile.Wall]: { fill: 0x23262b, line: 0x3a3f47 },
  [Tile.Door]: { fill: 0xb5651d, line: 0x854a14 },
  [Tile.Grass]: { fill: 0x3a5236, line: 0x32482f },
  [Tile.Water]: { fill: 0x274b6d, line: 0x1d3a55 },
  [Tile.ShallowWater]: { fill: 0x4d7fa3, line: 0x40688a }, // lighter — the depth ramp reads under the (subtler) shader
  [Tile.Sand]: { fill: 0xd8c08c, line: 0xc0a875 }, // brighter beach
  [Tile.Dirt]: { fill: 0x6b5638, line: 0x5a472e },
  [Tile.Trail]: { fill: 0x8a7350, line: 0x6f5c40 },
  // Tree/Bush tiles sit on visible ground (the canopy is drawn raised on top in
  // drawTileMotif) so a blocking tree reads as an object, not as patterned grass.
  [Tile.Tree]: { fill: 0x35492c, line: 0x243318 },
  [Tile.Bush]: { fill: 0x3a5236, line: 0x2c3f25 },
  [Tile.TallGrass]: { fill: 0x44603a, line: 0x38522e },
  [Tile.Rubble]: { fill: 0x4a4640, line: 0x3a3732 },
  [Tile.Pavement]: { fill: 0x44484e, line: 0x383b40 },
  [Tile.Rail]: { fill: 0x55504a, line: 0x3f3b36 },
  [Tile.Crop]: { fill: 0x7e8a3a, line: 0x69742f },
  [Tile.Bridge]: { fill: 0x6e5640, line: 0x5a4634 },
  // Living-world terrain. Water/Lava are the STATIC underlay beneath the animated
  // overlay (AnimatedTerrain) — kept readable but quiet so the animation reads.
  [Tile.DeepWater]: { fill: 0x183349, line: 0x102434 },
  [Tile.Mud]: { fill: 0x423624, line: 0x322817 }, // darker wet earth — clearly not grass
  [Tile.Foam]: { fill: 0xc9bd9a, line: 0xb0a584 }, // WET SAND w/ a surf line (was pale cyan — read as ocean speckle)
  [Tile.Scorched]: { fill: 0x2a241f, line: 0x1d1814 },
  [Tile.Ash]: { fill: 0x4a463f, line: 0x35322c },
  [Tile.Basalt]: { fill: 0x2b2622, line: 0x18140f },
  [Tile.Lava]: { fill: 0x8a3010, line: 0x551c08 },
  [Tile.Stump]: { fill: 0x3a2c1e, line: 0x281d12 },
};
