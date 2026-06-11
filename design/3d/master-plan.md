# OUTBREAK 3D — Full-Stack 3D Transformation Master Plan

> **Status:** Approved direction, pre-implementation.
> **Goal:** Transform OUTBREAK from a 2D top-down Phaser 3 game into a 3D game with AAA-level polish, **preserving 100% of current functionality**.
> **Engine:** Babylon.js 8 (WebGPU-first, WebGL2 fallback) · **Scope:** offline-only single-player · **Art:** stylized low-poly + cinematic lighting · **Backend:** none (fully local stack).

---

## 0. How to use this document

This is the single source of truth for the 3D transformation. It is **built and tested phase by phase** (§8), exactly like the original CLAUDE.md phases — do not attempt the whole port in one shot.

- Each milestone (M0–M8) ends with a **green bar**: `npm run typecheck` + `npm test` + `npm run build` pass, the **Phaser build still ships** (until M8), and the milestone's exit criteria are demonstrated.
- The studio framework gates apply: run `/gate-check` between phases, `/code-review` + `/smoke-check` per feature, and the **dual-build same-save QA** described in §10.
- The **constitution** in §2 is binding. When in doubt, the rule is: *the simulation is the authority; 3D is a view; the save schema is frozen; Phaser is the behavioral oracle until cutover.*
- This document supersedes nothing in `CLAUDE.md` about game *design*; it is the *technical transformation* layer around it.

---

## 1. Audit — the preservation contract

Everything in this section **must survive the port with identical behavior**. This is the checklist the final parity certificate (M7) is verified against.

### 1.1 Codebase facts

| Fact | Value |
|---|---|
| Size | ~22,600 LoC, 100 TS files |
| Stack | Vite 5.4.8, Phaser 3.80.1, TypeScript 5.5.4 (strict) |
| Runtime deps | `phaser`, `@mlc-ai/web-llm` (only two) |
| Tests | 29 headless logic suites, custom esbuild+Node runner (`npm test`) — **run without Phaser** |
| CI/Deploy | GitHub Actions → GH Pages; Vercel auto-deploy; static output |
| Save | `localStorage["outbreak_save_v4"]`, full `GameState` JSON |
| World | 40×40 chunks × 48×48 tiles, `TILE_SIZE = 32px`, deterministic per-chunk gen |

### 1.2 Three-layer architecture (the decisive fact)

- **Pure simulation/logic (~80%), zero Phaser imports — ports unchanged:**
  - `src/game/**` (~50 files): `GameState.ts`, `survival.ts`, `inventory.ts`, `combat.ts`, `worldgen.ts`, `world/**` (`ChunkManager`, `biomes`, `roads`, `terrainField`, `setpieces`, `landmarks`, `buildingStates`, `disasterScars`, `spawn`, `scaling`, `noise`), `items/**`, `enemies/**`, `pets.ts`, `npcs.ts`, `vehicles.ts`, `farming.ts`, `crafting.ts`, `skills.ts`, `perks.ts`, `base.ts`, `scavenge.ts`, `weather.ts`, `disasters.ts`, `worldEvents.ts`, `objectives.ts`, `notes.ts`, `outcomes.ts`, `survival.ts`.
  - `src/ai/**` (7 files): `provider.ts`, `ollamaProvider.ts`, `webllm.ts`, `claudeProvider.ts`, `mockProvider.ts`, `gameMaster.ts`, `prompts.ts`.
  - `src/shared/contracts.ts`: GM + save schema.
- **Phaser presentation — to be rebuilt:**
  - `src/engine/**` (~15 files): `Player.ts`, `Npc.ts`, `Enemy.ts`, `Animal.ts`, `Camera.ts`, `ChunkRenderer.ts`, procedural texture generators (`textures.ts`, `propSprites.ts`, `petSprites.ts`, `zombieSprites.ts`, `icons.ts`), `anim.ts` (**dependency-free math gaits — kept**), `audio.ts` (**100% synthesized Web Audio, zero samples — kept**), `shaders/water.ts` + `shaders/lava.ts`, `fx.ts`.
- **UI:**
  - `src/ui/**` (~10 files): Phaser-drawn `HUD.ts` + `HotBar.ts`; **DOM-overlay modals** `EncounterModal`, `LootModal`, `CraftModal`, `TradeModal`, `StorageModal`, `PetModal`, `ReaderModal`, `CharacterCreate`, `LootReveal`; `Minimap.ts`; touch controls.
- **The orchestrator catch:** `src/scenes/WorldScene.ts` is **242KB / ~270 methods** — it is *not* pure presentation. It fuses simulation orchestration (clock advance, spawn cadence, disaster scheduling, taming/search timers, siege ticks, beacon resolution, vehicle/pet reconciliation) with rendering. **Extracting it is the critical path of the whole project** (§3.2, M1).

### 1.3 Feature inventory (must survive 100%)

**World & terrain** — seeded append-only RNG chunk generation; 5×5 chunk streaming ring (radius 2 load / 3 unload); terrain regenerated from seed (never saved); 20+ biomes (urban: downtown, suburb, commercial_strip, industrial, warehouse, hospital, police, military, school, mall, trainyard, construction; rural: forest, dense_woods, grassland, parkland, farmland, badlands, coast, marsh, riverbank, lake, ocean, volcanic); buildings with real interiors, containers (10 kinds), furniture; landmarks; set-pieces (crashed helicopter, derailed train, gas truck…); disaster scars overlaid on regenerated chunks; fog-of-war discovery (`discovered` chunk keys).

**Survival** — hp / stamina / hunger / thirst / infection (0–100, GM deltas clamped); decay ticks (~2s): hunger 1, thirst 1.4, stamina regen 6, starve 2 HP, infection 1.5; burning (8 HP/tick, lava/fire) and wet (douses fire) statuses with timers; perk modifiers (Iron Gut, Marathoner, Hardy, Adaptable…); death = `hp ≤ 0 ∨ infection ≥ 100`.

**Combat** — 41 melee weapons (blade/axe/blunt/spear/polearm/whip/fists) + 60+ ranged (pistol/SMG/shotgun/rifle/LMG/bow/crossbow/launcher/flame/energy); 6 ammo calibres, magazine + reload, reserve stacks; 20 ability types (bleed, cleave, knockback, stun, pierce, lifesteal, crit, burn, execute, chain, ricochet, explosive, incendiary, quiet, heavy, fast, poison, freeze, armorpierce, vampiric); body + head armor; perk multipliers (Marksman +25% ranged, Brawler +25% melee, Tough −25% physical, Quick −20% cd, Fireproof −60% burn); noise → aggro radius.

**Enemies** — 100+ hand-authored zombie defs across 6 rarities; movement archetypes walker / crawler / erratic / lurcher / leaper / stalker / runner; traits fast, brute, armored, electric, toxic, spitter, screamer, bloated/exploder, frenzied, grabber, leaper, flamer; AI states idle → alert → aggro → feeding → fleeing; per-biome spawn tables, `minDay` gating, distance/day escalation; hordes; ambient spawn cadence 26–56s; 12+ bosses; blood moon (6%/night → more & deadlier spawns, red sky).

**Animals** — rabbit (8 HP), deer (22 HP), boar (34 HP); ambient roaming, flee AI (alarmed radius 340px); hunting drops Raw Meat / Hide / Bone.

**NPCs & factions** — 3 factions (Townsfolk, Wanderers, Scavengers); standing −100..100; tiers poor / average / prime (HP/dmg/loot/recruit-cost multipliers); barter trade offers (2–4 per NPC); recruit ≤2 companions (cost-gated, follow + assist in combat); living camps (deterministic rosters at landmarks); building moods boarded / infested / trapped / normal (deterministic rolls + flag overrides).

