import type { LLMProvider } from "./provider";
import { createRng, type Rng } from "../game/rng";
import { WEAPON_ITEMS } from "../game/inventory";

// Offline procedural Game Master ("the Director"). Implements LLMProvider so the
// full AI-driven loop runs on ANY device with NO model and NO API key — this is
// the default so the deployed website "just works". Real Ollama / Claude remain a
// one-env-var swap (CLAUDE.md §8.1). Returns schema-valid JSON (turn or scenario);
// the engine still validates everything in outcomes.ts (CLAUDE.md §5, §8.5).

interface GS {
  player?: Partial<Record<"hp" | "stamina" | "hunger" | "thirst" | "infection", number>>;
  inventory?: { item: string; qty: number }[];
  worldFlags?: string[];
  recentEvents?: string[];
  day?: number;
  timeOfDay?: string;
  location_type?: string;
}
interface TurnIn {
  game_state?: GS;
  input?: { mode?: string; value?: string };
  kind?: string;
  theme?: string;
}

const LOOT: Record<string, string[]> = {
  pharmacy: ["Bandage", "Antibiotics", "Painkillers", "Antiseptic"],
  hospital: ["Bandage", "Antibiotics", "Saline Drip", "Painkillers"],
  grocery: ["Canned Food", "Water Bottle", "Energy Bar", "Dried Fruit"],
  gas_station: ["Snacks", "Water Bottle", "Fuel Canister", "Road Flare"],
  hardware_store: ["Crowbar", "Hammer", "Nails", "Duct Tape", "Hatchet"],
  police_station: ["Pistol", "Pistol Ammo", "Kevlar Vest", "Baton"],
  house: ["Canned Food", "Water Bottle", "Kitchen Knife", "Batteries", "Blanket"],
  street: ["Scrap Metal", "Empty Bottle", "Loose Brick"],
};

const FOOD = new Set(["Canned Food", "Energy Bar", "Dried Fruit", "Snacks"]);
const DRINK = new Set(["Water Bottle", "Soda"]);
const MEDS = new Set(["Bandage", "Antibiotics", "Painkillers", "Antiseptic", "Saline Drip"]);

type Intent =
  | "search" | "rest" | "fight" | "flee" | "hide" | "eat" | "drink"
  | "heal" | "talk" | "barricade" | "scout" | "explore";

function classify(v: string): Intent {
  const has = (...k: string[]) => k.some((w) => v.includes(w));
  if (has("search", "loot", "scaveng", "rummage", "ransack", "grab", "open", "raid")) return "search";
  if (has("rest", "sleep", "wait", "camp", "catch your breath", "recover")) return "rest";
  if (has("fight", "attack", "kill", "shoot", "swing", "smash", "stab", "bash")) return "fight";
  if (has("flee", "run", "escape", "retreat", "sprint away", "get away")) return "flee";
  if (has("hide", "sneak", "crouch", "quiet", "stealth", "duck")) return "hide";
  if (has("eat", "food")) return "eat";
  if (has("drink", "water")) return "drink";
  if (has("heal", "bandage", "patch", "treat", "medicine", "first aid")) return "heal";
  if (has("talk", "help", "trade", "greet", "approach", "call out", "negotiate")) return "talk";
  if (has("barricade", "fortify", "board up", "block", "build", "secure")) return "barricade";
  if (has("scout", "scan", "observe", "climb", "roof", "survey", "look around", "lookout")) return "scout";
  return "explore";
}

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
      return JSON.stringify(scenario(p.theme ?? "downtown high-rise", rng));
    }
    return JSON.stringify(turn(p, rng));
  }
}

