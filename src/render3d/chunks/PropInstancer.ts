// Props + containers as thin instances (3D master plan §3.5 step 6): one
// blockout base mesh per prop kind (palette colours from engine/propSprites),
// one thin-instance pool per kind across all loaded chunks, rebuilt when the
// streaming ring changes. Wind-swayed kinds (SWAY_SPECS) tilt per frame using
// the SAME swayAngle/posPhase math as the Phaser pass, budgeted to the nearest
// ~120 instances. Searchable props carry a per-instance colour that grays out
// when rummaged (SEARCHED-tint parity).

import "@babylonjs/core/Meshes/thinInstanceMesh"; // side-effect: registers thinInstance* on Mesh
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { EventBus } from "../../sim/events";
import type { SimChunkStore } from "../../sim/world";
import { posPhase, swayAngle, SWAY_SPECS } from "../../engine/anim";
import { groundHeightAt, WORLD_SCALE } from "../space";
import type { ContainerKind } from "../../game/worldgen";

/** Blockout recipe: stacked boxes [x0,y0,z0,x1,y1,z1,color] in meters at origin. */
type BoxSpec = [number, number, number, number, number, number, number];

interface PropSpec {
  boxes: BoxSpec[];
}

const box = (w: number, h: number, d: number, color: number, y0 = 0, ox = 0, oz = 0): BoxSpec => [
  ox - w / 2, y0, oz - d / 2, ox + w / 2, y0 + h, oz + d / 2, color,
];

