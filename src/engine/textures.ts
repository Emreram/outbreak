import Phaser from "phaser";
import { Tile, TILE_ORDER } from "../game/worldgen";
import { createRng } from "../game/rng";

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

/** Scale a packed RGB colour's brightness by `amt` (e.g. -0.2 darker, +0.15 lighter). */
function shade(hex: number, amt: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * Generate the terrain tileset: N tiles laid out horizontally, one per Tile
 * value (frame index === enum value, from TILE_ORDER), each `size`x`size`.
 * Always runs (procedural, authoritative). Each frame is TEXTURED — a dithered
 * noise field, a soft bevel, and a per-type motif (lane lines, brick courses,
 * water ripples, grass blades…) — so large areas read with depth instead of as
 * flat colour, while the frame layout (index === Tile) is unchanged.
 */
export function generateTileTexture(scene: Phaser.Scene, size: number): void {
  if (scene.textures.exists(TILESET_KEY)) return;

  const order = TILE_ORDER;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  order.forEach((tile, i) => {
    const { fill, line } = TILE_COLORS[tile];
    const ox = i * size;
    // deterministic per-TYPE texture (every instance of a tile looks identical,
    // but richly textured rather than flat).
    const rng = createRng(`tile:${tile}`);

    g.fillStyle(fill, 1).fillRect(ox, 0, size, size);

    // dither: scattered lighter/darker specks for a grain/noise feel.
    const specks = Math.round(size * size * 0.28);
    for (let s = 0; s < specks; s++) {
      const x = ox + rng.int(0, size - 1);
      const y = rng.int(0, size - 1);
      const amt = rng.range(-0.16, 0.16);
      g.fillStyle(shade(fill, amt), rng.range(0.35, 0.7)).fillRect(x, y, 1, 1);
    }

    drawTileMotif(g, tile, ox, size, fill, rng);

    // soft bevel: lit top/left edge, shaded bottom/right edge → subtle relief.
    g.fillStyle(shade(fill, 0.16), 0.5).fillRect(ox, 0, size, 1).fillRect(ox, 0, 1, size);
    g.fillStyle(shade(fill, -0.22), 0.5).fillRect(ox, size - 1, size, 1).fillRect(ox + size - 1, 0, 1, size);
    // thin inner border keeps the grid legible.
    g.lineStyle(1, line, 0.8).strokeRect(ox + 0.5, 0.5, size - 1, size - 1);
  });

  g.generateTexture(TILESET_KEY, size * order.length, size);
  g.destroy();
}

/** Per-Tile decorative overlay drawn on top of the base fill + dither. */
function drawTileMotif(
  g: Phaser.GameObjects.Graphics,
  tile: Tile,
  ox: number,
  size: number,
  fill: number,
  rng: { int(a: number, b: number): number; range(a: number, b: number): number },
): void {
  const light = shade(fill, 0.22);
  const dark = shade(fill, -0.26);
  const mid = size / 2;
  switch (tile) {
    case Tile.Road:
      g.fillStyle(0xb7a23f, 0.5).fillRect(ox + mid - 1, 4, 2, 6).fillRect(ox + mid - 1, size - 10, 2, 6); // dashed centre line
      break;
    case Tile.Sidewalk:
    case Tile.Pavement:
      g.fillStyle(dark, 0.5).fillRect(ox, mid, size, 1).fillRect(ox + mid, 0, 1, size); // expansion-joint slabs
      break;
    case Tile.Wall:
      g.fillStyle(dark, 0.7);
      for (let y = 4; y < size; y += 8) g.fillRect(ox, y, size, 1); // brick courses
      for (let y = 0; y < size; y += 8) g.fillRect(ox + ((y / 8) % 2 ? mid : size - 4), y, 1, 8);
      break;
    case Tile.Floor:
    case Tile.Bridge:
      g.fillStyle(dark, 0.55);
      for (let x = 4; x < size; x += 7) g.fillRect(ox + x, 0, 1, size); // floorboards
      break;
    case Tile.Door:
      g.lineStyle(2, dark, 0.8).strokeRect(ox + 5, 4, size - 10, size - 8); // panel

      g.fillStyle(0xffe08a, 0.9).fillCircle(ox + size - 9, mid, 1.6); // knob
      break;
    case Tile.Water:
    case Tile.ShallowWater:
      g.lineStyle(1, light, 0.5);
      for (let k = 0; k < 3; k++) {
        const y = 6 + k * 9;
        g.beginPath();
        g.moveTo(ox + 3, y);
        g.lineTo(ox + mid, y + 3);
        g.lineTo(ox + size - 3, y);
        g.strokePath();
      }
      break;
    case Tile.Grass:
    case Tile.TallGrass:
      g.lineStyle(1, light, 0.6);
      for (let b = 0; b < (tile === Tile.TallGrass ? 12 : 7); b++) {
        const x = ox + rng.int(3, size - 3);
        const y = rng.int(8, size - 2);
        const h = tile === Tile.TallGrass ? rng.int(5, 9) : rng.int(2, 4);
        g.lineBetween(x, y, x + rng.int(-1, 1), y - h);
      }
      break;
    case Tile.Tree:
    case Tile.Bush:
      g.fillStyle(light, 0.7).fillCircle(ox + mid - 3, mid - 2, size * 0.22);
      g.fillStyle(dark, 0.6).fillCircle(ox + mid + 4, mid + 3, size * 0.18);
      break;
    case Tile.Crop:
      g.fillStyle(dark, 0.5);
      for (let x = 5; x < size; x += 7) g.fillRect(ox + x, 2, 2, size - 4); // planted rows
      break;
    case Tile.Rail:
      g.fillStyle(dark, 0.8).fillRect(ox + 8, 0, 2, size).fillRect(ox + size - 10, 0, 2, size); // rails
      g.fillStyle(light, 0.6);
      for (let y = 2; y < size; y += 7) g.fillRect(ox + 4, y, size - 8, 2); // ties
      break;
    case Tile.Rubble:
    case Tile.Sand:
    case Tile.Dirt:
    case Tile.Trail:
      g.fillStyle(dark, 0.5);
      for (let s = 0; s < 6; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2)); // pebbles/grain
      break;
    default:
      break;
  }
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
