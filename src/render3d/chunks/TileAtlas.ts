// Procedural tile atlas (3D master plan §3.5 step 1) — a Canvas2D port of
// engine/textures.ts generateTileTexture + drawTileMotif, painting the SAME
// 27 frames (same TILE_COLORS, same seeded rng per tile, same dither/bevel/
// border and per-type motifs) into one DynamicTexture strip. Frame index ===
// Tile enum value, exactly like the Phaser tileset, so a grid value maps
// straight to a UV window. The Tree frame skips its painted canopy (the 3D
// mesher raises a real trunk + canopy instead — a flat painted tree under a
// 3D one would double-draw).

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { Tile, TILE_ORDER } from "../../game/world/tiles";
import { TILE_COLORS } from "../../shared/tilePalette";
import { createRng } from "../../game/rng";

export const TILE_FRAME = 40; // px per frame, like the Phaser tileset
export const ATLAS_TILES = TILE_ORDER.length;

/** Scale a packed RGB colour's brightness (port of textures.ts shade()). */
function shade(hex: number, amt: number): number {
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
}

function css(hex: number, a = 1): string {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

/** Minimal Phaser-Graphics-shaped shim over Canvas2D so the motif code below
 *  stays line-for-line comparable with the original. */
class G {
  private fillCss = "#000";
  private strokeCss = "#000";
  private lw = 1;
  constructor(private ctx: CanvasRenderingContext2D) {}
  fillStyle(c: number, a = 1): this {
    this.fillCss = css(c, a);
    return this;
  }
  lineStyle(w: number, c: number, a = 1): this {
    this.lw = w;
    this.strokeCss = css(c, a);
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.ctx.fillStyle = this.fillCss;
    this.ctx.fillRect(x, y, w, h);
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.ctx.strokeStyle = this.strokeCss;
    this.ctx.lineWidth = this.lw;
    this.ctx.strokeRect(x, y, w, h);
    return this;
  }
  fillCircle(x: number, y: number, r: number): this {
    this.ctx.fillStyle = this.fillCss;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, 7);
    this.ctx.fill();
    return this;
  }
  strokeCircle(x: number, y: number, r: number): this {
    this.ctx.strokeStyle = this.strokeCss;
    this.ctx.lineWidth = this.lw;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, 7);
    this.ctx.stroke();
    return this;
  }
  fillEllipse(x: number, y: number, w: number, h: number): this {
    this.ctx.fillStyle = this.fillCss;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, 7);
    this.ctx.fill();
    return this;
  }
  lineBetween(x0: number, y0: number, x1: number, y1: number): this {
    this.ctx.strokeStyle = this.strokeCss;
    this.ctx.lineWidth = this.lw;
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    return this;
  }
  // path API (used by water ripples / lava cracks / tree rim)
  private path: { x: number; y: number }[] = [];
  beginPath(): this {
    this.path = [];
    return this;
  }
  moveTo(x: number, y: number): this {
    this.path = [{ x, y }];
    return this;
  }
  lineTo(x: number, y: number): this {
    this.path.push({ x, y });
    return this;
  }
  arc(x: number, y: number, r: number, a0: number, a1: number): this {
    this.ctx.strokeStyle = this.strokeCss;
    this.ctx.lineWidth = this.lw;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, a0, a1);
    this.ctx.stroke();
    return this;
  }
  strokePath(): this {
    if (this.path.length < 2) return this;
    this.ctx.strokeStyle = this.strokeCss;
    this.ctx.lineWidth = this.lw;
    this.ctx.beginPath();
    this.ctx.moveTo(this.path[0].x, this.path[0].y);
    for (let i = 1; i < this.path.length; i++) this.ctx.lineTo(this.path[i].x, this.path[i].y);
    this.ctx.stroke();
    return this;
  }
}

type Rng = { int(a: number, b: number): number; range(a: number, b: number): number };