/** Palette-faithful blockouts for the prop catalog (propSprites.ts hexes). */
const PROPS: Record<string, PropSpec> = {
  tree: { boxes: [box(0.22, 1.1, 0.22, 0x4a3420), box(1.3, 0.9, 1.3, 0x244a22, 1.0), box(0.8, 0.5, 0.8, 0x4f9e45, 1.9)] },
  pine: { boxes: [box(0.2, 0.7, 0.2, 0x163d1c), box(1.2, 0.7, 1.2, 0x257032, 0.6), box(0.7, 0.7, 0.7, 0x3f9a45, 1.3), box(0.35, 0.5, 0.35, 0x4fb455, 2.0)] },
  bush: { boxes: [box(0.8, 0.45, 0.8, 0x2c5a2a), box(0.5, 0.3, 0.5, 0x4f9e45, 0.4)] },
  rock: { boxes: [box(0.7, 0.4, 0.6, 0x6b6f76), box(0.4, 0.2, 0.35, 0x868b92, 0.38)] },
  boulder: { boxes: [box(1.1, 0.7, 1.0, 0x5b5f66), box(0.6, 0.3, 0.55, 0x787d84, 0.65)] },
  // WS7 facelift: wheels, glass cabins, bumpers, ribs, stocked shelving.
  car: {
    boxes: [
      box(1.3, 0.4, 2.4, 0x2a527d, 0.18), box(1.1, 0.34, 1.2, 0x12202e, 0.56), // body + glass cabin
      box(1.34, 0.1, 0.24, 0x274a6e, 0.3, 0, 1.16), box(1.34, 0.1, 0.24, 0x274a6e, 0.3, 0, -1.16), // bumpers
      box(0.16, 0.3, 0.3, 0x14181c, 0.0, 0.6, 0.78), box(0.16, 0.3, 0.3, 0x14181c, 0.0, -0.6, 0.78),
      box(0.16, 0.3, 0.3, 0x14181c, 0.0, 0.6, -0.78), box(0.16, 0.3, 0.3, 0x14181c, 0.0, -0.6, -0.78), // wheels
    ],
  },
  wreck: {
    boxes: [
      box(1.3, 0.36, 2.4, 0x33352f, 0.14), box(1.1, 0.28, 1.2, 0x24221b, 0.48),
      box(0.16, 0.26, 0.3, 0x101214, 0.0, 0.6, 0.78), box(0.16, 0.26, 0.3, 0x101214, 0.0, -0.55, -0.8),
      box(0.5, 0.12, 0.7, 0x7a3a1a, 0.5, 0.2, 0.3), // scorch hump
    ],
  },
  crate: { boxes: [box(0.7, 0.6, 0.7, 0xb5853f), box(0.74, 0.08, 0.74, 0x8a6230, 0.26), box(0.74, 0.06, 0.74, 0x8a6230, 0.56)] },
  barrel: { boxes: [box(0.5, 0.8, 0.5, 0x4f6a8a), box(0.54, 0.05, 0.54, 0x3a5068, 0.16), box(0.54, 0.05, 0.54, 0x3a5068, 0.6)] },
  dumpster: {
    boxes: [
      box(1.4, 0.84, 0.8, 0x3f6a46, 0.12), box(1.44, 0.1, 0.84, 0x2c4a31, 0.96),
      box(0.06, 0.6, 0.84, 0x2c4a31, 0.2, 0.5, 0), box(0.06, 0.6, 0.84, 0x2c4a31, 0.2, -0.5, 0), // ribs
      box(0.12, 0.14, 0.12, 0x14181c, 0, 0.55, 0.36), box(0.12, 0.14, 0.12, 0x14181c, 0, -0.55, 0.36), // casters
    ],
  },
  shelf: {
    boxes: [
      box(0.08, 1.4, 0.42, 0x5a4326, 0, 0.47, 0), box(0.08, 1.4, 0.42, 0x5a4326, 0, -0.47, 0), // side panels
      box(1.0, 0.06, 0.4, 0x6e5230, 0.42), box(1.0, 0.06, 0.4, 0x6e5230, 0.86), box(1.0, 0.06, 0.4, 0x6e5230, 1.3),
      box(0.26, 0.22, 0.3, 0xb7a23f, 0.48, -0.25, 0), box(0.2, 0.18, 0.28, 0x9aa3ad, 0.48, 0.18, 0), // stock
      box(0.24, 0.2, 0.3, 0xd1483a, 0.92, 0.1, 0),
    ],
  },
  bookshelf: {
    boxes: [
      box(0.08, 1.6, 0.37, 0x3a2c1e, 0, 0.47, 0), box(0.08, 1.6, 0.37, 0x3a2c1e, 0, -0.47, 0),
      box(1.0, 0.06, 0.35, 0x4a3c2d, 0.5), box(1.0, 0.06, 0.35, 0x4a3c2d, 1.0), box(1.0, 0.05, 0.35, 0x4a3c2d, 1.5),
      box(0.7, 0.34, 0.26, 0xd1483a, 0.56, -0.05, 0), box(0.5, 0.3, 0.26, 0x2f8f3c, 1.06, 0.15, 0), // spines
    ],
  },
  bed: { boxes: [box(1.1, 0.4, 2.0, 0x5a6470), box(1.0, 0.14, 1.9, 0xcdd9e5, 0.4)] },
  counter: { boxes: [box(1.6, 0.85, 0.7, 0x5b616a), box(1.66, 0.06, 0.76, 0x8a8f98, 0.85)] },
  desk: { boxes: [box(1.3, 0.75, 0.7, 0x6e5230), box(0.4, 0.3, 0.08, 0x2ec4ff, 0.78)] },
  sofa: { boxes: [box(1.8, 0.5, 0.8, 0x556b5a), box(1.8, 0.4, 0.25, 0x6e8a72, 0.5, 0, -0.28)] },
  locker_prop: { boxes: [box(0.6, 1.7, 0.5, 0x5f86a8)] },
  fridge_prop: { boxes: [box(0.7, 1.7, 0.7, 0xdfe6ec)] },
  corpse: { boxes: [box(0.5, 0.22, 1.5, 0x6a5d4f)] },
  corpse_soldier: { boxes: [box(0.5, 0.22, 1.5, 0x4a5a3f)] },
  hay: { boxes: [box(1.0, 0.8, 1.0, 0xc9a84c)] },
  tent: { boxes: [box(1.6, 0.9, 1.6, 0x6a7a52)] },
  grave: { boxes: [box(0.5, 0.7, 0.14, 0x8a8f98)] },
  sign: { boxes: [box(0.1, 1.0, 0.1, 0x5a4326), box(0.9, 0.5, 0.06, 0x9aa3ad, 1.0)] },
  reeds: { boxes: [box(0.12, 0.9, 0.12, 0x4f7a36, 0, -0.2, 0.1), box(0.12, 1.1, 0.12, 0x6f9e4a, 0, 0.1, -0.1), box(0.12, 0.8, 0.12, 0x8fbf5e, 0, 0.25, 0.2)] },
  cattail: { boxes: [box(0.1, 1.0, 0.1, 0x57803a, 0, -0.1, 0), box(0.16, 0.3, 0.16, 0x8a5f38, 1.0, -0.1, 0)] },
  lilypad: { boxes: [box(0.8, 0.04, 0.8, 0x2f6e33, 0.04)] },
  driftwood: { boxes: [box(1.4, 0.25, 0.4, 0x9a8f7a)] },
  rowboat: { boxes: [box(0.9, 0.3, 2.0, 0x6e5230), box(0.7, 0.1, 1.7, 0x8a6a3a, 0.3)] },
  dock: { boxes: [box(1.6, 0.15, 1.6, 0x6e5230, 0.1)] },
  fishing_spot: { boxes: [box(0.5, 0.06, 0.5, 0xcfe8f4, 0.02)] },
  pet_den: { boxes: [box(1.3, 0.5, 1.3, 0x3a2c1e), box(0.7, 0.3, 0.7, 0x14100c, 0.0)] },
  flowers: { boxes: [box(0.4, 0.3, 0.4, 0x2c5a2a), box(0.2, 0.16, 0.2, 0xe88ab0, 0.3)] },
  // Drivable-vehicle blockouts (Feature 4 records; propSprites veh_* palette).
  veh_sedan: { boxes: [box(1.5, 0.5, 3.0, 0xe8ebee), box(1.3, 0.42, 1.5, 0x1b2733, 0.5), box(0.2, 0.18, 0.2, 0xc2c8cf, 0.5, 0, 1.3)] },
  veh_pickup: { boxes: [box(1.6, 0.55, 1.6, 0xe2e5e9, 0, 0, -0.7), box(1.5, 0.35, 1.4, 0xb7bdc4, 0, 0, 0.8), box(1.3, 0.4, 0.9, 0x1b2733, 0.55, 0, -0.7)] },
  veh_van: { boxes: [box(1.7, 1.0, 3.4, 0xeceef1), box(1.5, 0.5, 0.8, 0x1b2733, 0.45, 0, -1.4)] },
};

