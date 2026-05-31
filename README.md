# OUTBREAK

A 2D, top-down, **open-world zombie-survival game** where an **AI Game Master**
decides the outcome of everything you do — so every playthrough is different.
Runs on a **local LLM via Ollama** by default (free, offline), with optional
cloud Claude behind the same interface.

- **Full design spec:** [`CLAUDE.md`](./CLAUDE.md)
- **Build roadmap & verification plan:** [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)

> **Current status: MVP complete (Phases 0–7).**
> A seeded procedural city in **CC0 Kenney art**; an animated survivor with movement,
> sprint, and **melee**; **zombies** (walkers + runners) that wander and chase; an **AI
> Game Master** that resolves free-text or 4-choice actions into validated outcomes
> (the engine clamps/validates everything); a live **HUD**; **survival** (hunger /
> thirst / stamina / infection) with a **day/night** cycle; **death → summary → a new,
> AI-authored run**; a **main menu**; sound; and **touch controls** for phones.
>
> **Runs on any device with no setup** — an offline procedural GM is the default, so
> the full loop works in any browser with no model and no API key. A local **Ollama**
> model or cloud **Claude** is a one-env-var swap (`VITE_AI_PROVIDER`).

---

## Prerequisites

- **Node.js ≥ 18** (developed on Node 22) and npm.
- A modern browser.
- *(Optional, for the real AI)* **Ollama** — the game runs fine without it on the
  built-in offline GM; install it to have a real local LLM run the Game Master.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173/**).

### Controls
| Action | Keys / Touch |
|---|---|
| Move | **WASD** / **arrows** · on-screen **joystick** (mobile) |
| Sprint | hold **Shift** · push the joystick to its edge |
| Aim + fire gun | **mouse** aim + hold **left-click** · the **FIRE** button (auto-aims) |
| Reload | **R** · the **RELOAD** button |
| Melee attack | **SPACE** / **F** · the **HIT** button |
| Act / open chest / search | **E** · the **ACT** button |
| Inventory / equip / loot screen | **I** · the **BAG** button |
| Menu / new run | **ESC** |
| Quick item use | **1** eat · **2** drink · **3** hurt · **4** bandage |
| Reproduce a specific city | add `?seed=<value>` to the URL, e.g. `…/?seed=alpha` |

### Loot, weapons & rarity
Scavenge **200+ hand-authored weapons** across 6 rarities (common → mythic) — blades, axes,
blunts, spears, bows, and real guns (pistols/SMGs/shotguns/rifles/snipers/LMGs/launchers/
flamethrower…). Each has its own damage, range, fire rate and **abilities** (bleed, cleave,
knockback, stun, crit, lifesteal, execute, pierce, explosive, burn…). **Guns are real ranged
combat** — aim, fire projectiles, manage ammo + reloads. Find loot by **searching buildings**
(location-appropriate tables — police → guns/ammo, pharmacy → meds, hardware → melee), **opening
chests** inside buildings, or as **drops from kills**. Walk over a drop to grab it; open the
**loot screen** (`I` / BAG) to compare, **equip** a melee + a gun, read tooltips, use consumables,
or drop items. Rarity is colour-coded everywhere (icons, drops, the HUD, tooltips). Equipped
**armor** reduces the damage you take.

### The bestiary — 100+ enemy types
Over **100 hand-authored zombie/enemy types**, each with a **procedurally distinct look** (14
body archetypes × rot palettes × features: bone, blood, spikes, glowing eyes, bloat sacs, armor
plates, tatters, horns…), its own **movement/animation** (shamblers, runners, crawlers, leapers
that dash, erratic skitterers) and **unique behaviour**: spitters fling acid, screamers summon a
horde, exploders burst for area damage, splitters spawn crawlers when killed, bloated/toxic types
leave damaging clouds, grabbers pin you in place, brutes knock you back, armored/regenerating/
undying types are hard to put down — up to **elites and bosses** (Tank, Behemoth, Brood Mother,
Abomination, Patient Zero, The Colossus…). Types are **rarity-graded** and **day-gated**: common
walkers early, rarer and nastier horrors as the outbreak deepens. **Health bars** show on hurt
enemies and **name labels** mark rare/elite/boss types. Damage varies widely by type.

### Character creation
"New run" opens a **creation screen**: enter a **name**, pick a **background/class** (12 — Soldier,
Police Officer, Firefighter, Paramedic, Scavenger, Survivalist, Athlete, Mechanic, Chef, Biker,
Doomsday Prepper, or the balanced Survivor), choose a survivor **colour**, and a **difficulty**
(Easy → Nightmare). Each background gives a **starting loadout** (weapon + gear, auto-equipped) and
a **signature perk that actually changes play** — e.g. Marksman (+ranged), Brawler (+melee), Tough
(less damage), Fireproof (shrug off burn/toxic), Field Medic (meds heal more), Iron Gut (slower
hunger/thirst), Lucky (rarer loot), Marathoner (stamina), Scrapper (more ammo/materials), Hardy
(slower infection), Quick (faster attacks). A **Random** button rolls everything; the AI opening
scenario reflects your chosen background.

Every run starts at **hour zero** of the outbreak (Day 0) with the survivor you created;
the streets are nearly empty at first and danger ramps as the days pass. In an
**encounter** the world pauses and you either **type** what you do or tap one of 4
options — while you're typing, game keys are paused so a stray key can't interrupt or
cancel your input. The GM narrates, the engine applies a validated outcome, and a line
shows exactly **what changed** (items/stats/threats). The HUD shows your name, day/time,
five survival stats, inventory, and the latest event. Your run **autosaves**; death → a
summary → a brand-new, AI-authored run.

## Other scripts

```bash
npm test           # headless game-logic tests (worldgen invariants + state/inventory/survival)
npm run build      # type-check (tsc --noEmit, strict) + production bundle
npm run typecheck  # type-check only
npm run preview    # serve the production build
```

---

## Project layout (Phase 0/1)

```
src/
├── main.ts                # Phaser bootstrap
├── shared/contracts.ts    # GM request/response types + JSON schemas (one source of truth)
├── engine/                # rendering / movement / camera / textures (no story logic)
│   ├── textures.ts        # CC0 asset paths + placeholder fallback
│   ├── Player.ts · Camera.ts · WorldRenderer.ts
├── game/                  # hard mechanics (authoritative)
│   ├── constants.ts · rng.ts (seeded) · worldgen.ts (seeded city)
│   ├── GameState.ts (state + clamp + save/load) · survival.ts · inventory.ts
├── ai/                    # swappable GM brain (LLMProvider)
│   ├── provider.ts · ollamaProvider.ts (default) · claudeProvider.ts (optional stub)
├── ui/                    # HUD overlay (reads state, never mutates mechanics)
│   └── HUD.ts
└── scenes/
    ├── BootScene.ts · WorldScene.ts
```

Architecture follows the three-layer separation in `CLAUDE.md` §5: **engine** (no
story) · **game logic** (single source of truth) · **AI** (proposes; the engine
validates and disposes).

---

## Configuration

Copy `.env.example` → `.env` to override defaults. All browser-visible vars are
`VITE_`-prefixed.

| Var | Default | Purpose |
|---|---|---|
| `VITE_AI_PROVIDER` | `auto` | `auto` (use Ollama if running, else offline GM), `ollama`, `mock`, or `claude` |
| `VITE_OLLAMA_HOST` | `/ollama` (proxied) | local Ollama; set an absolute URL to bypass the dev proxy |
| `VITE_OLLAMA_MODEL` | _auto_ | pin a model name; unset auto-picks the first installed model |
| `VITE_WEBLLM_MODEL` | `Llama-3.2-3B-Instruct-q4f16_1-MLC` | in-browser model to download (use a 1B id for weak GPUs) |

### Real AI in the browser — no install, no key (WebLLM)

There's a second real-AI path that needs **nothing on a server and no API key**, and it
works on the **deployed site**: a model that runs entirely on your GPU via **WebGPU**.

- In the **main menu**, click **"Enable in-browser AI"**. The model (~2 GB) downloads
  once and is cached by the browser; a progress % shows while it loads.
- When it's ready the Game Master runs on that in-browser model — the HUD shows
  **`GM:webllm`**. Your choice is remembered (it auto-loads from cache next visit).
- Requires **WebGPU** (desktop **Chrome/Edge**; not most phones or Safari yet). On
  unsupported browsers the button says so and the game uses the offline GM.

This is the only real-LLM option that runs on the **public Vercel link** with zero
backend — at the cost of a one-time multi-GB download per device.

### Play with the real AI (local Ollama)

OUTBREAK ships with an **offline procedural Game Master** so it runs anywhere with
zero setup. For a genuinely AI-driven game where a real LLM decides every outcome:

1. Install **Ollama** (<https://ollama.com>) and pull a model — e.g. `ollama pull llama3.1`.
   (An *abliterated/uncensored* build narrates the horror without refusing — CLAUDE.md §8.8.)
2. Make sure Ollama is running, then `npm run dev` and start a run.

That's it — **no env edits, no CORS setup.** The game **auto-detects** Ollama and
routes the Game Master (and the opening scenario) through it; the dev/preview server
proxies `/ollama` → `127.0.0.1:11434` so the browser never hits a CORS wall. The
HUD's bottom line shows the active brain — **`GM:ollama`** (real model) or
**`GM:offline`** (procedural). If the model becomes unreachable mid-run, the game
falls back to the offline GM and says so once.

> The hosted Vercel build is static (no proxy), so the **public site uses the
> offline GM by design** — the real LLM path is for local play. A cloud key, if ever
> used, stays server-side, never in the browser bundle.

## License / assets

Original or **CC0** assets only. Phase 2 uses CC0 Kenney.nl packs (Roguelike
Modern City + Top-down Shooter); sources are listed in
[`public/assets/CREDITS.md`](./public/assets/CREDITS.md). No copyrighted game
art, characters, or named content.
