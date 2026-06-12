// Renderer-agnostic chunk store — the de-Phasered ChunkManager (3D master plan
// §3.2 / M1). Streams the same (2r+1)² ring of deterministically generated
// chunks with the same hysteresis, owns chest/searchable RECORDS (no sprites),
// and answers every terrain query the sim needs. Views (Babylon's
// ChunkViewManager, or anything else) subscribe to load/unload callbacks and
// build/destroy their own presentation. Terrain itself is identical to the
// Phaser path by construction: both call generateChunk + applyScars.

import { generateChunk, chunkStartPx, SOLID_TILES, type Building, type ChunkData, type ContainerKind, type Landmark } from "../game/worldgen";
import { biomeAt } from "../game/world/biomes";
import { applyScars } from "../game/world/disasterScars";
import type { DisasterZone } from "../shared/contracts";
import { dangerTierAt, lootBiasAt } from "../game/world/scaling";
import { findSpawnChunk } from "../game/world/spawn";
import { isSearchableKind } from "../game/scavenge";
import {
  CHUNK_TILES,
  CHUNK_LOAD_RADIUS,
  TILE_SIZE,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Y,
  WORLD_WIDTH_PX,
  WORLD_HEIGHT_PX,
} from "../game/constants";
import type { TileGrid } from "./physics";

const SOLID = new Set<number>(SOLID_TILES as number[]);
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
const UNLOAD_RADIUS = CHUNK_LOAD_RADIUS + 1; // hysteresis so borders don't thrash

/** A lootable container record (the sim/3D analog of ChunkManager.ActiveChest). */
export interface ChestRec {
  gid: string;
  x: number; // world px (tile centre)
  y: number;
  tier: number;
  kind: ContainerKind;
  locked: boolean;
  opened: boolean;
}

/** A streamed searchable world prop record (car/dumpster/corpse/shelf…). */
export interface SearchableRec {
  gid: string;
  kind: string;
  x: number;
  y: number;
  searched: boolean;
}

interface LoadedChunk {
  cx: number;
  cy: number;
  data: ChunkData;
  chests: ChestRec[];
  searchables: SearchableRec[];
}

export interface SimChunkStoreOpts {
  isChestLooted: (gid: string) => boolean;
  isPropSearched?: (gid: string) => boolean;
  disasters?: () => readonly DisasterZone[];
  currentDay?: () => number;
  onChunkLoad?: (data: ChunkData) => void;
  onChunkUnload?: (cx: number, cy: number) => void;
  /** Random source for the sampling helpers (injectable for determinism in tests). */
  random?: () => number;
}

export class SimChunkStore implements TileGrid {
  readonly start: { x: number; y: number };
  private readonly seed: string;
  private readonly opts: SimChunkStoreOpts;
  private readonly loaded = new Map<string, LoadedChunk>();
  private lastCenter = { cx: NaN, cy: NaN };
  private readonly rnd: () => number;

  constructor(seed: string, opts: SimChunkStoreOpts) {
    this.seed = seed;
    this.opts = opts;
    this.rnd = opts.random ?? Math.random;
    const sc = findSpawnChunk(seed);
    const spawn = generateChunk(seed, sc.x, sc.y);
    this.start = chunkStartPx(spawn);
  }

  worldPxBounds(): { w: number; h: number } {
    return { w: WORLD_WIDTH_PX, h: WORLD_HEIGHT_PX };
  }

  /** Stream chunks in/out around a world-pixel position (cheap unless the
   *  centre chunk changed). */
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

  /** Searchable iff the generator stamped a stable gid on a searchable kind.
   *  (The Phaser path additionally required the prop texture to exist — a
   *  defensive guard, not a rule; every searchable kind has a generator.) */
  private isSearchableProp(p: { kind: string; gid?: string }): boolean {
    return !!p.gid && isSearchableKind(p.kind);
  }

