import Phaser from "phaser";
import { generateChunk, chunkStartPx, SOLID_TILES, type Building, type ChunkData, type ContainerKind, type Landmark } from "../worldgen";
import { biomeAt } from "./biomes";
import { applyScars } from "./disasterScars";
import type { DisasterZone } from "../../shared/contracts";
import { dangerTierAt, lootBiasAt } from "./scaling";
import { findSpawnChunk } from "./spawn";
import {
  CHUNK_TILES,
  CHUNK_LOAD_RADIUS,
  TILE_SIZE,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Y,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
} from "../constants";
import { ChunkView, type ColliderSpec } from "../../engine/ChunkRenderer";
import { CHEST_CLOSED, PADLOCK } from "../../engine/icons";
import { fxTexFor } from "../../engine/fx";
import { propKey } from "../../engine/propSprites";
import { isSearchableKind } from "../scavenge";

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

/** A streamed searchable world prop (car/dumpster/corpse/shelf…, Expansion U1). */
export interface ActiveSearchable {
  gid: string;
  kind: string;
  sprite: Phaser.GameObjects.Image;
  searched: boolean;
}

/** Tint for ransacked props so a searched street reads at a glance. */
export const SEARCHED_TINT = 0x5f5f5f;

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
  searchables: ActiveSearchable[];
}

export interface ChunkManagerOpts {
  collide: ColliderSpec[]; // colliders to register against every chunk layer
  isChestLooted: (gid: string) => boolean;
  isPropSearched?: (gid: string) => boolean; // searchable props already rummaged
  // --- Living World hooks (all optional → back-compat) ---
  disasters?: () => readonly DisasterZone[]; // active scars to overlay on each chunk
  currentDay?: () => number; // game-day, for scar heal lifecycle
  onChunkLoad?: (data: ChunkData) => void; // notify (e.g. AnimatedTerrain) a chunk's grid is live
  onChunkUnload?: (cx: number, cy: number) => void; // notify a chunk was torn down
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
    const sc = findSpawnChunk(seed); // a naturally hospitable, dry chunk for this seed
    const spawn = generateChunk(seed, sc.x, sc.y);
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

  /** Searchable props are owned here (interactive), not by the ChunkView. The skip
   *  predicate must EXACTLY match spawnSearchables' spawn condition. */
  private readonly skipSearchable = (p: { kind: string; gid?: string }): boolean =>
    !!p.gid && isSearchableKind(p.kind) && this.scene.textures.exists(propKey(p.kind));

  private load(cx: number, cy: number): void {
    const data = generateChunk(this.seed, cx, cy);
    applyScars(data, this.opts.disasters?.(), this.opts.currentDay?.() ?? 0);
    const view = new ChunkView(this.scene, data, this.opts.collide, this.skipSearchable);
    const chests: ActiveChest[] = [];
    for (const c of data.containers) {
      if (this.opts.isChestLooted(c.gid)) continue;
      const x = (c.tx + 0.5) * TILE_SIZE;
      const y = (c.ty + 0.5) * TILE_SIZE;
      const kt = fxTexFor(this.scene, CHEST_CLOSED, KIND_TINT[c.kind] ?? KIND_TINT.crate);
      const spr = this.scene.add.image(x, y, kt.key).setDepth(6).setTint(kt.tint);
      const chest: ActiveChest = { gid: c.gid, sprite: spr, tier: c.tier, kind: c.kind, locked: c.locked, opened: false };
      if (c.locked) chest.badge = this.scene.add.image(x + 9, y - 8, PADLOCK).setDepth(7);
      chests.push(chest);
    }
    this.loaded.set(key(cx, cy), { cx, cy, data, view, chests, searchables: this.spawnSearchables(data) });
    this.opts.onChunkLoad?.(data);
  }

  private spawnSearchables(data: ChunkData): ActiveSearchable[] {
    const out: ActiveSearchable[] = [];
    for (const p of data.props) {
      if (!this.skipSearchable(p)) continue; // not searchable → ChunkView draws it
      const searched = this.opts.isPropSearched?.(p.gid!) ?? false;
      const spr = this.scene.add.image(p.x, p.y, propKey(p.kind)).setDepth(4);
      if (searched) spr.setTint(SEARCHED_TINT).setAlpha(0.55); // alpha too — canvas ignores tints
      out.push({ gid: p.gid!, kind: p.kind, sprite: spr, searched });
    }
    return out;
  }

