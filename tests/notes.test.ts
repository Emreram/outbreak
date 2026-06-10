// Readables & stash maps (Expansion U2): defs registered, flavour text is
// deterministic + non-empty, stash spots are deterministic / on land / walkable,
// and flags round-trip through the parser.

import { READABLES } from "../src/game/items/readables";
import { defOf } from "../src/game/items/catalog";
import { rollLoot } from "../src/game/items/lootTables";
import { noteText, rollReadable, rollStashSpot, stashFlag, parseStashFlag, stashCount } from "../src/game/notes";
import { generateChunk, SOLID_TILES } from "../src/game/worldgen";
import { createRng } from "../src/game/rng";
import { newGame } from "../src/game/GameState";
import { CHUNK_TILES, TILE_SIZE, SPAWN_CHUNK } from "../src/game/constants";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let failed = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) failed++;
}

// Defs registered in the catalog, but OUT of the generic loot pools.
{
  ok(READABLES.length === 3, "three readables defined");
  ok(READABLES.every((r) => defOf(r.name).kind === "readable"), "readables resolve via the catalog");
  const rng = createRng("pools");
  let leaked = 0;
  const readableNames = new Set(READABLES.map((r) => r.name));
  for (let i = 0; i < 400; i++) {
    for (const s of rollLoot("chest:4", rng, 3, 1)) if (readableNames.has(s.item)) leaked++;
  }
  ok(leaked === 0, "readables never appear in generic loot rolls (explicit injection only)");
}

// Flavour text: deterministic per (seed, n, flavor), non-empty, varies with n.
{
  ok(noteText("s1", 0, "note") === noteText("s1", 0, "note"), "note text deterministic");
  ok(noteText("s1", 0, "note").length > 20, "note text is substantial");
  ok(noteText("s1", 0, "journal").length > 20, "journal text is substantial");
  const texts = new Set<string>();
  for (let n = 0; n < 8; n++) texts.add(noteText("s1", n, "note"));
  ok(texts.size >= 4, "successive notes vary");
}

// rollReadable: notes common, maps present but the prize.
{
  const rng = createRng("rollr");
  const counts: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) {
    const r = rollReadable(rng);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  ok((counts["Weathered Note"] ?? 0) > (counts["Stash Map"] ?? 0), "notes commoner than maps");
  ok((counts["Stash Map"] ?? 0) > 200, "maps still findable (~20%)");
}

// Stash spots: deterministic, on land, walkable, 3–6 chunks out; flag round-trips.
{
  const px = (SPAWN_CHUNK.x * CHUNK_TILES + 24) * TILE_SIZE;
  const py = (SPAWN_CHUNK.y * CHUNK_TILES + 24) * TILE_SIZE;
  const a = rollStashSpot("stash-seed", px, py, 0);
  const b = rollStashSpot("stash-seed", px, py, 0);
  ok(!!a && !!b && a.tx === b.tx && a.ty === b.ty, "stash spot deterministic per (seed, n)");
  const c = rollStashSpot("stash-seed", px, py, 1);
  ok(!!c && (c.tx !== a!.tx || c.ty !== a!.ty), "the next map points somewhere else");
  if (a) {
    const dChunks = Math.hypot(Math.floor(a.tx / CHUNK_TILES) - SPAWN_CHUNK.x, Math.floor(a.ty / CHUNK_TILES) - SPAWN_CHUNK.y);
    ok(dChunks >= 2 && dChunks <= 7, `stash is an expedition away (${dChunks.toFixed(1)} chunks)`);
    const chunk = generateChunk("stash-seed", Math.floor(a.tx / CHUNK_TILES), Math.floor(a.ty / CHUNK_TILES));
    const t = chunk.grid[a.ty - Math.floor(a.ty / CHUNK_TILES) * CHUNK_TILES][a.tx - Math.floor(a.tx / CHUNK_TILES) * CHUNK_TILES];
    ok(!new Set<number>(SOLID_TILES as number[]).has(t), "stash tile is walkable");
    const f = stashFlag(a.tx, a.ty);
    const parsed = parseStashFlag(f);
    ok(!!parsed && parsed.tx === a.tx && parsed.ty === a.ty, "stash flag round-trips through the parser");
    const s = newGame("x");
    s.worldFlags.push(f);
    ok(stashCount(s) === 1, "stashCount counts stash_ flags");
    ok(parseStashFlag("chest_stash_1_2") === null, "looted-marker flags don't parse as stashes");
  }
}

console.log(failed === 0 ? "ALL NOTES CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
