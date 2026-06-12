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
import { Tile, type Building, type ChunkData } from "../../game/worldgen";
import { WORLD_SCALE } from "../space";
import { tileUV } from "./TileAtlas";
import { biomeGrassTint, cornerAO, hashUnit, takesGrassTint, tileJitter, type RGBMul } from "./groundShade";

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
  /** Per-vertex RGBA multipliers (AO + jitter + biome tint, WS5). */
  col: number[];
}

const WHITE: RGBMul = { r: 1, g: 1, b: 1 };

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

/** Textured horizontal quad (CCW for +Y in the RH scene). Vertex order is
 *  (x0,z0)(x1,z0)(x1,z1)(x0,z1) — corner colors follow that order. */
function texQuadUp(
  b: TexBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  tile: number,
  c00: RGBMul = WHITE,
  c10: RGBMul = WHITE,
  c11: RGBMul = WHITE,
  c01: RGBMul = WHITE,
): void {
  const base = b.pos.length / 3;
  const u = tileUV(tile);
  b.pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  b.nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  b.uv.push(u.u0, u.v1, u.u1, u.v1, u.u1, u.v0, u.u0, u.v0);
  for (const c of [c00, c10, c11, c01]) b.col.push(c.r, c.g, c.b, 1);
}

/** Textured vertical quad with outward normal (nx,nz); bottom/top tints
 *  ground the wall bases (WS5). */
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
  bottomMul = 1,
  topMul = 1,
): void {
  const base = b.pos.length / 3;
  const u = tileUV(tile);
  b.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  for (let i = 0; i < 4; i++) b.nrm.push(nx, 0, nz);
  b.uv.push(u.u0, u.v1, u.u1, u.v1, u.u1, u.v0, u.u0, u.v0);
  b.col.push(bottomMul, bottomMul, bottomMul, 1, bottomMul, bottomMul, bottomMul, 1, topMul, topMul, topMul, 1, topMul, topMul, topMul, 1);
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
  if (b.col.length > 0) vd.colors = b.col;
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
  /** Window frames/glass + door jambs (WS5) — vertex-coloured detail. */
  detail: Mesh | null;
}

export function meshChunk(scene: Scene, chunk: ChunkData, seedNum = 0): ChunkMeshes {
  const s = chunk.size;
  const t = chunk.tileSize * WORLD_SCALE; // 1m per tile
  const ox = chunk.cx * s * t;
  const oz = chunk.cy * s * t;
  const grid = chunk.grid;
  const ground: TexBuilder = { pos: [], idx: [], nrm: [], uv: [], col: [] };
  const walls: TexBuilder = { pos: [], idx: [], nrm: [], uv: [], col: [] };
  const trees: ColBuilder = { pos: [], idx: [], nrm: [], col: [] };
  const water: FluidBuilder = { pos: [], idx: [], depth: [] };
  const lava: FluidBuilder = { pos: [], idx: [], depth: [] };
  const roofs: ColBuilder = { pos: [], idx: [], nrm: [], col: [] };
  const detail: ColBuilder = { pos: [], idx: [], nrm: [], col: [] };

  const at = (x: number, y: number): Tile | -1 => (x < 0 || y < 0 || x >= s || y >= s ? -1 : grid[y][x]);
  const atNum = (x: number, y: number): number => at(x, y);

  const tint = biomeGrassTint(chunk.biome);
  const TRIM = 0.08;

  // Corner shade = per-tile jitter × corner AO × (biome tint on grass-ish).
  const cornerShade = (lx: number, ly: number, v: Tile, cx: 0 | 1, cy: 0 | 1, j: RGBMul): RGBMul => {
    const ao = cornerAO(atNum, lx, ly, cx, cy);
    let r = j.r * ao;
    let g = j.g * ao;
    let b = j.b * ao;
    if (tint && takesGrassTint(v)) {
      r *= 1 + (tint.r - 1) * 0.5;
      g *= 1 + (tint.g - 1) * 0.5;
      b *= 1 + (tint.b - 1) * 0.5;
    }
    return { r, g, b };
  };

  // --- ground (per-tile atlas quads) + walls + trees + fluids ----------------
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const v = grid[y][x] as Tile;
      const x0 = ox + x * t;
      const z0 = oz + y * t;
      const gx = chunk.cx * s + x;
      const gy = chunk.cy * s + y;
      const j = tileJitter(seedNum, gx, gy);
      texQuadUp(
        ground,
        x0, z0, x0 + t, z0 + t, 0, v,
        cornerShade(x, y, v, 0, 0, j),
        cornerShade(x, y, v, 1, 0, j),
        cornerShade(x, y, v, 1, 1, j),
        cornerShade(x, y, v, 0, 1, j),
      );

      const wd = WATER_DEPTH[v];
      if (wd !== undefined) fluidQuad(water, x0, z0, x0 + t, z0 + t, 0.03, wd);
      if (v === Tile.Lava) fluidQuad(lava, x0, z0, x0 + t, z0 + t, 0.03, 1);

      const h = EXTRUDE_M[v];
      if (h !== undefined) {
        // Top face + only the sides exposed to a different tile (hidden-face
        // cull); sides darken toward the base, a bright trim ring caps the
        // exposed top edge (§6.5 silhouette highlight).
        const topMul: RGBMul = { r: 1.12, g: 1.12, b: 1.12 };
        texQuadUp(walls, x0, z0, x0 + t, z0 + t, h, v, topMul, topMul, topMul, topMul);
        const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
          texQuadSide(walls, ax, az, bx, bz, 0, h - TRIM, nx, nz, v, 0.78, 1);
          texQuadSide(walls, ax, az, bx, bz, h - TRIM, h, nx, nz, v, 1.22, 1.22);
        };
        if (at(x, y + 1) !== v) side(x0, z0 + t, x0 + t, z0 + t, 0, 1);
        if (at(x, y - 1) !== v) side(x0 + t, z0, x0, z0, 0, -1);
        if (at(x + 1, y) !== v) side(x0 + t, z0 + t, x0 + t, z0, 1, 0);
        if (at(x - 1, y) !== v) side(x0, z0, x0, z0 + t, -1, 0);
      }

      if (v === Tile.Tree) {
        buildTreeInto(trees, seedNum, gx, gy, chunk.biome, x0 + t / 2, z0 + t / 2);
      }
      if (v === Tile.Door) {
        buildDoorFrameInto(detail, at, x, y, x0, z0, t);
      }
    }
  }

  // --- building facades: windows on long exterior wall runs (WS5) ------------
  for (const b of chunk.buildings) buildWindowsInto(detail, chunk, b, seedNum);

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
    detail: applyCol(scene, `${id}_detail`, detail),
  };
}