  private load(cx: number, cy: number): void {
    const data = generateChunk(this.seed, cx, cy);
    applyScars(data, this.opts.disasters?.(), this.opts.currentDay?.() ?? 0);
    const chests: ChestRec[] = [];
    for (const c of data.containers) {
      if (this.opts.isChestLooted(c.gid)) continue;
      chests.push({
        gid: c.gid,
        x: (c.tx + 0.5) * TILE_SIZE,
        y: (c.ty + 0.5) * TILE_SIZE,
        tier: c.tier,
        kind: c.kind,
        locked: c.locked,
        opened: false,
      });
    }
    const searchables: SearchableRec[] = [];
    for (const p of data.props) {
      if (!this.isSearchableProp(p)) continue;
      searchables.push({
        gid: p.gid!,
        kind: p.kind,
        x: p.x,
        y: p.y,
        searched: this.opts.isPropSearched?.(p.gid!) ?? false,
      });
    }
    this.loaded.set(key(cx, cy), { cx, cy, data, chests, searchables });
    this.opts.onChunkLoad?.(data);
  }

  private unload(k: string): void {
    const lc = this.loaded.get(k);
    if (!lc) return;
    this.loaded.delete(k);
    this.opts.onChunkUnload?.(lc.cx, lc.cy);
  }

  /** Re-derive every resident chunk against CURRENT disaster scars (fresh
   *  lava/burn/flood appears immediately). Chest records are kept; searchables
   *  re-spawn with their searched state restored from flags. */
  refreshLoaded(): void {
    for (const lc of this.loaded.values()) {
      const data = generateChunk(this.seed, lc.cx, lc.cy);
      applyScars(data, this.opts.disasters?.(), this.opts.currentDay?.() ?? 0);
      lc.data = data;
      lc.searchables = [];
      for (const p of data.props) {
        if (!this.isSearchableProp(p)) continue;
        lc.searchables.push({
          gid: p.gid!,
          kind: p.kind,
          x: p.x,
          y: p.y,
          searched: this.opts.isPropSearched?.(p.gid!) ?? false,
        });
      }
      this.opts.onChunkUnload?.(lc.cx, lc.cy);
      this.opts.onChunkLoad?.(data);
    }
  }

  destroy(): void {
    for (const k of [...this.loaded.keys()]) this.unload(k);
  }

  // --- terrain queries (global tile coords) --------------------------------

  private chunkAtCoord(cx: number, cy: number): LoadedChunk | undefined {
    return this.loaded.get(key(cx, cy));
  }

  /** The chunk data at chunk coords, if resident (views mesh from this). */
  chunkData(cx: number, cy: number): ChunkData | null {
    return this.chunkAtCoord(cx, cy)?.data ?? null;
  }

  loadedChunks(): readonly { cx: number; cy: number; data: ChunkData }[] {
    return [...this.loaded.values()];
  }

