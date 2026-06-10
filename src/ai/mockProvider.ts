import type { LLMProvider } from "./provider";
import { createRng, type Rng } from "../game/rng";
import { WEAPON_ITEMS } from "../game/inventory";
import { rollLoot } from "../game/items/lootTables";
import { classifyIntent } from "../game/intent";
import type { NextInteraction } from "../shared/contracts";

// Offline procedural Game Master ("the Director"). Implements LLMProvider so the
// full AI-driven loop runs on ANY device with NO model and NO API key — the
// default so the deployed site "just works". Real Ollama / Claude are a one-env-var
// swap (CLAUDE.md §8.1). Returns schema-valid JSON; the engine validates it.
//
// It reacts to the player's actual words (intent + echo), scales danger with the
// outbreak day, and produces outcomes with real impact (loot, wounds, infection,
// spawns, world flags) so the AI genuinely drives play.

interface GS {
  player?: Partial<Record<"hp" | "stamina" | "hunger" | "thirst" | "infection", number>>;
  inventory?: { item: string; qty: number }[];
  worldFlags?: string[];
  recentEvents?: string[];
  day?: number;
  timeOfDay?: string;
  bloodMoon?: boolean;
  location_type?: string;
}
interface TurnIn {
  game_state?: GS;
  input?: { mode?: string; value?: string };
  kind?: string;
  theme?: string;
  background?: string;
}

// Loot now comes from the rarity-weighted catalog tables (src/game/items/lootTables.ts).

const FOOD = new Set(["Canned Food", "Energy Bar", "Dried Fruit", "Snacks"]);
const DRINK = new Set(["Water Bottle", "Soda"]);
const MEDS = new Set(["Bandage", "Antibiotics", "Painkillers", "Antiseptic", "Saline Drip"]);

interface Outcome {
  narrative: string;
  d: Record<"hp" | "stamina" | "hunger" | "thirst" | "infection", number>;
  add: { item: string; qty: number; note?: string }[];
  remove: { item: string; qty: number }[];
  flags: string[];
  spawns: { type: string; count: number; reason?: string }[];
  forceChoices: boolean;
  gameOver: boolean;
  gameOverReason: string;
}

export class MockProvider implements LLMProvider {
  async generate(_system: string, payload: object, _schema: object): Promise<string> {
    const p = payload as TurnIn;
    const rng = createRng(`${p.input?.value ?? ""}|${Date.now()}|${Math.random()}`);
    if (p.kind === "scenario") {
      return JSON.stringify(scenario(p.theme ?? "downtown high-rise", rng, p.background));
    }
    return JSON.stringify(turn(p, rng));
  }
}

