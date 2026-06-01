import Phaser from "phaser";
import { Tile, TILE_ORDER } from "../game/worldgen";

// Terrain is rendered from a PROCEDURALLY-generated tileset (one flat-coloured
// frame per Tile value, frame index === enum value) so every biome terrain is
// guaranteed a frame without hand-aligning a CC0 PNG to ~19 tiles. CC0 character
// art still loads from /public (ASSET_PATHS); props use propSprites.ts.

export const TILESET_KEY = "tiles";
export const PLAYER_KEY = "player";
export const ZOMBIE_KEY = "zombie";
export const SURVIVOR_NPC_KEY = "survivor_npc";

// CC0 character assets served from /public (loaded in BootScene). If a load
// fails, the generators below provide a placeholder for that key. The terrain
// tileset is intentionally NOT here — it is always generated (see above).
export const ASSET_PATHS: Readonly<Record<string, string>> = {
  [PLAYER_KEY]: "assets/characters/survivor.png",
  [ZOMBIE_KEY]: "assets/characters/zombie.png",
  [SURVIVOR_NPC_KEY]: "assets/characters/survivor_npc.png",
};

// One colour per Tile enum value. Order in TILE_ORDER below must match the enum
// so the generated tileset's frame index === the grid value used by the tilemap.
// Exported so the minimap (Feature 10) can colour chunks by their biome's base tile.
export const TILE_COLORS: Record<Tile, { fill: number; line: number }> = {
  [Tile.Road]: { fill: 0x33373d, line: 0x2a2e33 },
  [Tile.Sidewalk]: { fill: 0x6c727a, line: 0x5b616a },
  [Tile.Floor]: { fill: 0x5a4a38, line: 0x4a3c2d },
  [Tile.Wall]: { fill: 0x23262b, line: 0x3a3f47 },
  [Tile.Door]: { fill: 0xb5651d, line: 0x854a14 },
  [Tile.Grass]: { fill: 0x3a5236, line: 0x32482f },
  [Tile.Water]: { fill: 0x274b6d, line: 0x1d3a55 },
  [Tile.ShallowWater]: { fill: 0x3f6f93, line: 0x335c7a },
  [Tile.Sand]: { fill: 0xcdb482, line: 0xb89f6e },
  [Tile.Dirt]: { fill: 0x6b5638, line: 0x5a472e },
  [Tile.Trail]: { fill: 0x8a7350, line: 0x6f5c40 },
  [Tile.Tree]: { fill: 0x1f3d22, line: 0x16301a },
  [Tile.Bush]: { fill: 0x33572f, line: 0x294626 },
  [Tile.TallGrass]: { fill: 0x46663a, line: 0x3a5630 },
  [Tile.Rubble]: { fill: 0x4a4640, line: 0x3a3732 },
  [Tile.Pavement]: { fill: 0x44484e, line: 0x383b40 },
  [Tile.Rail]: { fill: 0x55504a, line: 0x3f3b36 },
  [Tile.Crop]: { fill: 0x7e8a3a, line: 0x69742f },
  [Tile.Bridge]: { fill: 0x6e5640, line: 0x5a4634 },
};

/**
 * Generate the terrain tileset: N tiles laid out horizontally, one per Tile
 * value (frame index === enum value, from TILE_ORDER), each `size`x`size`.
 * Always runs (the terrain set is procedural), so it is authoritative.
 */
export function generateTileTexture(scene: Phaser.Scene, size: number): void {
  if (scene.textures.exists(TILESET_KEY)) return;

  const order = TILE_ORDER;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  order.forEach((tile, i) => {
    const { fill, line } = TILE_COLORS[tile];
    const ox = i * size;
    g.fillStyle(fill, 1);
    g.fillRect(ox, 0, size, size);
    // Subtle inner border so the grid reads clearly without real art.
    g.lineStyle(1, line, 1);
    g.strokeRect(ox + 0.5, 0.5, size - 1, size - 1);
  });

  g.generateTexture(TILESET_KEY, size * order.length, size);
  g.destroy();
}

/** Generate the placeholder player sprite: a coloured disc with a facing dot. */
export function generatePlayerTexture(scene: Phaser.Scene, size: number): void {
  if (scene.textures.exists(PLAYER_KEY)) return;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = size / 2;
  const r = size * 0.4;

  g.fillStyle(0x10141a, 1); // dark outline ring
  g.fillCircle(c, c, r + 1.5);
  g.fillStyle(0x2ec4ff, 1); // body
  g.fillCircle(c, c, r);
  g.fillStyle(0x0b2f3d, 1); // small "front" marker (points up by default)
  g.fillCircle(c, c - r * 0.45, r * 0.22);

  g.generateTexture(PLAYER_KEY, size, size);
  g.destroy();
}
