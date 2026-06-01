import Phaser from "phaser";
import { generateChunk, chunkStartPx, SOLID_TILES, type Building, type ChunkData, type ContainerKind } from "../worldgen";
import { biomeAt } from "./biomes";
import { dangerTierAt, lootBiasAt } from "./scaling";
import {
  CHUNK_TILES,
  CHUNK_LOAD_RADIUS,
  SPAWN_CHUNK,
  TILE_SIZE,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Y,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
} from "../constants";
import { ChunkView, type ColliderSpec } from "../../engine/ChunkRenderer";
import { CHEST_CLOSED, PADLOCK } from "../../engine/icons";

// Streams the enormous, finite world: keeps a (2r+1)² ring of generated chunks
// resident around the player, generating/destroying them on chunk-boundary
// crossings. The single source of truth for terrain queries (replaces the old
// one-map `this.world`): walkability, buildings, spawn sampling, and the
// distance/biome-based danger + loot scaling.

const SOLID = new Set<number>(SOLID_TILES as number[]);
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
const UNLOAD_RADIUS = CHUNK_LOAD_RADIUS + 1; // hysteresis so borders don't thrash

export interface ActiveChest {
  gid: string;
  sprite: Phaser.GameObjects.Image;
  badge?: Phaser.GameObjects.Image; // padlock overlay while locked
  tier: number;
  kind: ContainerKind;
  locked: boolean;
  opened: boolean;
}

// Cheap per-kind tint of the chest sprite so container variety reads at a glance
// (dedicated kind sprites arrive with the AI/procedural art pass).
const KIND_TINT: Record<ContainerKind, number> = {
  crate: 0xb5853f,
  drawer: 0x9c6b3f,
  cabinet: 0x8a8f98,
  locker: 0x5f86a8,
  fridge: 0xdfe6ec,
  toolbox: 0xd1483a,
  register: 0x6e7b86,
  med_cabinet: 0xeef2f5,
  gun_cabinet: 0x4a4036,
  safe: 0x676b71,
};

interface LoadedChunk {
  cx: number;
  cy: number;
  data: ChunkData;
  view: ChunkView;
  chests: ActiveChest[];
}

export interface ChunkManagerOpts {
  collide: ColliderSpec[]; // colliders to register against every chunk layer
  isChestLooted: (gid: string) => boolean;
}

export class ChunkManager {
  readonly start: { x: number; y: number };
  private readonly scene: Phaser.Scene;
  private readonly seed: string;
  private readonly opts: ChunkManagerOpts;
  private readonly loaded = new Map<string, LoadedChunk>();
  private lastCenter = { cx: NaN, cy: NaN };

  constructor(scene: Phaser.Scene, seed: string, opts: ChunkManagerOpts) {
    this.scene = scene;
    this.seed = seed;
    this.opts = opts;
    const spawn = generateChunk(seed, SPAWN_CHUNK.x, SPAWN_CHUNK.y);
    this.start = chunkStartPx(spawn);
  }

  worldPxBounds(): { w: number; h: number } {
    return { w: WORLD_WIDTH_PX, h: WORLD_HEIGHT_PX };
  }

  /** Stream chunks in/out around a world-pixel position. Cheap unless the
   *  player crossed into a new chunk. */
  ensureAround(px: number, py: number): void {
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);
    if (ccx === this.lastCenter.cx && ccy === this.lastCenter.cy) return;
    this.lastCenter = { cx: ccx, cy: ccy };