function turn(p: TurnIn, rng: Rng): object {
  const gs = p.game_state ?? {};
  const loc = (gs.location_type ?? "street").toLowerCase();
  const inv = gs.inventory ?? [];
  const raw = (p.input?.value ?? "").trim();
  const value = raw.toLowerCase();
  const hp = gs.player?.hp ?? 100;
  const day = gs.day ?? 0;
  const night = gs.timeOfDay === "night" || gs.timeOfDay === "dusk";
  const bloodMoon = gs.bloodMoon === true;
  const hasWeapon = inv.some((i) => WEAPON_ITEMS.has(i.item));
  const intent = classifyIntent(value);
  const careful = /quiet|sneak|careful|slow|cautious|stealth|softly/.test(value);

  // Danger ramps with the outbreak (day 0 is nearly calm), spikes at night, and a
  // blood moon makes the streets a churning, runner-heavy swarm.
  const danger = Math.min(0.04 + day * 0.05 + (night ? 0.18 : 0) + (bloodMoon ? 0.35 : 0), 0.92);
  const spawnChance = Math.max(0, danger * (careful ? 0.35 : 1));
  // On a blood moon, "something showed up" almost always means a small pack, runner-led.
  const undead = (): string => (bloodMoon || rng.chance(danger) ? "zombie_runner" : "zombie");
  const packCount = (lo: number, hi: number): number => rng.int(lo, hi) + (bloodMoon ? rng.int(2, 4) : 0);

  const o: Outcome = {
    narrative: "",
    d: { hp: 0, stamina: 0, hunger: 0, thirst: 0, infection: 0 },
    add: [],
    remove: [],
    flags: [],
    spawns: [],
    forceChoices: false,
    gameOver: false,
    gameOverReason: "",
  };

  // Every action passes a little time.
  o.d.hunger -= rng.int(1, 3);
  o.d.thirst -= rng.int(2, 4);

  switch (intent) {
    case "search": {
      o.d.stamina -= rng.int(6, 13);
      const findP = OPEN_LOCS.has(loc) ? 0.4 : 0.84;
      if (rng.chance(findP)) {
        const found = rollLoot(loc, rng, careful ? 2 : 1); // rarity-graded, location-appropriate
        for (const s of found) o.add.push({ item: s.item, qty: s.qty });
        const first = found[0]?.item ?? "supplies";
        o.narrative = `You work through the ${prettyLoc(loc)}, prying open drawers and shoving shelves aside. Tucked away: ${first}.`;
        if (found.some((s) => WEAPON_ITEMS.has(s.item))) o.narrative += " Finally, something to fight back with.";
      } else {
        o.narrative = `You ransack the ${prettyLoc(loc)}, but someone got here first — only broken glass and empty packaging.`;
      }
      if (rng.chance(spawnChance + 0.08)) {
        o.spawns.push({ type: undead(), count: packCount(1, 2), reason: "noise drew them" });
        o.narrative += careful ? " A floorboard creaks — you freeze as a shape shifts nearby." : " The racket carries. Something answers with a wet snarl.";
        o.forceChoices = true;
      }
      break;
    }
    case "rest": {
      o.d.stamina += rng.int(30, 45);
      o.d.hunger -= rng.int(5, 9);
      o.d.thirst -= rng.int(6, 11);
      if (rng.chance(bloodMoon ? 0.92 : night ? 0.55 : 0.2 + danger)) {
        o.d.hp -= rng.int(8, 18);
        o.spawns.push({ type: undead(), count: packCount(1, 2), reason: "ambush while resting" });
        o.narrative = "You let your guard down — and wake to cold hands dragging at you. So much for rest.";
        o.forceChoices = true;
      } else {
        o.narrative = "You hole up somewhere quiet and breathe. The shaking in your hands finally settles.";
      }
      break;
    }
    case "fight": {
      o.d.stamina -= rng.int(14, 24);
      if (hasWeapon) {
        o.d.hp -= rng.int(2, 12);
        o.flags.push("fought_off_infected");
        if (rng.chance(0.14)) {
          o.d.infection += rng.int(15, 30);
          o.narrative = "You put your weapon to work — skulls split, bodies drop. But one got its teeth into you; the bite throbs.";
        } else {
          o.narrative = "You meet them head-on, weapon swinging in brutal arcs. When it's done you're gore-soaked but standing.";
        }
      } else {
        const lethal = (value.includes("horde") || value.includes("all of them") || value.includes("everyone")) && rng.chance(0.6);
        o.d.hp -= lethal ? 100 : rng.int(16, 34);
        if (rng.chance(0.32)) o.d.infection += rng.int(15, 35);
        if (lethal || hp + o.d.hp <= 0) {
          o.gameOver = true;
          o.gameOverReason = "Bare-handed against the dead, you went down under the weight of them.";
          o.narrative = "Fists against teeth is a losing trade. They bear you down before you can break free.";
        } else {
          o.narrative = "You lash out with fists and elbows — it half-works, but their nails and teeth find you first.";
        }
      }
      o.forceChoices = !o.gameOver && rng.chance(0.5);
      break;
    }
    case "flee": {
      o.d.stamina -= rng.int(18, 34);
      if (rng.chance((night ? 0.32 : 0.12) + danger * 0.3)) {
        o.d.hp -= rng.int(6, 16);
        o.narrative = "You bolt, lungs on fire. You tear free — but not before something rakes down your back.";
      } else {
        o.narrative = "You run blind and hard, vaulting debris, and put real distance between you and the dead. For now.";
        o.flags.push("escaped_danger");
      }
      break;
    }
    case "hide": {
      o.d.stamina -= rng.int(2, 6);
      o.narrative = rng.chance(0.82)
        ? "You fold into the shadows and go still. Shuffling steps pass close enough to smell, then fade."
        : "You press into cover, but there's nowhere good — a silhouette lingers, head tilting as if it heard you.";
      o.forceChoices = !rng.chance(0.7);
      break;
    }
    case "eat": {
      const f = inv.find((i) => FOOD.has(i.item));
      if (f) {
        o.remove.push({ item: f.item, qty: 1 });
        o.d.hunger += rng.int(26, 38);
        o.narrative = `You wolf down the ${f.item}. The gnawing in your gut finally lets go.`;
      } else {
        o.narrative = "You dig for food and find nothing. Your stomach twists in protest.";
      }
      break;
    }
    case "drink": {
      const dr = inv.find((i) => DRINK.has(i.item));
      if (dr) {
        o.remove.push({ item: dr.item, qty: 1 });
        o.d.thirst += rng.int(30, 42);
        o.narrative = `You drain the ${dr.item}. Your cracked lips and raw throat thank you.`;
      } else {
        o.narrative = "Nothing to drink. Your tongue feels like sandpaper.";
      }
      break;
    }
    case "heal": {
      const m = inv.find((i) => MEDS.has(i.item));
      if (m) {
        o.remove.push({ item: m.item, qty: 1 });
        o.d.hp += rng.int(22, 38);
        if (m.item === "Antibiotics" || m.item === "Antiseptic" || m.item === "Saline Drip") {
          o.d.infection -= rng.int(20, 40);
          o.narrative = `You dose yourself with the ${m.item}. The fever-heat in the wound recedes a little.`;
        } else {
          o.narrative = `You patch yourself with the ${m.item}, hands shaking. The worst of the pain dulls.`;
        }
      } else {
        o.narrative = "You reach for something to treat the wound — but your med supplies are gone.";
      }
      break;
    }
    case "talk": {
      if (rng.chance(0.55)) {
        o.flags.push("met_friendly_survivor");
        if (rng.chance(0.5)) {
          // NOTE: must be real catalog items — "Pistol Ammo" used to slip through
          // as a useless generic material (no such item exists; ammo is "9mm Rounds").
          const gift = rng.pick(["Water Bottle", "Canned Food", "Bandage", "9mm Rounds"]);
          o.add.push({ item: gift, qty: 1, note: "from a survivor" });
          o.narrative = `A wary survivor lowers their pipe. After a tense beat they share a ${gift} and point you toward a safer block.`;
        } else {
          o.narrative = "You call out. A frightened voice answers from a doorway — no trade, but they steer you clear of a nest of the dead.";
        }
      } else {
        o.spawns.push({ type: "survivor_hostile", count: 1, reason: "hostile scavenger" });
        o.narrative = "Your call is answered with a raised crowbar and dead eyes. This one isn't here to talk.";
        o.forceChoices = true;
      }
      break;
    }
    case "barricade": {
      const tools = inv.some((i) => ["Duct Tape", "Nails", "Hammer", "Crowbar"].includes(i.item));
      o.d.stamina -= rng.int(10, 18);
      if (tools) {
        o.flags.push(`barricaded_${loc}`);
        o.narrative = `You drag furniture against the doors and nail it fast. The ${prettyLoc(loc)} feels like it might actually hold.`;
      } else {
        o.narrative = "You try to barricade up, but bare hands and no supplies make for a flimsy job.";
      }
      break;
    }
    case "scout": {
      o.d.stamina -= rng.int(3, 8);
      o.narrative = rng.pick([
        "You find high ground and read the streets. The dead drift in loose herds — and you mark a clearer route.",
        "From cover you watch the block, counting silhouettes and timing their drift. A storefront door hangs open and quiet.",
        "You survey the area. Smoke rises a few streets over; closer by, something worth scavenging glints in a wreck.",
      ]);
      break;
    }
    default: {
      // Free-form action — echo it back so the player feels heard, then improvise.
      o.d.stamina -= rng.int(0, 6);
      o.narrative = `You ${cleanAction(raw)}. ` + rng.pick([
        "For a moment the ruined street stays quiet — but the sweet reek of rot never lets you forget.",
        "It works, more or less. Nothing lunges out of the dark this time.",
        "Somewhere close, glass settles. You hold your breath; nothing comes.",
      ]);
      if (rng.chance(spawnChance)) {
        o.spawns.push({ type: undead(), count: packCount(1, 1), reason: "drawn by movement" });
        o.narrative += " Then a shape peels away from a doorway and starts toward you.";
        o.forceChoices = true;
      }
      break;
    }
  }

  // The blood moon colours every beat of the night.
  if (bloodMoon) o.narrative += " Overhead, the blood moon burns red.";

  const built = buildInteraction(o, rng);
  return {
    narrative: o.narrative,
    state_changes: o.d,
    inventory_add: o.add,
    inventory_remove: o.remove,
    world_flags_add: o.flags,
    spawns: o.spawns,
    discovered: { name: null, type: null, x: null, y: null },
    next_interaction: built.interaction,
    game_over: o.gameOver,
    game_over_reason: o.gameOverReason,
    encounter_over: built.encounterOver,
  };
}

