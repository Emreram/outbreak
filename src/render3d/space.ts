// The coordinate & unit contract (3D master plan §3.1) — the SOLE owner of the
// sim↔world mapping. Everything else (meshers, views, camera, aim) must go
// through these helpers; nothing may duplicate the conversion.
//
//   - The simulation stays the existing 2D tile grid, in PIXELS, forever.
//   - 3D is a pure view:  sim x → world X,  sim y → world Z,  visual height → Y.
//   - TILE_SIZE (32 px) ≡ 1 meter, so WORLD_SCALE = 1/32.
//   - The scene is RIGHT-handed (scene.useRightHandedSystem = true) and the
//     camera alpha is fixed at +π/2 (camera south of the target looking north)
//     so that sim-north (−y) is screen-up and sim-east (+x) is screen-right —
//     matching the minimap. Asserted by tests/space3d.test.ts against Babylon's
//     own LookAt math; do not change one without the other.
//
// This module is dependency-free on purpose (like engine/anim.ts) so headless
// tests bundle it without pulling the render stack.

import { CHUNK_TILES, TILE_SIZE, WORLD_HEIGHT_PX, WORLD_WIDTH_PX } from "../game/constants";

/** Pixels → meters. 32 px ≡ 1 m. */
export const WORLD_SCALE = 1 / TILE_SIZE;

/** One chunk edge in meters (48). */
export const CHUNK_METERS = CHUNK_TILES;

/** World extent in meters (1,920 × 1,920). */
export const WORLD_METERS_X = WORLD_WIDTH_PX * WORLD_SCALE;
export const WORLD_METERS_Z = WORLD_HEIGHT_PX * WORLD_SCALE;

/** Camera yaw that makes sim-north (−y px) screen-up in a right-handed scene. */
export const CAMERA_ALPHA_NORTH_UP = Math.PI / 2;

/** Default camera pitch (~57° look-down) and follow radius (plan §6.1). */
export const CAMERA_BETA_DEFAULT = 0.6;
export const CAMERA_RADIUS_DEFAULT = 16;
export const CAMERA_RADIUS_MIN = 9;
export const CAMERA_RADIUS_MAX = 24;
export const CAMERA_BETA_MIN = 0.45;
export const CAMERA_BETA_MAX = 0.95;
/** Camera-target lerp per frame at 60 fps (matches Phaser follow 0.12). */
export const CAMERA_FOLLOW_LERP = 0.12;

/** Structural vector so this module needs no Babylon import. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Sim pixels (+ optional visual height in meters) → world meters. */
export function simToWorld(xPx: number, yPx: number, hM = 0, out?: Vec3Like): Vec3Like {
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = xPx * WORLD_SCALE;
  o.y = hM;
  o.z = yPx * WORLD_SCALE;
  return o;
}

/** World meters (X/Z plane) → sim pixels. */
export function worldToSim(wx: number, wz: number, out?: { x: number; y: number }): { x: number; y: number } {
  const o = out ?? { x: 0, y: 0 };
  o.x = wx * TILE_SIZE;
  o.y = wz * TILE_SIZE;
  return o;
}

/**
 * Ground height (meters) under a sim position. Flat 0 until the optional
 * visual-only terrain displacement lands (plan §3.5 step 2, M6 flag) — every
 * entity Y placement must route through here so that flag is one change.
 */
export function groundHeightAt(_xPx: number, _yPx: number): number {
  return 0;
}