    for (let dy = -CHUNK_LOAD_RADIUS; dy <= CHUNK_LOAD_RADIUS; dy++) {
      for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS; dx++) {
        const cx = ccx + dx;
        const cy = ccy + dy;
        if (cx < 0 || cy < 0 || cx >= WORLD_CHUNKS_X || cy >= WORLD_CHUNKS_Y) continue;
        if (!this.loaded.has(key(cx, cy))) this.load(cx, cy);
      }
    }
    for (const [k, lc] of this.loaded) {
      if (Math.max(Math.abs(lc.cx - ccx), Math.abs(lc.cy - ccy)) > UNLOAD_RADIUS) this.unload(k);
    }
  }

  private load(cx: number, cy: number): void {
    const data = generateChunk(this.seed, cx, cy);
    const view = new ChunkView(this.scene, data, this.opts.collide);
    const chests: ActiveChest[] = [];
    for (const c of data.containers) {
      if (this.opts.isChestLooted(c.gid)) continue;
      const x = (c.tx + 0.5) * TILE_SIZE;
      const y = (c.ty + 0.5) * TILE_SIZE;
      const spr = this.scene.add.image(x, y, CHEST_CLOSED).setDepth(6).setTint(KIND_TINT[c.kind] ?? KIND_TINT.crate);
      const chest: ActiveChest = { gid: c.gid, sprite: spr, tier: c.tier, kind: c.kind, locked: c.locked, opened: false };
      if (c.locked) chest.badge = this.scene.add.image(x + 9, y - 8, PADLOCK).setDepth(7);
      chests.push(chest);
    }
    this.loaded.set(key(cx, cy), { cx, cy, data, view, chests });
  }

  private unload(k: string): void {
    const lc = this.loaded.get(k);
    if (!lc) return;
    lc.view.destroy();
    for (const c of lc.chests) {
      c.sprite.destroy();
      c.badge?.destroy();
    }
    this.loaded.delete(k);
  }

  destroy(): void {
    for (const k of [...this.loaded.keys()]) this.unload(k);
  }

  // --- terrain queries (global tile coords) --------------------------------

  private chunkAt(cx: number, cy: number): LoadedChunk | undefined {
    return this.loaded.get(key(cx, cy));
  }

  /** Walkable iff in-bounds, in a loaded chunk, and not a solid tile. */
  walkable(gtx: number, gty: number): boolean {
    if (gtx < 0 || gty < 0 || gtx >= WORLD_CHUNKS_X * CHUNK_TILES || gty >= WORLD_CHUNKS_Y * CHUNK_TILES) return false;
    const lc = this.chunkAt(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return false;
    const lx = gtx - lc.cx * CHUNK_TILES;
    const ly = gty - lc.cy * CHUNK_TILES;
    return !SOLID.has(lc.data.grid[ly][lx]);
  }

  /** The building whose interior contains a global tile, or null. */
  buildingAt(gtx: number, gty: number): Building | null {
    const lc = this.chunkAt(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return null;
    for (const b of lc.data.buildings) {
      if (gtx >= b.tx && gtx <= b.tx + b.tw - 1 && gty >= b.ty && gty <= b.ty + b.th - 1) return b;
    }
    return null;
  }

  /** A walkable world-pixel point at tile-radius [minR, maxR] from (gtx, gty). */
  walkableNear(gtx: number, gty: number, minR: number, maxR: number): { x: number; y: number } | null {
    for (let tries = 0; tries < 50; tries++) {
      const r = Phaser.Math.Between(minR, maxR);
      const a = Math.random() * Math.PI * 2;
      const nx = Math.round(gtx + Math.cos(a) * r);
      const ny = Math.round(gty + Math.sin(a) * r);
      if (this.walkable(nx, ny)) return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
    }
    return null;
  }

  /** A walkable point at least `minR` tiles away, sampled within loaded chunks. */
  randomWalkableInView(px: number, py: number, minR: number): { x: number; y: number } | null {
    const gtx = Math.floor(px / TILE_SIZE);
    const gty = Math.floor(py / TILE_SIZE);
    const reach = CHUNK_LOAD_RADIUS * CHUNK_TILES;
    for (let tries = 0; tries < 80; tries++) {
      const nx = gtx + Phaser.Math.Between(-reach, reach);
      const ny = gty + Phaser.Math.Between(-reach, reach);
      if (Math.hypot(nx - gtx, ny - gty) >= minR && this.walkable(nx, ny)) {
        return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
      }
    }
    return null;
  }

  // --- distance + biome scaling (pure math in ./scaling) -------------------

  /** Integer danger boost (added to `day` for spawns): distance + biome. */
  dangerTier(px: number, py: number): number {
    return dangerTierAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX));
  }

  /** Loot rarity bias (added to rollLoot's extraBias): distance + biome. */
  lootBias(px: number, py: number): number {
    return lootBiasAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX));
  }

  /** Biome id at a world-pixel position (for biome-aware encounters/loot). */
  biomeAtPx(px: number, py: number): string {
    return biomeAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX)).id;
  }

  // --- chests (interactive; owned per loaded chunk) ------------------------

  activeChests(): ActiveChest[] {
    const out: ActiveChest[] = [];
    for (const lc of this.loaded.values()) for (const c of lc.chests) out.push(c);
    return out;
  }
}

function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