function turn(p: TurnIn, rng: Rng): object {
  const gs = p.game_state ?? {};
  const loc = (gs.location_type ?? "street").toLowerCase();
  const inv = gs.inventory ?? [];
  const value = (p.input?.value ?? "").toLowerCase().trim();
  const hp = gs.player?.hp ?? 100;
  const night = gs.timeOfDay === "night" || gs.timeOfDay === "dusk";
  const hasWeapon = inv.some((i) => WEAPON_ITEMS.has(i.item));
  const locLoot = LOOT[loc] ?? LOOT.street;
  const intent = classify(value);

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
      o.d.stamina -= rng.int(4, 10);
      if (rng.chance(loc === "street" ? 0.45 : 0.78)) {
        const item = rng.pick(locLoot);
        const qty = rng.int(1, 2);
        o.add.push({ item, qty });
        o.narrative = `You pick through the ${prettyLoc(loc)}, shoving debris aside. Tucked away, you find ${qty > 1 ? `${qty} ` : "a "}${item}${qty > 1 ? "s" : ""}.`;
      } else {
        o.narrative = `You search the ${prettyLoc(loc)} methodically, but anything useful is long gone.`;
      }
      if (rng.chance(night ? 0.5 : 0.28)) {
        o.spawns.push({ type: rng.chance(0.2) ? "zombie_runner" : "zombie", count: rng.int(1, 2), reason: "noise from searching" });
        o.narrative += " A wet snarl answers the noise — something heard you.";
        o.forceChoices = true;
      }
      break;
    }
    case "rest": {
      o.d.stamina += rng.int(25, 40);
      o.d.hunger -= rng.int(4, 8);
      o.d.thirst -= rng.int(5, 10);
      if (rng.chance(night ? 0.5 : 0.22)) {
        o.d.hp -= rng.int(5, 15);
        o.spawns.push({ type: "zombie", count: rng.int(1, 2), reason: "ambush while resting" });
        o.narrative = "You let your eyes close — and jolt awake to cold hands clawing at you. So much for rest.";
        o.forceChoices = true;
      } else {
        o.narrative = "You hole up and catch your breath. The ache in your limbs dulls a little.";
      }
      break;
    }
    case "fight": {
      o.d.stamina -= rng.int(12, 22);
      if (hasWeapon) {
        o.d.hp -= rng.int(0, 10);
        o.flags.push("fought_off_infected");
        if (rng.chance(0.12)) {
          o.d.infection += rng.int(15, 30);
          o.narrative = "You put the weapon to work — skulls crack, bodies drop. But one got close; a scratch burns hot on your arm.";
        } else {
          o.narrative = "You meet them head-on, weapon swinging in tight arcs. When it's over, you're breathing hard but standing.";
        }
      } else {
        const lethal = (value.includes("horde") || value.includes("all of them")) && rng.chance(0.6);
        o.d.hp -= lethal ? 100 : rng.int(12, 28);
        if (rng.chance(0.3)) o.d.infection += rng.int(15, 35);
        if (lethal || hp + o.d.hp <= 0) {
          o.gameOver = true;
          o.gameOverReason = "Overwhelmed and unarmed, you went down under the press of bodies.";
          o.narrative = "Bare hands against the dead is a losing trade. They drag you down before you can land a second blow.";
        } else {
          o.narrative = "You lash out with fists and elbows. It works — barely — but their teeth and nails find you first.";
        }
      }
      o.forceChoices = !o.gameOver && rng.chance(0.5);
      break;
    }
    case "flee": {
      o.d.stamina -= rng.int(18, 32);
      if (rng.chance(night ? 0.3 : 0.12)) {
        o.d.hp -= rng.int(6, 14);
        o.narrative = "You bolt, lungs burning. You break free, but not before something rakes across your back.";
      } else {
        o.narrative = "You run — hard, blind, desperate — and put real distance between you and the danger. For now.";
        o.flags.push("escaped_danger");
      }
      break;
    }
    case "hide": {
      o.d.stamina -= rng.int(2, 6);
      o.narrative = rng.chance(0.8)
        ? "You fold yourself into shadow and go still. Shuffling footsteps pass close, then fade."
        : "You try to hide, but there's nowhere good — your heart hammers as a silhouette lingers nearby.";
      o.forceChoices = !rng.chance(0.7);
      break;
    }
    case "eat": {
      const f = inv.find((i) => FOOD.has(i.item));
      if (f) {
        o.remove.push({ item: f.item, qty: 1 });
        o.d.hunger += rng.int(22, 34);
        o.narrative = `You force down the ${f.item}. It's not much, but the gnawing in your gut eases.`;
      } else {
        o.narrative = "You dig through your pack for food and come up empty. Your stomach growls in protest.";
      }
      break;
    }
    case "drink": {
      const dr = inv.find((i) => DRINK.has(i.item));
      if (dr) {
        o.remove.push({ item: dr.item, qty: 1 });
        o.d.thirst += rng.int(26, 38);
        o.narrative = `You drink the ${dr.item} down. Your cracked lips and dry throat thank you.`;
      } else {
        o.narrative = "You have nothing to drink. Your tongue feels like sandpaper.";
      }
      break;
    }
    case "heal": {
      const m = inv.find((i) => MEDS.has(i.item));
      if (m) {
        o.remove.push({ item: m.item, qty: 1 });
        o.d.hp += rng.int(18, 32);
        if (m.item === "Antibiotics" || m.item === "Antiseptic") o.d.infection -= rng.int(15, 30);
        o.narrative = `You use the ${m.item}, hands shaking. The worst of the pain recedes.`;
      } else {
        o.narrative = "You reach for something to patch yourself up, but your med supplies are gone.";
      }
      break;
    }
    case "talk": {
      if (rng.chance(0.55)) {
        o.flags.push("met_friendly_survivor");
        if (rng.chance(0.5)) {
          const gift = rng.pick(["Water Bottle", "Canned Food", "Bandage", "Pistol Ammo"]);
          o.add.push({ item: gift, qty: 1, note: "from a survivor" });
          o.narrative = `A wary survivor lowers their weapon. After a tense moment, they share a ${gift} and a rumor about a safer block.`;
        } else {
          o.narrative = "You call out. A frightened survivor answers from a doorway — no trade, but they point you away from a nest of the dead.";
        }
      } else {
        o.spawns.push({ type: "survivor_hostile", count: 1, reason: "hostile scavenger" });
        o.narrative = "Your call is answered with a raised pipe and cold eyes. This one isn't interested in talking.";
        o.forceChoices = true;
      }
      break;
    }
    case "barricade": {
      const tools = inv.some((i) => ["Duct Tape", "Nails", "Hammer", "Crowbar"].includes(i.item));
      o.d.stamina -= rng.int(10, 18);
      if (tools) {
        o.flags.push(`barricaded_${loc}`);
        o.narrative = `You wedge furniture against the doors and hammer it fast. The ${prettyLoc(loc)} feels defensible now.`;
      } else {
        o.narrative = "You try to barricade up, but without proper tools it's flimsy at best.";
      }
      break;
    }
    case "scout": {
      o.d.stamina -= rng.int(3, 8);
      o.narrative = rng.pick([
        "You find high ground and scan the streets. The layout sharpens in your mind — and you mark a few places worth a look.",
        "From cover, you watch the block. You count the dead, trace their drift, and spot a clearer route.",
        "You survey the area. Smoke rises a few streets over; closer by, a storefront door hangs open and quiet.",
      ]);
      break;
    }
    default: {
      // Free-form action — improvise gracefully so ANY input gets a sane reply.
      o.d.stamina -= rng.int(0, 5);
      o.narrative = rng.pick([
        "You do as you intend. The ruined street stays quiet — for now — but the air carries that sweet rot you can't unsmell.",
        "It works, more or less. Nothing lunges out of the dark this time.",
        "You manage it. Somewhere distant, glass breaks; closer, nothing stirs.",
      ]);
      break;
    }
  }

  const interaction = buildInteraction(o, loc, rng);
  return {
    narrative: o.narrative,
    state_changes: o.d,
    inventory_add: o.add,
    inventory_remove: o.remove,
    world_flags_add: o.flags,
    spawns: o.spawns,
    discovered: { name: null, type: null, x: null, y: null },
    next_interaction: interaction,
    game_over: o.gameOver,
    game_over_reason: o.gameOverReason,
  };
}

