// Chunk → mesh (3D master plan §3.5). Greedy-merges runs of identical tiles
// into ground quads (one mesh) and extrudes the solid tiles into merged boxes
// (one mesh) — ~300–900 tris per chunk instead of 4,608 naive. M0 paints with
// per-vertex colours from the shared TILE_COLORS palette; M2 swaps the surface
// writer to procedural-atlas UVs without touching the merge logic. Water/lava
// stay flat (they read as water from the top-down camera until the NodeMaterial
// planes land in M2).

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { Tile, type ChunkData } from "../../game/worldgen";
import { TILE_COLORS } from "../../shared/tilePalette";
import { WORLD_SCALE } from "../space";

/** Visual extrusion height (meters) per solid tile kind. Water/DeepWater are
 *  solid to the SIM but render flat — the camera never needs a water wall. */
const EXTRUDE_M: Partial<Record<Tile, number>> = {
  [Tile.Wall]: 2.6,
  [Tile.Tree]: 2.4,
  [Tile.Basalt]: 1.0,
  [Tile.Rubble]: 0.55,
  [Tile.Rail]: 0.35,
};

interface Builder {
  pos: number[];
  idx: number[];
  col: number[];
  nrm: number[];
}

function newBuilder(): Builder {
  return { pos: [], idx: [], col: [], nrm: [] };
}

function pushColor(b: Builder, hex: number, mul: number, n: number): void {
  const r = Math.min(1, (((hex >> 16) & 0xff) / 255) * mul);
  const g = Math.min(1, (((hex >> 8) & 0xff) / 255) * mul);
  const bl = Math.min(1, ((hex & 0xff) / 255) * mul);
  for (let i = 0; i < n; i++) b.col.push(r, g, bl, 1);
}

/** Horizontal quad at height y, CCW for +Y in the right-handed scene. */
function quadUp(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, hex: number, mul: number): void {
  const base = b.pos.length / 3;
  b.pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  b.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  pushColor(b, hex, mul, 4);
}

/** Vertical quad facing `nx,nz` (axis-aligned outward normal). */
function quadSide(
  b: Builder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  nx: number,
  nz: number,
  hex: number,
  mul: number,
): void {
  const base = b.pos.length / 3;
  b.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
  // Outward winding: CCW seen from the normal side.
  b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  for (let i = 0; i < 4; i++) b.nrm.push(nx, 0, nz);
  pushColor(b, hex, mul, 4);
}

/** Axis-aligned box from (x0,z0)-(x1,z1), y0..y1: top + 4 sides (no bottom). */
function box(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, hex: number): void {
  quadUp(b, x0, z0, x1, z1, y1, hex, 1.12); // lighter top
  quadSide(b, x0, z1, x1, z1, y0, y1, 0, 1, hex, 0.92); // south (+z)
  quadSide(b, x1, z0, x0, z0, y0, y1, 0, -1, hex, 0.78); // north (−z, away from sun)
  quadSide(b, x1, z1, x1, z0, y0, y1, 1, 0, hex, 0.85); // east
  quadSide(b, x0, z0, x0, z1, y0, y1, -1, 0, hex, 0.85); // west
}

function applyTo(scene: Scene, name: string, b: Builder): Mesh | null {
  if (b.idx.length === 0) return null;
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.normals = b.nrm;
  vd.colors = b.col;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

export interface ChunkMeshes {
  ground: Mesh | null;
  solids: Mesh | null;
}

/** Greedy-mesh one generated chunk into 1 ground mesh + 1 solids mesh. */
export function meshChunk(scene: Scene, chunk: ChunkData): ChunkMeshes {
  const s = chunk.size;
  const t = chunk.tileSize * WORLD_SCALE; // 1m per tile
  const ox = chunk.cx * s * t;
  const oz = chunk.cy * s * t;
  const ground = newBuilder();
  const solids = newBuilder();
  const grid = chunk.grid;

  // --- ground: greedy rectangles of identical tile values --------------------
  const done: boolean[] = new Array(s * s).fill(false);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (done[y * s + x]) continue;
      const v = grid[y][x];
      let w = 1;
      while (x + w < s && !done[y * s + x + w] && grid[y][x + w] === v) w++;
      let h = 1;
      outer: while (y + h < s) {
        for (let i = 0; i < w; i++) {
          if (done[(y + h) * s + x + i] || grid[y + h][x + i] !== v) break outer;
        }
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) done[(y + yy) * s + x + xx] = true;
      const c = TILE_COLORS[v as Tile];
      quadUp(ground, ox + x * t, oz + y * t, ox + (x + w) * t, oz + (y + h) * t, 0, c ? c.fill : 0x222222, 1);
    }
  }

  // --- solids: greedy rectangles of equal-height extrusions ------------------
  const sdone: boolean[] = new Array(s * s).fill(false);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (sdone[y * s + x]) continue;
      const v = grid[y][x] as Tile;
      const hM = EXTRUDE_M[v];
      if (hM === undefined) {
        sdone[y * s + x] = true;
        continue;
      }
      let w = 1;
      while (x + w < s && !sdone[y * s + x + w] && grid[y][x + w] === v) w++;
      let h = 1;
      outer: while (y + h < s) {
        for (let i = 0; i < w; i++) {
          if (sdone[(y + h) * s + x + i] || grid[y + h][x + i] !== v) break outer;
        }
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) sdone[(y + yy) * s + x + xx] = true;
      const c = TILE_COLORS[v];
      box(solids, ox + x * t, oz + y * t, ox + (x + w) * t, oz + (y + h) * t, 0, hM, c ? c.line : 0x333333);
    }
  }

  return {
    ground: applyTo(scene, `chunk_${chunk.cx}_${chunk.cy}_ground`, ground),
    solids: applyTo(scene, `chunk_${chunk.cx}_${chunk.cy}_solids`, solids),
  };
}
