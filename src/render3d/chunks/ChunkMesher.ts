// Chunk → mesh (3D master plan §3.5). Per chunk this builds:
//   ground   — one mesh of per-tile quads UV'd into the procedural atlas
//              (the painted-tile identity, including the static water bed)
//   walls    — extruded solids (Wall 2.6m brick-textured, Basalt 1.0, Rubble
//              0.55, Rail 0.35) with hidden faces culled against neighbours
//   trees    — trunk + layered canopy boxes (vertex-coloured) per Tree tile
//   water    — greedy quads at +3cm with a per-vertex depth channel feeding
//              the animated caustic shader (Shallow 0 → Water .78 → Deep 1)
//   lava     — greedy quads under the domain-warp emissive shader
//   roofs    — one slab + parapet per building, merged, dither-cutaway
// Positions are absolute world meters (no parent transforms) and matrices are
// frozen — chunk meshes are static until the chunk is rebuilt.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { Tile, type ChunkData } from "../../game/worldgen";
import { WORLD_SCALE } from "../space";
import { tileUV } from "./TileAtlas";

/** Visual extrusion height (meters) per solid tile kind. Water/DeepWater are
 *  solid to the SIM but render as fluid planes; trees get real trunks. */
const EXTRUDE_M: Partial<Record<Tile, number>> = {
  [Tile.Wall]: 2.6,
  [Tile.Basalt]: 1.0,
  [Tile.Rubble]: 0.55,
  [Tile.Rail]: 0.35,
};

const WATER_DEPTH: Partial<Record<Tile, number>> = {
  [Tile.ShallowWater]: 0,
  [Tile.Water]: 0.784,
  [Tile.DeepWater]: 1,
};

export const ROOF_BASE_M = 2.6;

interface TexBuilder {
  pos: number[];
  idx: number[];
  nrm: number[];
  uv: number[];
}

interface ColBuilder {
  pos: number[];
  idx: number[];
  nrm: number[];
  col: number[];
}

interface FluidBuilder {
  pos: number[];
  idx: number[];
  depth: number[];
}

function pushRGBA(out: number[], hex: number, mul: number, n: number): void {
  const r = Math.min(1, (((hex >> 16) & 0xff) / 255) * mul);
  const g = Math.min(1, (((hex >> 8) & 0xff) / 255) * mul);
  const b = Math.min(1, ((hex & 0xff) / 255) * mul);
  for (let i = 0; i < n; i++) out.push(r, g, b, 1);
}

/** Textured horizontal quad (CCW for +Y in the RH scene). */
function texQuadUp(b: TexBuilder, x0: number, z0: number, x1: number, z1: number, y: number, tile: number): void {
  const base = b.pos.length / 3;
  const u = tileUV(tile);
  b.pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  b.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  b.uv.push(u.u0, u.v1, u.u1, u.v1, u.u1, u.v0, u.u0, u.v0);
}

/** Textured vertical quad with outward normal (nx,nz). */
function texQuadSide(
  b: TexBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  nx: number,
  nz: number,
  tile: number,
): void {
  const base = b.pos.length / 3;
  const u = tileUV(tile);
  b.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  for (let i = 0; i < 4; i++) b.nrm.push(nx, 0, nz);
  b.uv.push(u.u0, u.v1, u.u1, u.v1, u.u1, u.v0, u.u0, u.v0);
}

function colQuadUp(b: ColBuilder, x0: number, z0: number, x1: number, z1: number, y: number, hex: number, mul: number): void {
  const base = b.pos.length / 3;
  b.pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  b.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  pushRGBA(b.col, hex, mul, 4);
}

function colQuadSide(
  b: ColBuilder,
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
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  for (let i = 0; i < 4; i++) b.nrm.push(nx, 0, nz);
  pushRGBA(b.col, hex, mul, 4);
}

/** Colored box: top + 4 shaded sides (no bottom). */
export function colBox(b: ColBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, hex: number): void {
  colQuadUp(b, x0, z0, x1, z1, y1, hex, 1.12);
  colQuadSide(b, x0, z1, x1, z1, y0, y1, 0, 1, hex, 0.92);
  colQuadSide(b, x1, z0, x0, z0, y0, y1, 0, -1, hex, 0.78);
  colQuadSide(b, x1, z1, x1, z0, y0, y1, 1, 0, hex, 0.85);
  colQuadSide(b, x0, z0, x0, z1, y0, y1, -1, 0, hex, 0.85);
}

function fluidQuad(b: FluidBuilder, x0: number, z0: number, x1: number, z1: number, y: number, depth: number): void {
  const base = b.pos.length / 3;
  b.pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  for (let i = 0; i < 4; i++) b.depth.push(depth);
}

