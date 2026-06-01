# OUTBREAK — Development Plan

The end-to-end plan to build OUTBREAK exactly as specified in [`CLAUDE.md`](./CLAUDE.md),
**phase by phase**, with a concrete verification step for every phase so we always
know it works before moving on.

`CLAUDE.md` is the **single source of truth** for the design. This document is the
**execution plan**: what we build, in what order, and how we prove each step is correct.

---

## 0. Status at a glance

| Phase | Title | State | Verified by |
|---|---|---|---|
| 0 | Scaffold | ✅ Done | `npm run build` (type-check + bundle) + dev-server boot |
| 1 | Walkable world | ✅ Done | worldgen invariant harness + dev-server boot |
| 2 | Designed art (CC0) | ✅ Done | baked-tileset visual check + asset load/serve + build |
| 3 | State + HUD + save/load | ✅ Done | 21 game-logic unit tests + HUD smoke + dev boot |
| 4 | The Game Master (core) | ✅ Done | GM pipeline tests (offline GM + validation + e2e turn) + build |
| 5 | Encounters & reactive world | ✅ Done | build + logic tests; enemy AI / triggers (browser play) |
| 6 | Survival + death + new run | ✅ Done | decay/death/new-run tests + build; full loop (browser play) |
| 7 | Replayability & polish | ✅ Done | build + tests; menu/sound/touch/scenario + mobile (browser play) |

> **Discipline (CLAUDE.md §0, §13):** after every phase, make it run, **stop**, report
> how to test it, and wait for the go-ahead. Do not build ahead of the current phase.

---

## 1. Guiding principles (non-negotiable)

These come straight from `CLAUDE.md` §5, §14, §15 and govern every phase:

1. **Three clean layers, kept separate (§5):**
   - **Engine** (`src/engine`) — rendering, movement, camera, tilemap, physics, animation. *Knows nothing about story.*
   - **Game logic** (`src/game`) — `GameState`, survival, inventory, world flags, triggers, day/night. *Single source of truth for hard mechanics.*
   - **AI layer** (`src/ai`, optional `server/`) — builds GM requests behind a swappable `LLMProvider`, validates output, hands **validated** changes to game logic.
2. **Golden rule — the AI proposes, the engine disposes (§5, §8.1).** The GM never mutates `GameState`. All GM output flows through `outcomes.ts`: **validate → clamp → apply**.
3. **Engine is the authority** on all hard mechanics; GM output is *always* validated first (§14).
4. **Provider behind the interface (§8.1) — never hardcoded.** Local Ollama is the default and needs no key; cloud Claude is a config-flag swap. **No cloud key ever in the browser bundle (§15).**
5. **Seeded RNG everywhere procedural (§14)** so runs are reproducible for debugging.
6. **Offline-first (§16).** The full game must run on a local Ollama model with no internet and no API key.
7. **Don't over-scope the MVP (§15).** No multiplayer, no sprawling skill/crafting trees, no cloud saves until the core loop is fun.
8. **Commit at the end of each phase (§14).** Placeholders are fine, tagged `// TODO`.

### Dependency direction (enforced by code review)
```
scenes ─▶ engine ─▶ (Phaser)
   │         ▲
   ▼         │
 game ◀──────┘ (game logic is consumed by scenes; engine never imports game story state)
   ▲
   │
  ai ─▶ shared/contracts   (ai validates, then calls into game logic via outcomes.ts)
```
- `engine/*` must **not** import from `game/GameState`, `ai/*`, or story concepts.
- `ai/*` must **not** import Phaser or mutate `GameState` directly — it returns validated changes.
- `shared/contracts.ts` is the one place the GM JSON shape is defined; client and server both import it.

---

## 2. Architecture map (target end-state)