**Pets** — 20+ species across common→epic (Stray Dog, Cat, Goat, Horse, Wolf, Falcon, Donkey, Pony, Dire Wolf, Great Stag, Raven, Snapping Turtle, Warhorse, Griffin, Dragon, Phoenix, Leviathan…); taming (diet item + 2s channel + per-species %); bond 0–5 (feeding +0.25, +25 HP); roster max 8, max 2 wild at once; auras luck / scout / fear / regen / light; **riding** (speed ≥1.4×), **flight** (stamina drain 1/s aloft, regen 2/s grounded, fly-over collision gate, landing-spot search), **swimming** (water-tile process gate); mounts trample low-rank zombies; synthesized per-species voices.

**Vehicles** — sedan (2.3×), pickup (2.05×), van (1.85×); deterministic spawn on urban road tiles; parts-based repair (Engine/Battery/Spark Plug/Tire); fuel 0–100 (canister +60); runs over zombie groups; persisted only when repaired/moved (else seed-reconciled).

**Crafting & economy systems** — farming (wheat/corn/tomato/potato/carrot: till → plant → water → harvest, growth on time-of-day clock); crafting (20+ recipes; campfire/workbench stations; skill-gated e.g. 5.56 needs Crafting 2); 6 skills (combat/farming/crafting/medical/fitness/mechanics, quadratic XP `100·(L−1)·L/2`); base building (claim a building + 7 placeables: barricade/wall/gate/spikes/storage/campfire/workbench, with HP, siege damage, base storage stash); scavenging (14 searchable prop kinds, hold-to-search 1.2–1.8s, empty %, +110 search noise, themed bonus drops, per-run searched flags); loot (19 tables, 6 rarities with Lucky +60% bias, biome bias, building tiers 0–4, locked chests, stash-map buried tier-3 chests).

**Reactive world** — day/night 4-phase cycle (dawn/day/dusk/night) with keyframed lighting + persisted `clockMs`; weather (clear/cloudy/rain/fog/storm, weighted, rain waters crops + draws undead); 10 world-event types (horde, raiders, flyover, supply drop, trader, dilemma, + investigable beacons smoke/flare/gunfight/car-alarm); disasters (earthquake/wildfire/flood/eruption/storm_lightning; telegraph → active → scar phases; cataclysm rate scales with day); objectives / 5-step opening arc; notes & readables (12 seeded pools) + stash maps (pin world flag → buried chest).

**Meta** — difficulty (scenario × background × user pick, 0.8–1.5); 12 perks; character creation (backgrounds with loadouts+perks, name, jacket color, difficulty radio); death → summary (days survived, kills, reason) → new seed + new AI scenario; minimap with chunk fog-of-war; 4-slot category hotbar (food/drink/heal/cure).

**AI Game Master** — 4 swappable brains behind `LLMProvider`: WebLLM (in-browser WebGPU, opt-in, XGrammar-constrained) → Ollama (`localhost:11434` via `/ollama` Vite proxy, `format`-schema-constrained) → Claude (stubbed cloud path) → MockProvider (deterministic offline GM, always available); `runTurn` 45s timeout, retry-once-on-parse, 3-tier fallback to safe outcome; `generateScenario` (8 themes); `sanitizeGM` + `applyGM` validate/clamp/dedupe/spawn-safety; encounter modal with free-text **and** 4-choice input, typewriter narrative, non-blocking banners.

**Presentation "feel" to preserve** — loot-reveal ceremony with rarity stingers; blood decal pooling (80 splat / 110 drip caps, timed fade); brass casing ejects; melee swing-arc styles (slash/thrust/smash); prop wind-sway with traveling gusts; keyframed day/night overlay + player glow; weather overlays; blood-moon red sky; title-screen embers/ash/flicker; **fully synthesized audio** (per-biome ambient beds, night chirps, per-species pet voices, combat/UI/loot stingers, positional pan + distance falloff); floating damage numbers; rarity glow under drops; hitstop / zoom-punch / hurt-pulse; spawn pop-in & death fade tweens; DOM touch controls (joystick + 5 buttons); `?seed=` URL dev flow.

**Key constants** — `PLAYER_SPEED 190 px/s`, sprint ×1.6, `MAX_STACK 99`, `MAX_COMPANIONS 2`, `MAX_PET_ROSTER 8`, `TAME_MS 2000`, terrain speed mults (shallow water .55 / mud .5 / lava .28 + burn), camera zoom 1.25 / follow lerp 0.12, `SAVE_KEY "outbreak_save_v4"`.

---

## 2. Constitution of the port (binding rules)

