import { createRng, type Rng } from "./rng";
import type { GameState } from "../shared/contracts";
import { generateChunk } from "./worldgen";
import { SOLID_TILES, Tile } from "./world/tiles";
import { biomeAt } from "./world/biomes";
import { CHUNK_TILES, TILE_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "./constants";

// Notes, journals & stash maps (Expansion U2). Flavour text is composed from
// seeded pools the first time a note is read (and stored on the inventory entry's
// `note` field, which already persists). A Stash Map consumes on use and pins a
// deterministic buried cache as a `stash_<tx>_<ty>` world flag — the scene
// reconciles a locked tier-3 chest onto loaded chunks from those flags.

const NOTE_POOL: readonly string[] = [
  "Day 12. The pharmacy on the main road is picked clean. The back room wasn't. Locked though.",
  "If you find this — DON'T trust the radio voice. They count heads before the gate, never after.",
  "Mara went north for the supply drop and never came back. The flare was green. Green means military.",
  "They move at night. I know everyone says that. I'm writing it because I didn't believe it.",
  "Out of food. The dog won't stop staring at me. Going to try the grocery one last time.",
  "The runners follow sound, not light. Threw my watch down the street and walked away alive.",
  "Whoever boarded up the blue house knew what they were doing. Whoever opened it didn't.",
  "Keep off the overpass. It looks clear from below. It is not clear.",
  "Found a working car battery in a toolbox, of all places. Check the toolboxes.",
  "If the water tastes like copper, boil it twice. Learned that the hard way.",
  "Three of us went into the hospital. I'm writing this alone.",
  "The horde passed through at dawn — hundreds. They follow the highway like a river.",
];

const JOURNAL_POOL: readonly string[] = [
  "Week 3. Rules so far: never sprint past a doorway, never loot after dark, never sleep twice in the same place. Still alive, so the rules stay.",
  "I keep a tally of the quiet days. Four this month. The trick nobody tells you: the quiet days are for moving, not resting.",
  "Traded my last antibiotics for a crowbar. Felt like a mistake until the third locked cabinet. Now I'd do it again.",
  "Saw a camp by the tents off the road. Good people, I think — they fed me and let me leave. Both halves of that sentence matter.",
  "The infection isn't the end right away. You get hours. Marcus used his to barricade the door from the outside. I'm writing this because someone should know.",
  "Farms are the future. Anyone can empty a shelf; nobody restocks one. Seeds, water, a fence — that's a life.",
  "Lesson from the warehouse district: if the crates look untouched, ask yourself why. Something kept people away.",
  "I name the walkers I recognise. The mailman. The teacher. It keeps them people, and it keeps me careful.",
];

/** Deterministic flavour text for the n-th note/journal read this run. */
export function noteText(seed: string, n: number, flavor: "note" | "journal"): string {
  const rng = createRng(`${seed}:note:${flavor}:${n}`);
  return rng.pick(flavor === "journal" ? JOURNAL_POOL : NOTE_POOL);
}

/** Which readable an injection point grants (notes common, maps the prize). */
export function rollReadable(rng: Rng): string {
  const x = rng.next();
  return x < 0.55 ? "Weathered Note" : x < 0.8 ? "Survivor Journal" : "Stash Map";
}

export const stashFlag = (tx: number, ty: number): string => `stash_${tx}_${ty}`;

/** Stash flags present on the run (drives the n-th deterministic location). */
export function stashCount(state: GameState): number {
  return state.worldFlags.filter((f) => f.startsWith("stash_")).length;
}

/** Parse a stash flag back to its tile. */
export function parseStashFlag(flag: string): { tx: number; ty: number } | null {
  const m = /^stash_(\d+)_(\d+)$/.exec(flag);
  return m ? { tx: parseInt(m[1], 10), ty: parseInt(m[2], 10) } : null;
}

const SOLID = new Set<number>(SOLID_TILES as number[]);

/** Roll the n-th stash location: a WALKABLE tile 3–6 chunks from the reader, on
 *  land, nudged deterministically off solid tiles (generateChunk is pure, so the
 *  spot is final the moment the flag is written — no save-scum, no drift). */
export function rollStashSpot(seed: string, px: number, py: number, n: number): { tx: number; ty: number } | null {
  const rng = createRng(`${seed}:stash:${n}`);
  const pcx = Math.floor(px / (CHUNK_TILES * TILE_SIZE));
  const pcy = Math.floor(py / (CHUNK_TILES * TILE_SIZE));
  for (let tries = 0; tries < 14; tries++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = 3 + rng.next() * 3; // 3–6 chunks out — a real expedition
    const cx = Math.round(pcx + Math.cos(ang) * dist);
    const cy = Math.round(pcy + Math.sin(ang) * dist);
    if (cx < 1 || cy < 1 || cx >= WORLD_CHUNKS_X - 1 || cy >= WORLD_CHUNKS_Y - 1) continue;
    const biome = biomeAt(seed, cx, cy);
    if (biome.id === "ocean" || biome.id === "lake") continue;
    const chunk = generateChunk(seed, cx, cy);
    const lx0 = 4 + rng.int(0, CHUNK_TILES - 9);
    const ly0 = 4 + rng.int(0, CHUNK_TILES - 9);
    // deterministic outward ring scan for open ground near the rolled tile
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const lx = lx0 + dx;
          const ly = ly0 + dy;
          if (lx < 1 || ly < 1 || lx >= CHUNK_TILES - 1 || ly >= CHUNK_TILES - 1) continue;
          const t = chunk.grid[ly][lx];
          if (!SOLID.has(t) && t !== Tile.Floor && t !== Tile.Door && t !== Tile.Lava) {
            return { tx: cx * CHUNK_TILES + lx, ty: cy * CHUNK_TILES + ly };
          }
        }
      }
    }
  }
  return null;
}
