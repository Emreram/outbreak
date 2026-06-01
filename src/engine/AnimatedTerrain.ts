import Phaser from "phaser";
import { Tile, type ChunkData } from "../game/worldgen";
import { TILE_SIZE } from "../game/constants";
import { splashPuff, emberPuff } from "./fx";
import { WATER_FRAG } from "./shaders/water";
import { LAVA_FRAG } from "./shaders/lava";

// Living-world animated terrain. For each streamed chunk it finds the water + lava
// bodies and draws an animated, GPU-shaded overlay clipped to their exact tile shape:
//  - WebGL: a Phaser.GameObjects.Shader quad over each body's bounding box, fed a
//    per-tile MASK texture (alpha = membership, green = water depth). The shaders
//    (water.ts / lava.ts) animate from Phaser's auto-updated `time` uniform — no
//    per-frame JS — and discard non-member texels so there's no overshoot onto land.
//  - No WebGL (rare Canvas fallback) or shader-creation failure: the static water/
//    lava tiles still render; we add only the ambient particles below so it never
//    looks dead and can never crash.
// Ambient ripple/ember particles are emitted along shorelines, globally rate-gated.
//
// Owned + ticked by WorldScene; mirrors ChunkManager load/unload via callbacks.

interface ChunkOverlay {
  shaders: Phaser.GameObjects.Shader[];
  maskKeys: string[];
  waterEdges: { x: number; y: number }[];
  lavaEdges: { x: number; y: number }[];
}

const EDGE_CAP = 16; // shoreline sample points kept per body (for ambient particles)
const AMBIENT_MS = 200; // min interval between ambient particle puffs (global)

const isWater = (t: number): boolean => t === Tile.Water || t === Tile.ShallowWater || t === Tile.DeepWater;
const isLava = (t: number): boolean => t === Tile.Lava;
const ckey = (cx: number, cy: number): string => `${cx},${cy}`;

