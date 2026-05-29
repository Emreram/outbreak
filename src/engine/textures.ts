import Phaser from "phaser";
import { Tile } from "../game/worldgen";

// Programmatic PLACEHOLDER art (CLAUDE.md §9 "draw a labelled colored shape").
// Phase 2 replaces these with CC0 Kenney sprite/tile sheets.
// TODO: replace placeholder art with Kenney packs in Phase 2.

export const TILESET_KEY = "tiles";
export const PLAYER_KEY = "player";

// One colour per Tile enum value. Index === Tile index, so the generated
// tileset's frame order matches the grid values used by the tilemap.
const TILE_COLORS: Record<Tile, { fill: number; line: number }> = {
  [Tile.Road]: { fill: 0x33373d, line: 0x2a2e33 },
  [Tile.Sidewalk]: { fill: 0x6c727a, line: 0x5b616a },
  [Tile.Floor]: { fill: 0x5a4a38, line: 0x4a3c2d },
  [Tile.Wall]: { fill: 0x23262b, line: 0x3a3f47 },
  [Tile.Door]: { fill: 0xb5651d, line: 0x854a14 },
  [Tile.Grass]: { fill: 0x3a5236, line: 0x32482f },
};

/**
 * Generate a single tileset texture: N tiles laid out horizontally, one per
 * Tile type, each `size`x`size`. The tilemap slices this back into frames.
 */
export function generateTileTexture(scene: Phaser.Scene, size: number): void {
  if (scene.textures.exists(TILESET_KEY)) return;

  const order: Tile[] = [
    Tile.Road,
    Tile.Sidewalk,
    Tile.Floor,
    Tile.Wall,
    Tile.Door,
    Tile.Grass,
  ];
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