  private unload(k: string): void {
    const lc = this.loaded.get(k);
    if (!lc) return;
    lc.view.destroy();
    for (const c of lc.chests) {
      c.sprite.destroy();
      c.badge?.destroy();
    }
    for (const s of lc.searchables) s.sprite.destroy();
    this.loaded.delete(k);
    this.opts.onChunkUnload?.(lc.cx, lc.cy);
  }

  /** Re-derive every resident chunk's terrain against the CURRENT disaster scars
   *  and rebuild its tile layer. Call right after a disaster mutates the world so
   *  fresh lava/burn/flood appears immediately (chests are unaffected — kept). */
  refreshLoaded(): void {
    for (const lc of this.loaded.values()) {
      const data = generateChunk(this.seed, lc.cx, lc.cy);
      applyScars(data, this.opts.disasters?.(), this.opts.currentDay?.() ?? 0);
      lc.view.destroy();
      lc.view = new ChunkView(this.scene, data, this.opts.collide, this.skipSearchable);
      lc.data = data;
      for (const s of lc.searchables) s.sprite.destroy();
      lc.searchables = this.spawnSearchables(data); // same gids → searched state restored via flags
      this.opts.onChunkUnload?.(lc.cx, lc.cy);
      this.opts.onChunkLoad?.(data);
    }
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

  /** The raw tile value at a global tile, or null if not in a loaded chunk. */
  tileAt(gtx: number, gty: number): number | null {
    const lc = this.chunkAt(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return null;
    const lx = gtx - lc.cx * CHUNK_TILES;
    const ly = gty - lc.cy * CHUNK_TILES;
    return lc.data.grid[ly]?.[lx] ?? null;
  }

  /** Landmarks of the loaded chunk at (cx, cy) — for minimap discovery (Feature 10). */
  landmarksAt(cx: number, cy: number): Landmark[] {
    return this.chunkAt(cx, cy)?.data.landmarks ?? [];
  }

  /** Set-piece guard packs of the loaded chunk at (cx, cy) (Expansion U2). */
  ambushAt(cx: number, cy: number): readonly { x: number; y: number; count: number }[] {
    return this.chunkAt(cx, cy)?.data.ambush ?? [];
  }

  /** Buildings of the loaded chunk at (cx, cy) (U5 building overlays / camps). */
  buildingsAt(cx: number, cy: number): readonly Building[] {
    return this.chunkAt(cx, cy)?.data.buildings ?? [];
  }

  /** Biome id of the loaded chunk at (cx, cy) without re-deriving from noise. */
  chunkBiome(cx: number, cy: number): string | null {
    return this.chunkAt(cx, cy)?.data.biome ?? null;
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

  /** Nearest walkable tile centre within `maxR` tiles — a deterministic ring
   *  scan (nearest first), used as the landing scanner for flying mounts (PR-B). */
  nearestWalkable(gtx: number, gty: number, maxR: number): { x: number; y: number } | null {
    if (this.walkable(gtx, gty)) return { x: (gtx + 0.5) * TILE_SIZE, y: (gty + 0.5) * TILE_SIZE };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
          if (this.walkable(gtx + dx, gty + dy)) {
            return { x: (gtx + dx + 0.5) * TILE_SIZE, y: (gty + dy + 0.5) * TILE_SIZE };
          }
        }
      }
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

  /** Wind-swayed prop images across loaded chunks (Anim PR 4 — the scene's
   *  sway pass culls + caps; mirrors activeChests). */
  activeSwayables(): { img: Phaser.GameObjects.Image; phase: number; kind: string }[] {
    const out: { img: Phaser.GameObjects.Image; phase: number; kind: string }[] = [];
    for (const lc of this.loaded.values()) for (const sw of lc.view.swayables) out.push(sw);
    return out;
  }

  activeChests(): ActiveChest[] {
    const out: ActiveChest[] = [];
    for (const lc of this.loaded.values()) for (const c of lc.chests) out.push(c);
    return out;
  }

  /** All streamed searchable props in loaded chunks (Expansion U1). */
  activeSearchables(): ActiveSearchable[] {
    const out: ActiveSearchable[] = [];
    for (const lc of this.loaded.values()) for (const s of lc.searchables) out.push(s);
    return out;
  }
}

function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
