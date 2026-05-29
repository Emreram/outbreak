# OUTBREAK — Claude Code Master Prompt
> **Working title:** OUTBREAK *(rename freely).*
> A 2D, top-down, **open-world zombie-survival game** where an AI Game Master decides the outcome of everything you do, so **every playthrough is different**.
> **Runs on a local LLM via Ollama by default** — free, offline, and uncensored (cloud Claude is an optional swap-in).
---
## 0. How to use this document
1. Save this file as **`CLAUDE.md`** in the root of a new, empty git repo.
2. Kick Claude Code off with exactly this:
   > *"Read `CLAUDE.md`. This is the full spec. Build **Phase 0 and Phase 1 only** — a procedurally generated city I can walk around in with a placeholder player sprite. Then stop, tell me exactly how to run it, and wait. Do not move to later phases until I say so."*
3. Work **phase by phase**. Test each phase before unlocking the next. Do **not** let Claude Code try to build the whole game in one shot — it will produce something half-broken. The phases in §13 exist precisely to prevent that.
4. Keep this file updated as the single source of truth as the design evolves.
---
## 1. Vision
A grounded, tense, top-down survival-horror game set in a city overrun by the infected. The player explores freely, scavenges, fights or flees, meets survivors, and tries to stay alive.
The hook: **there is no fixed story.** At every meaningful moment the player either **types what they want to do** ("I climb onto the pharmacy roof to scout") or **picks one of 4 contextual options**. That input is sent to an **AI Game Master (GM)** which decides what actually happens — narrative, loot, injuries, who lives, who dies, what shows up. Combined with a freshly generated map and starting scenario each run, no two playthroughs feel the same.
Reference tone: *Project Zomboid* (systems, top-down survival) × *The Last of Us* (grounded horror) × a text-adventure / AI-dungeon-master brain.
**Be realistic about scope:** this is an MVP-first build. No multiplayer, no sprawling skill trees, no cloud accounts until the core loop is fun.
---
## 2. Core gameplay loop
```
EXPLORE (walk the open world, free movement)
   ↓ approach a building / threat / point of interest
TRIGGER an encounter
   ↓ game pauses, shows a prompt
PLAYER ACTS  →  free-text input  OR  pick 1 of 4 choices
   ↓ send {game state + action} to the AI Game Master
GM RETURNS a structured JSON outcome
   ↓ engine VALIDATES it, then applies it
APPLY  →  narrative shown, stats change, items gained/lost,
          zombies/survivors spawned, world flags updated
   ↓
back to EXPLORE  (until death → new, different run)
```
Two interaction modes, chosen by the GM per situation:
- **Free text** — open, exploratory moments. ("What do you do?")
- **4 choices** — tense, branching moments: combat, dilemmas, high-stakes calls.
---
## 3. The replayability engine (why every run differs)
Variety comes from **four** independent sources stacked together:
1. **Procedural map** — a new seeded city layout each run (streets, buildings, loot, spawns).
2. **AI scenario seed** — at new-game, the GM invents a unique opening premise: who you are, where you start, the immediate threat, one starting advantage, a short-term goal (see §8.6).
3. **AI-decided outcomes** — the GM resolves every action with natural variation, surprises, and emergent consequences.
4. **Emergent state** — your choices change the world (cleared zones stay cleared, NPCs you save become allies, an NPC you betray hunts you), so the run snowballs differently each time.
---
## 4. Tech stack
| Layer | Choice | Why |
|---|---|---|
| Game client | **Phaser 3** (TypeScript) | Best-in-class 2D engine: tilemaps, sprite atlases, animations, arcade physics, camera-follow for open world. |
| Bundler / dev server | **Vite** | Fast, zero-config, great DX. |
| AI / Game Master brain | **Local LLM via Ollama** (default) | Runs entirely on your machine — free, offline, private. For a violent zombie game an **uncensored / abliterated** local model is ideal: it won't refuse to narrate gore. Cloud Claude is an optional swap-in (see provider adapter). |
| AI access layer | **Ollama HTTP API** at `http://localhost:11434` | Native `/api/chat` with the **`format` parameter** (JSON schema) to force schema-valid output. No API key. A thin Node/Express proxy is **optional** — only needed if you ever switch to a cloud provider with a secret key. |
| Save data | **localStorage** (MVP) → Supabase later | Persist a run; optional cloud saves are post-MVP. |
| Language | **TypeScript everywhere** | Shared types between client, server, and the GM JSON contract. |
**Models (local, via Ollama):** pick by what your laptop can run (see §8.8). One model can serve both turn outcomes and scenario generation. Instruction-following and rule-adherence scale with model size — the bigger the model, the better the GM "judges" your actions. **Ollama's `format` (JSON-schema) parameter guarantees the *syntax* is valid; model size determines the *quality* of the decisions.**
- **Turns + scenario gen:** any solid instruction-following model — Qwen 2.5/3, Llama 3.x, Gemma 2/3, Mistral-Nemo, gpt-oss. Use an **abliterated/uncensored** build so the GM narrates the horror without refusing.
- Keep narrative **short** (the prompt already enforces 2–4 sentences) to keep local turns snappy.
- **Stream** the response so text types out and feels alive.
- Use `keep_alive` so the model stays warm in VRAM between turns (no reload lag).
**Optional cloud swap:** behind the provider adapter (§8.1) you can drop in the Anthropic Claude API (`claude-haiku-4-5` for turns, `claude-sonnet-4-6` for scenario gen, with prompt caching) if you ever want higher-quality decisions or to ship without requiring players to run a model. Same GM prompt, same schema — only the adapter changes.
**Alternative client framework:** Next.js 14 (you know it from TryOnAI) works too, but Vite is lighter and more game-appropriate for the MVP.
---
## 5. High-level architecture
Three clean layers. **Keep them separate.**
1. **Engine** (`/src/engine`) — rendering, movement, camera, tilemap, physics, animations. Knows nothing about story.
2. **Game logic** (`/src/game`) — central game state, survival systems, inventory, world flags, encounter triggers, the day/night clock. The **single source of truth for all hard mechanics.**
3. **AI layer** (`/src/ai`, optionally `/server`) — sits behind a **provider interface** (§8.1) so the GM brain is swappable (local Ollama by default, cloud Claude optional). It builds the GM request, calls the chosen provider, receives schema-valid JSON, **validates it**, and hands validated changes to the game-logic layer.
**Golden rule: the AI proposes, the engine disposes.** The GM never mutates state directly. It returns *proposed* changes; the engine validates, clamps, and enforces them. This is what stops the AI from breaking the game (infinite ammo, ignoring death, conjuring items, etc.). **This matters even more with a local model:** smaller models follow the rules less reliably than Claude, so the validation layer is your safety net — lean on it hard.
---
## 6. Project structure
```
outbreak/
├── CLAUDE.md                  # this file
├── .env                       # OLLAMA_HOST/model config (+ ANTHROPIC_API_KEY only if using cloud)
├── package.json
├── vite.config.ts
├── server/                    # OPTIONAL — only needed for a cloud provider with a secret key
│   └── index.ts               # thin proxy (skip entirely for local-only Ollama)
├── public/
│   └── assets/                # sprite sheets, tilesets, audio (CC0 packs)
└── src/
    ├── main.ts                # Phaser bootstrap
    ├── shared/
    │   └── contracts.ts       # GM request/response TYPES — shared client+server
    ├── engine/
    │   ├── Player.ts          # movement, animation, collision
    │   ├── Camera.ts
    │   ├── WorldRenderer.ts    # draws the tilemap
    │   └── Enemy.ts           # zombie state machine
    ├── game/
    │   ├── GameState.ts       # central store (stats, inventory, flags, time)
    │   ├── survival.ts        # hunger/thirst/stamina/infection decay
    │   ├── inventory.ts
    │   ├── worldgen.ts        # seeded procedural city generator
    │   ├── encounters.ts      # what triggers a GM call & when
    │   └── outcomes.ts        # VALIDATE + APPLY GM output
    ├── ai/
    │   ├── provider.ts        # LLMProvider interface (swappable brain)
    │   ├── ollamaProvider.ts  # DEFAULT: calls localhost:11434 /api/chat w/ format=schema
    │   ├── claudeProvider.ts  # OPTIONAL: cloud fallback (via /server proxy)
    │   └── gameMaster.ts      # assemble state, call the active provider, parse + return
    ├── ui/
    │   ├── HUD.ts             # stats bars + inventory
    │   ├── EncounterModal.ts  # free-text box + 4-choice buttons + narrative
    │   └── MainMenu.ts
    └── scenes/
        ├── BootScene.ts
        ├── WorldScene.ts      # the open world
        └── GameOverScene.ts
```
---
## 7. Game state model
A single authoritative object. Everything the GM needs to make fair decisions lives here.
```ts
interface GameState {
  seed: string;                       // run seed (map + RNG reproducibility)
  day: number;
  timeOfDay: "dawn" | "day" | "dusk" | "night";
  player: {
    name: string;
    hp: number;        // 0–100
    stamina: number;   // 0–100
    hunger: number;    // 0–100 (0 = starving)
    thirst: number;    // 0–100
    infection: number; // 0–100 (100 = turned/dead)
    x: number; y: number;
  };
  inventory: { item: string; qty: number; note?: string }[];
  worldFlags: string[];               // e.g. "cleared_pharmacy_3", "ally_marcus_alive"
  recentEvents: string[];             // rolling last ~6 events for GM context
  knownLocations: { name: string; type: string; x: number; y: number }[];
  difficultyModifier: number;         // set by the run's scenario
}
```
Rules for the engine:
- **Clamp** every stat to its range after applying changes.
- `hp <= 0` **or** `infection >= 100` → death.
- `recentEvents` is a rolling buffer (keep the last ~6) so GM context stays small and cheap.
- Persist the whole object to localStorage every few turns + on quit.
---
## 8. The AI Game Master (the core feature)
### 8.1 Design principle + provider adapter
The GM **narrates and proposes**; the engine **validates and enforces**. Always run GM output through `outcomes.ts` before touching `GameState`.
Put the GM brain behind a tiny interface so it's swappable:
```ts
// src/ai/provider.ts
export interface LLMProvider {
  // returns RAW JSON text matching the GM output schema
  generate(systemPrompt: string, payload: object, schema: object): Promise<string>;
}
```
- **`OllamaProvider`** (default): POSTs to `http://localhost:11434/api/chat` and passes `schema` in the **`format`** field → output is constrained to valid JSON. No key, no internet.
- **`ClaudeProvider`** (optional): calls the Anthropic API through the `/server` proxy.
- A single config flag (e.g. `AI_PROVIDER=ollama|claude` in `.env`) picks the active one. Everything downstream — the GM prompt, the schema, `outcomes.ts` — is identical regardless of provider.
### 8.2 GM system prompt — used by every provider (paste verbatim)
```
You are the GAME MASTER for OUTBREAK, an open-world zombie-survival game.
You control the world, narrate events, and decide the outcome of everything the player does.
# WORLD & TONE
- Genre: grounded survival horror. Think Project Zomboid x The Last of Us.
- The dead have risen; the city is overrun. Infection spreads through bites and deep
  scratches and is usually fatal.
- Food, water, ammo, and medicine are scarce. Trust is rare. Death is permanent.
- No magic, no superpowers, no cartoon logic. Everything obeys real-world cause and effect.
# YOUR ROLE EACH TURN
You receive the full GAME STATE (JSON) and the player's INPUT — either free text
("I do X") or a chosen OPTION. You must:
1. Determine a fair, realistic outcome based on the player's stats, inventory, location,
   and the world's current state.
2. Reward clever, prepared, and cautious play. Punish reckless play with real risk:
   injury, lost resources, attracting the infected, or death.
3. Keep the world alive and surprising so no two runs feel the same — vary encounters,
   loot, survivors, weather, and events — but NEVER contradict established facts
   (worldFlags, recentEvents) and NEVER break the HARD RULES below.
4. Decide what happens next: an open situation (free_text) or a tense branch (4 choices).
5. Reply with ONE valid JSON object in the exact OUTPUT SCHEMA. Output nothing else —
   no markdown, no code fences, no commentary.
# HARD RULES
- Resource integrity: only grant items the player could plausibly find here. Only remove
  items when justified (used, dropped, stolen, broken) — and say so in the narrative.
- Mortality is real: if an action would realistically be fatal, the player dies. Set
  "game_over": true with a final narrative. Do NOT rescue bad decisions with luck.
- Consistency: respect worldFlags and recentEvents. Cleared places stay cleared. Dead
  characters stay dead. Locked doors stay locked until opened.
- Fair difficulty: scale danger to the player's CURRENT condition. A wounded, unarmed
  player should not face an unwinnable horde unless they knowingly walked into one.
- Brevity: narrative is 2–4 tight, vivid sentences. Consequence over exposition.
- Choices (when used): EXACTLY 4, meaningfully distinct (e.g. aggressive / cautious /
  clever / desperate). Each must have believable upside AND risk. Never include an
  obviously-correct option.
- Interaction rhythm: use free_text for exploration and open moments; use choices for
  combat, dilemmas, and high-stakes decisions. Alternate to keep the game dynamic.
- Stat changes are DELTAS (e.g. -10). The engine clamps and validates everything —
  propose sensible numbers, never try to force impossible states.
# OUTPUT SCHEMA (return EXACTLY this shape)
{
  "narrative": "2-4 sentences describing what happens.",
  "state_changes": { "hp": 0, "stamina": 0, "hunger": 0, "thirst": 0, "infection": 0 },
  "inventory_add": [ { "item": "name", "qty": 1, "note": "optional" } ],
  "inventory_remove": [ { "item": "name", "qty": 1 } ],
  "world_flags_add": [ "snake_case_flag" ],
  "spawns": [ { "type": "zombie | zombie_runner | survivor_hostile | survivor_friendly", "count": 1, "reason": "why" } ],
  "discovered": { "name": null, "type": null, "x": null, "y": null },
  "next_interaction": {
    "type": "free_text | choices",
    "prompt": "What the player sees / is asked.",
    "options": []   // EXACTLY 4 strings if type == "choices", else empty
  },
  "game_over": false,
  "game_over_reason": ""
}
```
### 8.3 Per-turn input payload (what the provider sends each turn)
```json
{
  "game_state": { "...trimmed GameState (player, inventory, worldFlags, recentEvents, day, timeOfDay, location_type)..." },
  "input": { "mode": "free_text", "value": "I search behind the pharmacy counter for medicine" }
}
```
For choice mode: `{ "mode": "choice", "value": "Fight through the horde" }`.
### 8.4 Required output — enforce it with Ollama structured outputs
Don't trust a local model to format JSON by hand — **constrain it.** Ollama's `/api/chat` accepts a **`format`** parameter that takes a full JSON schema and forces the output to match it. This is the single most important trick for running the GM locally: it makes broken JSON essentially impossible. (You must still instruct the model to output JSON — the GM prompt already does.)
Pass this schema (mirrors §8.2) as `format`:
```json
{
  "type": "object",
  "properties": {
    "narrative": { "type": "string" },
    "state_changes": {
      "type": "object",
      "properties": {
        "hp": {"type":"integer"}, "stamina": {"type":"integer"},
        "hunger": {"type":"integer"}, "thirst": {"type":"integer"},
        "infection": {"type":"integer"}
      },
      "required": ["hp","stamina","hunger","thirst","infection"]
    },
    "inventory_add": { "type":"array", "items": {
      "type":"object",
      "properties": {"item":{"type":"string"},"qty":{"type":"integer"},"note":{"type":"string"}},
      "required": ["item","qty"] } },
    "inventory_remove": { "type":"array", "items": {
      "type":"object",
      "properties": {"item":{"type":"string"},"qty":{"type":"integer"}},
      "required": ["item","qty"] } },
    "world_flags_add": { "type":"array", "items": {"type":"string"} },
    "spawns": { "type":"array", "items": {
      "type":"object",
      "properties": {
        "type": {"type":"string","enum":["zombie","zombie_runner","survivor_hostile","survivor_friendly"]},
        "count": {"type":"integer"},
        "reason": {"type":"string"}
      },
      "required": ["type","count"] } },
    "discovered": {
      "type":"object",
      "properties": {"name":{"type":"string"},"type":{"type":"string"},"x":{"type":"number"},"y":{"type":"number"}}
    },
    "next_interaction": {
      "type":"object",
      "properties": {
        "type": {"type":"string","enum":["free_text","choices"]},
        "prompt": {"type":"string"},
        "options": {"type":"array","items":{"type":"string"}}
      },
      "required": ["type","prompt","options"]
    },
    "game_over": {"type":"boolean"},
    "game_over_reason": {"type":"string"}
  },
  "required": ["narrative","state_changes","next_interaction","game_over"]
}
```
Example call:
```bash
curl http://localhost:11434/api/chat -d '{
  "model": "<your-model>",
  "messages": [
    {"role":"system","content":"<GM system prompt from 8.2>"},
    {"role":"user","content":"<per-turn payload from 8.3>"}
  ],
  "stream": true,
  "keep_alive": "30m",
  "options": { "temperature": 0.8 },
  "format": { ...the schema above... }
}'
```
The `enum` constraints guarantee valid spawn types and interaction modes. Keep a backstop anyway: if `JSON.parse` ever fails, retry once, then apply a safe fallback outcome ("Nothing of note happens.") so the game never hard-crashes. *(Structured outputs are a **local** Ollama feature; the optional cloud Claude path uses tool/JSON mode instead — same provider interface, same schema.)*
### 8.5 Engine-side validation (`outcomes.ts`) — non-negotiable
Before applying GM output:
- Parse and schema-check the JSON; reject/repair malformed responses.
- Apply `state_changes` as deltas, then **clamp** each stat to `0–100`.
- `inventory_remove`: ignore items the player doesn't actually hold; never go below 0 qty.
- `inventory_add`: cap per-item qty to a sane max; merge stacks.
- `world_flags_add`: append + **dedupe**.
- `spawns`: instantiate enemies/survivors at valid, walkable tiles **near** the player (not inside walls).
- `discovered`: if present, add to `knownLocations` and reveal on the map.
- Re-check death conditions (`hp <= 0` or `infection >= 100`) → route to GameOverScene.
- Push a one-line summary into `recentEvents` (and trim to the last ~6).
### 8.6 New-run scenario generation (called once per new game)
A separate one-shot call to the same provider (use your local model; or `claude-sonnet-4-6` on the cloud path). Constrain it with a `format` schema too. Pass a **random theme** to force variety, e.g. randomly pick one of:
`["winter outbreak", "military quarantine zone", "rural farmland collapse", "downtown high-rise", "overrun hospital", "highway exodus", "flooded district", "prison break"]`.
System instruction:
```
Generate a unique opening scenario for a new run of OUTBREAK. Given the THEME, define:
who the player is (one line), where they start, the immediate threat, ONE starting
advantage (a single useful item or trait), and a short-term goal. Make it distinct and
atmospheric. Return ONLY this JSON:
{
  "intro_narrative": "3-5 sentences setting the scene",
  "player_name": "string",
  "start_location": "string",
  "starting_items": [ { "item": "name", "qty": 1 } ],
  "starting_goal": "string",
  "difficulty_modifier": 1.0
}
```
### 8.7 Latency notes (local)
- Local inference is **free** but slower than cloud — speed depends on your hardware and model size.
- Keep turns snappy: **small input** (trim GameState, cap `recentEvents`), **short narrative** (2–4 sentences), and `keep_alive` so the model never reloads between turns.
- **Stream** the response and show a short "the world reacts…" spinner so waiting feels intentional.
- A 4-sentence narrative + small JSON is only ~150–250 tokens, so even a mid-range laptop GPU should turn around in a few seconds.
### 8.8 Running the GM on a local Ollama model — setup
1. **Install Ollama** from ollama.com (Windows/Mac/Linux).
2. **Pull a model** you can run, then start it: `ollama run <model>`. It serves an HTTP API at `http://localhost:11434`.
3. **Point the game at it** via the `OllamaProvider` (§8.1). For local-only play you can call Ollama **directly from the browser** — no proxy needed — but you must allow the dev origin for CORS: set `OLLAMA_ORIGINS=*` (or your Vite URL) before starting Ollama. Prefer not to touch CORS? Route through the optional thin `/server` proxy instead.
4. **Keep it warm:** pass `"keep_alive": "30m"` so the model stays in VRAM between turns.
**Model picks by hardware** (use an *abliterated/uncensored* build so the GM narrates gore freely — you're already running these locally):
| Your machine | Run | Notes |
|---|---|---|
| ~8 GB VRAM / 16 GB RAM | 7–9B at Q4_K_M (Qwen, Llama 3.x, Gemma) | Fast; `format` keeps JSON valid; rule-adherence is the weak point — lean on validation. |
| 12–16 GB VRAM | 12–14B at Q4/Q5 (Qwen 14B, Mistral-Nemo 12B, Gemma 12B) | Noticeably better judgment and narrative. |
| 24 GB+ VRAM | 24–32B (Qwen 32B, gpt-oss, Gemma 27B) | Best rule-following; closest to the cloud experience. |
Smaller model misbehaving (ignoring world flags, dumb choices, infinite loot)? Fixes in order: tighten the GM prompt, shrink the per-turn payload, lower temperature a touch, add stricter `outcomes.ts` checks, or step up a model size. Since you already run abliterated Gemma GGUF locally, the quickest start is to point `OllamaProvider` at whatever you've already got loaded.
---
## 9. Art & assets — how we get "fully designed" sprites
**Honest reality:** Claude Code will not hand-paint custom pixel art. The fast, professional path is **curated CC0 asset packs**, with programmatic placeholders only where a sprite is missing.
- **Primary source: Kenney.nl** (CC0 — free, commercial-ok, no attribution required). Good fits:
  - *Topdown Shooter* pack (player, enemies, top-down perspective)
  - *Roguelike / RPG* + *Tiny Town* / *Tiny Dungeon* (tiles: roads, walls, floors, doors, props)
  - UI pack for the HUD.
  - Download into `/public/assets`.
- **Characters** (player, walker, runner, survivors): top-down sprites with **idle + 4-direction walk** animations, packed into a Phaser **texture atlas**.
- **Tilemap**: build a city tileset — roads, sidewalks, building interiors, walls, doors — plus props: cars, crates, barricades, corpses, loot containers.
- **Placeholder fallback:** if a needed sprite isn't in the packs, draw a labelled colored shape (e.g. red circle = zombie) so dev is never blocked. Mark each with a `// TODO: replace placeholder art`.
- **Post-MVP upgrade path:** swap in AI-generated sprite sheets or commissioned art later. Out of scope for the MVP.
- **Copyright:** original or CC0 assets only. Do **not** reproduce any real game's characters, named content, or art.
---
## 10. World generation (open world)
- **Code generates the geometry; the AI handles what's inside.** Clean separation of concerns.
- `worldgen.ts` builds a **seeded** top-down city on a tile grid each run:
  - A road/street network (grid with some variation).
  - Blocks filled with **buildings**, each tagged with a `type` (house, pharmacy, grocery, gas station, hospital, police station, hardware store…) and an **enterable trigger zone**.
  - Scattered props, loot nodes, and zombie spawn points.
- **Open-world feel:** free roaming, camera follows the player, points of interest revealed as **discovered**. Map size is a tunable constant — start modest, scale up once it runs well.
- **Day/night** affects visibility and danger (nights are deadlier).
- Same seed → same map, for reproducible debugging. New game → new seed → new city.
---
## 11. Enemy & NPC behaviour
- **Zombie state machine** (`Enemy.ts`): `wander → alerted (saw/heard player) → chase → attack`. **Noise** (gunshots, sprinting) widens the aggro radius.
  - **Walkers**: slow, common. **Runners**: fast, rare, dangerous.
- **Hordes**: clusters that can be drawn away or avoided; engaging one is a real commitment.
- **Survivors**: spawned via GM encounters; friendly (trade/ally) or hostile. Their fate persists through `worldFlags` (`ally_x_alive`, `hostile_y_hunting`).
- Keep enemy AI simple and readable for the MVP — chase logic + line-of-sight is enough.
---
## 12. Survival systems (`survival.ts`)
- **Stats**: HP, stamina, hunger, thirst, infection.
- **Decay**: hunger/thirst drop over time; stamina drains on sprinting/heavy actions and regenerates when resting; resting passes time (and risk).
- **Eating/drinking/healing**: items restore the matching stat.
- **Infection**: rises from bites/scratches and ticks up over time once infected; antibiotics/rare meds slow it, a rare cure could stop it. **Reaching 100 = you turn (death).**
- **Death** → run ends → score/summary screen (days survived, zombies killed, story beats) → **new, procedurally different run.**
- **Optional, post-MVP:** light crafting (combine items) and small within-run skill progression. Don't build these until the core loop is fun.
---
## 13. Build phases (milestones) — build IN ORDER, test each before continuing
> After **every** phase: make it run, then **stop and report** how to run/test it. Don't skip ahead.
- **Phase 0 — Scaffold.** Vite + Phaser + TS project. `LLMProvider` interface + `OllamaProvider` stub (no proxy needed for local). `.env` + `contracts.ts` types. Dev server runs and shows an empty Phaser canvas.
- **Phase 1 — Walkable world.** Seeded procedural city tilemap. Placeholder player sprite, WASD/arrow movement, camera-follow, wall collisions. *I can walk around a city.*
- **Phase 2 — Designed art.** Integrate Kenney packs. Player + walker + runner + survivor sprites with idle/4-dir walk animations. Proper city tiles and props. Placeholders for anything missing. *It looks like a real game.*
- **Phase 3 — State + HUD.** `GameState` store + survival stat decay + inventory. On-screen HUD (stat bars + inventory). Save/load to localStorage. *Stats live and persist.*
- **Phase 4 — The Game Master (core).** Wire `OllamaProvider` → `/api/chat` with the GM system prompt and `format`=schema (§8.4). `EncounterModal` with **free-text input AND 4-choice buttons** + streamed narrative. `outcomes.ts` validates and applies GM JSON. *I can act and the local AI decides what happens.*
- **Phase 5 — Encounters & reactive world.** Triggers (enter building / zombie proximity / random events) fire GM calls. Spawns from GM output appear on the map. World flags persist within a run. Basic zombie chase AI. *The world reacts and remembers.*
- **Phase 6 — Survival + death + new run.** Hunger/thirst/stamina/infection fully wired. Day/night cycle. Infection → death. Death → GameOver summary → **new seed + new AI scenario.** *Full survival loop closes.*
- **Phase 7 — Replayability & polish.** Per-run scenario generation (§8.6) so each run opens uniquely. Difficulty scaling. Main menu. Sound. UI polish. *Shippable MVP.*
---
## 14. Coding standards
- **TypeScript everywhere.** The GM request/response contract lives in `src/shared/contracts.ts` and is imported by both client and server — one source of truth for the schema.
- Respect the **three-layer separation** (§5). Engine code must not know about story; AI code must not mutate state directly.
- **Engine is the authority** on all hard mechanics. GM output is *always* validated first.
- **Provider behind the interface (§8.1) — never hardcode it.** Local Ollama needs no key. If you enable the cloud path, the API key lives only in the server/`.env` (gitignored), never in the client bundle.
- Use a **seeded RNG** for all procedural systems so runs are reproducible for debugging.
- Small functions, clear names, comment only the non-obvious. **Commit at the end of each phase.**
- Don't block gameplay on art — placeholders are fine, tagged with `// TODO`.
---
## 15. Guardrails — what NOT to do
- ❌ Don't try to build everything at once. Follow §13 and get each phase running first.
- ❌ Don't let the AI write directly to `GameState`. Validate → clamp → apply, always.
- ❌ Don't put a cloud API key in the browser. (Local Ollama has no key — for cloud, keep it server-side.)
- ❌ Don't over-scope the MVP: no multiplayer, no huge skill/crafting trees, no cloud saves yet.
- ❌ Don't rely on the model to format JSON freehand — pass Ollama's `format` schema (§8.4). Still retry-once-then-safe-fallback as a backstop.
- ❌ Don't hardcode the provider — keep Ollama and Claude swappable behind `LLMProvider`.
- ❌ Don't reproduce any copyrighted game's assets, characters, or named content — original / CC0 only.
- ❌ Don't send the entire history to the GM every turn — trim state and cap `recentEvents` to control cost.
---
## 16. Definition of done (MVP)
- [ ] Walkable, **procedurally generated** city with **designed** (CC0) sprites and tiles.
- [ ] Player movement, camera-follow, and collisions.
- [ ] Working HUD: HP / stamina / hunger / thirst / infection + inventory.
- [ ] Encounters trigger on entering buildings / approaching threats.
- [ ] Encounter UI offers **both** free-text input **and** 4-choice selection.
- [ ] GM returns structured JSON; engine **validates and applies** it.
- [ ] Enemies spawn from outcomes; world flags persist within a run.
- [ ] Survival stats decay; infection and death work.
- [ ] Death → summary → **new run that is noticeably different** (new map seed + new AI scenario).
- [ ] Runs fully offline on a local Ollama model (no API key, no internet); cloud Claude is a config-flag swap, not a requirement.
---
*End of master prompt. Rename the game, tune the constants, and let the GM surprise you.*
