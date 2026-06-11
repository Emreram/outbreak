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

const EDGE_CAP = 16; // shoreline sample points kept per chunk (for ambient particles)
const AMBIENT_MS = 200; // min interval between ambient particle puffs (global)
const MIN_BODY_TILES = 6; // puddles smaller than this get no shader (static tiles only)
const MAX_BODIES_PER_CHUNK = 4; // quad cap — bounds shader count at any load radius

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
    this.buildBodies(data, ov, "water");
    this.buildBodies(data, ov, "lava");
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

  /** Build per-BODY shader quads: flood-fill the member tiles into connected
   *  components and give each its own tight-bbox quad + mask. The old version
   *  used ONE quad over the bounding box of ALL water in the chunk — scattered
   *  water (old marsh) made that quad span the whole chunk and the translucent
   *  caustic wash covered the entire screen (the screenshot-reported "ocean over
   *  the forest"). Tiny puddles (< MIN_BODY_TILES) keep their static tiles +
   *  ambient particles but get no shader; quads are capped per chunk. */
  private buildBodies(data: ChunkData, ov: ChunkOverlay, kind: "water" | "lava"): void {
    const size = data.size;
    const grid = data.grid;
    const member = kind === "water" ? isWater : isLava;
    const { labels, bodies } = labelComponents(grid, size, member);
    if (bodies.length === 0) return;
    bodies.sort((a, b) => b.tiles - a.tiles); // biggest bodies get FX + quads first

    // Shoreline edge points (a member tile touching a non-member) → ambient FX.
    const edges = kind === "water" ? ov.waterEdges : ov.lavaEdges;
    for (const b of bodies) {
      for (let ly = b.minY; ly <= b.maxY && edges.length < EDGE_CAP; ly++) {
        for (let lx = b.minX; lx <= b.maxX && edges.length < EDGE_CAP; lx++) {
          if (labels[ly * size + lx] !== b.id) continue;
          const border =
            !member(grid[ly]?.[lx - 1] ?? -1) || !member(grid[ly]?.[lx + 1] ?? -1) ||
            !member(grid[ly - 1]?.[lx] ?? -1) || !member(grid[ly + 1]?.[lx] ?? -1);
          if (border && Math.random() < 0.5) {
            edges.push({ x: (data.cx * size + lx + 0.5) * TILE_SIZE, y: (data.cy * size + ly + 0.5) * TILE_SIZE });
          }
        }
      }
    }

    // WebGL shader overlays (each clipped to ITS body via a labels-only mask).
    const base = kind === "water" ? this.waterBase : this.lavaBase;
    if (!this.webgl || !base) return;
    let made = 0;
    for (const b of bodies) {
      if (b.tiles < MIN_BODY_TILES || made >= MAX_BODIES_PER_CHUNK) break; // sorted desc
      const maskKey = `lwmask_${kind}_${data.cx}_${data.cy}_${b.id}`;
      if (!this.writeMask(maskKey, grid, labels, b, size, kind)) continue;
      ov.maskKeys.push(maskKey);
      const w = b.maxX - b.minX + 1;
      const h = b.maxY - b.minY + 1;
      try {
        const px = (data.cx * size + b.minX) * TILE_SIZE;
        const py = (data.cy * size + b.minY) * TILE_SIZE;
        const sh = this.scene.add.shader(base, px + (w * TILE_SIZE) / 2, py + (h * TILE_SIZE) / 2, w * TILE_SIZE, h * TILE_SIZE, [maskKey]);
        sh.setDepth(kind === "water" ? 0.6 : 0.7);
        ov.shaders.push(sh);
        made++;
      } catch {
        // Shader unsupported on this device — keep the static tile + particles.
        if (this.scene.textures.exists(maskKey)) this.scene.textures.remove(maskKey);
        ov.maskKeys = ov.maskKeys.filter((k) => k !== maskKey);
      }
    }
  }

  /** Draw the membership/depth mask for ONE body's bounding box: alpha marks only
   *  tiles carrying this body's label, so two bodies with overlapping bboxes can
   *  never double-tint a texel. Returns false on failure. */
  private writeMask(
    key: string,
    grid: Tile[][],
    labels: Int32Array,
    body: Body,
    size: number,
    kind: "water" | "lava",
  ): boolean {
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const w = body.maxX - body.minX + 1;
    const h = body.maxY - body.minY + 1;
    const tex = this.scene.textures.createCanvas(key, w, h);
    const ctx = tex?.getContext();
    if (!tex || !ctx) return false;
    const img = ctx.createImageData(w, h);
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const lx = body.minX + ix;
        const ly = body.minY + iy;
        const o = (iy * w + ix) * 4;
        if (labels[ly * size + lx] === body.id) {
          const t = grid[ly][lx];
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

/** One 4-connected component of member tiles. */
interface Body {
  id: number;
  tiles: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Label the grid's member tiles into 4-connected components (iterative flood
 *  fill on a preallocated stack — no recursion, no per-tile allocations). */
function labelComponents(
  grid: Tile[][],
  size: number,
  member: (t: number) => boolean,
): { labels: Int32Array; bodies: Body[] } {
  const labels = new Int32Array(size * size); // 0 = not a member / unvisited
  const stack = new Int32Array(size * size);
  const bodies: Body[] = [];
  let next = 1;
  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      const si = sy * size + sx;
      if (labels[si] !== 0 || !member(grid[sy][sx])) continue;
      const body: Body = { id: next++, tiles: 0, minX: sx, minY: sy, maxX: sx, maxY: sy };
      let top = 0;
      stack[top++] = si;
      labels[si] = body.id;
      while (top > 0) {
        const i = stack[--top];
        const x = i % size;
        const y = (i / size) | 0;
        body.tiles++;
        if (x < body.minX) body.minX = x;
        if (x > body.maxX) body.maxX = x;
        if (y < body.minY) body.minY = y;
        if (y > body.maxY) body.maxY = y;
        if (x > 0 && labels[i - 1] === 0 && member(grid[y][x - 1])) { labels[i - 1] = body.id; stack[top++] = i - 1; }
        if (x < size - 1 && labels[i + 1] === 0 && member(grid[y][x + 1])) { labels[i + 1] = body.id; stack[top++] = i + 1; }
        if (y > 0 && labels[i - size] === 0 && member(grid[y - 1][x])) { labels[i - size] = body.id; stack[top++] = i - size; }
        if (y < size - 1 && labels[i + size] === 0 && member(grid[y + 1][x])) { labels[i + size] = body.id; stack[top++] = i + size; }
      }
      bodies.push(body);
    }
  }
  return { labels, bodies };
}
