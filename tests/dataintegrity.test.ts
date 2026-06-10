// Cross-reference integrity for ALL data-driven content: every item name a system
// hands out must resolve to a REAL catalog def (defOf's generic fallback hides
// typos as useless junk items), every prop kind must have a drawer, every station
// must exist in the build palette, and the offline GM must only gift real items.
// Born from a live bug: survivors gifted "Pistol Ammo" — an item that doesn't exist.

import { getItemDef } from "../src/game/items/catalog";
import { RECIPES } from "../src/game/crafting";
import { PLACEABLES } from "../src/game/base";
import { CROPS, SEED_TO_CROP } from "../src/game/farming";
import { ANIMALS } from "../src/engine/Animal";
import { BACKGROUNDS } from "../src/game/backgrounds";
import { isPerk } from "../src/game/perks";
import { CAR_PARTS } from "../src/game/vehicles";
import { NPC_TIERS, recruitCost } from "../src/game/npcs";
import { SEARCHABLE_PROPS } from "../src/game/scavenge";
import { SETPIECES } from "../src/game/world/setpieces";
import { BIOMES } from "../src/game/world/biomes";
import { landmarkStyle } from "../src/game/world/landmarks";
import { propKinds } from "../src/engine/propSprites";
import { generateChunk } from "../src/game/worldgen";
import { WEAPONS } from "../src/game/items/weapons";
import { ammoItemForType } from "../src/game/items/catalog";
import { MockProvider } from "../src/ai/mockProvider";
import { SCENARIO_THEMES } from "../src/shared/contracts";

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
const real = (name: string): boolean => getItemDef(name) !== undefined;
const bad = (names: Iterable<string>): string[] => [...names].filter((n) => !real(n));

// 1) Crafting: inputs + outputs are real items; stations exist in the build palette.
{
  const names = new Set<string>();
  for (const r of RECIPES) {
    names.add(r.out);
    for (const i of r.inputs) names.add(i.item);
  }
  const missing = bad(names);
  ok(missing.length === 0, `crafting items all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
  const stations = new Set(Object.values(PLACEABLES).map((p) => p.station).filter(Boolean));
  const ghost = RECIPES.filter((r) => r.station && !stations.has(r.station));
  ok(ghost.length === 0, `every recipe station is buildable${ghost.length ? " — GHOST: " + ghost.map((r) => `${r.id}→${r.station}`).join(", ") : ""}`);
}

// 2) Weapons: every gun's calibre maps to a real ammo item.
{
  const broken = WEAPONS.filter((w) => w.hand === "ranged" && w.ammoType && !ammoItemForType(w.ammoType)).map((w) => w.name);
  ok(broken.length === 0, `every gun calibre has an ammo item${broken.length ? " — BROKEN: " + broken.join(", ") : ""}`);
}

// 3) Farming: seeds + produce resolve; seed map is total.
{
  const names = new Set<string>();
  for (const c of Object.values(CROPS)) {
    names.add(c.seed);
    names.add(c.produce);
  }
  const missing = bad(names);
  ok(missing.length === 0, `crop seeds/produce all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
  ok(Object.values(CROPS).every((c) => SEED_TO_CROP[c.seed] === c.id), "seed → crop map is consistent");
}

// 4) Base building: every cost item is real.
{
  const names = new Set<string>();
  for (const p of Object.values(PLACEABLES)) for (const c of p.cost) names.add(c.item);
  const missing = bad(names);
  ok(missing.length === 0, `placeable costs all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
}

// 5) Hunting + vehicles + recruiting hand out real items.
{
  const names = new Set<string>();
  for (const a of Object.values(ANIMALS)) for (const d of a.drops) names.add(d.item);
  for (const p of CAR_PARTS) names.add(p);
  names.add("Fuel Canister");
  for (const tier of Object.keys(NPC_TIERS)) for (const c of recruitCost(tier).items) names.add(c.item);
  const missing = bad(names);
  ok(missing.length === 0, `animal drops / car parts / recruit costs all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
}

// 6) Backgrounds: loadout items real, perks valid.
{
  const names = new Set<string>();
  const badPerks: string[] = [];
  for (const b of BACKGROUNDS) {
    for (const it of b.items) names.add(it.item);
    for (const p of b.perks) if (!isPerk(p)) badPerks.push(`${b.id}:${p}`);
  }
  const missing = bad(names);
  ok(missing.length === 0, `background loadouts all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
  ok(badPerks.length === 0, `background perks all valid${badPerks.length ? " — BAD: " + badPerks.join(", ") : ""}`);
}

// 7) Props: every kind referenced by scavenging, set-pieces, biomes and landmark
//    styles has a drawer; every prop a real generated patch emits has one too.
{
  const kinds = new Set(propKinds());
  const missing: string[] = [];
  for (const k of Object.keys(SEARCHABLE_PROPS)) if (!kinds.has(k)) missing.push(`scavenge:${k}`);
  for (const d of SETPIECES) for (const s of d.stamps) if (!kinds.has(s.kind)) missing.push(`setpiece:${d.id}:${s.kind}`);
  for (const b of Object.values(BIOMES)) {
    for (const p of b.props) if (!kinds.has(p)) missing.push(`biome:${b.id}:${p}`);
    for (const lm of b.landmarks) {
      const prop = landmarkStyle(lm.kind).prop;
      if (prop && !kinds.has(prop)) missing.push(`landmark:${lm.kind}:${prop}`);
    }
  }
  for (const d of SETPIECES) {
    const prop = landmarkStyle(d.id).prop;
    if (prop && !kinds.has(prop)) missing.push(`scene-style:${d.id}:${prop}`);
  }
  for (let cy = 18; cy <= 22; cy++) {
    for (let cx = 18; cx <= 22; cx++) {
      for (const p of generateChunk("integrity", cx, cy).props) {
        if (!kinds.has(p.kind)) missing.push(`gen:${cx},${cy}:${p.kind}`);
      }
    }
  }
  ok(missing.length === 0, `every referenced prop kind has a drawer${missing.length ? " — MISSING: " + [...new Set(missing)].join(", ") : ""}`);
}

// 8) The offline GM only hands out REAL items (scenario kits for every theme).
{
  const mock = new MockProvider();
  void (async () => {
    const missing: string[] = [];
    for (const theme of SCENARIO_THEMES) {
      const raw = JSON.parse(await mock.generate("", { kind: "scenario", theme }, {})) as {
        starting_items: { item: string }[];
      };
      for (const it of raw.starting_items) if (!real(it.item)) missing.push(`${theme}:${it.item}`);
    }
    ok(missing.length === 0, `offline-GM scenario kits all real${missing.length ? " — MISSING: " + missing.join(", ") : ""}`);
    console.log(failed === 0 ? "ALL DATA-INTEGRITY CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  })();
}
