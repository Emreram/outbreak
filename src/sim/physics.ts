// Arcade-equivalent planar physics (3D master plan §3.4) — a hand-port of the
// ~6 Phaser Arcade behaviors the game actually uses, kept pure and unit-tested
// so positions are bit-stable for golden replays and save compatibility.
// NO physics engine, NO navmesh (decision record in the master plan):
//   1. AABB move-and-slide vs the solid-tile grid (resolve X, then Y — the
//      Arcade separate-axis slide that lets a 20px body glide through 1-tile
//      doorways).
//   2. Per-tile process gates (ColliderSpec.process port): a gate returning
//      true makes that tile PASSABLE for this body (flying mounts pass all,
//      swimmers pass water only).
//   3. Circle overlaps + a uniform spatial hash broadphase (touch attacks,
//      pickup magnets, aura radii).
//   4. Swept-segment tile traces (projectiles vs walls, line of sight).
// All units are sim PIXELS and seconds. The tile grid is queried through the
// minimal TileGrid interface; an unloaded chunk (null tile) is SOLID, matching
// ChunkManager.walkable()'s "not loaded ⇒ not walkable".

import { TILE_SIZE } from "../game/constants";
import { SOLID_TILES } from "../game/world/tiles";

const SOLID = new Set<number>(SOLID_TILES as readonly number[]);

export interface TileGrid {
  /** Raw tile at a global tile coord, or null when out of bounds / unloaded. */
  tileAt(gtx: number, gty: number): number | null;
}

/**
 * Per-tile pass gate (the ColliderSpec.process port, sense inverted to read
 * naturally): return TRUE to pass through this normally-solid tile.
 * Phaser's processCallback returned false to pass; this returns true to pass.
 */
export type TileGate = (tile: number, gtx: number, gty: number) => boolean;

export interface MoveOpts {
  gate?: TileGate;
  /** World pixel bounds — body centre clamped to [half, w-half] (collideWorldBounds). */
  bounds?: { w: number; h: number };
}

export interface MoveResult {
  x: number;
  y: number;
  /** True if the body was blocked on that axis this step. */
  hitX: boolean;
  hitY: boolean;
}

function isSolidFor(grid: TileGrid, gtx: number, gty: number, gate?: TileGate): boolean {
  const t = grid.tileAt(gtx, gty);
  if (t === null) return true; // unloaded/out of bounds blocks, like ChunkManager
  if (!SOLID.has(t)) return false;
  return gate ? !gate(t, gtx, gty) : true;
}

// Epsilon keeps a body whose edge sits exactly on a tile boundary out of the
// next tile (Arcade bodies touch without overlapping).
const EDGE_EPS = 1e-7;

/** Sweep the X axis: clamp to the NEAREST blocking column the leading edge
 *  enters (no tunneling at any speed). Columns the body already overlaps are
 *  not re-checked, so an overlapped body can always escape. */
function sweepX(grid: TileGrid, x: number, y: number, nx: number, h: number, gate?: TileGate): { x: number; hit: boolean } {
  const y0 = Math.floor((y - h) / TILE_SIZE);
  const y1 = Math.floor((y + h - EDGE_EPS) / TILE_SIZE);
  if (nx > x) {
    const c0 = Math.floor((x + h - EDGE_EPS) / TILE_SIZE) + 1;
    const c1 = Math.floor((nx + h - EDGE_EPS) / TILE_SIZE);
    for (let c = c0; c <= c1; c++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (isSolidFor(grid, c, ty, gate)) return { x: c * TILE_SIZE - h, hit: true };
      }
    }
  } else if (nx < x) {
    const c0 = Math.floor((x - h) / TILE_SIZE) - 1;
    const c1 = Math.floor((nx - h) / TILE_SIZE);
    for (let c = c0; c >= c1; c--) {
      for (let ty = y0; ty <= y1; ty++) {
        if (isSolidFor(grid, c, ty, gate)) return { x: (c + 1) * TILE_SIZE + h, hit: true };
      }
    }
  }
  return { x: nx, hit: false };
}

/** Sweep the Y axis (same nearest-face rule, run after X — Arcade order). */
function sweepY(grid: TileGrid, x: number, y: number, ny: number, h: number, gate?: TileGate): { y: number; hit: boolean } {
  const x0 = Math.floor((x - h) / TILE_SIZE);
  const x1 = Math.floor((x + h - EDGE_EPS) / TILE_SIZE);
  if (ny > y) {
    const r0 = Math.floor((y + h - EDGE_EPS) / TILE_SIZE) + 1;
    const r1 = Math.floor((ny + h - EDGE_EPS) / TILE_SIZE);
    for (let r = r0; r <= r1; r++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolidFor(grid, tx, r, gate)) return { y: r * TILE_SIZE - h, hit: true };
      }
    }
  } else if (ny < y) {
    const r0 = Math.floor((y - h) / TILE_SIZE) - 1;
    const r1 = Math.floor((ny - h) / TILE_SIZE);
    for (let r = r0; r >= r1; r--) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolidFor(grid, tx, r, gate)) return { y: (r + 1) * TILE_SIZE + h, hit: true };
      }
    }
  }
  return { y: ny, hit: false };
}