/** Scale a packed RGB by per-channel multipliers (clamped). */
function shadeHex(hex: number, r: number, g: number, b: number): number {
  const cr = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * r)));
  const cg = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * g)));
  const cb = Math.max(0, Math.min(255, Math.round((hex & 255) * b)));
  return (cr << 16) | (cg << 8) | cb;
}

const PINE_BIOMES = new Set(["dense_woods"]);
const BARE_BIOMES = new Set(["volcanic", "badlands"]);

/** Tile-tree builder (WS5/WS7): tapering trunk + jittered canopy lobes with
 *  per-tree hue variation; pines stack dark cones; volcanic trees go bare. */
function buildTreeInto(b: ColBuilder, seedNum: number, gx: number, gy: number, biome: string, cx: number, cz: number): void {
  const h1 = hashUnit(seedNum ^ 0x51ed, gx, gy);
  const h2 = hashUnit(seedNum ^ 0xa341, gx, gy);
  const v = 0.88 + h1 * 0.24; // value jitter ±12%
  const w = (h2 - 0.5) * 0.16; // warm/yellow shift ±8%
  const leaf = (hex: number): number => shadeHex(hex, v * (1 + w), v, v * (1 - w * 0.5));

  if (BARE_BIOMES.has(biome)) {
    colBox(b, cx - 0.1, cz - 0.1, cx + 0.1, cz + 0.1, 0, 1.6 + h1 * 0.5, 0x2e2620); // charred trunk
    colBox(b, cx - 0.42, cz - 0.42, cx + 0.42, cz + 0.42, 1.2, 1.7, 0x3a332c); // sparse lobe
    return;
  }
  if (PINE_BIOMES.has(biome) || (biome === "forest" && h2 > 0.62)) {
    colBox(b, cx - 0.09, cz - 0.09, cx + 0.09, cz + 0.09, 0, 0.7, 0x4a3420);
    colBox(b, cx - 0.62, cz - 0.62, cx + 0.62, cz + 0.62, 0.6, 1.15, leaf(0x163d1c));
    colBox(b, cx - 0.44, cz - 0.44, cx + 0.44, cz + 0.44, 1.15, 1.7, leaf(0x257032));
    colBox(b, cx - 0.26, cz - 0.26, cx + 0.26, cz + 0.26, 1.7, 2.3 + h1 * 0.3, leaf(0x3f9a45));
    return;
  }
  // deciduous: two-step tapering trunk + 3–5 jittered lobes + lit crown
  colBox(b, cx - 0.16, cz - 0.16, cx + 0.16, cz + 0.16, 0, 0.7, 0x3f2c19);
  colBox(b, cx - 0.1, cz - 0.1, cx + 0.1, cz + 0.1, 0.7, 1.25, 0x4a3420);
  const lobes = 3 + Math.floor(h2 * 3);
  for (let i = 0; i < lobes; i++) {
    const ha = hashUnit(seedNum ^ (0x100 + i), gx, gy);
    const hb = hashUnit(seedNum ^ (0x200 + i), gx, gy);
    const lx = cx + (ha - 0.5) * 0.9;
    const lz = cz + (hb - 0.5) * 0.9;
    const ly = 1.0 + (i / lobes) * 1.1;
    const half = 0.52 - i * 0.04 + ha * 0.18;
    colBox(b, lx - half, lz - half, lx + half, lz + half, ly, ly + 0.62 + hb * 0.3, leaf(i === lobes - 1 ? 0x3c7a37 : 0x274c24));
  }
}

