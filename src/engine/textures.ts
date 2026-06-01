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
// tileset is intentionally NOT here — it is always generated (see above). The
// player + survivor NPC are now drawn procedurally (detailed top-down sprites),
// so they're generated rather than loaded; only the zombie keeps a CC0 fallback.
export const ASSET_PATHS: Readonly<Record<string, string>> = {
  [ZOMBIE_KEY]: "assets/characters/zombie.png",
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

// --- top-down survivor characters (hand-drawn, canvas) ----------------------
// A detailed overhead survivor — shoulders + jacket, backpack, arms reaching
// forward, a head with hair, and a soft shadow — facing +x so the engine's
// movement-rotation lines up. Used for the PLAYER and survivor NPCs (different
// palettes) in place of the old flat placeholder discs / crude CC0 blobs.

const CHAR_SIZE = 40;

interface SurvivorPalette {
  jacket: number;
  skin: number;
  hair: number;
  pack: number;
  armed?: boolean; // draw a slung rifle (NPCs); the player has a live weapon overlay
}

function hx(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}
function rgbf(c: number, f: number): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return `rgb(${r},${g},${b})`;
}
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 7);
  ctx.fill();
}

function drawSurvivorCanvas(p: SurvivorPalette): HTMLCanvasElement {
  const S = CHAR_SIZE;
  const C = S / 2;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // soft drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  oval(ctx, C, C + 9, 13, 6);

  // backpack behind (−x)
  ctx.fillStyle = hx(p.pack);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(C - 13, C - 7, 9, 14);
  ctx.fill();
  ctx.stroke();

  // arms reaching forward (+x)
  ctx.strokeStyle = rgbf(p.jacket, 0.82);
  ctx.lineWidth = 5;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(C - 2, C + s * 7);
    ctx.lineTo(C + 9, C + s * 5);
    ctx.stroke();
  }
  // hands
  ctx.fillStyle = hx(p.skin);
  for (const s of [-1, 1]) disc(ctx, C + 9, C + s * 5, 2.2);

  // torso / jacket (broad shoulders perpendicular to facing)
  ctx.fillStyle = hx(p.jacket);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  oval(ctx, C - 1, C, 9, 11);
  ctx.stroke();
  // zipper seam + shoulder highlight
  ctx.strokeStyle = rgbf(p.jacket, 1.2);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(C - 1, C - 9);
  ctx.lineTo(C - 1, C + 9);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  oval(ctx, C - 2, C - 4, 6, 3.5);

  // slung rifle (armed survivors)
  if (p.armed) {
    ctx.strokeStyle = "#23262b";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(C - 6, C + 9);
    ctx.lineTo(C + 12, C - 4);
    ctx.stroke();
  }

  // head (front, +x): hair cap from above, then face
  ctx.fillStyle = hx(p.hair);
  disc(ctx, C + 7, C, 6.4);
  ctx.fillStyle = hx(p.skin);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.2;
  disc(ctx, C + 8.6, C, 4.8);
  ctx.stroke();

  return cv;
}

/** The player survivor — olive jacket, no slung rifle (a live weapon overlays it). */
export function generatePlayerTexture(scene: Phaser.Scene, _size: number): void {
  if (scene.textures.exists(PLAYER_KEY)) return;
  scene.textures.addCanvas(PLAYER_KEY, drawSurvivorCanvas({ jacket: 0x5b6b52, skin: 0xc89a6a, hair: 0x3a2c1e, pack: 0x6e5a3a }));
}

/** Survivor NPC — light neutral so the scene's faction tint (cyan/green) reads;
 *  armed so they look like fighters. */
export function generateSurvivorNpcTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SURVIVOR_NPC_KEY)) return;
  scene.textures.addCanvas(SURVIVOR_NPC_KEY, drawSurvivorCanvas({ jacket: 0x9aa0a8, skin: 0xd0a878, hair: 0x2e2722, pack: 0x4a4f57, armed: true }));
}