/** Per-Tile decorative overlay — direct port of textures.ts drawTileMotif. */
function drawTileMotif(g: G, tile: Tile, ox: number, size: number, fill: number, rng: Rng): void {
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
    case Tile.DeepWater:
      g.lineStyle(1, light, 0.35);
      for (let k = 0; k < 3; k++) {
        const y = 6 + k * 9;
        g.beginPath();
        g.moveTo(ox + 3, y);
        g.lineTo(ox + mid, y + 3);
        g.lineTo(ox + size - 3, y);
        g.strokePath();
      }
      break;
    case Tile.Lava: {
      g.fillStyle(0x1c1410, 0.55);
      for (let s = 0; s < 7; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(2, 4));
      g.lineStyle(1.5, 0xff7a2a, 0.85);
      for (let k = 0; k < 3; k++) {
        const y = 5 + k * 9;
        g.beginPath();
        g.moveTo(ox + rng.int(2, 6), y);
        g.lineTo(ox + mid + rng.int(-3, 3), y + rng.int(2, 5));
        g.lineTo(ox + size - rng.int(2, 6), y + rng.int(-2, 2));
        g.strokePath();
      }
      g.fillStyle(0xffd27a, 0.7).fillCircle(ox + mid + rng.int(-6, 6), mid + rng.int(-6, 6), 1.6);
      break;
    }
    case Tile.Mud: {
      g.fillStyle(dark, 0.5);
      for (let s = 0; s < 5; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2));
      g.fillStyle(0x2a3038, 0.4).fillEllipse(ox + rng.int(8, size - 8), rng.int(8, size - 8), 9, 5);
      g.fillStyle(0x2a3038, 0.35).fillEllipse(ox + rng.int(8, size - 8), rng.int(8, size - 8), 7, 4);
      break;
    }
    case Tile.Foam: {
      const fy = 6 + rng.int(0, 4);
      g.lineStyle(2, 0xffffff, 0.55);
      g.beginPath();
      g.moveTo(ox + 2, fy);
      g.lineTo(ox + mid, fy + rng.int(2, 4));
      g.lineTo(ox + size - 2, fy + rng.int(-1, 1));
      g.strokePath();
      g.fillStyle(0xffffff, 0.4).fillCircle(ox + rng.int(6, size - 6), fy + rng.int(3, 6), 1.4);
      g.fillStyle(0xffffff, 0.3).fillCircle(ox + rng.int(6, size - 6), fy + rng.int(4, 8), 1);
      g.fillStyle(0x8a7a58, 0.3);
      for (let s = 0; s < 3; s++) g.fillCircle(ox + rng.int(4, size - 4), rng.int(mid, size - 3), rng.int(1, 2));
      break;
    }
    case Tile.Stump: {
      g.fillStyle(0x140f0a, 0.5);
      for (let s = 0; s < 5; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2));
      g.fillStyle(0x3a2c1e, 1).fillCircle(ox + mid, mid, size * 0.22);
      g.lineStyle(1, 0x1c130c, 0.8);
      g.strokeCircle(ox + mid, mid, size * 0.13);
      g.fillStyle(0x5a4632, 0.8).fillCircle(ox + mid, mid, size * 0.06);
      break;
    }
    case Tile.Scorched:
    case Tile.Ash:
    case Tile.Basalt:
    case Tile.Grass:
      g.lineStyle(1, light, 0.6);
      for (let b = 0; b < 7; b++) {
        const x = ox + rng.int(3, size - 3);
        const y = rng.int(8, size - 2);
        g.lineBetween(x, y, x + rng.int(-1, 1), y - rng.int(2, 4));
      }
      break;
    case Tile.TallGrass: {
      g.fillStyle(0x0e1c0e, 0.28).fillEllipse(ox + mid + 1, size - 4, size * 0.55, size * 0.2); // base shadow
      const blade = (col: number, a: number, n: number, hi: number) => {
        g.lineStyle(1.4, col, a);
        for (let b = 0; b < n; b++) {
          const x = ox + rng.int(3, size - 3);
          const y = rng.int(size - 6, size - 2);
          g.lineBetween(x, y, x + rng.int(-2, 2), y - rng.int(hi - 3, hi));
        }
      };
      blade(0x2f4a26, 0.8, 9, 10); // dark backs
      blade(0x6fa64a, 0.85, 9, 12); // bright fronts
      break;
    }
    case Tile.Tree:
      // 3D path: the mesher raises a real trunk + canopy — paint forest floor
      // only (cast-shadow ellipse keeps the ground read grounded).
      g.fillStyle(0x0c170d, 0.4).fillEllipse(ox + mid + 2, mid + 7, size * 0.66, size * 0.34);
      break;
    case Tile.Bush: {
      g.fillStyle(0x0e1c0e, 0.32).fillEllipse(ox + mid + 1, mid + 6, size * 0.56, size * 0.26); // shadow
      g.fillStyle(0x2f5a2b, 1).fillCircle(ox + mid - 3, mid + 1, size * 0.22); // body
      g.fillStyle(0x418a39, 1).fillCircle(ox + mid + 3, mid, size * 0.19); // lit lobe
      g.fillStyle(0x60ab4d, 0.9).fillCircle(ox + mid - 1, mid - 3, size * 0.12); // highlight
      g.fillStyle(0x1f3d1f, 0.5).fillCircle(ox + mid + 5, mid + 4, size * 0.12); // shade
      break;
    }
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

/** UV window for a tile frame (half-texel inset against atlas bleed). */
export function tileUV(tile: number): { u0: number; v0: number; u1: number; v1: number } {
  const inset = 0.5 / (ATLAS_TILES * TILE_FRAME);
  return { u0: tile / ATLAS_TILES + inset, v0: inset, u1: (tile + 1) / ATLAS_TILES - inset, v1: 1 - inset };
}

/** Paint the 27-frame strip and return it as a Babylon texture. */
export function createTileAtlas(scene: Scene): DynamicTexture {
  const size = TILE_FRAME;
  const tex = new DynamicTexture("tileAtlas", { width: size * ATLAS_TILES, height: size }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = new G(ctx);

  TILE_ORDER.forEach((tile, i) => {
    const { fill, line } = TILE_COLORS[tile];
    const ox = i * size;
    // deterministic per-TYPE texture (identical to the Phaser tileset's rng)
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

  tex.update(false);
  tex.updateSamplingMode(Texture.NEAREST_NEAREST);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}