/** Door frame (WS5): jambs + header straddling the door tile's wall axis. */
function buildDoorFrameInto(
  b: ColBuilder,
  at: (x: number, y: number) => Tile | -1,
  x: number,
  y: number,
  x0: number,
  z0: number,
  t: number,
): void {
  const WOOD = 0x4a3a28;
  const cxm = x0 + t / 2;
  const czm = z0 + t / 2;
  const xRun = at(x - 1, y) === Tile.Wall || at(x + 1, y) === Tile.Wall;
  if (xRun) {
    colBox(b, x0 + 0.02, czm - 0.09, x0 + 0.14, czm + 0.09, 0, 2.18, WOOD);
    colBox(b, x0 + t - 0.14, czm - 0.09, x0 + t - 0.02, czm + 0.09, 0, 2.18, WOOD);
    colBox(b, x0 + 0.02, czm - 0.09, x0 + t - 0.02, czm + 0.09, 2.18, 2.36, WOOD);
  } else {
    colBox(b, cxm - 0.09, z0 + 0.02, cxm + 0.09, z0 + 0.14, 0, 2.18, WOOD);
    colBox(b, cxm - 0.09, z0 + t - 0.14, cxm + 0.09, z0 + t - 0.02, 0, 2.18, WOOD);
    colBox(b, cxm - 0.09, z0 + 0.02, cxm + 0.09, z0 + t - 0.02, 2.18, 2.36, WOOD);
  }
}

const FRAME_C = 0x3a3f47;
const GLASS_C = 0x141c26;

/** Windows on long exterior wall runs (WS5): every 2nd tile of runs ≥3,
 *  hash-jittered so facades differ. Frame + protruding dark-glass panel. */
function buildWindowsInto(detail: ColBuilder, chunk: ChunkData, b: Building, seedNum: number): void {
  const s = chunk.size;
  const t = chunk.tileSize * WORLD_SCALE;
  const lxOf = (gtx: number): number => gtx - chunk.cx * s;
  const lyOf = (gty: number): number => gty - chunk.cy * s;
  const wallAt = (gtx: number, gty: number): boolean => {
    const lx = lxOf(gtx);
    const ly = lyOf(gty);
    return lx >= 0 && ly >= 0 && lx < s && ly < s && chunk.grid[ly][lx] === Tile.Wall;
  };
  const emit = (gtx: number, gty: number, face: "n" | "s" | "w" | "e"): void => {
    if (hashUnit(seedNum ^ 0x77aa, gtx, gty) < 0.25) return; // jittered rhythm
    const cx = (gtx + 0.5) * t;
    const cz = (gty + 0.5) * t;
    if (face === "n" || face === "s") {
      const fz = face === "n" ? gty * t : (gty + 1) * t;
      colBox(detail, cx - 0.43, fz - 0.04, cx + 0.43, fz + 0.04, 0.92, 1.94, FRAME_C);
      colBox(detail, cx - 0.33, fz - 0.05, cx + 0.33, fz + 0.05, 1.04, 1.82, GLASS_C);
    } else {
      const fx = face === "w" ? gtx * t : (gtx + 1) * t;
      colBox(detail, fx - 0.04, cz - 0.43, fx + 0.04, cz + 0.43, 0.92, 1.94, FRAME_C);
      colBox(detail, fx - 0.05, cz - 0.33, fx + 0.05, cz + 0.33, 1.04, 1.82, GLASS_C);
    }
  };
  // Walk each edge, find consecutive Wall runs, window every 2nd interior tile.
  const scan = (count: number, tileAt: (i: number) => { gtx: number; gty: number }, face: "n" | "s" | "w" | "e"): void => {
    let runStart = -1;
    for (let i = 0; i <= count; i++) {
      const isWall = i < count && wallAt(tileAt(i).gtx, tileAt(i).gty);
      if (isWall && runStart < 0) runStart = i;
      if (!isWall && runStart >= 0) {
        const len = i - runStart;
        if (len >= 3) {
          for (let k = runStart + 1; k < i - 1; k += 2) {
            const p = tileAt(k);
            emit(p.gtx, p.gty, face);
          }
        }
        runStart = -1;
      }
    }
  };
  scan(b.tw, (i) => ({ gtx: b.tx + i, gty: b.ty }), "n");
  scan(b.tw, (i) => ({ gtx: b.tx + i, gty: b.ty + b.th - 1 }), "s");
  scan(b.th, (i) => ({ gtx: b.tx, gty: b.ty + i }), "w");
  scan(b.th, (i) => ({ gtx: b.tx + b.tw - 1, gty: b.ty + i }), "e");
}
