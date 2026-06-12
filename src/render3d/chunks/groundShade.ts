// Ground/wall shading helpers (graphics plan WS5 / master plan §3.5.1 + §6.5)
// — pure and Babylon-free so the headless runner covers them. Per-tile value
// jitter kills the uniform-carpet read, corner AO grounds walls/trees into
// the terrain, biome tints push grass toward each region's palette.

import { Tile } from "../../game/world/tiles";

/** Cheap deterministic 0..1 hash per global tile (decor-hash convention). */
export function seedHash(seed: string, salt: string): number {
  let h = 2166136261 >>> 0;
  const s = `${seed}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashUnit(seedNum: number, gx: number, gy: number): number {
  const h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ seedNum) >>> 0;
  return (((h ^ (h >>> 13)) >>> 0) % 10000) / 10000;
}

export interface RGBMul {
  r: number;
  g: number;
  b: number;
}

/** Per-tile value jitter 0.94–1.06 with a ±2% warm/cool skew (flat per tile —
 *  reads as tile variation, not noise). */
export function tileJitter(seedNum: number, gx: number, gy: number): RGBMul {
  const h = hashUnit(seedNum, gx, gy);
  const h2 = hashUnit(seedNum ^ 0x9e3779b9, gx, gy);
  const v = 0.94 + h * 0.12;
  const warm = (h2 - 0.5) * 0.04;
  return { r: v * (1 + warm), g: v, b: v * (1 - warm) };
}

/** Occluders for corner AO: extruded solids + trees. */
export function isOccluder(t: number): boolean {
  return t === Tile.Wall || t === Tile.Basalt || t === Tile.Rubble || t === Tile.Rail || t === Tile.Tree;
}

const AO_LEVELS = [1, 0.82, 0.7, 0.58];

/**
 * AO multiplier for a ground-quad corner. (x,y) is the tile; (cx,cy) ∈ {0,1}
 * picks the corner; `at` returns the tile value at local coords (or -1 outside
 * the chunk — treated as open, a slight border under-darkening we accept).
 */
export function cornerAO(at: (x: number, y: number) => number, x: number, y: number, cx: 0 | 1, cy: 0 | 1): number {
  const dx = cx === 1 ? 1 : -1;
  const dy = cy === 1 ? 1 : -1;
  let n = 0;
  if (isOccluder(at(x + dx, y))) n++;
  if (isOccluder(at(x, y + dy))) n++;
  if (isOccluder(at(x + dx, y + dy))) n++;
  return AO_LEVELS[Math.min(3, n)];
}

/** Per-biome grass/dirt tint targets (§6.5 region palettes), or null. */
export function biomeGrassTint(biome: string): RGBMul | null {
  switch (biome) {
    case "forest":
    case "dense_woods":
      return { r: 0.88, g: 1.0, b: 0.86 };
    case "grassland":
    case "farmland":
      return { r: 1.04, g: 1.02, b: 0.88 };
    case "parkland":
      return { r: 0.96, g: 1.03, b: 0.9 };
    case "marsh":
    case "wetland":
      return { r: 0.92, g: 0.98, b: 0.82 };
    case "volcanic":
    case "badlands":
      return { r: 0.95, g: 0.9, b: 0.86 };
    default:
      return null;
  }
}

/** True for tiles that take the biome grass tint. */
export function takesGrassTint(t: number): boolean {
  return t === Tile.Grass || t === Tile.TallGrass || t === Tile.Dirt;
}
