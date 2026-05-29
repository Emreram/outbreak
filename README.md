# OUTBREAK

A 2D, top-down, **open-world zombie-survival game** where an **AI Game Master**
decides the outcome of everything you do — so every playthrough is different.
Runs on a **local LLM via Ollama** by default (free, offline), with optional
cloud Claude behind the same interface.

- **Full design spec:** [`CLAUDE.md`](./CLAUDE.md)
- **Build roadmap & verification plan:** [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)

> **Current status: Phase 0 + Phase 1 complete and verified.**
> A seeded, procedurally generated city you can walk around with a placeholder
> player sprite, camera-follow, and wall collisions. The AI Game Master, HUD,
> survival systems, and combat arrive in later phases (see the plan). No model
> or internet is required to run what exists today.

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
| Action | Keys |
|---|---|
| Move | **WASD** or **arrow keys** |
| New random city | **R** |
| Reproduce a specific city | add `?seed=<value>` to the URL, e.g. `…/?seed=alpha` |

The HUD (top-left) shows the run seed, building count, your tile coords, and FPS.

## Other scripts

```bash
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
│   ├── textures.ts        # placeholder art (replaced by CC0 packs in Phase 2)
│   ├── Player.ts · Camera.ts · WorldRenderer.ts
├── game/                  # hard mechanics (authoritative)
│   ├── constants.ts · rng.ts (seeded) · worldgen.ts (seeded city)
├── ai/                    # swappable GM brain (LLMProvider)
│   ├── provider.ts · ollamaProvider.ts (default) · claudeProvider.ts (optional stub)
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
| `VITE_AI_PROVIDER` | `ollama` | `ollama` (local, default) or `claude` (optional cloud) |
| `VITE_OLLAMA_HOST` | `http://localhost:11434` | local Ollama HTTP API |
| `VITE_OLLAMA_MODEL` | `llama3.1` | local model name |

> The AI Game Master is wired up in **Phase 4**. When that lands, you'll run a
> local model with `ollama run <model>` (and set `OLLAMA_ORIGINS` for browser
> CORS, or use the optional `/server` proxy). A cloud API key, if ever used,
> stays server-side — never in the browser bundle.

## License / assets

Original or **CC0** assets only (Phase 2 uses Kenney.nl packs). No copyrighted
game art, characters, or named content.
