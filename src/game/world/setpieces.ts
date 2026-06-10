import { createRng, type Rng } from "../rng";
import { CHUNK_TILES } from "../constants";
import { Tile, SOLID_TILES, type ChunkData, type ContainerKind } from "./tiles";
import { BIOMES, type BiomeId } from "./biomes";
import { roadTileInChunk } from "./roads";

// Roadside set-piece scenes (Expansion U2): composed multi-prop "stories" —
// checkpoints, crashed convoys, ambushed camps — stamped along roads and in the
// wilds so travel is never empty. APPEND-ONLY on a FORKED rng (`:scene:`), so the
// chunk's main generation stream stays byte-identical (worldgen invariant #1).
// Scene containers stream as normal chests; scene props with searchable kinds
// become hold-E scavenge targets automatically (U1).

interface Stamp {
  kind: string; // prop kind (propSprites drawer)
  dx: number; // tile offset from the scene anchor
  dy: number;
}

interface SceneContainer {
  kind: ContainerKind;
  tier: number;
  lockChance: number;
  dx: number;
  dy: number;
}

export interface SetpieceDef {
  id: string;
  where: "road" | "open";
  label: string; // landmark-style label revealed on approach
  stamps: Stamp[];
  containers: SceneContainer[];
  ambush?: { min: number; max: number; p: number }; // guard pack on first visit
}

export const SETPIECES: SetpieceDef[] = [
  {
    id: "military_checkpoint",
    where: "road",
    label: "Military checkpoint",
    stamps: [
      { kind: "wreck", dx: 0, dy: 0 },
      { kind: "barrel", dx: 1, dy: 1 },
      { kind: "crate", dx: -1, dy: 1 },
      { kind: "corpse_soldier", dx: 1, dy: -1 },
      { kind: "tent", dx: -2, dy: 0 },
      { kind: "sign", dx: 2, dy: 0 },
    ],
    containers: [{ kind: "locker", tier: 3, lockChance: 0.5, dx: -1, dy: -1 }],
    ambush: { min: 2, max: 4, p: 0.5 },
  },
  {
    id: "crashed_convoy",
    where: "road",
    label: "Crashed convoy",
    stamps: [
      { kind: "wreck", dx: 0, dy: 0 },
      { kind: "wreck", dx: 2, dy: 1 },
      { kind: "car", dx: -2, dy: 0 },
      { kind: "barrel", dx: 1, dy: -1 },
      { kind: "corpse", dx: 0, dy: 1 },
      { kind: "crate", dx: 3, dy: 0 },
    ],
    containers: [{ kind: "crate", tier: 2, lockChance: 0.25, dx: 1, dy: 2 }],
    ambush: { min: 2, max: 5, p: 0.4 },
  },
  {
    id: "police_barricade",
    where: "road",
    label: "Police barricade",
    stamps: [
      { kind: "car", dx: 0, dy: 0 },
      { kind: "car", dx: 0, dy: 2 },
      { kind: "barrel", dx: 1, dy: 1 },
      { kind: "sign", dx: -1, dy: 0 },
      { kind: "corpse", dx: 1, dy: -1 },
    ],
    containers: [{ kind: "gun_cabinet", tier: 2, lockChance: 0.6, dx: -1, dy: 2 }],
    ambush: { min: 1, max: 3, p: 0.35 },
  },
  {
    id: "ambushed_camp",
    where: "open",
    label: "Ambushed camp",
    stamps: [
      { kind: "tent", dx: 0, dy: 0 },
      { kind: "tent", dx: 2, dy: 1 },
      { kind: "base_campfire", dx: 1, dy: 0 },
      { kind: "corpse", dx: 0, dy: 2 },
      { kind: "corpse", dx: 2, dy: -1 },
      { kind: "crate", dx: -1, dy: 1 },
    ],
    containers: [{ kind: "crate", tier: 2, lockChance: 0.2, dx: 3, dy: 0 }],
    ambush: { min: 2, max: 4, p: 0.45 },
  },
  {
    id: "evac_pile",
    where: "open",
    label: "Abandoned evac pile",
    stamps: [
      { kind: "crate", dx: 0, dy: 0 },
      { kind: "crate", dx: 1, dy: 1 },
      { kind: "barrel", dx: 0, dy: -1 },
      { kind: "corpse", dx: 2, dy: 0 },
      { kind: "sign", dx: 0, dy: 2 },
      { kind: "dumpster", dx: -2, dy: 1 },
    ],
    containers: [
      { kind: "crate", tier: 1, lockChance: 0.1, dx: -1, dy: 0 },
      { kind: "drawer", tier: 1, lockChance: 0.1, dx: 2, dy: 2 },
    ],
    ambush: { min: 1, max: 3, p: 0.25 },
  },
];