const FALLBACK: PropSpec = { boxes: [box(0.6, 0.6, 0.6, 0x777777)] };

/** Chest kind tints (ChunkManager KIND_TINT parity). */
const CHEST_TINT: Record<ContainerKind, number> = {
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

export const SEARCHED_GRAY = 0.42; // brightness of rummaged props (0x5f5f5f-ish)

/** Tall/bulky kinds whose thin-instance pools cast sun shadows (WS4). */
const CASTER_KINDS = new Set([
  "tree", "pine", "car", "wreck", "veh_sedan", "veh_pickup", "veh_van",
  "boulder", "dumpster", "locker_prop", "fridge_prop", "shelf", "bookshelf", "tent",
]);

interface Pool {
  mesh: Mesh;
  /** Instance records for rebuilds + sway. */
  items: { x: number; y: number; phase: number; gid?: string; searched?: boolean }[];
  matrices: Float32Array;
  colors: Float32Array | null;
  swayKind: string | null;
}

export class PropInstancer {
  private readonly pools = new Map<string, Pool>();
  private readonly material: StandardMaterial;
  private dirty = true;
  /** Optional extra instances (seed/persisted vehicles) merged at rebuild. */
  extras: (() => { kind: string; x: number; y: number; yaw?: number }[]) | null = null;
  /** Optional shadow hookup (WS4): tall pools cast, all pools receive. */
  shadows: import("../env/ShadowDirector").ShadowDirector | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly store: SimChunkStore,
    events: EventBus,
  ) {
    this.material = new StandardMaterial("propMat", scene);
    this.material.specularColor = Color3.Black();
    events.on("chunkLoaded", () => (this.dirty = true));
    events.on("chunkUnloaded", () => (this.dirty = true));
    events.on("searchDone", () => (this.dirty = true));
  }

  private buildBase(kind: string, spec: PropSpec): Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const quad = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
      hex: number, mul: number,
    ) => {
      const base = pos.length / 3;
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      for (let i = 0; i < 4; i++) nrm.push(nx, ny, nz);
      const r = Math.min(1, (((hex >> 16) & 255) / 255) * mul);
      const g = Math.min(1, (((hex >> 8) & 255) / 255) * mul);
      const b = Math.min(1, ((hex & 255) / 255) * mul);
      for (let i = 0; i < 4; i++) col.push(r, g, b, 1);
    };
    for (const [x0, y0, z0, x1, y1, z1, hex] of spec.boxes) {
      quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, 0, 1, 0, hex, 1.12); // top
      quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, hex, 0.92); // south
      quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, hex, 0.78); // north
      quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, hex, 0.85); // east
      quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, hex, 0.85); // west
    }
    const mesh = new Mesh(`prop_${kind}`, this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.colors = col;
    vd.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // thin instances span chunks; skip per-mesh culling
    if (this.shadows?.enabled) {
      mesh.receiveShadows = true;
      if (CASTER_KINDS.has(kind)) this.shadows.addPoolCaster(mesh);
    }
    return mesh;
  }

  /** Rebuild every pool from the loaded chunks (cheap: a few hundred matrices). */
  private rebuild(): void {
    this.dirty = false;
    type Item = Pool["items"][number];
    const buckets = new Map<string, Item[]>();
    for (const lc of this.store.loadedChunks()) {
      for (const p of lc.data.props) {
        const kind = p.kind;
        let arr = buckets.get(kind);
        if (!arr) {
          arr = [];
          buckets.set(kind, arr);
        }
        arr.push({ x: p.x, y: p.y, phase: posPhase(p.x, p.y), gid: p.gid });
      }
    }
    // searchable searched-state from records (already filtered by flags)
    const searched = new Map<string, boolean>();
    for (const s of this.store.activeSearchables()) searched.set(s.gid, s.searched);
    // chests as pseudo-prop pools
    for (const c of this.store.activeChests()) {
      const kind = `chest_${c.kind}`;
      let arr = buckets.get(kind);
      if (!arr) {
        arr = [];
        buckets.set(kind, arr);
      }
      arr.push({ x: c.x, y: c.y, phase: 0 });
    }
    // extras (vehicle records etc.)
    for (const e of this.extras?.() ?? []) {
      let arr = buckets.get(e.kind);
      if (!arr) {
        arr = [];
        buckets.set(e.kind, arr);
      }
      arr.push({ x: e.x, y: e.y, phase: 0 });
    }

    // sync pools
    for (const [kind, pool] of this.pools) {
      if (!buckets.has(kind)) {
        pool.mesh.thinInstanceCount = 0;
        pool.items = [];
      }
    }
    const m = new Matrix();
    const q = Quaternion.Identity();
    const one = new Vector3(1, 1, 1);
    const pv = new Vector3();
    for (const [kind, items] of buckets) {
      let pool = this.pools.get(kind);
      if (!pool) {
        const spec = kind.startsWith("chest_")
          ? { boxes: [box(0.62, 0.5, 0.5, CHEST_TINT[kind.slice(6) as ContainerKind] ?? 0xb5853f), box(0.66, 0.12, 0.54, 0x4f3a1f, 0.5)] }
          : (PROPS[kind] ?? FALLBACK);
        pool = {
          mesh: this.buildBase(kind, spec),
          items: [],
          matrices: new Float32Array(0),
          colors: null,
          swayKind: SWAY_SPECS[kind] ? kind : null,
        };
        this.pools.set(kind, pool);
      }
      pool.items = items;
      pool.matrices = new Float32Array(items.length * 16);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.searched = it.gid ? searched.get(it.gid) : undefined;
        pv.set(it.x * WORLD_SCALE, groundHeightAt(it.x, it.y), it.y * WORLD_SCALE);
        Matrix.ComposeToRef(one, q, pv, m);
        m.copyToArray(pool.matrices, i * 16);
      }
      pool.mesh.thinInstanceSetBuffer("matrix", pool.matrices, 16, pool.swayKind === null);
      // per-instance gray-out for searched searchables
      if (items.some((it) => it.searched !== undefined)) {
        pool.colors = new Float32Array(items.length * 4);
        for (let i = 0; i < items.length; i++) {
          const g = items[i].searched ? SEARCHED_GRAY : 1;
          pool.colors[i * 4] = g;
          pool.colors[i * 4 + 1] = g;
          pool.colors[i * 4 + 2] = g;
          pool.colors[i * 4 + 3] = 1;
        }
        pool.mesh.thinInstanceSetBuffer("color", pool.colors, 4);
      } else if (pool.colors) {
        pool.colors = null;
        pool.mesh.thinInstanceSetBuffer("color", null as unknown as Float32Array, 4);
      }
    }
  }

  /** Per-frame: flush rebuilds + tilt the nearest swayables (budgeted). */
  update(timeMs: number, playerXPx: number, playerYPx: number): void {
    if (this.dirty) this.rebuild();
    const m = new Matrix();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const pv = new Vector3();
    let budget = 120;
    for (const pool of this.pools.values()) {
      if (!pool.swayKind || pool.items.length === 0) continue;
      const spec = SWAY_SPECS[pool.swayKind];
      let touched = false;
      for (let i = 0; i < pool.items.length && budget > 0; i++) {
        const it = pool.items[i];
        if (Math.abs(it.x - playerXPx) > 700 || Math.abs(it.y - playerYPx) > 700) continue; // near-camera budgeted pass
        budget--;
        const a = swayAngle(spec, timeMs, it.phase);
        Quaternion.RotationAxisToRef(AXIS_Z, a, q);
        pv.set(it.x * WORLD_SCALE, groundHeightAt(it.x, it.y), it.y * WORLD_SCALE);
        Matrix.ComposeToRef(one, q, pv, m);
        m.copyToArray(pool.matrices, i * 16);
        touched = true;
      }
      if (touched) pool.mesh.thinInstanceBufferUpdated("matrix");
    }
  }
}

const AXIS_Z = new Vector3(0, 0, 1);