function applyTex(scene: Scene, name: string, b: TexBuilder): Mesh | null {
  if (b.idx.length === 0) return null;
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.normals = b.nrm;
  vd.uvs = b.uv;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

function applyCol(scene: Scene, name: string, b: ColBuilder): Mesh | null {
  if (b.idx.length === 0) return null;
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.normals = b.nrm;
  vd.colors = b.col;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

function applyFluid(scene: Scene, name: string, b: FluidBuilder): Mesh | null {
  if (b.idx.length === 0) return null;
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.applyToMesh(mesh);
  mesh.setVerticesData("depth", b.depth, false, 1);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

export interface ChunkMeshes {
  ground: Mesh | null;
  walls: Mesh | null;
  trees: Mesh | null;
  water: Mesh | null;
  lava: Mesh | null;
  roofs: Mesh | null;
}

export function meshChunk(scene: Scene, chunk: ChunkData): ChunkMeshes {
  const s = chunk.size;
  const t = chunk.tileSize * WORLD_SCALE; // 1m per tile
  const ox = chunk.cx * s * t;
  const oz = chunk.cy * s * t;
  const grid = chunk.grid;
  const ground: TexBuilder = { pos: [], idx: [], nrm: [], uv: [] };
  const walls: TexBuilder = { pos: [], idx: [], nrm: [], uv: [] };
  const trees: ColBuilder = { pos: [], idx: [], nrm: [], col: [] };
  const water: FluidBuilder = { pos: [], idx: [], depth: [] };
  const lava: FluidBuilder = { pos: [], idx: [], depth: [] };
  const roofs: ColBuilder = { pos: [], idx: [], nrm: [], col: [] };

  const at = (x: number, y: number): Tile | -1 => (x < 0 || y < 0 || x >= s || y >= s ? -1 : grid[y][x]);

  // --- ground (per-tile atlas quads) + walls + trees + fluids ----------------
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const v = grid[y][x] as Tile;
      const x0 = ox + x * t;
      const z0 = oz + y * t;
      texQuadUp(ground, x0, z0, x0 + t, z0 + t, 0, v);

      const wd = WATER_DEPTH[v];
      if (wd !== undefined) fluidQuad(water, x0, z0, x0 + t, z0 + t, 0.03, wd);
      if (v === Tile.Lava) fluidQuad(lava, x0, z0, x0 + t, z0 + t, 0.03, 1);

      const h = EXTRUDE_M[v];
      if (h !== undefined) {
        // Top face + only the sides exposed to a different tile (hidden-face cull).
        texQuadUp(walls, x0, z0, x0 + t, z0 + t, h, v);
        if (at(x, y + 1) !== v) texQuadSide(walls, x0, z0 + t, x0 + t, z0 + t, 0, h, 0, 1, v);
        if (at(x, y - 1) !== v) texQuadSide(walls, x0 + t, z0, x0, z0, 0, h, 0, -1, v);
        if (at(x + 1, y) !== v) texQuadSide(walls, x0 + t, z0 + t, x0 + t, z0, 0, h, 1, 0, v);
        if (at(x - 1, y) !== v) texQuadSide(walls, x0, z0, x0, z0 + t, 0, h, -1, 0, v);
      }

      if (v === Tile.Tree) {
        const cx = x0 + t / 2;
        const cz = z0 + t / 2;
        colBox(trees, cx - 0.12, cz - 0.12, cx + 0.12, cz + 0.12, 0, 1.15, 0x3f2c19); // trunk
        colBox(trees, cx - 0.72, cz - 0.72, cx + 0.72, cz + 0.72, 1.0, 1.95, 0x274c24); // canopy base
        colBox(trees, cx - 0.45, cz - 0.45, cx + 0.45, cz + 0.45, 1.95, 2.5, 0x3c7a37); // lit crown
      }
    }
  }

  // --- roofs: slab + parapet per building, merged ----------------------------
  for (const b of chunk.buildings) {
    const bx0 = b.tx * t;
    const bz0 = b.ty * t;
    const bx1 = (b.tx + b.tw) * t;
    const bz1 = (b.ty + b.th) * t;
    colBox(roofs, bx0, bz0, bx1, bz1, ROOF_BASE_M, ROOF_BASE_M + 0.14, 0x2c3036); // slab
    const p = 0.16; // parapet lip
    colBox(roofs, bx0, bz0, bx1, bz0 + p, ROOF_BASE_M + 0.14, ROOF_BASE_M + 0.34, 0x3a3f47);
    colBox(roofs, bx0, bz1 - p, bx1, bz1, ROOF_BASE_M + 0.14, ROOF_BASE_M + 0.34, 0x3a3f47);
    colBox(roofs, bx0, bz0 + p, bx0 + p, bz1 - p, ROOF_BASE_M + 0.14, ROOF_BASE_M + 0.34, 0x3a3f47);
    colBox(roofs, bx1 - p, bz0 + p, bx1, bz1 - p, ROOF_BASE_M + 0.14, ROOF_BASE_M + 0.34, 0x3a3f47);
  }

  const id = `chunk_${chunk.cx}_${chunk.cy}`;
  return {
    ground: applyTex(scene, `${id}_ground`, ground),
    walls: applyTex(scene, `${id}_walls`, walls),
    trees: applyCol(scene, `${id}_trees`, trees),
    water: applyFluid(scene, `${id}_water`, water),
    lava: applyFluid(scene, `${id}_lava`, lava),
    roofs: applyCol(scene, `${id}_roofs`, roofs),
  };
}