/**
 * Decide the follow-up. Most turns RESOLVE and hand control straight back to
 * exploration (encounter_over=true) — no more constant prompt chains. Only an
 * immediate threat gets exactly ONE tense 4-choice follow-up; the engine caps
 * the whole encounter at 2 turns regardless.
 */
function buildInteraction(o: Outcome, rng: Rng): { interaction: NextInteraction; encounterOver: boolean } {
  const dangerNow = o.spawns.length > 0 || o.forceChoices;
  if (!dangerNow) {
    // Calm/exploration beat → done. The prompt is unused once the engine closes
    // out, but stays schema-valid (free_text ⇒ no options).
    return { interaction: { type: "free_text", prompt: "", options: [] }, encounterOver: true };
  }
  const options = rng.pick([
    ["Stand and fight", "Back away slowly", "Run for it", "Try to slip past"],
    ["Swing at the nearest one", "Throw something to distract them", "Bolt for the exit", "Barricade and wait it out"],
  ]);
  return { interaction: { type: "choices", prompt: "No time — decide.", options }, encounterOver: false };
}

function cleanAction(raw: string): string {
  let s = raw.replace(/^\s*(i\s+|i'd\s+|i\s+want\s+to\s+|i\s+will\s+|let me\s+|try to\s+)/i, "").trim();
  if (!s) s = "look around";
  s = s.charAt(0).toLowerCase() + s.slice(1);
  return s.length > 80 ? s.slice(0, 80) : s;
}

// Open-ground locations (street + outdoor biomes) — scavenging is leaner here
// than inside a building.
const OPEN_LOCS = new Set<string>([
  "street", "forest", "dense_woods", "grassland", "farmland", "riverbank", "lake",
  "marsh", "coast", "quarry", "parkland", "construction_site", "ocean",
]);

function prettyLoc(loc: string): string {
  return loc.replace(/_/g, " ");
}

// --- scenario generation (CLAUDE.md §8.6) — framed at the OUTBREAK'S FIRST HOURS ---

function scenario(theme: string, rng: Rng, background?: string) {
  const NAMES = ["Mara", "Dev", "Ruiz", "Cole", "Imani", "Yuki", "Sasha", "Bishop", "Lena", "Tariq"];
  const byTheme: Record<string, { loc: string; items: string[]; goal: string; hook: string }> = {
    "winter outbreak": { loc: "a frozen transit depot", items: ["Warm Coat", "Canned Food"], goal: "Reach somewhere defensible before the cold and the crowds turn.", hook: "The platform TV is looping an emergency broadcast nobody's watching anymore." },
    "military quarantine zone": { loc: "a checkpoint that's still half-manned", items: ["9mm Pistol", "9mm Rounds"], goal: "Get out of the cordon before it's sealed for good.", hook: "Soldiers are shouting at the crowd to stay back. A few of them already look wrong." },
    "rural farmland collapse": { loc: "a quiet farmhouse kitchen", items: ["Hatchet", "Water Bottle"], goal: "Get the truck running and reach the highway while the roads are open.", hook: "The radio cut out mid-sentence. Out the window, a neighbor is shambling across the field." },
    "downtown high-rise": { loc: "the 14th floor of an office tower as alarms blare", items: ["Crowbar", "Energy Bar"], goal: "Get down to the street before the stairwells choke with people — and worse.", hook: "Phones are buzzing with the same three words: STAY INSIDE. NOW." },
    "overrun hospital": { loc: "a hospital ward as the first patients seize and rise", items: ["Bandage", "Antibiotics"], goal: "Grab what medicine you can and get clear before the ward turns.", hook: "Code alarms are firing in every room at once. The screaming is just starting." },
    "highway exodus": { loc: "a freeway already snarling into gridlock", items: ["Road Flare", "Water Bottle"], goal: "Work your way off the jammed road before panic does the killing for them.", hook: "Brake lights stretch to the horizon. Up ahead, people are abandoning their cars and running." },
    "flooded district": { loc: "a flooded row of shops as the sirens wail", items: ["Rope", "Canned Food"], goal: "Cross to dry ground before nightfall and the rising water.", hook: "Evacuation horns echo off the water. The first infected are floundering in the shallows." },
    "prison break": { loc: "a cell block as the doors release and order breaks", items: ["Shiv", "Canned Food"], goal: "Reach the yard gate before the block becomes a slaughterhouse.", hook: "The PA is dead, the cells are popping open, and the first screams just started down the tier." },
  };
  const t = byTheme[theme] ?? byTheme["downtown high-rise"];
  const name = rng.pick(NAMES);
  return {
    intro_narrative: `It's hour zero. ${background ? `${name}, a ${background.toLowerCase()},` : name} is in ${t.loc} when it all goes sideways. ${t.hook} The infection is spreading fast — minutes ago this was an ordinary day. Whatever you do next is on you.`,
    player_name: name,
    start_location: t.loc,
    starting_items: t.items.map((item) => ({ item, qty: /Rounds|Shells|Ammo|Arrows|Bolts|Nails|Cells/.test(item) ? 24 : 1 })),
    starting_goal: t.goal,
    difficulty_modifier: Math.round(rng.range(0.85, 1.3) * 100) / 100,
  };
}
