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
- *(Later phases only)* **Ollama** for the local AI Game Master — not needed yet.

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
| Act / open an encounter | **E** · the **ACT** button |
| Attack (melee) | **SPACE** / **F** · the **HIT** button |
| New run | **R** |
| Quick item use (debug) | **1** eat · **2** drink · **3** hurt · **4** bandage |
| Reproduce a specific city | add `?seed=<value>` to the URL, e.g. `…/?seed=alpha` |

In an **encounter** the world pauses and you either type what you do or tap one of 4
options; the GM narrates and the engine applies a validated outcome. The HUD (top-left)
shows day/time, your five survival stats, inventory, and a debug line. Your run
**autosaves**; death → a summary → a brand-new, AI-authored run.

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
| `VITE_AI_PROVIDER` | `mock` | `mock` (offline GM, default), `ollama` (local), or `claude` (cloud) |
| `VITE_OLLAMA_HOST` | `http://localhost:11434` | local Ollama HTTP API |
| `VITE_OLLAMA_MODEL` | `llama3.1` | local model name |

> By default OUTBREAK uses a built-in **offline procedural Game Master** so it runs
> anywhere with no setup. To use a real local model, run `ollama run <model>`, set
> `VITE_AI_PROVIDER=ollama` (and `OLLAMA_ORIGINS` for browser CORS, or use the
> optional `/server` proxy). If the configured model is unreachable, the game
> automatically falls back to the offline GM. A cloud key, if ever used, stays
> server-side — never in the browser bundle.

## License / assets

Original or **CC0** assets only. Phase 2 uses CC0 Kenney.nl packs (Roguelike
Modern City + Top-down Shooter); sources are listed in
[`public/assets/CREDITS.md`](./public/assets/CREDITS.md). No copyrighted game
art, characters, or named content.
