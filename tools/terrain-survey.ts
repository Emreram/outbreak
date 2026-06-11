// Terrain survey (Terrain Overhaul PR1): a dev tool that maps a seed's world so
// screenshot verification can teleport straight to interesting places.
//   npx tsx tools/terrain-survey.ts <seed>            — survey one seed
//   npx tsx tools/terrain-survey.ts --scan <n>        — scan n random seeds for marsh-heavy ones
// Prints a biome histogram, the spawn chunk, and example coordinates (chunk +
// world-px centre) for marsh / lake / coast / river-bridge / urban-border chunks.

import { biomeAt } from "../src/game/world/biomes";
import { findSpawnChunk } from "../src/game/world/spawn";
import { generateChunk, Tile } from "../src/game/worldgen";
import { CHUNK_TILES, TILE_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "../src/game/constants";

const px = (cx: number, cy: number): string => {
  const x = Math.round((cx + 0.5) * CHUNK_TILES * TILE_SIZE);
  const y = Math.round((cy + 0.5) * CHUNK_TILES * TILE_SIZE);
  return `chunk(${cx},${cy}) px(${x},${y})`;
};

function survey(seed: string): void {
  console.log(`\n=== seed "${seed}" ===`);
  const hist = new Map<string, number>();
  const examples = new Map<string, { cx: number; cy: number }>();
  const urbanBorders: Array<{ cx: number; cy: number }> = [];
  // Examples skip the 3-chunk rim ring — the edge falloff floods it by design,
  // so rim chunks aren't representative of their biome.
  for (let cy = 3; cy < WORLD_CHUNKS_Y - 3; cy++) {
    for (let cx = 3; cx < WORLD_CHUNKS_X - 3; cx++) {
      const b = biomeAt(seed, cx, cy);
      hist.set(b.id, (hist.get(b.id) ?? 0) + 1);
      if (!examples.has(b.id)) examples.set(b.id, { cx, cy });
      if (b.urban && urbanBorders.length < 3) {
        const n = [biomeAt(seed, cx + 1, cy), biomeAt(seed, cx - 1, cy), biomeAt(seed, cx, cy + 1), biomeAt(seed, cx, cy - 1)];
        if (n.some((x) => !x.urban && x.id !== "ocean")) urbanBorders.push({ cx, cy });
      }
    }
  }
  const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log("biomes:", sorted.map(([id, n]) => `${id}:${n}`).join(" "));

  const spawn = findSpawnChunk(seed);
  console.log(`spawn  ${px(spawn.x, spawn.y)}  (${biomeAt(seed, spawn.x, spawn.y).id})`);

  for (const id of ["marsh", "wetland", "lake", "coast", "volcanic"]) {
    const e = examples.get(id);
    console.log(e ? `${id.padEnd(8)} ${px(e.cx, e.cy)}` : `${id.padEnd(8)} (none this seed)`);
  }
  for (const u of urbanBorders.slice(0, 1)) console.log(`urb-edge ${px(u.cx, u.cy)}`);

  // A bridge: scan outward from spawn for a chunk whose grid holds Bridge tiles.
  outer: for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const cx = spawn.x + dx;
        const cy = spawn.y + dy;
        if (cx < 1 || cy < 1 || cx >= WORLD_CHUNKS_X - 1 || cy >= WORLD_CHUNKS_Y - 1) continue;
        if (biomeAt(seed, cx, cy).urban) continue;
        const g = generateChunk(seed, cx, cy).grid;
        for (let ly = 0; ly < CHUNK_TILES; ly++) {
          const lx = g[ly].indexOf(Tile.Bridge);
          if (lx >= 0) {
            const gx = cx * CHUNK_TILES + lx;
            const gy = cy * CHUNK_TILES + ly;
            console.log(`bridge   tile(${gx},${gy}) px(${Math.round((gx + 0.5) * TILE_SIZE)},${Math.round((gy + 0.5) * TILE_SIZE)})`);
            break outer;
          }
        }
      }
    }
  }
}

const args = process.argv.slice(2);
if (args[0] === "--scan") {
  // Find marsh-heavy seeds for worst-case screenshot verification.
  const n = parseInt(args[1] ?? "12", 10);
  const scored: Array<{ seed: string; marsh: number }> = [];
  for (let i = 0; i < n; i++) {
    const seed = `scan${i}`;
    let marsh = 0;
    for (let cy = 1; cy < WORLD_CHUNKS_Y - 1; cy++) {
      for (let cx = 1; cx < WORLD_CHUNKS_X - 1; cx++) {
        const id = biomeAt(seed, cx, cy).id;
        if (id === "marsh" || id === "wetland") marsh++;
      }
    }
    scored.push({ seed, marsh });
  }
  scored.sort((a, b) => b.marsh - a.marsh);
  console.log("marsh-heaviest seeds:", scored.slice(0, 4).map((s) => `${s.seed}(${s.marsh})`).join(" "));
  survey(scored[0].seed);
} else {
  survey(args[0] ?? "alpha");
}