/**
 * Move an axis-aligned square body (side `body` px, centre at x,y) by v·dt with
 * Arcade-style separate-axis resolution: sweep X to the nearest blocking face,
 * then sweep Y from the resolved x. Sliding falls out of the axis separation
 * exactly as in Phaser; the sweep makes it tunnel-proof at any speed.
 */
export function moveAndSlide(
  grid: TileGrid,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
  body: number,
  opts?: MoveOpts,
): MoveResult {
  const h = body / 2;
  const gate = opts?.gate;

  const rx = vx !== 0 ? sweepX(grid, x, y, x + vx * dt, h, gate) : { x, hit: false };
  const ry = vy !== 0 ? sweepY(grid, rx.x, y, y + vy * dt, h, gate) : { y, hit: false };

  let nx = rx.x;
  let ny = ry.y;
  if (opts?.bounds) {
    nx = Math.max(h, Math.min(opts.bounds.w - h, nx));
    ny = Math.max(h, Math.min(opts.bounds.h - h, ny));
  }
  return { x: nx, y: ny, hitX: rx.hit, hitY: ry.hit };
}

/** Plain circle-vs-circle overlap (touch attacks, magnets, auras). */
export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Uniform-grid spatial hash (64px cells) for entity broadphase. Rebuild each
 * tick (entity counts are ≤~80, rebuild is cheaper than incremental moves).
 */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  constructor(private readonly cell = 64) {}

  clear(): void {
    this.cells.clear();
  }

  private key(cx: number, cy: number): number {
    return cx * 73856093 + cy * 19349663;
  }

  insert(x: number, y: number, item: T): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const arr = this.cells.get(k);
    if (arr) arr.push(item);
    else this.cells.set(k, [item]);
  }

  /** All items in cells overlapping the circle at (x,y) radius r (coarse). */
  query(x: number, y: number, r: number, out: T[] = []): T[] {
    const x0 = Math.floor((x - r) / this.cell);
    const x1 = Math.floor((x + r) / this.cell);
    const y0 = Math.floor((y - r) / this.cell);
    const y1 = Math.floor((y + r) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }
}

export interface TraceHit {
  hit: boolean;
  x: number;
  y: number;
  dist: number;
  /** The solid tile that stopped the ray (when hit). */
  tile?: { tile: number; gtx: number; gty: number };
}

/**
 * Swept segment vs the solid-tile grid (Amanatides–Woo DDA). Returns the entry
 * point into the first blocking tile, or the segment end. Projectile sweeps and
 * line-of-sight checks share this.
 */
export function traceSegment(
  grid: TileGrid,
  x0: number,
  y0: number,
  angle: number,
  maxDist: number,
  gate?: TileGate,
): TraceHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let gtx = Math.floor(x0 / TILE_SIZE);
  let gty = Math.floor(y0 / TILE_SIZE);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(TILE_SIZE / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(TILE_SIZE / dy) : Infinity;
  const nextVX = dx > 0 ? (gtx + 1) * TILE_SIZE : gtx * TILE_SIZE;
  const nextVY = dy > 0 ? (gty + 1) * TILE_SIZE : gty * TILE_SIZE;
  let tMaxX = dx !== 0 ? (nextVX - x0) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextVY - y0) / dy : Infinity;

  // Starting inside a solid tile (e.g. muzzle clipped into a wall) hits at 0.
  if (isSolidFor(grid, gtx, gty, gate)) {
    return { hit: true, x: x0, y: y0, dist: 0, tile: { tile: grid.tileAt(gtx, gty) ?? -1, gtx, gty } };
  }

  let t = 0;
  while (t <= maxDist) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      gtx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      gty += stepY;
    }
    if (t > maxDist) break;
    if (isSolidFor(grid, gtx, gty, gate)) {
      return {
        hit: true,
        x: x0 + dx * t,
        y: y0 + dy * t,
        dist: t,
        tile: { tile: grid.tileAt(gtx, gty) ?? -1, gtx, gty },
      };
    }
  }
  return { hit: false, x: x0 + dx * maxDist, y: y0 + dy * maxDist, dist: maxDist };
}