function buildInteraction(o: Outcome, loc: string, rng: Rng) {
  const danger = o.spawns.length > 0 || o.forceChoices;
  const useChoices = danger || rng.chance(0.35);
  if (!useChoices) {
    return { type: "free_text", prompt: "What do you do?", options: [] as string[] };
  }
  const options = danger
    ? rng.pick([
        ["Stand and fight", "Back away slowly", "Run for it", "Try to slip past"],
        ["Swing for the nearest one", "Throw something to distract them", "Bolt for the exit", "Barricade and wait"],
      ])
    : rng.pick([
        ["Search deeper", "Move on quietly", "Rest a moment", `Head deeper into the ${prettyLoc(loc)}`],
        ["Scout the area", "Scavenge nearby", "Find a safe spot", "Press on"],
      ]);
  return { type: "choices", prompt: danger ? "It's on you — fast." : "What's your next move?", options };
}

function prettyLoc(loc: string): string {
  return loc.replace(/_/g, " ");
}

// --- scenario generation (CLAUDE.md §8.6) ----------------------------------

function scenario(theme: string, rng: Rng) {
  const NAMES = ["Mara", "Dev", "Ruiz", "Cole", "Imani", "Yuki", "Sasha", "Bishop", "Lena", "Tariq"];
  const byTheme: Record<string, { loc: string; items: string[]; goal: string; note: string }> = {
    "winter outbreak": { loc: "a frozen transit depot", items: ["Warm Coat", "Canned Food"], goal: "Reach the heated shelter before nightfall freezes you.", note: "Snow muffles sound — and footsteps." },
    "military quarantine zone": { loc: "a collapsed checkpoint", items: ["Pistol Ammo", "Gas Mask"], goal: "Slip past the abandoned cordon and out of the kill-box.", note: "The soldiers are gone. Their guns aren't all accounted for." },
    "rural farmland collapse": { loc: "a silent farmhouse", items: ["Hatchet", "Water Bottle"], goal: "Get the truck running and reach the highway.", note: "Open fields mean nowhere to hide." },
    "downtown high-rise": { loc: "the 14th floor of a dead office tower", items: ["Crowbar", "Energy Bar"], goal: "Descend to street level without waking the stairwell.", note: "The elevators are tombs. Take the stairs." },
    "overrun hospital": { loc: "a blood-slick hospital ward", items: ["Bandage", "Antibiotics"], goal: "Find the dispensary and get out before the ward turns.", note: "Medicine is everywhere here — so are the infected." },
    "highway exodus": { loc: "a gridlocked freeway of dead cars", items: ["Road Flare", "Water Bottle"], goal: "Work your way up the off-ramp to the ridge.", note: "Thousands fled this way. Most didn't make it." },
    "flooded district": { loc: "a half-submerged row of shops", items: ["Rope", "Canned Food"], goal: "Cross the flooded blocks to dry ground.", note: "The water hides what's beneath it." },
    "prison break": { loc: "an open cell block", items: ["Shiv", "Canned Food"], goal: "Find the armory key and reach the yard gate.", note: "Locked doors everywhere — and things behind them." },
  };
  const t = byTheme[theme] ?? byTheme["downtown high-rise"];
  const name = rng.pick(NAMES);
  return {
    intro_narrative: `${name} comes to in ${t.loc}, ears ringing, the world already ended. ${t.note} ${rng.pick(["No one is coming.", "The radio died hours ago.", "The screaming stopped, which is worse."])} Whatever happens next is up to you.`,
    player_name: name,
    start_location: t.loc,
    starting_items: t.items.map((item) => ({ item, qty: 1 })),
    starting_goal: t.goal,
    difficulty_modifier: Math.round((rng.range(0.85, 1.35)) * 100) / 100,
  };
}