1. **2D simulation, 3D presentation.** The simulation remains the existing tile-grid world — positions in pixels, tile collision, aggro/noise radii, every rule untouched. 3D is a *pure view*: `x → X`, `y → Z`, visual height `→ Y`. Flying/altitude is a render-only channel; the sim never sees a third axis. This is the strongest guarantee that functionality is preserved (the proven Hades / Don't Starve 2D-logic-under-3D-render model).
2. **Strangler-fig migration; Phaser is the frozen behavioral oracle.** WorldScene's simulation is extracted into a renderer-agnostic `/src/sim` layer **with WorldScene delegating to it**, so the Phaser build stays shippable and validates each extraction. Babylon binds to the *same* sim behind `/play3d.html` + `?renderer=3d`. **No new gameplay lands on the Phaser-only path.** Phaser is deleted at cutover (M8).
3. **The save schema is frozen.** `outbreak_save_v4` stays byte-compatible across both builds for the entire migration; the *same save file must load in 2D and 3D and place the player in the same spot*. This is the headline parity instrument, alongside the 29 logic tests and golden-replay tapes.
4. **The game must always run with zero assets and zero network.** Every renderable has a procedural blockout fallback; GLB art is progressive enhancement. This preserves OUTBREAK's current identity (offline, airplane-mode, instant-boot).

---

## 3. 3D architecture (Babylon.js 8)

### 3.1 Coordinate & unit contract

One module — `src/render3d/space.ts` — owns the entire mapping, and nothing else may duplicate it:

- `TILE_SIZE 32px ≡ 1 meter`; `WORLD_SCALE = 1/32`. Chunk = 48m; loaded ring ≈ 240m square; world = 1,920m square.
- `simToWorld(x_px, y_px, h_m = 0) → Vector3(x_px·WORLD_SCALE, h_m, y_px·WORLD_SCALE)`; plus `worldToSim()` and `groundHeightAt(x_px,y_px)`.
- Camera `alpha` is fixed so sim-north (−y) is screen-up, matching the minimap. A unit test asserts round-trip + minimap orientation.
- **All sim math, save data, aggro radii, noise distances stay in pixels forever.** Visual heights are cosmetic (characters ~1.7m, walls 2.6m).
- **Sim tick:** fixed-step 60 Hz accumulator with render-side interpolation (replaces Phaser's variable delta). This is a *declared* feel change that buys determinism + replay-testability; per-system code already takes a `delta` param, so the port is mechanical.

### 3.2 Module layout

```
src/
  game/, ai/, shared/        UNCHANGED (pure logic, contracts, GM)
  sim/                       NEW — renderer-agnostic, extracted from WorldScene
    Sim.ts                   fixed-step loop, system registry, entity world
    physics.ts               Arcade-equivalent AABB-vs-tilegrid + circle overlaps (§3.4)
    events.ts                typed EventBus (spawn/death/fx/banner/toast/…)
    input.ts                 abstract intents (move vector, aim angle, fire, interact…)
    entities/                PlayerSim, EnemySim, NpcSim, PetSim, AnimalSim, VehicleSim
    systems/                 clock, weather, bloodMoon, spawning, hordes, disasters,
                             worldEvents/beacons, siege, taming, search, farming,
                             vehicles, riding/flight, camps, moods, objectives, ambienceCues
  render3d/                  NEW — Babylon presentation (replaces engine/ + scene halves)
    bootstrap.ts             WebGPUEngine.IsSupportedAsync ? initAsync() : Engine(webgl2)
    SceneHost.ts             scene, render loop, resize, quality tiers
    space.ts                 §3.1 coordinate contract (sole owner)
    WorldView.ts             subscribes to sim events; owns sub-views
    chunks/                  ChunkMesher, ChunkViewManager, TileAtlas (port of textures.ts),
                             PropInstancer (thin instances + sway), Searchables, Labels
    actors/                  ActorFactory, ModularZombie (§3.6), AnimController (§3.7),
                             gaitDriver.ts (REUSES engine/anim.ts math)
    entities/                PlayerView, EnemyView, NpcView, PetView, AnimalView,
                             VehicleView, DropView, ChestView, PlaceableView, CorpseView
    env/                     TimeOfDayDirector, SkyDome, WeatherFX, DisasterFX, LightPool
    fx/                      DecalPool, CasingPool, SwingTrail, MuzzleFlash,
                             DamageNumbers (GUI pool), RarityGlow, ParticleLibrary
    camera/FollowRig.ts      §6.1
    assets/                  manifest.ts, AssetRegistry, blockout.ts, MaterialLibrary, variation.ts
    audio3d.ts               PannerNode adapter over engine/audio.ts (§6.4)
  ui/                        KEPT (DOM modals); HUD → DOM rewrite; Minimap → 2D canvas
  engine/, scenes/           Phaser — frozen during migration, deleted at M8
  main.ts                    Phaser entry (until M8)
  main3d.ts                  Babylon entry (vite multi-page /play3d.html + ?renderer=3d)
```

`engine/anim.ts` and `engine/audio.ts` are **promoted, not replaced** (both are already Phaser-free) → relocated into `render3d/` (or `shared/`) intact.

### 3.3 Scene graph

```
Scene
├─ Camera        ArcRotateCamera on a lerped target proxy (FollowRig)
├─ Lights        sun DirectionalLight + CascadedShadowGenerator; HemisphericLight ambient;
│                LightPool: ≤8 nearest PointLights (campfire, lava, muzzle, electric)
├─ Sky           inverted icosphere gradient ShaderMaterial (TimeOfDayDirector); star/ember layer
├─ World root
│  └─ chunk_<cx>_<cy>  (frozen TransformNode)
│     ├─ ground (1 merged, greedy-quaded, atlas UVs)
│     ├─ walls  (1 merged, extruded solids)
│     ├─ roofs  (1 merged, dither-cutaway material)
│     ├─ water / lava planes (NodeMaterial, only if present)
│     └─ per-chunk thin-instance buffers (PropInstancer)
├─ Actors root   skeletal + blockout entities (≤ ~60 active)
├─ FX root        decal/casing thin instances, trails, GPU particles
└─ GUI            one fullscreen AdvancedDynamicTexture (damage numbers, labels, rings)
```

Static chunk meshes: `freezeWorldMatrix()` + `material.freeze()` + `doNotSyncBoundingInfo`; `scene.blockMaterialDirtyMechanism = true` after load; WebGPU `SnapshotRenderingHelper` (FAST) with invalidation on chunk swap.

### 3.4 Physics — port Arcade semantics by hand; **no Havok, no navmesh**

**Decision:** re-implement the ~6 Arcade behaviors actually used as `sim/physics.ts` (~300–400 LoC, pure, unit-tested). **Rejected:** `@babylonjs/havok`, ammo, cannon, Recast navigation.

Why:
- **Determinism & tests.** The 29 headless tests + golden-replay harness need bit-stable positions. A black-box WASM stepper is harder to coerce into Arcade's separate-axis slide than just writing the slide.
- **Save compatibility.** Player/NPC/pet/vehicle positions persist in pixels; any solver drift teleports saves.
- **Tuned feel is gameplay, not physics.** The 20px square body gliding through 1-tile (32px) doorways, knockback impulses, vehicle run-over overlap, and the mount fly-over / swim-only **per-tile process callbacks** (`ColliderSpec.process` in `ChunkRenderer.ts`) are rules — they map 1:1 to a tile-grid query and 0:1 to a rigid-body world.
- **Offline budget.** `HavokPhysics.wasm` ≈ 2MB against the PWA precache budget, for zero gain on a planar sim.

`sim/physics.ts` contains: AABB move-and-slide vs tile grid (resolve X then Y, Arcade-style) using the same `SOLID_TILES` lookup + per-tile process-gate hook; circle-overlap broadphase on a uniform 64px grid (player↔enemy touch, projectile↔entity, pickup magnets, aura radii); swept-segment projectile traces; velocity integration honoring existing `speedMult` / `terrainMult`. Validation: **characterization tests** — scripted input tapes run once on the frozen Phaser build to record golden position traces; the sim must replay them within ε. AI chase stays tile-based steering verbatim (optional post-ship per-chunk flow-field for un-sticking, logic-equivalent & flagged).

### 3.5 Chunk → mesh pipeline

Per chunk, on the existing `generateChunk` output (scars already applied by `applyScars`):

1. **Ground** — greedy-merge runs of identical tile IDs into quads (one mesh, ~300–900 tris vs 4,608 naive). UVs index a **procedurally generated tile atlas**: port `engine/textures.ts` tile painting to an offscreen canvas → one 1024² `DynamicTexture` (27 tiles + decor variants). Carries the current palette/identity and keeps the zero-asset boot. Per-vertex AO darkening baked along wall bases.
2. **Optional visual height** (M6 flag) — displace ground vertices from `world/terrainField.ts` semantics, amplitude ≤0.4m, clamped to 0 under buildings/roads/rail/water. Entities sit at `groundHeightAt()`; **sim never sees it.**
3. **Walls** — extrude `Tile.Wall` / tree-trunk / `Basalt` solids into greedy-merged boxes (2.6m, atlas side UVs); `Tile.Door` → opening + instanced doorframe.
4. **Roofs** — flat slab + parapet (or low gable for houses) per building rect, **merged into one roof mesh per chunk**, custom material that **dither-discards within ~8m of the player while `buildingAt(player) != null`** (uniforms: playerPos, indoorFlag). One draw call, no per-building state, neighbors stay capped; interiors get a dim ambient multiplier from the same flag.
5. **Water / lava** — greedy quads at fixed Y; **NodeMaterial ports of `shaders/water.ts` + `shaders/lava.ts`** (scrolling procedural waves, Shallow vs DeepWater depth tint, shoreline foam from a baked distance-to-shore attribute; lava = animated emissive + ember GPU particles + pooled flickering PointLight).
6. **Props / vegetation** — one base mesh per prop kind (GLB or blockout), **thin instances** with per-instance color + sway-phase attribute; wind via a `MaterialPlugin` vertex offset using `posPhase(x,y)` + traveling-gust uniform (direct port of the `SWAY_SPECS` pass). Searchable props (14 kinds, few per chunk) are *regular* instances (need per-instance gray-out + pick target + progress ring).
7. **Labels** — landmark + notable-building signage as GUI `TextBlock`s `linkWithMesh`'d, distance-faded, pooled (~40 max), reusing the existing FILLER_LABELS filter.

Streaming: `ChunkViewManager` mirrors `ChunkManager` load/unload events; meshing budgeted ≤4ms/frame via a work queue (one section per frame); hysteresis ring unchanged. EXP2 fog at 90–120m hides pop-in **and** is the primary mood tool.

### 3.6 Characters — 100+ zombie variety without 100 models

**Parametric variety system, data-driven from the existing `ZombieDef` catalog** (which already encodes a `LookSpec`: archetype + skin/accent palette + features):

- **One shared humanoid skeleton convention** (identical bone names/hierarchy) across all humanoids. ~12 base body meshes matching the existing `BodyArchetype` set (walker, bloated, crawler, brute, behemoth, lanky, child, hazmat, spitter, screamer, husk, armored), all skinned to that rig.
- Per-type variation composed at spawn from the def:
  1. **Material params** — skin/accent tint, emissive (electric arc-blue, toxic green, flamer ember).
  2. **Bone-scale morphs** — head/arm/torso/leg multipliers; the existing `dimsFor()` table → bone scales gives silhouette variety for free.
  3. **Attachments** — socketed props (helmet, riot plates, gas tank, hazmat hood, spikes) on bones.
  4. **Trait VFX** — drips, sparks, flames, spores from the ParticleLibrary.
- **Retargeting is trivial** given the shared rig: load one `anims_humanoid.glb`, `AnimationGroup.clone(name, targetConverter)` per actor.
- **Crowd escape hatch (M7, only if needed):** Baked Vertex Animation Textures (`BakedVertexAnimationManager`) for 5 core clips; zombies >25m render as VAT thin instances, swap to skeletal inside 25m — for blood-moon hordes.
- **Blockout fallback (always works):** capsule+box modular figure from the same LookSpec palette, **animated procedurally by porting `anim.ts` gait specs to bone transforms** (`frequency/sway/bob` → spine rotation + root bob). The game animates with zero GLB files.

NPCs: same rig + civilian meshes + faction-color accents + tier gear. Player: hero mesh, jacket material slot tinted by `appearance.color` (analog of `playerJacketFrames`). Animals/pets: 3 quadruped rigs (small/large/mount) + winged + serpent cover rabbit→leviathan; mythics get emissive/particle dressing.

### 3.7 Animation mapping

`AnimController` per actor: state machine (idle / move / sprint / attack_melee{slash|thrust|smash} / attack_ranged / hit / death / eat / scream / mounted / swim / fly) → `AnimationGroup` crossfade (`enableBlending`, ~0.15s fades); `speedRatio = simSpeed / clipBaseSpeed` (no foot-slide). Movement archetypes map to clip choice + speedRatio + a **procedural gait layer**: `gaitDriver.ts` reuses `anim.ts` per-archetype specs to add spine sway/bob/lean **additively** on bones — this is how erratic jitter, lurcher stutter, and gallop posting survive retargeting onto stock clips. Mount riding: rider parented to saddle bone, gallop posting from the gait phase. Hit/lunge/recoil squash-stretch: 100–120ms root-scale tweens (same curves as `Player.lunge`/`recoil`).

### 3.8 Lighting & time-of-day

`TimeOfDayDirector` ports the existing `applyLighting(t)` keyframe table onto: sun direction (azimuth/elevation from `dayFraction()`), sun color/intensity, hemispheric ambient, fog color/density, sky gradient stops, exposure/contrast, vignette weight. Signatures: **dawn** low warm sun + long shadows + mist; **day** neutral high sun (gameplay clarity); **dusk** orange key + purple fill; **night** cool dim moon + deep-blue ambient + vignette up. **Blood moon** = red directional + red fog + sky tint + bloom up + faint pulsing exposure (volumetric-feeling port of the current red overlay). Weather modulates on top (overcast → lower shadow contrast + sun intensity).

Shadows: one `CascadedShadowGenerator` (2 cascades, 2048, `autoCalcDepthBounds`, `shadowMaxZ ≈ 60m`, PCF medium); casters = entities + walls/props within ~50m. **Low tier:** generator off → thin-instanced **blob shadow discs** (also always used under flying mounts as the ground reference). Interiors: roof geometry occludes the sun; LightPool grants nearest ≤8 point lights (campfire, lava, lit night windows, muzzle blips, electric zaps).

### 3.9 Post-FX stack

`DefaultRenderingPipeline` (HDR):
- **bloom** (threshold 0.8, weight keyframed 0.15 day → 0.45 night/blood-moon, kernel 64) — sells emissives (lava, rarity glow, muzzle, mythic pets);
- **imageProcessing** — exposure/contrast keyframed per phase; **vignette** 1.2 day → 2.8 night; **ColorCurves** per phase (no LUT *files* → keeps zero-asset identity; optional baked LUT PNGs later);
- **grain** ~8 animated; **chromaticAberration** ~1.5 baseline, pulsed on hurt/blood-moon onset; **sharpen** ~0.2;
- **FXAA** (WebGL2) / `MSAA samples=4` (WebGPU);
- `SSAO2RenderingPipeline` @0.5 ratio (~0.6m radius) — grounding for low-poly; off on Low tier;
- **DOF** off in gameplay; enabled as a cinematic beat (focal lock on player + slight push-in) while the Encounter modal is open and on title/death screens.

Camera shake / zoom-punch / hitstop = FollowRig effects from the same sim events; hitstop = sim timescale 0 for N ms (identical mechanic).

### 3.10 Weather, particles, disasters

`GPUParticleSystem` with automatic CPU `ParticleSystem` fallback: rain (4–6k, camera-following emit box, splash sub-emitter off on Low), storm (rain + directional intensity + lightning flashes + existing thunder synth), fog (scene fog + ground mist sheet), ash/embers (volcanic/wildfire), snow if present. Disaster live phases: **earthquake** = camera trauma + dust + crack decals; **wildfire** = spreading flame patches + scorched re-mesh on scar; **flood** = animated water plane rising over Mud fringe; **eruption** = ballistic lava bombs + glow column; **lightning** = strike beam + flash + scorch decal. Scars re-derive terrain through `applyScars` → chunk remesh on scar/heal day boundaries (sim event).

### 3.11 Performance budget (60 fps on Intel Iris Xe / M1 Air, WebGL2)

| Budget | Target | Mechanism |
|---|---|---|
| Draw calls | ≤300 (typ. ~200) | merged chunk meshes (4/chunk), thin instances, one GUI ADT |
| Triangles | ≤1.2M typical | greedy meshing, prop budgets, fog at 90–120m |
| Skinned actors | ≤60 full; half-rate anim >30m; VAT crowd for hordes | AnimController LOD |
| Particles | ≤20k GPU / 4k CPU | tiered presets |
| Frame CPU | sim ≤3ms, meshing ≤4ms amortized | fixed-step sim + work queue |
| Shadows | 1 CSM 2×2048; Low: blob discs | quality tiers |
| Boot | first-interactive <4s cold, zero-asset | blockout-first; GLBs stream after |

**Quality tiers** auto-probed at boot + override in settings: **High** (WebGPU/discrete: MSAA4, SSAO, CSM 2048, GPU particles, snapshot), **Medium** (WebGL2 iGPU: FXAA, SSAO off, CSM 1024×2), **Low/mobile** (blob shadows, bloom-only post, half particles, radius-capped fog draw distance).

---

## 4. Local full-stack architecture (offline-only)

"Full-stack" here does **not** mean a server tier. The locked scope is offline-only single-player: **no backend, no database, no auth, no networking, no cloud**. The complete stack is local and shippable as a static bundle. This section defines every tier and explicitly resolves the backend sub-questions so nothing is left implicit.

### 4.1 The stack (every tier is local)

```
┌── Distribution ──────────────────────────────────────────────┐
│  Static CDN: Vercel (primary) + GitHub Pages.  Installable PWA │
├── Client (browser) ──────────────────────────────────────────┤
│  Presentation:  Babylon.js 8 canvas  +  DOM UI overlay        │
│  Simulation:    /src/sim  (authoritative game logic, 60Hz)    │
│  Inference:     GM brains  ←─ the only "backend-like" tier,    │
│                 and it runs locally (see §4.5)                 │
│  Persistence:   IndexedDB (saves)  +  Cache Storage (PWA)      │
└──────────────────────────────────────────────────────────────┘
        No application server. No network call is ever required.
```

### 4.2 Backend questions — explicitly answered

| Concern | Decision | Rationale |
|---|---|---|
| Database | **None** — local IndexedDB only | Single-player; no shared or server-authoritative state exists |
| Auth / accounts | **None** | Saves are local and user-owned; nothing to gate |
| State sync / netcode / multiplayer | **None** (out of scope) | The AI-GM **pauses the world per player** for encounters — multiplayer would require a fundamentally different GM design; parked as a future product, not this transformation |
| Server APIs | **None** | The only "API" is the **local** LLM HTTP endpoint (Ollama) behind the existing `/ollama` Vite dev proxy, accessed through the `LLMProvider` interface |
| Cloud saves | **None** | Replaced by manual **export/import** save files (§4.3) |
| Telemetry/analytics | **None** | Preserves the offline, private, airplane-mode identity |

### 4.3 Persistence evolution

- **Schema frozen:** `outbreak_save_v4` stays byte-compatible (constitution rule 3, §2) — the same file loads in both the Phaser and Babylon builds throughout migration.
- **Store moves to IndexedDB** via `idb-keyval`: keys `outbreak/slot/<0..3>` (multi-slot saves) + `outbreak/meta`. Async, multi-MB quota (vs the ~5MB localStorage cap), and headroom for future replay tapes.
- **One-time migration:** on first 3D boot, if `localStorage["outbreak_save_v4"]` exists and IDB slot 0 is empty, copy it across; **keep the localStorage copy** as rollback and to keep feeding the Phaser build during the migration era (one save serves both).
- **Export / import:** JSON file download + file-picker upload, validated through the **existing `loadGame` clamp/`isValidState` path** so a hand-edited or stale file can never corrupt a run.
- **Run history ("Legacy" screen):** small store of past death summaries — stretch, post-parity.

### 4.4 Offline & PWA

- `vite-plugin-pwa` (Workbox, `registerType: "prompt"`): precache the app shell + tile-atlas code + blockout path so the game is **installable and fully playable with zero network and zero downloaded art**.
- Runtime `CacheFirst` for the optional GLB asset pack and WebLLM model shards; a settings toggle **"Download offline pack"** caches the full ~25MB pack on demand. WebLLM already persists model shards in IndexedDB.
- Net effect: today's instant-boot, airplane-mode identity is preserved — assets only ever *upgrade* the experience.

### 4.5 Inference backend (local, unchanged)

The GM is the only backend-shaped tier, and it stays exactly as audited: the 4-brain fallback **WebLLM (in-browser WebGPU) → Ollama (`/ollama` proxy) → Claude (stub) → MockProvider (deterministic, in-process)**, with the 45s timeout, retry-once-on-parse, JSON-schema constraint, and `sanitizeGM` clamping. These are pure modules ported with no edits. **One new 3D concern:** Babylon and WebLLM share the GPU, so the render loop is capped to 30fps while inference runs (which doubles as the encounter's cinematic slow-down) — verified at M5. The Ollama dev/preview proxy in `vite.config.ts` is untouched.

### 4.6 Hosting & deployment

- Static output to **Vercel** (primary) and **GitHub Pages** (`GH_PAGES` base path), unchanged from today.
- CI (GitHub Actions) build → deploy, **plus** new gates: bundle-size + asset-size checks (Risks §10, rows 7 & 12) and Playwright smoke on both render backends (M7).
- No serverless functions and **no secrets in the bundle** (an Anthropic key would live only in the optional, out-of-scope Claude proxy — server-side, never client).

---

## 5. Asset pipeline

**Doctrine — the game boots fully playable with an empty asset directory.** Every renderable has a procedural **blockout** fallback (primitives colored from the existing LookSpec/prop palettes, animated by the ported gait math). GLBs are progressive enhancement resolved through a manifest — today's generated-texture + Replicate lane, lifted to 3D.

- **Sources (CC0, repo-redistributable):** **Kenney** (City / Suburban / Survival / Furniture / Car / Nature / Graveyard / Food kits), **Quaternius** (Ultimate Animated Animals; Monsters/Dragons for mythic pets; Modular characters + **Universal Animation Library** shared-rig clips), **KayKit** (characters + animations). Poly Pizza as CC0 index. **Avoid shipping Mixamo rigs in-repo** (redistribution licensing is murky; CC0 libraries cover the need).
- **Conventions:** GLB only; 1u = 1m; Y-up, +Z forward; origin at feet/base; shared humanoid bone names; one palette texture ≤1024² per pack; names `actor_*.glb`, `prop_*.glb`, `anims_humanoid.glb`.
- **Manifest:** `public/assets3d/manifest.json` → `{ id: { url, scale, yawOffset, sockets, lod? } }`. `AssetRegistry.resolve(id)`: manifest hit → `SceneLoader.ImportMeshAsync` (cached container, instantiated) → 404/parse fail → `blockout.ts`. Console "asset coverage" report (mirrors the current generatedKeys flow).
- **AI-3D lane (optional, mirrors `tools/gen-assets.ts`):** `tools/gen-3d.ts` → Meshy or Tripo text/image-to-3D → GLB → `@gltf-transform/cli optimize` (prune/dedup/weld/quantize + meshopt) → manifest entry. Curated; never a runtime dependency.
- **Compression:** **meshopt** (`EXT_meshopt_compression`; decoder ~35KB **self-hosted** for offline) over Draco; textures mostly tiny palette PNGs; any large texture → KTX2/UASTC with self-hosted Basis transcoder.
- **Budgets:** player ≤8k tris; zombies ≤5k; animals ≤3k; mythics ≤10k; props ≤800; vehicles ≤6k; building modules ≤1.2k. **Payload:** core app ≤3.5MB gz; full asset pack ≤25MB; PWA precache ≤30MB; zero-asset mode ≈ today's footprint.

---

## 6. Complete redesign for 3D

### 6.1 Camera

`ArcRotateCamera`, smart-follow: target = lerped `TransformNode` proxy at the player's visual position (lerp 0.12 ≈ today). Default **`alpha = −π/2` (north-up, minimap-consistent)**, Q/E or middle-drag to rotate (optional snap-back); **`beta ≈ 0.55–0.65 rad` (~55–60° look-down)** preserves top-down legibility of aggro/noise radii; radius 16m, wheel-clamped 9–24m; `lowerBetaLimit 0.45`, `upperBetaLimit 0.95`. Spring arm: ray from target to camera vs wall meshes shortens radius smoothly (rarely fires thanks to roof cutaway). **Mouse aim = ray ∩ plane y = playerVisualY** (analytic, not mesh picking → stable & free) → world x/z → sim pixels → exact `aimAngle()` semantics. zoom-punch → radius pulse; hurt-pulse → chromatic + vignette; hitstop unchanged. Encounter beat: DOF on + slow 6% push-in. Over-shoulder mode: deferred post-parity (flagged stretch).

### 6.2 Controls

Identical bindings (WASD/arrows; Shift sprint; E interact; R reload; 1–5 quickslots; weapon cycle; B build; F mount/flight…) routed through `sim/input.ts` intents instead of Phaser keys. Movement stays screen-relative = world-relative while `alpha` is locked; if the player rotates the camera, movement rotates with it (the one genuinely new input rule, gated behind that feature). Touch: existing DOM virtual joystick + buttons reused **verbatim** (renderer-independent); fire button keeps nearest-enemy auto-aim; Low tier default on mobile.

### 6.3 UI / UX

- **DOM modals survive untouched** (Encounter, Loot, Craft, Trade, Storage, Pet, Reader, CharacterCreate, LootReveal) — they already float over the canvas; an M6 restyle adds typography, blur backdrop, controller-style focus.
- **HUD: rewrite Phaser-drawn HUD as a DOM overlay** (same data, CSS-animated bars, status icons) — crisper, renderer-independent, themeable.
- **Damage numbers / float text / hints / progress rings:** pooled `BABYLON.GUI` TextBlocks/Ellipses linked to world positions (≤48 live).
- **Minimap: port to a 2D `<canvas>` overlay** drawing the same chunk-color + fog-of-war data from `ChunkManager`/`discovered` — identical feature, zero render-target cost. (RTT top-down camera rejected on cost/benefit; revisit post-ship.)
- **Diegetic touches (M6):** world-space search progress ring, base siege HP bars over placeables, blood-moon sky as its own warning (banner kept).

### 6.4 Sound

`engine/audio.ts` (synthesized, renderer-free) is **kept as the audio identity**. `audio3d.ts` adds a Web Audio **`PannerNode`** (equalpower; optional HRTF toggle) per positioned one-shot, with the `AudioListener` synced to the camera each frame; the existing `SpatialOpts { pan, dist }` API is reimplemented on top so **every current call site works unchanged**. Ambient beds stay stereo (non-positional). Optional later lane: sample-based layers behind the same API with synth fallback (mirrors the asset-manifest doctrine). Pet voices, rarity stingers, heartbeat: untouched.

### 6.5 Art direction (what "cinematic lighting" means concretely)

- **Palette:** keep the muted survival base (the atlas port guarantees continuity); push saturation into *light*, not albedo — warm 2600K campfires/dusk vs cool 12000K night ambient; blood moon = red key + crushed shadows.
- **Silhouette rules:** every zombie archetype readable in shadow at 20m (bone-scale morphs guarantee it); props chunky, ≥8cm min feature; no detail below ~4cm (texel density irrelevant under palette shading).
- **Per-phase signatures:** dawn = low-sun god-rays + ground mist + long shadows; day = honest neutral (clarity is the AAA move at noon); dusk = orange/teal split; night = blue-black + pooled warm lights + vignette; storm = desaturated + strobe.
- **Per-biome grade nudges (ColorCurves deltas):** volcanic = ember-warm shadows; lake/coast = lifted blues; urban = sodium-vapor night tint; rural = green-gold days.

---

## 7. Migration mapping (feature → 3D)

Legend — **Risk** L/M/H · **Phase** M0–M8 · "sim" = `/src/sim` · "view" = `/src/render3d` · "**unchanged**" = pure-logic module ported with no edits.

### 6.1 World, terrain, streaming

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| 40×40 chunk world, seeded gen | `worldgen.ts` + `world/*` pure | **unchanged** | L | — |
| Chunk streaming 5×5 ring | `ChunkManager` + Phaser view | `ChunkManager` kept (de-Phasered); `ChunkViewManager` builds/disposes meshes on same events | M | M2 |
| Tile rendering (27 tiles) | generated tileset + tilemap layer | greedy-meshed ground + procedural DynamicTexture atlas (port `textures.ts`) | M | M2 |
| Solid-tile collision + process gates | Phaser colliders + `ColliderSpec.process` | `sim/physics.ts` AABB slide + same per-tile gates | **H** | M1 |
| Water / lava animated | fragment shaders on layer | NodeMaterial planes (port shader math) + foam attribute | M | M2 |
| Disaster scars overlay | `applyScars` on generate | **unchanged**; chunk remesh event on scar/heal | L | M2/M4 |
| Ground micro-decor + prop sway | hash-scattered images + sway pass | thin instances + sway MaterialPlugin (same `posPhase`/gust math) | L | M2 |
| Landmarks / set-pieces + labels | anchor prop + Phaser text | prop meshes + pooled GUI linked labels | L | M2 |
| Building signage | Phaser text per notable bldg | same GUI label pool + `FILLER_LABELS` filter | L | M2 |
| Fog-of-war discovery | `discoverAround` → `discovered` | sim system **unchanged**; minimap canvas reads it | L | M2 |

### 6.2 Player, locomotion, mounts, vehicles

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| 8-dir WASD + sprint + stamina | `Player.ts` arcade velocity | PlayerSim (same speeds/mults) + PlayerView skeletal/blockout | M | M1/M3 |
| Walk gait / bob / lean / idle breathe | math frame swaps + scaleY | clips + `gaitDriver` additive bone layer (same math) | M | M3 |
| Jacket color appearance | tinted frame copies | jacket material slot tint | L | M3 |
| Terrain speed (water/mud/lava) | `terrainMult` underfoot | identical in sim tick | L | M1 |
| Burning / wet status + FX | timers + overlay FX | identical timers; flame/drip particles + screen-edge FX | L | M3 |
| Pets riding (ground) | mount texture lock + rideTick gait | rider parented to saddle bone; gait phase drives posting | M | M4 |
| Flying mounts (takeoff/land/stamina) | fly-over gate + landing search | same sim rules; render-only altitude channel + blob shadow + altitude ring | **H** | M4 |
| Swimming mounts | water-tile process gate | same gate in `sim/physics`; swim anim + ripples | M | M4 |
| Vehicles (3 kinds, repair/fuel, run-over) | sprites + driveTick + overlap kills | VehicleSim (same math) + meshes, wheel spin, night headlights, overlap-knockdown | M | M4 |
| Vehicle reconcile from seed | `computeWantedVehicles` | **unchanged** (sim) | L | M4 |

### 6.3 Combat

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| 41 melee + swing styles | swing-arc graphics + cone math | identical cone math in sim; SwingTrail ribbon per style + weapon mesh in hand socket | M | M3 |
| 60+ ranged + ammo/mag/reload | arcade projectile sprites | swept-segment projectiles in sim; tracer billboards, MuzzleFlash + light blip; same spread/pellets | M | M3 |
| 20 weapon ability types | `combat.ts` pure | **unchanged**; per-ability VFX hooks (explosion burst + decal + shake) | L | M3 |
| Armor body/head | `combat.ts` pure | **unchanged**; armor attachment meshes (visual) | L | M3 |
| Damage numbers / hitstop / zoom-punch / hurt-pulse | float text + timeScale + camera | GUI pool; sim timescale; FollowRig pulses | L | M3 |
| Blood decals (80 cap) + casings | pooled images | thin-instanced ground quads (procedural splat texture) + casing instances with arc-settle | L | M3 |
| Corpses + fade + feeding | texture swap + sweep | death anim → static pose + dissolve fade; feeding loops eat clip | L | M3 |
| Enemy projectiles / explosions | sprites | same sim traces; acid glob particles, toxic cloud = particle sphere (same damage tick) | M | M3 |

### 6.4 Enemies & animals

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| 100+ zombie defs, distinct looks | procedural per-def sprites | variety system §3.6 (12 archetype meshes × material/bone-scale/attachment from same catalog) | **H** | M3 |
| Movement archetypes ×7 | per-archetype steering + gait | same steering in EnemySim; clip + gaitDriver per archetype | M | M3 |
| Traits (spitter/screamer/bloater/flamer/electric/toxic/armored/grabber) | `enemySpecials` + onDeath | **unchanged** logic; per-trait VFX (zap beam, scream ring, bloater burst) | M | M3 |
| AI states idle→alert→aggro→feeding→fleeing + noise | per-enemy scene update | EnemySim state machine (verbatim); pixel noise radii unchanged | **H** | M1/M3 |
| Hordes, ambient cadence, blood-moon, enemy cap | scene timers | SpawnSystem (verbatim) | M | M1 |
| Bosses | scaled defs | **unchanged**; scale + unique attachments + intro camera nudge | L | M3 |
| Animals + flee AI + hunting | sprites + scene logic | AnimalSim + quadruped rigs; same hunt ranges | L | M3 |

### 6.5 NPCs, pets, factions

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| 3 factions, standing, tiers | `npcs.ts` pure | **unchanged** | L | — |
| Trading offers / modal | DOM TradeModal | **unchanged** DOM; NPC turns to face player | L | M4 |
| Recruit ≤2 companions + combat | scene `updateNpcs` | NpcSim follow/assist (same ranges) | M | M4 |
| Living camps | `reconcileCampNpcs` | CampSystem (sim) + tent/fire props | M | M4 |
| 20+ pets, taming, bond, feeding, auras | `pets.ts` pure + scene timers | **unchanged** logic; TameSystem; aura = ground disc / light = pooled point light; mythic dressing; voices kept | M | M4 |
| Wild pet spawns / dens | scene checks | sim system **unchanged** | L | M4 |

### 6.6 Survival & world simulation

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| Survival stats + decay tick | `survival.ts` pure | **unchanged** | L | — |
| Day/night 4-phase + keyframed light + `clockMs` | `advanceClock` + overlay | ClockSystem (sim) + TimeOfDayDirector (§3.8) | M | M2 |
| Weather (5 kinds) | `weather.ts` + overlays | **unchanged** logic; WeatherFX particles/fog/wind | M | M4 |
| Blood moon 6%/night | scene + tint | **unchanged** roll; red lighting program + spawn change | L | M4 |
| Disasters (5 kinds, telegraph→active→scar) | `disasters.ts` + scene VFX | DisasterSystem (verbatim timers) + DisasterFX (§3.10); quake camera trauma | **H** | M4 |
| World events ×10 (beacons, drops, traders, raiders, flyover) | `worldEvents.ts` + scene spawns | EventSystem **unchanged**; beacon smoke/flare columns over fog; flyover sound pan + light sweep | M | M4 |
| Building moods (boarded/infested/trapped) | deterministic rolls + overlays | **unchanged** rolls; plank meshes / webs / trap props | L | M4 |
| Farming (5 crops) | `farming.ts` + plot sprites | **unchanged** logic; tilled decal + growth-stage plant instances | L | M4 |
| Base claim + 7 placeables + siege + storage | `base.ts` + scene siege tick | **unchanged**; placeable meshes w/ damage states; SiegeSystem | M | M4 |
| Scavenging (14 kinds, hold-to-search) | scene timers + tinted sprites | SearchSystem **unchanged**; world-space ring; gray material swap | L | M3 |
| Loot tables / rarities / luck / chests / locks | `items/*` pure + chest sprites | **unchanged**; chest meshes + padlock; lid-open anim | L | M3 |
| Loot reveal ceremony + stingers | DOM LootReveal + audio | **unchanged** DOM + audio; light pulse + camera nudge on epic+ | L | M5 |
| Drops + magnet pickup + rarity glow | sprites + glow | drop meshes/billboards + emissive rarity disc (bloom-lit); same magnet radii | L | M3 |
| Crafting / stations / skills / perks / difficulty / backgrounds | pure modules + DOM modals | **unchanged**; `stationsNear` from sim placeables | L | — |
| Objectives / opening arc / notes / stash maps | pure + scene triggers | ObjectiveSystem; reveal pins **unchanged**; buried chest = mound prop | L | M4 |
| Death → summary → new seed | GameOverScene | DOM death screen + desaturate grade pull | L | M5 |

### 6.7 GM, UI, meta

| Feature | Current | 3D implementation | Risk | Phase |
|---|---|---|---|---|
| GM 4 brains, timeout/retry/fallback, schema, sanitize | `/src/ai` pure | **unchanged** | L | — |
| Encounter modal (free-text + 4 choices, typewriter, banners) | DOM EncounterModal | **unchanged** DOM; camera DOF beat; 30fps render cap while inferring | M | M5 |
| Intent choreography (dash/rummage/crouch…) | `playIntent` in scene | IntentSystem (sim actions) + view reactions, 1:1 | M | M5 |
| HUD / HotBar | Phaser-drawn | DOM overlay rewrite, same data | M | M5 |
| Minimap + fog | Phaser canvas | 2D canvas overlay, same data | L | M2 |
| Touch controls | DOM joystick/buttons | kept verbatim → sim input | M | M5 |
| Char create / main menu / title embers | DOM + Phaser scenes | DOM kept; title = 3D diorama chunk + GPU embers + DOF dolly | L | M5/M6 |
| Save v4 localStorage | `GameState.ts` | schema frozen; IDB slots + export/import (§4) | M | M5 |
| Synthesized audio (all) | `audio.ts` | kept + PannerNode positional adapter | L | M6 |

---

## 8. Phased roadmap

Sizes **S/M/L/XL** (relative effort, not calendar). Green-bar rule per milestone: `npm test` (29+ suites) + `tsc --noEmit` + `npm run build` pass, **Phaser build still ships** (until M8), Babylon entry behind `/play3d.html` + `?renderer=3d`.

| # | Milestone | Size | Deliverables | Exit criteria (DoD) |
|---|---|---|---|---|
| **M0** | **Spike: Babylon boots the world** | M | bootstrap (WebGPU→WebGL2), `space.ts`, throwaway chunk mesher on real `generateChunk`, camera rig, capsule player on ported tile collision, perf-probe scene (25 chunks blockout + 60 capsule actors) | 60fps on an Intel iGPU laptop (Medium) **and** an M1; both backends verified; coordinate round-trip test green; **written go/no-go on budgets** |
| **M1** | **Sim extraction (the strangler seam)** | XL | `/src/sim`: `physics.ts`, events, input, entity sims, ~14 systems extracted **domain-by-domain with WorldScene delegating** (Phaser green after each); golden-replay harness (input tapes → position/state traces); new sim unit tests | Phaser build plays identically (per-domain parity checklist); WorldScene reduced to bindings; replay traces stable; all 29 + new tests green |
| **M2** | **Walkable 3D world** | L | ChunkMesher (ground/walls/roofs/water/lava), atlas port, PropInstancer + sway, streaming, TimeOfDayDirector + CSM + post v1, fog, labels, minimap canvas, roof cutaway | Walk the full world in 3D @60fps Medium; enter interiors with cutaway; day/night/fog cycle; **same save loads in both builds, player in same spot** |
| **M3** | **Entities & combat parity** | XL | ActorFactory + variety system + blockout actors, AnimController + gaitDriver, Enemy/Animal sims bound, melee/ranged/projectiles/abilities, drops/chests/scavenging, decals/casings/trails/damage numbers, corpses | Kill / be-killed parity vs Phaser on same seed/save; all 100+ defs spawn distinct (automated screenshot grid); combat-feel checklist signed |
| **M4** | **Systems parity (the long tail)** | XL | vehicles; pets/taming/riding/**flying**/swimming; NPCs/trade/recruit/camps; farming; base/siege/storage; weather; blood moon; disasters + scars; world events/beacons; moods; objectives/notes/stash maps | Full feature-matrix demo passes in 3D; disaster + blood-moon + horde stress @60fps Medium; flying-mount readability check |
| **M5** | **GM, UI, meta loop** | M | EncounterModal hookup + intent choreography + cinematic beat; HUD DOM rewrite; menus/char-create/death; touch input; IDB persistence + slots + export/import | Complete run loop (create→play→encounters→death→new run) entirely in 3D incl. mobile touch; WebLLM/Ollama/Mock all verified under Babylon; save round-trips both builds |
| **M6** | **Polish: audio, VFX, lighting, art** | L | positional audio adapter; per-biome grades; CC0 GLB pack integration via manifest; title diorama; loot-ceremony flourish; DOM restyle; optional visual-only terrain height | "Feel" checklist (every item in §1.3 presentation list) signed; **zero-asset mode still fully playable and good-looking** |
| **M7** | **Perf + QA parity certification** | L | quality tiers; VAT crowds if horde perf demands; Playwright smoke + screenshot baselines (boot/world/combat/modals); low-end + mobile passes; payload audit; PWA | 60fps Medium on iGPU; 30fps floor on mid phone/Low; bundle budgets met; **signed parity certificate: every §7 row demonstrated** |
| **M8** | **Cutover & ship** | S | main3d → `/`; delete `/src/engine` Phaser + `/src/scenes` + phaser dep; README/CLAUDE.md update; Vercel/Pages deploy; PWA on | `npm run build` ships Babylon-only; deps show no phaser; offline install verified; **same-save continuity from last Phaser release confirmed** |

**Sequencing:** M1 is the critical path and the *only* phase where the Phaser build changes. M2 can begin against early M1 outputs (chunks/physics) in parallel. M6 asset work can start any time after M3 fixes actor conventions.

---

## 9. Tech stack

| Package | Version | Role | Notes |
|---|---|---|---|
| `@babylonjs/core` | ^8.x | engine, CSM, DefaultRenderingPipeline, SSAO2, GPU particles, thin instances, NodeMaterial, VAT | ES-module subpath imports only (tree-shake ~1.1–1.6MB gz); **no Inspector in prod** |
| `@babylonjs/loaders` | ^8.x | glTF/GLB | register glTF loader only |
| `@babylonjs/gui` | ^8.x | damage numbers, labels, rings | one fullscreen ADT |
| meshopt decoder (self-hosted js+wasm) | latest | `EXT_meshopt_compression` decode | `MeshoptCompression.Configuration.decoder.url` → local (~35KB) |
| Basis/KTX2 transcoder (self-hosted) | latest | KTX2 textures (only if used) | `KhronosTextureContainer2.URLConfig` local |
| `@gltf-transform/cli` (dev) | ^4.x | asset post: optimize/quantize/meshopt/ktx | tools pipeline + CI size check on `/assets3d` |
| `idb-keyval` | ^6.x | IndexedDB save slots | ~600B |
| `vite-plugin-pwa` (dev) | ^0.20+ | offline install, precache | `registerType: "prompt"` |
| `@playwright/test` (dev) | ^1.4x | boot/visual smoke (both backends) | screenshot baselines per milestone |
| `@mlc-ai/web-llm` | ^0.2.84 (kept) | in-browser GM | unchanged |
| esbuild / tsx / typescript / vite | kept | build + test | test runner unchanged; vite 6 bump only at M8 |
| `replicate`, `sharp` (dev) | kept | 2D gen lane; + new `tools/gen-3d.ts` (Meshy/Tripo) | optional lane |
| **Removed at M8** | — | `phaser` ^3.80.1; `/src/engine` Phaser files; `/src/scenes` | `anim.ts` + `audio.ts` kept (relocated) |

**Explicitly rejected:** `@babylonjs/havok` (§3.4), Babylon navigation/Recast plugin (§3.4), Babylon AudioEngine v2 (our synth layer is proven and identity-bearing), React/UI frameworks (DOM modals suffice).

---

## 10. Risks & trade-offs

| # | Risk | Severity | Prevention / mitigation |
|---|---|---|---|
| 1 | **WorldScene decomposition breaks subtle behavior** (242KB, ~270 entangled methods) | Critical | M1 extracts domain-at-a-time **with Phaser delegation kept green after each step**; golden-replay tapes recorded on frozen Phaser *before* extraction; per-domain manual parity checklist; feature freeze on the Phaser path |
| 2 | **Save incompatibility** between builds | Critical | Schema frozen at v4; fixture-save round-trip test in CI; dual-build same-save QA every milestone; IDB migration keeps the localStorage copy as rollback |
| 3 | Physics-feel drift (doorways, knockback, run-over, mount gates) | High | Hand-ported Arcade semantics + characterization tests vs golden traces; identical constants; **no physics engine** |
| 4 | Low-end perf (iGPU laptops, phones) | High | M0 budget probe is a **go/no-go gate**; instancing-first design; quality tiers; VAT crowd escape hatch; fog-bounded draw distance; Playwright perf smoke on a throttled profile |
| 5 | Scope creep mid-port | High | **Parity-first gate: nothing new before the M7 certificate**; stretch items explicitly parked (over-shoulder cam, RTT minimap, sample audio, flow fields, run-history Legacy screen) |
| 6 | WebGPU unavailability / regressions (Safari, older Chrome) | Medium | **WebGL2 is the primary *tested* path**; WebGPU is enhancement only (MSAA/snapshot); CI smoke runs WebGL2; feature-flag matrix |
| 7 | Asset bloat vs offline identity | Medium | Blockout-always-playable doctrine; pack ≤25MB optional download; CI size gate on `/assets3d`; meshopt + palette textures |
| 8 | Interior/roof occlusion edge cases (overlapping buildings, thresholds, set-pieces) | Medium | Single dither-cutaway shader (no per-building state machine); `buildingAt()` is the sole authority; camera spring-arm fallback; QA script visiting every building type + set-piece |
| 9 | GM encounters in 3D: GPU contention with WebLLM, focus over canvas, pacing | Medium | 30fps render cap during inference; modal DOM unchanged (focus proven); encounter camera beat is purely additive & disableable |
| 10 | Flying mounts: altitude readability, aim/trample correctness | Medium | Sim rules untouched (altitude render-only); blob shadow + altitude ring anchor ground truth; aim plane stays at ground Y; dedicated M4 exit check |
| 11 | Animation retarget / rig mismatch across sourced packs | Medium | Single skeleton convention enforced by an asset-lint script; gaitDriver procedural layer means missing/mismatched clips degrade to the current math feel, **never a T-pose** |
| 12 | Babylon bundle size erodes load/offline budget | Medium | Subpath imports + `vite build` size CI gate (core ≤3.5MB gz); no Inspector/debug layers in prod |
| 13 | Mobile/touch regressions (iOS Safari WebGL2, thermal) | Medium | Touch DOM layer reused verbatim; Low tier default on mobile; **early M2 device check, not late** |
| 14 | Fixed-step sim changes feel vs variable-delta Phaser | Low | Declared decision; 60Hz matches typical Phaser cadence; golden tapes quantify any drift before cutover |

---

## 11. Critical files (implementation anchors)

- `src/scenes/WorldScene.ts` — the 242KB orchestrator to strangler-extract into `/src/sim` (M1, critical path).
- `src/game/world/ChunkManager.ts` — terrain/streaming source of truth; de-Phasered, shared by sim + `ChunkViewManager`.
- `src/engine/ChunkRenderer.ts` — the Phaser chunk view + `ColliderSpec`/process-gate contract that `sim/physics.ts` and the 3D ChunkMesher must reproduce exactly.
- `src/engine/anim.ts` — dependency-free gait math, reused verbatim as the 3D `gaitDriver` (the "feel" carrier).
- `src/engine/audio.ts` — synthesized Web Audio, kept and wrapped by `audio3d.ts` for positional sound.
- `src/shared/contracts.ts` + `src/game/GameState.ts` — the frozen `outbreak_save_v4` + GM schema anchoring 100% parity across both renderers.

---

*End of master plan. Build in order (§8); keep the green bar; the save is sacred; the sim is the authority.*