```
outbreak/
├── CLAUDE.md                 # design spec (source of truth)
├── DEVELOPMENT_PLAN.md       # this file
├── README.md                 # how to run / play
├── .env.example              # provider + model config (copy to .env)
├── index.html · vite.config.ts · tsconfig.json · package.json
├── public/assets/            # CC0 sprite/tile/audio packs (Phase 2+)
├── server/                   # OPTIONAL cloud proxy (only if Claude path enabled)
└── src/
    ├── main.ts               # Phaser bootstrap                     [P0 ✅]
    ├── vite-env.d.ts         # typed VITE_ env access               [P0 ✅]
    ├── shared/contracts.ts   # GM request/response TYPES + schemas  [P0 ✅]
    ├── engine/
    │   ├── textures.ts       # CC0 asset paths + placeholder fallback [P1/P2 ✅]
    │   ├── Player.ts         # movement, collision, rotate-to-face   [P1/P2 ✅]
    │   ├── Camera.ts         # follow + bounds                      [P1 ✅]
    │   ├── WorldRenderer.ts  # draws the tilemap                    [P1 ✅]
    │   └── Enemy.ts          # zombie state machine                 [P5]
    ├── game/
    │   ├── constants.ts      # tunables (map size, speeds)          [P0 ✅]
    │   ├── rng.ts            # seeded RNG                           [P1 ✅]
    │   ├── worldgen.ts       # seeded procedural city               [P1 ✅]
    │   ├── GameState.ts      # central authoritative store + save    [P3 ✅]
    │   ├── survival.ts       # hunger/thirst/stamina/infection decay [P3 ✅ → P6]
    │   ├── inventory.ts      # add/remove/stack/cap                  [P3 ✅]
    │   ├── encounters.ts     # what triggers a GM call & when        [P5]
    │   └── outcomes.ts       # VALIDATE + APPLY GM output            [P4]
    ├── ai/
    │   ├── provider.ts       # LLMProvider interface                 [P0 ✅]
    │   ├── ollamaProvider.ts # DEFAULT local provider                [P0 ✅ → P4 stream]
    │   ├── claudeProvider.ts # OPTIONAL cloud provider (stub)        [P0 ✅]
    │   └── gameMaster.ts     # assemble → call provider → parse      [P4]
    ├── ui/
    │   ├── HUD.ts            # stat bars + inventory                 [P3 ✅]
    │   ├── EncounterModal.ts # free-text box + 4 choices + narrative [P4]
    │   └── MainMenu.ts       # title / new run                       [P7]
    └── scenes/
        ├── BootScene.ts      # gen textures, seed, → WorldScene      [P0/P1 ✅]
        ├── WorldScene.ts     # the open world                        [P1 ✅]
        └── GameOverScene.ts  # death summary → new run               [P6]
```

`[P0 ✅]`/`[P1 ✅]` = already built and verified. Bracketed numbers = phase that delivers it.

---

## 3. The AI Game Master data flow (target)

```
player action (free text OR 1-of-4 choice)
        │
        ▼
encounters.ts  ── trims GameState (player, inventory, worldFlags, recentEvents,
        │           day, timeOfDay, location_type) + caps recentEvents to ~6   (§8.3, §15)
        ▼
gameMaster.ts ── picks active LLMProvider (env flag), sends GM system prompt (§8.2)
        │           + payload + GM_OUTPUT_SCHEMA as `format`                   (§8.1, §8.4)
        ▼
provider      ── Ollama /api/chat (streamed, keep_alive) → raw JSON string
        │           [retry once on parse failure → safe fallback outcome]      (§8.4)
        ▼
outcomes.ts   ── VALIDATE → CLAMP → APPLY:                                      (§8.5)
        │           • state deltas, clamp 0–100
        │           • inventory_remove (only held), inventory_add (stack + cap)
        │           • world_flags_add (dedupe), discovered → knownLocations
        │           • spawns → enemies at walkable tiles near player
        │           • re-check death (hp<=0 || infection>=100) → GameOver
        │           • push 1-line summary to recentEvents (trim ~6)
        ▼
GameState (authoritative)  ──▶  engine renders result, HUD updates, world reacts
```

---

## 4. Phase-by-phase plan

Each phase lists: **Goal**, **Build**, **Deliverables**, **Verify (how we know it works)**, and **Exit gate**.

