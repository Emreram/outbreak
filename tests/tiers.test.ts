// Survivor quality tiers (Batch E): tier stat scaling, the recruit supply+standing
// cost (scaled by tier), the recruit gate (blocks without standing or supplies,
// consumes on success), and tier-biased / deterministic barter offers.

import { newGame } from "../src/game/GameState";
import { addItem, itemCount, removeItem } from "../src/game/inventory";
import {
  NPC_TIERS,
  rollTier,
  recruitCost,
  canRecruit,
  payRecruit,
  generateOffers,
  addStanding,
} from "../src/game/npcs";
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

// --- tier stats scale poor < average < prime --------------------------------
ok(NPC_TIERS.prime.hpMul > NPC_TIERS.average.hpMul && NPC_TIERS.average.hpMul > NPC_TIERS.poor.hpMul, "hp multiplier rises with tier");
ok(NPC_TIERS.prime.dmgMul > NPC_TIERS.poor.dmgMul, "damage multiplier rises with tier");
ok(NPC_TIERS.prime.maxOffers > NPC_TIERS.poor.maxOffers, "prime survivors offer more goods than poor");

// --- rollTier is deterministic + valid --------------------------------------
const t1 = rollTier(createRng("tier:1"), 0, "townsfolk");
const t2 = rollTier(createRng("tier:1"), 0, "townsfolk");
ok(t1 === t2, "rollTier is deterministic per rng seed");
ok(["poor", "average", "prime"].includes(t1), "rollTier returns a valid tier");

// --- recruit cost scales with tier ------------------------------------------
const poorCost = recruitCost("poor");
const primeCost = recruitCost("prime");
const sumQty = (c: typeof poorCost) => c.items.reduce((a, i) => a + i.qty, 0);
ok(sumQty(primeCost) > sumQty(poorCost), "a prime survivor costs more supplies than a poor one");
ok(primeCost.standingReq > poorCost.standingReq, "a prime survivor needs more standing");
ok(primeCost.items.some((i) => i.item === "Bandage"), "a prime survivor wants a medical item too");

// --- recruit gate: standing + supplies, consumed on success ------------------
// Strip the starting kit so the gate is unambiguous (newGame seeds food/water/meds).
const s = newGame("recruit");
removeItem(s, "Canned Food", 99);
removeItem(s, "Water Bottle", 99);
removeItem(s, "Bandage", 99);
ok(!canRecruit(s, "townsfolk", "prime"), "cannot recruit a prime survivor with nothing");
addStanding(s, "townsfolk", 50);
ok(!canRecruit(s, "townsfolk", "prime"), "standing alone is not enough — supplies are still required");
for (const c of primeCost.items) addItem(s, c.item, c.qty);
ok(canRecruit(s, "townsfolk", "prime"), "standing + the full supply bundle → can recruit");
payRecruit(s, "prime");
ok(
  itemCount(s, "Canned Food") === 0 && itemCount(s, "Water Bottle") === 0 && itemCount(s, "Bandage") === 0,
  "recruiting consumes exactly the supply bundle",
);
ok(!canRecruit(s, "townsfolk", "prime"), "cannot recruit again once the supplies are spent");

// A poor survivor needs no standing — only a thin supply bundle.
const sp = newGame("recruit-poor");
removeItem(sp, "Canned Food", 99);
removeItem(sp, "Water Bottle", 99);
ok(recruitCost("poor").standingReq === 0, "poor survivors have no standing requirement");
ok(!canRecruit(sp, "wanderers", "poor"), "still blocked without the (small) supply cost");
for (const c of recruitCost("poor").items) addItem(sp, c.item, c.qty);
ok(canRecruit(sp, "wanderers", "poor"), "a poor survivor recruits with just the staples");

// --- tier-biased, deterministic, capped barter offers ------------------------
const poorOffers = generateOffers(createRng("o:1"), "scavengers", "poor");
const primeOffers = generateOffers(createRng("o:1"), "scavengers", "prime");
ok(poorOffers.length <= NPC_TIERS.poor.maxOffers, "poor survivors offer a thin selection (cap respected)");
ok(primeOffers.length <= NPC_TIERS.prime.maxOffers, "prime survivors offer up to their larger cap");
ok(
  JSON.stringify(generateOffers(createRng("o:1"), "scavengers", "prime")) === JSON.stringify(primeOffers),
  "offers are deterministic per rng seed + tier",
);
ok(
  primeOffers.every((o) => o.get.item && o.get.qty > 0 && o.give.length > 0 && o.give.every((g) => g.qty > 0)),
  "every generated offer is well-formed (valid give → get)",
);

console.log(fail === 0 ? "ALL TIER CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