const SOLID = new Set<number>(SOLID_TILES as number[]);
const SCENE_P_URBAN = 0.22;
const SCENE_P_OPEN = 0.1;

/** Stamp at most ONE scene into the chunk (skipped if a landmark already rolled).
 *  Mutates chunk.props / containers / landmarks / ambush by APPENDING only. */
export function applySetpieces(seed: string, chunk: ChunkData): void {
  if (chunk.landmarks.length > 0) return; // density control: landmark OR scene
  const biome = BIOMES[chunk.biome as BiomeId];
  if (!biome || biome.id === "ocean") return;
  const rng = createRng(`${seed}:scene:${chunk.cx}:${chunk.cy}`);
  if (!rng.chance(biome.urban ? SCENE_P_URBAN : SCENE_P_OPEN)) return;

  const pool = biome.urban ? SETPIECES : SETPIECES.filter((d) => d.where === "open");
  const def = rng.pick(pool);
  const anchor = anchorFor(seed, chunk, def, rng);
  if (!anchor) return;

  const { tileSize } = chunk;
  let si = 0;
  for (const st of def.stamps) {
    const t = placeable(chunk, anchor.tx + st.dx, anchor.ty + st.dy);
    if (!t) continue;
    chunk.props.push({ kind: st.kind, x: (t.tx + 0.5) * tileSize, y: (t.ty + 0.5) * tileSize, gid: `${chunk.cx}_${chunk.cy}_sp${si++}` });
  }
  let ci = 0;
  for (const c of def.containers) {
    const t = placeable(chunk, anchor.tx + c.dx, anchor.ty + c.dy);
    if (!t) continue;
    chunk.containers.push({
      gid: `${chunk.cx}_${chunk.cy}_sc${ci++}`,
      tx: t.tx,
      ty: t.ty,
      tier: c.tier,
      type: "warehouse",
      kind: c.kind,
      locked: rng.chance(c.lockChance),
    });
  }
  chunk.landmarks.push({
    kind: def.id,
    label: def.label,
    x: (anchor.tx + 0.5) * tileSize,
    y: (anchor.ty + 0.5) * tileSize,
  });
  if (def.ambush && rng.chance(def.ambush.p)) {
    (chunk.ambush ??= []).push({
      x: (anchor.tx + 0.5) * tileSize,
      y: (anchor.ty + 0.5) * tileSize,
      count: rng.int(def.ambush.min, def.ambush.max),
    });
  }
}

/** Scene anchor: a road tile for road scenes, else a clear open tile. */
function anchorFor(seed: string, chunk: ChunkData, def: SetpieceDef, rng: Rng): { tx: number; ty: number } | null {
  if (def.where === "road") {
    const t = roadTileInChunk(seed, chunk.cx, chunk.cy, rng, new Set());
    if (t) return t;
    // urban chunk with no road tiles in range — fall through to an open anchor
  }
  const g0x = chunk.cx * CHUNK_TILES;
  const g0y = chunk.cy * CHUNK_TILES;
  for (let tries = 0; tries < 40; tries++) {
    const lx = rng.int(4, chunk.size - 5);
    const ly = rng.int(4, chunk.size - 5);
    if (placeableTile(chunk.grid[ly]?.[lx])) return { tx: g0x + lx, ty: g0y + ly };
  }
  return null;
}

/** A stamp/container landing spot: inside the chunk, walkable open ground (never
 *  water or a building interior — scenes live outdoors). */
function placeable(chunk: ChunkData, tx: number, ty: number): { tx: number; ty: number } | null {
  const lx = tx - chunk.cx * CHUNK_TILES;
  const ly = ty - chunk.cy * CHUNK_TILES;
  if (lx < 1 || ly < 1 || lx >= chunk.size - 1 || ly >= chunk.size - 1) return null;
  return placeableTile(chunk.grid[ly]?.[lx]) ? { tx, ty } : null;
}

function placeableTile(t: Tile | undefined): boolean {
  if (t === undefined) return false;
  if (SOLID.has(t)) return false;
  return t !== Tile.Floor && t !== Tile.Door && t !== Tile.ShallowWater && t !== Tile.Lava;
}