### ✅ Phase 0 — Scaffold (DONE)
- **Goal:** Vite + Phaser + TS project boots and shows a Phaser canvas.
- **Build:** `package.json`, `vite.config.ts`, `tsconfig.json` (strict), `index.html`, `.env.example`, `src/main.ts`, `shared/contracts.ts` (GM types **and** JSON schemas), `ai/provider.ts` (`LLMProvider`), `ai/ollamaProvider.ts` (functional default), `ai/claudeProvider.ts` (optional stub), `BootScene`.
- **Deliverables:** dev server runs; provider interface in place; GM contract types compile.
- **Verify:**
  - `npm run build` → type-check passes, Vite bundles 0 errors. ✔
  - `npm run dev` → `GET /` = 200, `GET /src/main.ts` = 200 (Phaser resolves). ✔
- **Exit gate:** project compiles and serves. ✔ **Met.**

### ✅ Phase 1 — Walkable world (DONE)
- **Goal:** *"I can walk around a procedurally generated city."*
- **Build:** `game/constants.ts`, `game/rng.ts` (seeded), `game/worldgen.ts` (roads → sidewalks → buildings w/ doors → spawn), `engine/textures.ts` (placeholder tiles + player), `engine/WorldRenderer.ts` (tilemap + wall collision + building labels), `engine/Player.ts` (WASD/arrows, 8-dir, normalized, body collision), `engine/Camera.ts` (follow + bounds), `WorldScene` (orchestration + debug HUD + `R` to regenerate).
- **Deliverables:** seeded city; placeholder player; movement; camera-follow; wall collisions; `?seed=` for reproducible maps; `R` for a new city.
- **Verify:**
  - **Automated invariant harness** (Phaser-free worldgen bundled with esbuild, run under Node) checks: grid dimensions, all tiles in range `0–5`, **spawn is walkable & in-bounds**, ≥5 buildings, **every door is a `Door` tile on the perimeter with a walkable tile just outside (reachable)**, buildings in-bounds, **same seed → identical map**, **different seeds → different maps**. → *ALL CHECKS PASSED* (30–44 buildings/seed).
  - `npm run build` clean; dev server boots.
  - **Manual smoke (browser):** WASD/arrows move the player; camera follows; player cannot pass through building walls; `R` yields a visibly different city; `?seed=foo` reproduces the same city.
- **Exit gate:** walk the city, collide with walls, regenerate. ✔ **Met.**

### ✅ Phase 2 — Designed art (CC0) (DONE)
- **Goal:** *"It looks like a real game."*
- **Built:**
  - Downloaded two **CC0 Kenney** packs — **Roguelike Modern City** (top-down city tiles) and **Top-down Shooter** (characters). License CC0, recorded in `public/assets/CREDITS.md`. No copyrighted game art (§9, §15).
  - **City tileset** (`public/assets/tiles/city_tileset.png`): a 32px, 6-frame strip baked from chosen 16×16 city tiles (upscaled 2×, nearest-neighbor), in `Tile` enum order — Road (asphalt), Sidewalk (pavement), Floor (warm interior), Wall (brick), Door (brick + an original open-doorway overlay), Grass. `WorldRenderer` is unchanged; it just loads this instead of flat colours.
  - **Characters** (`public/assets/characters/*.png`): survivor (player), zombie (walker/runner), survivor-NPC — top-down sprites that default-face **east** and are **rotated toward movement**, with a subtle walk bob. Zombie/NPC textures are preloaded for Phase 5.
  - `textures.ts` placeholder generators kept as a **fallback** (used only if a CC0 asset fails to load), tagged accordingly.
- **Verify:**
  - Baked tileset visually inspected — 6 frames correct, including the doorway. ✔
  - `npm run build` clean; production build copies `public/assets` → `dist/assets`. ✔
  - Dev server serves every asset (`image/png`, HTTP 200). ✔
  - *(Cannot screenshot the live canvas in this headless sandbox — a 30-second browser glance is the final visual check.)*
- **Honest scope note:** Kenney's CC0 top-down characters are single-pose sprites designed to **rotate to face** (Project Zomboid–style), not RPG-style 4-direction *frame* sheets — those aren't available CC0 in this top-down style. Rotation-to-face + walk bob is the faithful, intended use of the pack. Road **lane-marking autotiling** (straight vs. intersection vs. crosswalk) is deferred to polish; clean asphalt is used for now.
- **Exit gate:** the same walkable world now renders with designed CC0 sprites/tiles. ✔ **Met.**