export class AnimatedTerrain {
  private readonly scene: Phaser.Scene;
  private readonly webgl: boolean;
  private waterBase?: Phaser.Display.BaseShader;
  private lavaBase?: Phaser.Display.BaseShader;
  private readonly overlays = new Map<string, ChunkOverlay>();
  private ambientAcc = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.webgl = scene.game.renderer.type === Phaser.WEBGL;
    if (this.webgl) {
      try {
        this.waterBase = new Phaser.Display.BaseShader("lw_water", WATER_FRAG);
        this.lavaBase = new Phaser.Display.BaseShader("lw_lava", LAVA_FRAG);
      } catch {
        this.waterBase = undefined;
        this.lavaBase = undefined; // fall back to particle-only
      }
    }
  }

  /** Build/refresh the animated overlay for a (re)loaded chunk. */
  syncChunk(data: ChunkData): void {
    this.dropChunk(data.cx, data.cy); // idempotent — clears any prior overlay
    const ov: ChunkOverlay = { shaders: [], maskKeys: [], waterEdges: [], lavaEdges: [] };
    this.buildBody(data, ov, "water");
    this.buildBody(data, ov, "lava");
    if (ov.shaders.length || ov.waterEdges.length || ov.lavaEdges.length) this.overlays.set(ckey(data.cx, data.cy), ov);
  }

  /** Tear down a chunk's overlay (called on unload + before a refresh). */
  dropChunk(cx: number, cy: number): void {
    const k = ckey(cx, cy);
    const ov = this.overlays.get(k);
    if (!ov) return;
    for (const s of ov.shaders) s.destroy();
    for (const mk of ov.maskKeys) if (this.scene.textures.exists(mk)) this.scene.textures.remove(mk);
    this.overlays.delete(k);
  }

  destroy(): void {
    for (const k of [...this.overlays.keys()]) {
      const [cx, cy] = k.split(",").map(Number);
      this.dropChunk(cx, cy);
    }
  }

  /** Per-frame: shaders self-animate via `time`; here we just sprinkle ambient
   *  shoreline ripples / lava embers, globally rate-limited so cost is bounded
   *  regardless of how much water/lava is on screen. */
  update(delta: number): void {
    this.ambientAcc += delta;
    if (this.ambientAcc < AMBIENT_MS) return;
    this.ambientAcc = 0;
    const list = [...this.overlays.values()];
    if (list.length === 0) return;
    const ov = list[(Math.random() * list.length) | 0];
    if (ov.waterEdges.length && Math.random() < 0.7) {
      const p = ov.waterEdges[(Math.random() * ov.waterEdges.length) | 0];
      splashPuff(this.scene, p.x, p.y, 2);
    }
    if (ov.lavaEdges.length) {
      const p = ov.lavaEdges[(Math.random() * ov.lavaEdges.length) | 0];
      emberPuff(this.scene, p.x, p.y, 2);
    }
  }

  // --- internals ------------------------------------------------------------

  private buildBody(data: ChunkData, ov: ChunkOverlay, kind: "water" | "lava"): void {
    const size = data.size;
    const grid = data.grid;
    const member = kind === "water" ? isWater : isLava;
    let minX = size;
    let minY = size;
    let maxX = -1;
    let maxY = -1;
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        if (!member(grid[ly][lx])) continue;
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
      }
    }
    if (maxX < 0) return; // none of this kind here
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    // Shoreline edge points (a member tile touching a non-member) → ambient FX.
    const edges = kind === "water" ? ov.waterEdges : ov.lavaEdges;
    for (let ly = minY; ly <= maxY && edges.length < EDGE_CAP; ly++) {
      for (let lx = minX; lx <= maxX && edges.length < EDGE_CAP; lx++) {
        if (!member(grid[ly][lx])) continue;
        const border =
          !member(grid[ly]?.[lx - 1] ?? -1) || !member(grid[ly]?.[lx + 1] ?? -1) ||
          !member(grid[ly - 1]?.[lx] ?? -1) || !member(grid[ly + 1]?.[lx] ?? -1);
        if (border && Math.random() < 0.5) {
          edges.push({ x: (data.cx * size + lx + 0.5) * TILE_SIZE, y: (data.cy * size + ly + 0.5) * TILE_SIZE });
        }
      }
    }

    // WebGL shader overlay (clipped to the real shape via a per-tile mask).
    const base = kind === "water" ? this.waterBase : this.lavaBase;
    if (!this.webgl || !base) return;
    const maskKey = `lwmask_${kind}_${data.cx}_${data.cy}`;
    if (!this.writeMask(maskKey, grid, minX, minY, w, h, member, kind)) return;
    ov.maskKeys.push(maskKey);
    try {
      const px = (data.cx * size + minX) * TILE_SIZE;
      const py = (data.cy * size + minY) * TILE_SIZE;
      const sh = this.scene.add.shader(base, px + (w * TILE_SIZE) / 2, py + (h * TILE_SIZE) / 2, w * TILE_SIZE, h * TILE_SIZE, [maskKey]);
      sh.setDepth(kind === "water" ? 0.6 : 0.7);
      ov.shaders.push(sh);
    } catch {
      // Shader unsupported on this device — keep the static tile + particles.
      if (this.scene.textures.exists(maskKey)) this.scene.textures.remove(maskKey);
      ov.maskKeys = ov.maskKeys.filter((k) => k !== maskKey);
    }
  }

  /** Draw the membership/depth mask for a body's bounding box. Returns false on failure. */
  private writeMask(
    key: string,
    grid: Tile[][],
    minX: number,
    minY: number,
    w: number,
    h: number,
    member: (t: number) => boolean,
    kind: "water" | "lava",
  ): boolean {
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, w, h);
    const ctx = tex?.getContext();
    if (!tex || !ctx) return false;
    const img = ctx.createImageData(w, h);
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const t = grid[minY + iy][minX + ix];
        const o = (iy * w + ix) * 4;
        if (member(t)) {
          img.data[o] = 255;
          img.data[o + 1] = kind === "water" ? (t === Tile.DeepWater ? 255 : t === Tile.Water ? 200 : 90) : 0; // depth
          img.data[o + 2] = 0;
          img.data[o + 3] = 255; // membership
        } else {
          img.data[o + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    return true;
  }
}