  walkable(gtx: number, gty: number): boolean {
    if (gtx < 0 || gty < 0 || gtx >= WORLD_CHUNKS_X * CHUNK_TILES || gty >= WORLD_CHUNKS_Y * CHUNK_TILES) return false;
    const lc = this.chunkAtCoord(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return false;
    const lx = gtx - lc.cx * CHUNK_TILES;
    const ly = gty - lc.cy * CHUNK_TILES;
    return !SOLID.has(lc.data.grid[ly][lx]);
  }

  tileAt(gtx: number, gty: number): number | null {
    const lc = this.chunkAtCoord(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return null;
    const lx = gtx - lc.cx * CHUNK_TILES;
    const ly = gty - lc.cy * CHUNK_TILES;
    return lc.data.grid[ly]?.[lx] ?? null;
  }

  /** Tile under a world-pixel position (the "underfoot" query). */
  tileAtPx(px: number, py: number): number | null {
    return this.tileAt(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  landmarksAt(cx: number, cy: number): Landmark[] {
    return this.chunkAtCoord(cx, cy)?.data.landmarks ?? [];
  }

  ambushAt(cx: number, cy: number): readonly { x: number; y: number; count: number }[] {
    return this.chunkAtCoord(cx, cy)?.data.ambush ?? [];
  }

  buildingsAt(cx: number, cy: number): readonly Building[] {
    return this.chunkAtCoord(cx, cy)?.data.buildings ?? [];
  }

  chunkBiome(cx: number, cy: number): string | null {
    return this.chunkAtCoord(cx, cy)?.data.biome ?? null;
  }

  buildingAt(gtx: number, gty: number): Building | null {
    const lc = this.chunkAtCoord(Math.floor(gtx / CHUNK_TILES), Math.floor(gty / CHUNK_TILES));
    if (!lc) return null;
    for (const b of lc.data.buildings) {
      if (gtx >= b.tx && gtx <= b.tx + b.tw - 1 && gty >= b.ty && gty <= b.ty + b.th - 1) return b;
    }
    return null;
  }

  /** A walkable world-pixel point at tile-radius [minR, maxR] from (gtx, gty). */
  walkableNear(gtx: number, gty: number, minR: number, maxR: number): { x: number; y: number } | null {
    for (let tries = 0; tries < 50; tries++) {
      const r = minR + Math.floor(this.rnd() * (maxR - minR + 1));
      const a = this.rnd() * Math.PI * 2;
      const nx = Math.round(gtx + Math.cos(a) * r);
      const ny = Math.round(gty + Math.sin(a) * r);
      if (this.walkable(nx, ny)) return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
    }
    return null;
  }

  /** Nearest walkable tile centre within maxR tiles — deterministic ring scan
   *  (the landing scanner for flying mounts). */
  nearestWalkable(gtx: number, gty: number, maxR: number): { x: number; y: number } | null {
    if (this.walkable(gtx, gty)) return { x: (gtx + 0.5) * TILE_SIZE, y: (gty + 0.5) * TILE_SIZE };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.walkable(gtx + dx, gty + dy)) {
            return { x: (gtx + dx + 0.5) * TILE_SIZE, y: (gty + dy + 0.5) * TILE_SIZE };
          }
        }
      }
    }
    return null;
  }

  /** A walkable point at least minR tiles away, sampled within loaded chunks. */
  randomWalkableInView(px: number, py: number, minR: number): { x: number; y: number } | null {
    const gtx = Math.floor(px / TILE_SIZE);
    const gty = Math.floor(py / TILE_SIZE);
    const reach = CHUNK_LOAD_RADIUS * CHUNK_TILES;
    for (let tries = 0; tries < 80; tries++) {
      const nx = gtx + (Math.floor(this.rnd() * (reach * 2 + 1)) - reach);
      const ny = gty + (Math.floor(this.rnd() * (reach * 2 + 1)) - reach);
      if (Math.hypot(nx - gtx, ny - gty) >= minR && this.walkable(nx, ny)) {
        return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
      }
    }
    return null;
  }

  // --- distance + biome scaling (pure math in game/world/scaling) -----------

  dangerTier(px: number, py: number): number {
    return dangerTierAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX));
  }

  lootBias(px: number, py: number): number {
    return lootBiasAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX));
  }

  biomeAtPx(px: number, py: number): string {
    return biomeAt(this.seed, Math.floor(px / CHUNK_PX), Math.floor(py / CHUNK_PX)).id;
  }

  // --- interactive records --------------------------------------------------

  activeChests(): ChestRec[] {
    const out: ChestRec[] = [];
    for (const lc of this.loaded.values()) for (const c of lc.chests) out.push(c);
    return out;
  }

  activeSearchables(): SearchableRec[] {
    const out: SearchableRec[] = [];
    for (const lc of this.loaded.values()) for (const s of lc.searchables) out.push(s);
    return out;
  }
}

function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