### ✅ Phase 3 — State + HUD + save/load (DONE)
- **Goal:** *"Stats live and persist."*
- **Built:**
  - `game/GameState.ts` — authoritative state (CLAUDE.md §7) with `clampStat`, `isDead` (`hp<=0 || infection>=100`), `newGame`, `pushRecentEvent` (trims to last 6), and versioned localStorage `saveGame`/`loadGame`/`clearSave` with a **shape-validating loader** (corrupt/old saves are ignored).
  - `game/survival.ts` — `applyDecay`: hunger/thirst fall (thirst faster), stamina regens, starvation/dehydration damages HP, infection climbs once set. Day/night modulation + bite-infection come in Phase 6.
  - `game/inventory.ts` — `addItem` (stack-merge + `MAX_STACK` cap), `removeItem` (clamped, drops empty stacks, ignores unheld), `hasItem`/`itemCount`. Reused by `outcomes.ts` in Phase 4.
  - `ui/HUD.ts` — camera-fixed panel: 5 stat bars + values, day/time, inventory list, controls hint, debug line, and a minimal death banner.
  - `WorldScene` — owns the GameState, runs a survival tick (every 2 s), autosaves (every 4 s + on tab close/shutdown), resumes a save on reload, starts a fresh run on **R**. Debug keys **1/2/3/4** (eat/drink/hurt/bandage) make stats + inventory visibly change and persist — Phase-3 stand-ins for Phase-4 GM outcomes.
- **Verify:**
  - **21 headless unit tests** (clamp bounds + NaN; inventory stack/cap/clamp/unheld; decay + starvation + infection climb; death predicates; recentEvents trim; save/load round-trip + corrupt/invalid-shape rejection) → **ALL PASSED**.
  - `npm run build` clean; dev server serves the new modules (GameState, survival, inventory, HUD).
- **Note:** death currently shows a minimal banner + freeze; the full GameOver summary and new-run handoff are Phase 6. Infection only rises here (no zombies to inflict it until Phase 5).
- **Exit gate:** stats decay live, the HUD shows them, items consume, and a run reloads intact. ✔ **Met.**

### Phase 4 — The Game Master (core feature)
- **Goal:** *"I can act and the local AI decides what happens."*
- **Build:**
  - `ai/gameMaster.ts` — assemble trimmed payload (§8.3), select provider via env, send GM system prompt (§8.2) + `GM_OUTPUT_SCHEMA` as `format` (§8.4); **stream** the response; **retry once on parse failure, then safe fallback** ("Nothing of note happens.").
  - `ollamaProvider.ts` — switch to streaming `/api/chat`, `keep_alive`.
  - `game/outcomes.ts` — full **validate → clamp → apply** pipeline (§8.5).
  - `ui/EncounterModal.ts` — pauses the world; shows narrative (typed-out stream); offers **both** a free-text box **and** 4-choice buttons depending on `next_interaction.type`.
- **Deliverables:** a working turn — type or pick an action, local model responds, engine validates and applies it.
- **Verify:**
  - **Unit tests (no network):** feed canned/adversarial GM JSON into `outcomes.ts` and assert: deltas clamped; bogus item removals ignored; flags deduped; `discovered` added to `knownLocations`; spawns only at walkable tiles near the player; malformed JSON → fallback (no crash); `choices` mode yields exactly 4 options or is repaired.
  - **Schema test:** `GM_OUTPUT_SCHEMA` accepts the §8.2 example and rejects a missing `narrative`.
  - **Live integration (local Ollama):** with `ollama run <model>` up (and CORS `OLLAMA_ORIGINS` set or proxy), a real turn returns schema-valid JSON, applied within a few seconds; narrative is 2–4 sentences.
- **Exit gate:** a full turn round-trips through a local model and is safely applied.

