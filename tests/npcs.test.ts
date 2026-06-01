// Survivors, factions & barter (Feature 10b) — pure-logic invariants: biome→faction
// mapping, valid generated barter offers, rarity-driven value, accepting a trade,
// faction-standing math + labels, the companion cap, and save/load persistence.

import {
  FACTIONS,
  MAX_COMPANIONS,
  factionForBiome,
  factionStock,
  itemValue,
  generateOffers,
  canAccept,
  acceptOffer,
  getStanding,
  addStanding,
  standingLabel,
  companionCount,
} from "../src/game/npcs";
import { newGame, saveGame, loadGame, clearSave } from "../src/game/GameState";
import { addItem, itemCount } from "../src/game/inventory";
import { createRng } from "../src/game/rng";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- faction mapping ---
ok(factionForBiome("suburb") === "townsfolk", "suburbs are townsfolk");
ok(factionForBiome("forest") === "wanderers", "forests are wanderers");
ok(factionForBiome("downtown") === "scavengers", "downtown defaults to scavengers");
ok((FACTIONS as readonly string[]).includes(factionForBiome("industrial")), "every faction-of-biome is a known faction");
ok(typeof factionStock("townsfolk") === "string", "each faction maps to a loot stock source");

// --- value: rarer is worth more ---
ok(itemValue("First-Aid Kit") > itemValue("Snacks"), "a rare item is worth more than a common one");

// --- generated offers are well-formed ---
const offers = generateOffers(createRng("npc:1"), "townsfolk");
ok(offers.length > 0, "a survivor generates at least one barter offer");
ok(
  offers.every((o) => o.get.item && o.get.qty > 0 && o.give.length > 0 && o.give.every((g) => g.qty > 0)),
  "every offer has a valid give → get with positive quantities",
);
ok(JSON.stringify(generateOffers(createRng("npc:1"), "townsfolk")) === JSON.stringify(offers), "offers are deterministic per rng seed");

// --- accepting a trade consumes the give + grants the get ---
const s = newGame("trade");
const offer = { give: [{ item: "Scrap Metal", qty: 2 }], get: { item: "Bandage", qty: 1 } };
ok(!canAccept(s, offer), "cannot accept a trade without the goods");
addItem(s, "Scrap Metal", 2);
const band0 = itemCount(s, "Bandage");
ok(canAccept(s, offer) && acceptOffer(s, offer), "accept a trade once you hold the staples");
ok(itemCount(s, "Scrap Metal") === 0 && itemCount(s, "Bandage") === band0 + 1, "trade took the staples and gave the goods");
ok(!acceptOffer(s, offer), "the same trade fails once the staples are gone");

// --- faction standing math + labels ---
const st = newGame("standing");
ok(getStanding(st, "townsfolk") === 0, "standing starts neutral");
ok(addStanding(st, "townsfolk", 30) === 30 && addStanding(st, "townsfolk", 200) === 100, "standing rises and clamps at +100");
ok(addStanding(st, "wanderers", -500) === -100, "standing clamps at -100");
ok(standingLabel(70) === "allied" && standingLabel(0) === "neutral" && standingLabel(-80) === "hostile", "standing labels map to bands");

// --- companion cap ---
const cg = newGame("comp");
ok(companionCount(cg) === 0 && MAX_COMPANIONS >= 1, "no companions by default; cap is positive");
cg.npcs = [
  { id: "a", name: "Mara", kind: "companion", faction: "townsfolk", x: 0, y: 0, hp: 40, maxHp: 40 },
  { id: "b", name: "Cole", kind: "survivor", faction: "wanderers", x: 0, y: 0, hp: 40, maxHp: 40 },
];
ok(companionCount(cg) === 1, "companionCount counts only recruited companions");

// --- persistence ---
const sv = newGame("npcsave");
sv.npcs = [{ id: "z", name: "Iris", kind: "companion", faction: "townsfolk", x: 12, y: 34, hp: 30, maxHp: 45 }];
addStanding(sv, "townsfolk", 15);
saveGame(sv);
const loaded = loadGame();
ok(
  loaded !== null &&
    JSON.stringify(loaded.npcs) === JSON.stringify(sv.npcs) &&
    loaded.factions?.townsfolk === 15,
  "companions + faction standing persist across save/load",
);
clearSave();

console.log(fail === 0 ? "ALL NPC CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
