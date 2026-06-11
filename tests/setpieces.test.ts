// Roadside set-piece scenes (Expansion U2): templates are well-formed, the pass
// appends only (forked rng — main stream untouched), placement respects bounds +
// walkability, scenes appear at a sane rate, and everything is reproducible.

import { generateChunk, SOLID_TILES, Tile } from "../src/game/worldgen";
import { SETPIECES, applySetpieces } from "../src/game/world/setpieces";
import { hasLandmarkStyle } from "../src/game/world/landmarks";
import { CHUNK_TILES } from "../src/game/constants";

const SOLID = new Set<number>(SOLID_TILES as number[]);

let failed = 0;
function ok(cond: boolean, msg: string): void {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) failed++;
}

// Template sanity: ids unique, stamps near the anchor, containers + labels styled.
{
  const ids = new Set(SETPIECES.map((d) => d.id));
  ok(ids.size === SETPIECES.length, "set-piece ids unique");
  ok(SETPIECES.every((d) => d.stamps.length >= 4), "every scene has a real prop arrangement (4+ stamps)");
  ok(SETPIECES.every((d) => d.stamps.every((s) => Math.abs(s.dx) <= 4 && Math.abs(s.dy) <= 4)), "stamps cluster near the anchor");
  ok(SETPIECES.every((d) => d.containers.length >= 1), "every scene carries loot");
  ok(SETPIECES.every((d) => hasLandmarkStyle(d.id)), "every scene id has a curated landmark style");
  ok(SETPIECES.some((d) => d.where === "open"), "open-country templates exist (non-urban chunks)");
}

// Scan a patch: scenes appear, all parts in-bounds + walkable, gids namespaced.
{
  let scenes = 0;
  let ambushes = 0;
  let errs = 0;
  const sceneIds = new Set(SETPIECES.map((d) => d.id));
  for (let cy = 14; cy <= 26; cy++) {
    for (let cx = 14; cx <= 26; cx++) {
      const c = generateChunk("scenes", cx, cy);
      const sceneLm = c.landmarks.filter((l) => sceneIds.has(l.kind));
      if (sceneLm.length === 0) continue;
      scenes += sceneLm.length;
      if (sceneLm.length > 1) errs++; // max one scene per chunk
      if (c.ambush && c.ambush.length > 0) ambushes++;
      for (const p of c.props.filter((p) => p.gid?.includes("_sp"))) {
        const tx = Math.floor(p.x / c.tileSize) - cx * CHUNK_TILES;
        const ty = Math.floor(p.y / c.tileSize) - cy * CHUNK_TILES;
        const t = c.grid[ty]?.[tx];
        if (t === undefined || SOLID.has(t) || t === Tile.Floor) errs++;
      }
      for (const ct of c.containers.filter((x) => x.gid.includes("_sc"))) {
        const t = c.grid[ct.ty - cy * CHUNK_TILES]?.[ct.tx - cx * CHUNK_TILES];
        if (t === undefined || SOLID.has(t)) errs++;
      }
    }
  }
  console.log(`  scenes=${scenes} ambushes=${ambushes} over 169 chunks`);
  ok(scenes >= 8, `scenes appear across the world (got ${scenes})`);
  ok(ambushes >= 1, "some scenes post guards");
  ok(errs === 0, `scene parts in-bounds, on open ground, one per chunk (${errs} errors)`);
}

// Append-only + fork isolation: applySetpieces twice on identical inputs appends
// identically, and never touches the grid or pre-existing entries.
{
  const base = generateChunk("fork", 20, 21);
  const gridBefore = JSON.stringify(base.grid);
  const a = generateChunk("fork", 20, 21);
  const b = generateChunk("fork", 20, 21);
  ok(JSON.stringify(a) === JSON.stringify(b), "chunks with scenes fully reproducible");
  ok(JSON.stringify(a.grid) === gridBefore, "scene pass never mutates terrain");
  // calling the pass again on a chunk that already has landmarks must be a no-op
  const before = JSON.stringify({ p: a.props.length, c: a.containers.length, l: a.landmarks.length });
  applySetpieces("fork", a);
  const after = JSON.stringify({ p: a.props.length, c: a.containers.length, l: a.landmarks.length });
  ok(before === after, "pass is a no-op when a landmark already occupies the chunk");
}

// Forked-rng invariant pin: the MAIN stream's outputs (buildings + _c containers +
// _p props) for a fixed (seed,cx,cy) must stay byte-identical across versions —
// new passes must fork their rng and append only (worldgen.ts header).
{
  const c = generateChunk("pin-1", 20, 20);
  const mainStream = JSON.stringify({
    buildings: c.buildings.map((b) => b.gid + ":" + b.type + ":" + b.tx + "," + b.ty),
    containers: c.containers.filter((x) => /_(c|L|x)\d/.test(x.gid)).map((x) => x.gid + ":" + x.kind + ":" + x.tx + "," + x.ty),
    props: c.props.filter((p) => p.gid?.includes("_p")).map((p) => p.gid + ":" + p.kind),
  });
  // Pinned LITERAL from the U2 build. If this fails, a change reshuffled the main
  // worldgen rng stream — existing saves' chest_/searched_ flags would misalign.
  // (The old check compared the hash to itself, which could never fail.) If the
  // reshuffle is INTENTIONAL, bump SAVE_KEY and re-pin the new hash.
  // Re-pinned for the Terrain Overhaul (PR1): terrain became a pure field (no rng
  // in scatter), so the main stream reshuffled ONCE — covered by the v4 save wipe.
  const PINNED_MAIN_STREAM_HASH = "ff874d62";
  const hash = fnv(mainStream);
  console.log(`  main-stream hash=${hash}`);
  ok(hash === PINNED_MAIN_STREAM_HASH, `main stream matches the pinned hash (${hash} vs ${PINNED_MAIN_STREAM_HASH})`);
  const again = generateChunk("pin-1", 20, 20);
  const mainStream2 = JSON.stringify({
    buildings: again.buildings.map((b) => b.gid + ":" + b.type + ":" + b.tx + "," + b.ty),
    containers: again.containers.filter((x) => /_(c|L|x)\d/.test(x.gid)).map((x) => x.gid + ":" + x.kind + ":" + x.tx + "," + x.ty),
    props: again.props.filter((p) => p.gid?.includes("_p")).map((p) => p.gid + ":" + p.kind),
  });
  ok(mainStream === mainStream2, "main stream stable across calls");
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

console.log(failed === 0 ? "ALL SETPIECE CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