### Phase 5 — Encounters & reactive world
- **Goal:** *"The world reacts and remembers."*
- **Build:**
  - `game/encounters.ts` — triggers: **enter a building** (door/trigger zone), **zombie proximity**, and **random events**; throttle so the GM isn't spammed.
  - `engine/Enemy.ts` — zombie state machine `wander → alerted → chase → attack`; **walkers** (slow/common) and **runners** (fast/rare); noise widens aggro.
  - Wire `spawns` from GM output → instantiate enemies/survivors at walkable tiles near the player.
  - World flags persist within a run (cleared zones stay cleared; allies/hostiles tracked).
- **Deliverables:** entering buildings/being near zombies fires GM calls; outcomes spawn real entities; flags stick.
- **Verify:**
  - **Unit tests:** trigger fires once per entry (debounced); spawns land only on walkable tiles (never inside walls); `world_flags_add` persists and is respected on re-entry (a cleared building doesn't re-trigger the same encounter).
  - **AI behavior test:** enemy transitions through states; runner faster than walker; aggro expands with noise.
  - **Manual play:** walk into a pharmacy → encounter; flee a chasing walker; revisit a cleared zone → it remembers.
- **Exit gate:** encounters trigger, spawns appear, flags persist, zombies chase.

### Phase 6 — Survival + death + new run
- **Goal:** *"The full survival loop closes."*
- **Build:**
  - Fully wire decay (hunger/thirst/stamina/infection) into the tick; eating/drinking/healing restore matching stats; infection rises from bites and ticks up once infected.
  - **Day/night cycle** affecting visibility/danger (nights deadlier).
  - Death (`hp<=0 || infection>=100`) → `GameOverScene` summary (days survived, zombies killed, key story beats) → **new seed + new world**.
- **Deliverables:** a run can be lost; death produces a summary and starts a fresh, different run.
- **Verify:**
  - **Unit tests:** decay reaches starvation/dehydration over expected time; healing/eating clamp correctly; infection monotonically rises once set and hits death at 100.
  - **Manual play:** survive several in-game days; die by infection and by HP; confirm the summary screen and that the next run has a **new map**.
- **Exit gate:** you can die, see a summary, and start a noticeably different run.

### Phase 7 — Replayability & polish (Shippable MVP)
- **Goal:** *"Shippable MVP."*
- **Build:**
  - **Per-run scenario generation (§8.6):** one-shot provider call with a random theme → `intro_narrative`, player name, start location, ONE starting advantage, short-term goal, difficulty modifier; feed into the new run.
  - Difficulty scaling from `difficultyModifier`.
  - `ui/MainMenu.ts` (title / new run / continue), sound, UI polish.
- **Deliverables:** every run opens with a distinct AI-authored premise; menu + audio + polish.
- **Verify:**
  - **Scenario-variety test:** N generated scenarios across themes are schema-valid and meaningfully distinct (different names/locations/goals); on parse failure, a safe default scenario is used.
  - **Full Definition-of-Done pass (§16)** — see the traceability matrix in §7 below.
- **Exit gate:** all §16 checkboxes pass; runs differ run-to-run; fully offline on local Ollama.

---

## 5. Cross-cutting concerns (apply across phases)

- **Validation layer is the safety net (§5, §8.5).** Because local models follow rules less reliably than cloud, lean hard on `outcomes.ts`. Schema (`format`) guarantees *syntax*; `outcomes.ts` guarantees *legal game states*.
- **Context budget (§8.7, §15).** Trim `GameState` for the GM and cap `recentEvents` to ~6. Never send full history.
- **Latency UX (§8.7).** Stream narrative; show a brief "the world reacts…" spinner; `keep_alive` keeps the model warm.
- **Persistence (§7).** Save the whole `GameState` to localStorage every few turns + on quit.
- **Security (§14, §15).** Local Ollama needs no key. If the Claude path is ever enabled, the key lives only in `server/.env` (gitignored) and the browser talks to the proxy — never directly to Anthropic.
- **Art licensing (§9, §15).** CC0/original only; credit sources; placeholders tagged `// TODO`.
- **Reproducibility (§14).** All procedural systems use the seeded RNG; `?seed=` pins a run for debugging.

---

## 6. Testing & QA strategy

We verify at three levels, matched to the three layers:

1. **Pure-logic unit tests (headless, fast).** worldgen, rng, inventory, survival, clamping, and `outcomes.ts` are Phaser-free (or can be exercised without a canvas), so they're bundled with esbuild and run under Node. These live in `tests/*.test.ts` and run via **`npm test`** (currently: `worldgen.test.ts` + `state.test.ts`, 21 state checks). They are the bulk of correctness coverage.
2. **Type-check + build gate.** `npm run build` runs `tsc --noEmit` (strict) then a production Vite bundle. CI-friendly; catches contract drift between `shared/contracts.ts` and consumers.
3. **Runtime smoke + manual play.** Dev-server boot check (HTTP 200 for `/` and module transforms) plus a short scripted manual checklist per phase (move, collide, trigger, act, die, restart). The live-Ollama turn test (Phase 4+) confirms the offline AI path end-to-end.

**Per-phase exit gate = (all automated checks green) AND (manual smoke checklist passes).** Only then do we unlock the next phase.

---

## 7. Traceability — Definition of Done (§16) → phase

| Definition-of-Done item (§16) | Delivered in | Verified by |
|---|---|---|
| Walkable procedurally generated city | P1 (geometry) + P2 (art) | worldgen harness + visual smoke |
| Designed (CC0) sprites & tiles | P2 | license + animation smoke |
| Player movement, camera-follow, collisions | P1 | manual smoke (move/collide/follow) |
| HUD: HP/stamina/hunger/thirst/infection + inventory | P3 | HUD smoke + clamp/inventory tests |
| Encounters trigger on entering buildings / threats | P5 | trigger unit tests + play |
| Encounter UI: free-text **and** 4-choice | P4 | EncounterModal smoke |
| GM returns structured JSON; engine validates & applies | P4 | `outcomes.ts` unit tests + schema test |
| Enemies spawn from outcomes; flags persist | P5 | spawn/flag tests + play |
| Survival stats decay; infection & death work | P3/P6 | decay/death unit tests + play |
| Death → summary → new, different run | P6 | full-loop play + new-map check |
| Fully offline on local Ollama (cloud = config swap) | P0 design + P4 wiring | live local-Ollama turn; provider flag test |

Every §16 item maps to a phase and a concrete verification — that's how this plan "covers everything mentioned."

---

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Local model emits illegal-but-valid-JSON outcomes (infinite loot, ignoring death) | High | `outcomes.ts` validate/clamp/cap is mandatory; schema only fixes syntax (§5, §8.5). |
| Local turn latency feels slow | Med | Trim payload, short narrative, stream, `keep_alive`; spinner UX (§8.7). |
| CORS blocks browser → Ollama | Med | Document `OLLAMA_ORIGINS`; offer the optional `/server` proxy (§8.8). |
| Procedural map leaves unreachable areas | Low | Walkability invariant in the worldgen harness (doors reachable; all non-wall tiles connected via roads/sidewalks/alleys). |
| Scope creep beyond MVP | Med | Phase gates + §15 guardrails; post-MVP items (crafting, skills, cloud saves) explicitly deferred. |
| Art licensing slip | Low | CC0/original only; `CREDITS.md`; placeholder fallback. |
| Phaser bundle size warning | Low | Expected (engine is ~1.4 MB); optional manual chunking later, not blocking. |

---

## 9. Tunable constants (current)

Defined in `src/game/constants.ts` (CLAUDE.md §10 "start modest, scale up"):

| Constant | Value | Meaning |
|---|---|---|
| `TILE_SIZE` | 32 | px per tile |
| `MAP_WIDTH` / `MAP_HEIGHT` | 80 × 80 | city size in tiles (≈2560×2560 px) |
| `PLAYER_SPEED` | 190 | walking px/sec |

Worldgen knobs (in `worldgen.ts`): road gap `11–16`, building segment `4–8` tiles, empty-lot chance `0.14`.

---

## 10. How to run

See [`README.md`](./README.md). Short version:

```bash
npm install
npm run dev      # open the printed http://localhost:5173/ URL
```

Move with **WASD/arrows**, press **R** for a new city, pin a map with `?seed=<value>`.
The local AI Game Master (Ollama) is wired in **Phase 4** — until then the world is
fully walkable and self-contained (no model required).
