import Phaser from "phaser";
import type { DisasterZone, FarmPlot, GameState, GMResponse, KnownLocation, Placeable, Spawn, TurnInput, Vehicle } from "../shared/contracts";
import { Tile, type Building } from "../game/worldgen";
import { CROPS, SEED_TO_CROP, growPlots, plotAt, plotStage, tillPlot } from "../game/farming";
import {
  chunkVehicles,
  fitPart,
  isDrivable,
  isRepaired,
  nextNeed,
  resolveVehicle,
  upsertVehicle,
  vehicleChunkOf,
  vehicleDef,
  FUEL_MAX,
  FUEL_PER_CAN,
} from "../game/vehicles";
import {
  BUILD_ORDER,
  buildPlaceable,
  canAfford,
  claimBase,
  damagePlaceable,
  isBaseClaimed,
  placeableAt,
  placeableDef,
} from "../game/base";
import { compassDir, nextEventDelayMs, rollWorldEvent, type WorldEventKind } from "../game/worldEvents";
import {
  acceptOffer,
  addStanding,
  CAMP_LANDMARKS,
  campRoster,
  canRecruit,
  companionCount,
  factionForBiome,
  generateOffers,
  getStanding,
  MAX_COMPANIONS,
  npcGoneFlag,
  npcName,
  payRecruit,
  recruitCost,
  rollTier,
  tierMeta,
  type RecruitCost,
  type TradeOffer,
} from "../game/npcs";
import { clearedFlag, effectiveState, priedFlag, priedLootBonus, rescuedFlag, type BuildingMood } from "../game/world/buildingStates";
import { isWet, rollWeather } from "../game/weather";
import { addXp, SKILL_NAMES, type SkillId } from "../game/skills";
import { propKey } from "../engine/propSprites";
import { randomSeed, liveRng, createRng } from "../game/rng";
import {
  clampStat,
  clearSave,
  isDead,
  loadGame,
  newGame,
  pushRecentEvent,
  saveGame,
} from "../game/GameState";
import { applyDecay, ratesFor, ignitePlayer, soakPlayer, tickBurning, isBurning } from "../game/survival";
import { terrainEffect } from "../game/terrain";
import { scheduleDisaster, disasterPhase, intensityAt, inZone, type LiveDisaster } from "../game/disasters";
import { ammoMult, damageTakenMult, lootLuck, sprintDrainMult, type DamageKind } from "../game/perks";
import { addItem, ammoReserve, armorDefensePct, autoEquip, equipWeapon, equippedRangedDef, hasItem, quickUseItems, reloadEquipped, removeItem, useConsumable, weaponsInBag } from "../game/inventory";
import type { WeaponDef } from "../game/items/types";
import { meleeOutcome, shotOutcome, type MeleeHit, type ShotPlan } from "../game/combat";
import { rollLoot } from "../game/items/lootTables";
import { defOf } from "../game/items/catalog";
import { RARITY_META, rarityGlowSpec } from "../game/items/rarity";
import {
  CHEST_CLOSED,
  CHEST_OPEN,
  heldKey,
  iconKey,
  PADLOCK,
  PROJ_ARROW,
  PROJ_BULLET,
  PROJ_PELLET,
  PROJ_ROCKET,
} from "../engine/icons";
import { noteText, parseStashFlag, rollReadable, rollStashSpot, stashCount, stashFlag } from "../game/notes";
import { ReaderModal } from "../ui/ReaderModal";
import { arcSafehouse, currentStep, notifyObjective, objectiveLabel, type ObjectiveEvent } from "../game/objectives";
import { rarityRank } from "../game/items/rarity";
import { BIOMES, type BiomeId } from "../game/world/biomes";
import { applyOutcome, type ApplyResult } from "../game/outcomes";
import { classifyIntent, type Intent } from "../game/intent";
import { nextAmbientDelayMs } from "../game/encounters";
import { runTurn, getActiveBrain, consumeFellBack } from "../ai/gameMaster";
import { ChunkManager, SEARCHED_TINT, type ActiveChest, type ActiveSearchable } from "../game/world/ChunkManager";
import { SEARCHABLE_PROPS, CORPSE_BODY, SEARCH_NOISE, isPropSearched, markSearched, playsDead, type SearchableDef } from "../game/scavenge";
import type { ColliderSpec } from "../engine/ChunkRenderer";
import { AnimatedTerrain } from "../engine/AnimatedTerrain";
import { Player } from "../engine/Player";
import { PLAYER_KEY } from "../engine/textures";
import { Enemy } from "../engine/Enemy";
import { Animal, ANIMALS, type AnimalKind } from "../engine/Animal";
import { Npc } from "../engine/Npc";
import type { ZombieDef } from "../game/enemies/types";
import { rollAmbientUndead, rollZombie, resetSpawnVariety } from "../game/enemies/spawnTable";
import { getZombie } from "../game/enemies/catalog";
import { setupCamera } from "../engine/Camera";
import { HUD } from "../ui/HUD";
import { HotBar } from "../ui/HotBar";
import { EncounterModal } from "../ui/EncounterModal";
import { LootModal } from "../ui/LootModal";
import { CraftModal } from "../ui/CraftModal";
import { StorageModal } from "../ui/StorageModal";
import { Minimap } from "../ui/Minimap";
import { TradeModal } from "../ui/TradeModal";
import { craft } from "../game/crafting";
import { TouchControls } from "../ui/TouchControls";
import { sfx } from "../engine/audio";
import { bloodBurst, bloodDecal, splatHit, bloodTrail, gibs, resetFx, dustPuff, deathFade, spawnPopIn, meleeArc, makeGlow, makeDropGlow, fxTexFor, type DropGlow, startBurning, stopBurning, steamPuff, splashPuff, emberPuff, FX_DUST, FX_GLOW, FX_VIGNETTE } from "../engine/fx";
import { TILE_SIZE, CHUNK_TILES, CHUNK_LOAD_RADIUS, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "../game/constants";

/** A fallen zombie left on the ground — searchable once, fades after a while. */
interface CorpseRec {
  sprite: Phaser.GameObjects.Sprite;
  searched: boolean;
  diesAt: number;
}

/** What a hold-E search channel is aimed at: a streamed prop or a fallen body. */
interface SearchTarget {
  kind: string;
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  prop?: ActiveSearchable;
  corpse?: CorpseRec;
}

/** A live overlay on a non-normal building (U5): boards, bangers, or a knocker. */
interface BuildingFx {
  mood: BuildingMood;
  b: Building;
  sprite?: Phaser.GameObjects.Image; // boards (static body in placeGroup)
  lastCue: number; // knock/banger cue cooldown
}

/** A live heartbeat beacon (U4): a distant happening you can go investigate. */
interface Beacon {
  kind: WorldEventKind;
  x: number;
  y: number;
  until: number;
  pingId: number;
  lastSound: number;
  emitter?: Phaser.GameObjects.Particles.ParticleEmitter; // smoke column
  glow?: Phaser.GameObjects.Image; // flare light
}

/** A streamed, parked vehicle sprite + its live persisted condition (Feature 4). */
interface ActiveVehicle {
  gid: string;
  type: string;
  sprite: Phaser.GameObjects.Image;
  data: Vehicle;
}

/** A streamed, player-built structure sprite + its live persisted HP (Feature 7).
 *  Blocking kinds carry a static physics body (added to placeGroup) so they fortify. */
interface ActivePlaceable {
  gid: string;
  kind: string;
  sprite: Phaser.GameObjects.Image;
  data: Placeable;
}

interface ProjData {
  damage: number;
  pierce: number;
  knockback: number;
  bleed: number;
  bleedMs: number;
  stunMs: number;
  burn: number;
  explosive: number;
  executePct: number;
  crit: boolean;
  dirX: number;
  dirY: number;
  hits: Set<Enemy>;
}

// The open world (CLAUDE.md §13 Phases 1–3): a walkable seeded city plus the
// authoritative GameState, survival decay, HUD, and localStorage persistence.
// The scene orchestrates; mechanics live in the game-logic modules.

const DECAY_MS = 2000;
const SAVE_MS = 4000;
const SIEGE_MS = 600; // how often zombies gnaw at adjacent barricades / spikes wound them
const PHASES = ["dawn", "day", "dusk", "night"] as const;
const SEG_MS = 45000; // real seconds per time-of-day segment
const BLOOD_MOON_CHANCE = 0.06; // per-night chance the moon turns red and the dead swarm

// Continuous day/night lighting. `t` runs 0→1 across one full day (dawn→day→dusk→night)
// and advances smoothly WITHIN each phase, so the world eases through twilight, golden
// hours, and deep night instead of snapping between four flat tints. Each keyframe is a
// screen overlay tint (color), its darkness (a = alpha), and the player light's strength
// (glow). applyLighting() interpolates between the two surrounding keys every frame.
const LIGHT_KEYS: { t: number; color: number; a: number; glow: number }[] = [
  { t: 0.0, color: 0x121a33, a: 0.5, glow: 0.55 }, // ~05:00 pre-dawn — deep cold blue, still dark
  { t: 0.1, color: 0x46365e, a: 0.33, glow: 0.3 }, // dawn twilight — violet
  { t: 0.17, color: 0xff9e5e, a: 0.16, glow: 0.06 }, // sunrise — warm golden hour
  { t: 0.25, color: 0xfff2d8, a: 0.04, glow: 0.0 }, // early morning — faint warm wash
  { t: 0.375, color: 0x000000, a: 0.0, glow: 0.0 }, // noon — neutral, brightest
  { t: 0.5, color: 0xfff0d0, a: 0.05, glow: 0.0 }, // late afternoon — warm
  { t: 0.6, color: 0xff8a3c, a: 0.18, glow: 0.1 }, // sunset — warm orange golden hour
  { t: 0.68, color: 0x7a3550, a: 0.34, glow: 0.34 }, // dusk afterglow — magenta fading
  { t: 0.78, color: 0x16203f, a: 0.52, glow: 0.6 }, // nightfall — cold blue
  { t: 0.875, color: 0x070c1e, a: 0.66, glow: 0.78 }, // ~02:00 deep night — darkest
  { t: 1.0, color: 0x121a33, a: 0.5, glow: 0.55 }, // wraps back to pre-dawn
];

/** Linear blend between two 0xRRGGBB colors (f = 0 → a, 1 → b). */
function lerpColor(a: number, b: number, f: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * f);
  const g = Math.round(ag + (bg - ag) * f);
  const bl = Math.round(ab + (bb - ab) * f);
  return (r << 16) | (g << 8) | bl;
}

// Open-ground locations (outdoor biomes) vs enclosed buildings — shapes which
// instant quick-actions an encounter's opening prompt offers.
const OPEN_LOCS = new Set<string>([
  "street", "forest", "dense_woods", "grassland", "farmland", "riverbank", "lake",
  "marsh", "coast", "quarry", "parkland", "construction_site", "ocean",
]);

// Natural biomes where wild game roams (Feature 6).
const ANIMAL_BIOMES = new Set<string>([
  "forest", "dense_woods", "grassland", "farmland", "parkland", "riverbank", "marsh", "coast",
]);

// Calmer biomes where friendly survivors are found (Feature 10b).
const SAFE_BIOMES = new Set<string>([
  "suburb", "farmland", "forest", "grassland", "parkland", "school_campus", "coast", "riverbank",
]);

export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private chunks!: ChunkManager;
  private terrain!: AnimatedTerrain; // animated water/lava overlay (Living World)
  private hud!: HUD;
  private modal!: EncounterModal;
  private loot!: LootModal;
  private lootOpen = false;
  private craftUi!: CraftModal;
  private craftOpen = false;
  private touch!: TouchControls;
  private state!: GameState;
  private decayAcc = 0;
  private saveAcc = 0;
  private dead = false;
  private inEncounter = false;
  private encounterLoc = "street";
  private enacting = false; // a GM outcome is currently playing out in the visible world
  private encounterTurns = 0; // resolved GM turns this encounter (hard-capped below)
  private static readonly MAX_ENCOUNTER_TURNS = 2;
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private animals: Animal[] = [];
  private animalGroup!: Phaser.Physics.Arcade.Group;
  private animalAcc = 0;
  private animalDelay = 24000;
  private ambientAcc = 0;
  private ambientDelay = 30000;
  private aiNoticeShown = false; // show the "AI offline" toast at most once per run
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private weatherRect?: Phaser.GameObjects.Rectangle;
  private segAcc = 0;
  private kills = 0;
  private lastMelee = 0;
  private lastShot = 0;
  private firing = false;
  private reloading = false;
  private projectileGroup!: Phaser.Physics.Arcade.Group;
  private enemyProjGroup!: Phaser.Physics.Arcade.Group;
  private itemGroup!: Phaser.Physics.Arcade.Group;
  private grabbedUntil = 0;
  private clouds: { x: number; y: number; r: number; until: number; last: number }[] = [];
  private lastStep = 0;
  private glow!: Phaser.GameObjects.Image;
  private vignette!: Phaser.GameObjects.Image;
  private burnFx?: Phaser.GameObjects.Particles.ParticleEmitter; // flame plume while the player is on fire
  // Natural disasters (Living World): live (transient) instances + their Phaser
  // visuals keyed by id; lasting scars persist on state.disasters.
  private liveDisasters: LiveDisaster[] = [];
  private disasterVis = new Map<string, Phaser.GameObjects.GameObject[]>();
  private disasterAcc = 0;
  private disasterDelay = 95000;
  private disasterSeq = 0;
  private hurtVignette!: Phaser.GameObjects.Image; // red screen-edge pulse on damage
  private objBanner!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private controlsHint?: Phaser.GameObjects.Text; // one-time controls cheat-sheet (H re-shows)
  // Hold-E scavenging channel + fallen-body persistence (Expansion U1).
  private keyE?: Phaser.Input.Keyboard.Key;
  private search: { target: SearchTarget; def: SearchableDef; done: number; ring: Phaser.GameObjects.Graphics } | null = null;
  private corpses: CorpseRec[] = [];
  private corpseAcc = 0;
  // Set-piece ambushes + readable/stash systems (Expansion U2).
  private reader!: ReaderModal;
  private readonly ambushDone = new Set<string>(); // session-only — ambient undead regenerate
  private readonly stashChests = new Map<string, ActiveChest>(); // stash flag → streamed chest
  // Loot feel + opening arc (Expansion U3).
  private highlightFx?: Phaser.GameObjects.Image; // pulse under the current interact target
  private readonly pickupAgg = new Map<string, number>(); // burst-aggregated pickup float
  private pickupAggTimer?: Phaser.Time.TimerEvent;
  private pickupCombo = 0;
  private lastPickupAt = 0;
  // Sound & heartbeat (Expansion U4).
  private readonly beacons: Beacon[] = [];
  private groanAcc = 0;
  private groanDelay = 4000;
  private stingReadyAt = 0; // danger-sting cooldown
  private packWasClose = false; // edge trigger for the sting
  // Living camps + interactive buildings + street encounters (Expansion U5).
  private readonly buildingFx = new Map<string, BuildingFx>(); // gid → overlay
  private readonly campFires = new Map<string, Phaser.GameObjects.Image | null>(); // camp key → dressing
  private streetAcc = 0;
  private streetDelay = 70000;
  private rescueWatch: { id: string; until: number; faction: string } | null = null;
  private weaponSprite!: Phaser.GameObjects.Image;
  private weaponGlow!: Phaser.GameObjects.Image;
  private hotbar!: HotBar;
  private selectedQuick = 0; // quick-use slot Q / middle-click uses (0–3); set by [1-4]
  private activeWeapon = 0; // index into the carried-weapon strip (scroll / [5-0] cycle it)
  private readonly farmSprites = new Map<string, { soil: Phaser.GameObjects.Image; crop?: Phaser.GameObjects.Image }>();
  // Vehicles (Feature 4): parked sprites streamed per chunk (mirrors farmSprites/chests).
  private readonly vehicleSprites = new Map<string, ActiveVehicle>();
  private driving: ActiveVehicle | null = null;
  private vehiclesDirty = false; // force a reconcile after repair/fuel/park
  private lastVehCx = NaN;
  private lastVehCy = NaN;
  // Base building (Feature 7): streamed placeable sprites + blocking static bodies.
  private readonly placeableSprites = new Map<string, ActivePlaceable>();
  private placeGroup!: Phaser.Physics.Arcade.StaticGroup;
  private placeablesDirty = false;
  private lastPlCx = NaN;
  private lastPlCy = NaN;
  private buildMode = false;
  private buildIdx = 0;
  private buildGhost?: Phaser.GameObjects.Image;
  private siegeAcc = 0;
  private storeUi!: StorageModal;
  private storeOpen = false;
  // Living world (Feature 10): minimap discovery, dynamic events, radio broadcasts.
  private minimap!: Minimap;
  private eventAcc = 0;
  private eventDelay = 150000;
  private radioAcc = 0;
  private lastDiscCx = NaN;
  private lastDiscCy = NaN;
  // Survivors / companions / trade (Feature 10b).
  private npcs: Npc[] = [];
  private npcGroup!: Phaser.Physics.Arcade.Group;
  private npcAcc = 0;
  private npcDelay = 26000;
  private tradeUi!: TradeModal;
  private tradeOpen = false;
  private activeNpc: Npc | null = null;
  private readonly npcOffers = new Map<string, TradeOffer[]>();
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private uiLayer!: Phaser.GameObjects.Layer;
  private readonly saveOnUnload = () => this.persist();

  constructor() {
    super("WorldScene");
  }

  create(): void {
    resetFx(this); // drop any blood decals pooled from a previous run
    this.dead = false;
    this.inEncounter = false;
    this.enacting = false;
    this.encounterTurns = 0;
    this.lootOpen = false;
    this.craftOpen = false;
    this.grabbedUntil = 0;
    this.clouds = [];
    this.decayAcc = 0;
    this.saveAcc = 0;
    this.enemies = [];
    this.animals = [];
    this.animalAcc = 0;
    this.ambientAcc = 0;
    this.ambientDelay = 30000; // set properly once state/day is known (below)
    this.aiNoticeShown = false;
    this.segAcc = 0;
    this.kills = 0;
    this.lastMelee = 0;
    this.lastShot = 0;
    this.firing = false;
    this.reloading = false;
    this.lastStep = 0;
    this.selectedQuick = 0;
    this.activeWeapon = 0;
    for (const r of this.farmSprites.values()) {
      r.soil.destroy();
      r.crop?.destroy();
    }
    this.farmSprites.clear();
    for (const av of this.vehicleSprites.values()) av.sprite.destroy();
    this.vehicleSprites.clear();
    this.driving = null;
    this.vehiclesDirty = false;
    this.lastVehCx = NaN;
    this.lastVehCy = NaN;
    for (const ap of this.placeableSprites.values()) ap.sprite.destroy();
    this.placeableSprites.clear();
    this.placeablesDirty = false;
    this.lastPlCx = NaN;
    this.lastPlCy = NaN;
    this.buildMode = false;
    this.buildIdx = 0;
    this.buildGhost?.destroy();
    this.buildGhost = undefined;
    this.siegeAcc = 0;
    this.storeOpen = false;
    this.eventAcc = 0;
    this.radioAcc = 0;
    this.lastDiscCx = NaN;
    this.lastDiscCy = NaN;
    for (const n of this.npcs) n.destroy();
    this.npcs = [];
    this.npcAcc = 0;
    this.tradeOpen = false;
    this.activeNpc = null;
    this.npcOffers.clear();
    this.weatherRect = undefined; // re-created on the fresh uiLayer below
    // Expansion-state resets — the maps survive a scene restart (ESC → menu →
    // Continue) while their sprites do NOT; stale entries would silently block
    // stash chests / boards / campfires from ever re-spawning.
    this.search = null;
    this.corpses = [];
    this.corpseAcc = 0;
    this.stashChests.clear();
    this.buildingFx.clear();
    this.campFires.clear();
    this.beacons.length = 0;
    this.ambushDone.clear();
    this.pickupAgg.clear();
    this.pickupAggTimer = undefined;
    this.pickupCombo = 0;
    this.lastPickupAt = 0;
    this.groanAcc = 0;
    this.stingReadyAt = 0;
    this.packWasClose = false;
    this.streetAcc = 0;
    this.rescueWatch = null;

    // Resume a saved run unless a seed was pinned via ?seed= (a fresh debug run).
    const fromUrl = this.registry.get("seedFromUrl") === true;
    this.registry.set("seedFromUrl", false); // one-shot
    const seed = (this.registry.get("seed") as string) ?? randomSeed();
    const saved = fromUrl ? null : loadGame();
    this.state = saved ?? newGame(seed);

    // Groups first so the chunk streamer can collide every loaded layer against
    // them. The `collide` array is populated below (once the player exists) and
    // read lazily by the manager when it loads a chunk.
    this.enemyGroup = this.physics.add.group();
    this.animalGroup = this.physics.add.group();
    this.projectileGroup = this.physics.add.group();
    this.enemyProjGroup = this.physics.add.group();
    this.itemGroup = this.physics.add.group();
    this.placeGroup = this.physics.add.staticGroup(); // blocking placeables (Feature 7)
    this.npcGroup = this.physics.add.group(); // survivors / companions (Feature 10b)

    const collide: ColliderSpec[] = [];
    this.terrain = new AnimatedTerrain(this); // created before the manager so the first chunk loads get overlays
    this.chunks = new ChunkManager(this, this.state.seed, {
      collide,
      isChestLooted: (gid) => this.state.worldFlags.includes(`chest_${gid}`),
      isPropSearched: (gid) => isPropSearched(this.state, gid),
      disasters: () => this.state.disasters ?? [],
      currentDay: () => this.state.day,
      onChunkLoad: (data) => this.terrain.syncChunk(data),
      onChunkUnload: (cx, cy) => this.terrain.dropChunk(cx, cy),
    });

    // A fresh run (new game / character creation / ?seed) carries an AI intro, and
    // its freshly-saved state sits at the unplaced (0,0) origin — which is the ocean
    // border. Spawn it at the world's spawn chunk instead; a resumed run keeps its spot.
    const freshRun = !saved || !!this.registry.get("intro");
    const startX = freshRun ? this.chunks.start.x : this.state.player.x;
    const startY = freshRun ? this.chunks.start.y : this.state.player.y;
    // Resume mid-segment so the continuous clock/lighting picks up where it left off
    // instead of snapping back to the phase boundary (fresh runs start each segment at 0).
    if (!freshRun) this.segAcc = Phaser.Math.Clamp(this.state.clockMs ?? 0, 0, SEG_MS);
    this.player = new Player(this, startX, startY);
    this.player.setAppearance(this.state.appearance?.color); // character-creation tint

    const { w: worldW, h: worldH } = this.chunks.worldPxBounds();
    this.physics.world.setBounds(0, 0, worldW, worldH);
    setupCamera(this, this.player.sprite, worldW, worldH);

    // The main camera zooms the world 1.25× — but Phaser zoom also scales
    // scrollFactor(0) UI, which clips the HUD off the top. So all fixed UI goes
    // into uiLayer, rendered by a dedicated unzoomed UI camera; the main camera
    // ignores uiLayer. (DOM modals are HTML and unaffected.)
    // The UI camera's world-view is parked far OUTSIDE the finite map, so every
    // world object (scrollFactor 1) is culled off-view and never draws over the
    // HUD — while screen-fixed UI (scrollFactor 0) ignores scroll and stays put.
    this.uiLayer = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setScroll(-1_000_000, -1_000_000);

    // Equipped weapon shown in-hand: a plateless, outlined silhouette (heldKey) so
    // it reads clearly as a weapon, with a rarity-tinted glow behind it so it pops
    // against dark ground / at night and its rarity reads at a glance.
    this.weaponGlow = this.add
      .image(startX, startY, FX_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(10.6)
      .setScale(0.3)
      .setAlpha(0.55)
      .setVisible(false);
    this.weaponSprite = this.add.image(startX, startY, heldKey("Fists")).setDepth(11).setScale(0.8).setVisible(false);

    // Collider specs applied to every streamed chunk layer (walls/water/trees).
    collide.push(
      { target: this.player.sprite },
      { target: this.enemyGroup },
      { target: this.animalGroup },
      { target: this.npcGroup },
      { target: this.projectileGroup, callback: (o) => this.killProjectile(o as unknown as Phaser.Physics.Arcade.Image) },
      { target: this.enemyProjGroup, callback: (o) => this.killProjectile(o as unknown as Phaser.Physics.Arcade.Image) },
    );

    // Projectiles hit enemies; enemy acid + dropped loot overlap the player.
    this.physics.add.overlap(this.projectileGroup, this.enemyGroup, (a, b) => this.onProjectileHit(a, b));
    this.physics.add.overlap(this.projectileGroup, this.animalGroup, (a, b) => this.onProjAnimal(a, b));
    this.physics.add.overlap(this.player.sprite, this.enemyProjGroup, (_p, pr) => this.onEnemyProjHit(pr));
    // Blocking placeables (barricades/walls/gates) physically fortify: the player,
    // zombies, and animals all collide with them (Feature 7). The siege tick wears
    // them down as zombies press against them.
    this.physics.add.collider(this.player.sprite, this.placeGroup);
    this.physics.add.collider(this.enemyGroup, this.placeGroup);
    this.physics.add.collider(this.animalGroup, this.placeGroup);
    this.physics.add.collider(this.npcGroup, this.placeGroup);
    this.physics.add.overlap(this.player.sprite, this.itemGroup, (_p, item) =>
      this.pickupDrop(item as unknown as Phaser.Physics.Arcade.Image),
    );

    // Stream the initial ring of chunks (and their chests) around the spawn.
    this.chunks.ensureAround(startX, startY);
    this.reconcileVehicles(true); // place any cars in the opening view
    this.reconcilePlaceables(true); // restore any built structures in the opening view

    // Day/night tint: a flat darkening rect kept on the MAIN camera (below the
    // player glow at depth 520) so the additive flashlight glow still cuts through
    // the dark. It's a uniform fill, so the 1.25× zoom merely over-covers — fine.
    // The UI camera ignores it (below) so it isn't double-drawn.
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x00040c, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(500);

    // Atmosphere (procedural): drifting motes, a flashlight glow that brightens at
    // night, and a vignette. All camera-fixed except the glow, which follows the player.
    const dust = this.add
      .particles(0, 0, FX_DUST, {
        x: { min: 0, max: this.scale.width },
        y: { min: 0, max: this.scale.height },
        lifespan: 7000,
        speedX: { min: -14, max: -3 },
        speedY: { min: -3, max: 3 },
        scale: { min: 0.6, max: 1.8 },
        alpha: { start: 0.1, end: 0 },
        tint: 0x9aa3ad,
        frequency: 340,
        quantity: 1,
      })
      .setScrollFactor(0)
      .setDepth(510);
    this.uiLayer.add(dust);
    this.glow = makeGlow(this, this.player.sprite.x, this.player.sprite.y); // world-space (main camera)
    this.vignette = this.add.image(0, 0, FX_VIGNETTE).setOrigin(0, 0).setScrollFactor(0).setDepth(540);
    this.vignette.setDisplaySize(this.scale.width, this.scale.height);
    // Red screen-edge pulse that flashes when the player is hurt (Batch G).
    this.hurtVignette = this.add
      .image(0, 0, FX_VIGNETTE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(541)
      .setTint(0xc41020)
      .setAlpha(0);
    this.hurtVignette.setDisplaySize(this.scale.width, this.scale.height);
    this.uiLayer.add([this.vignette, this.hurtVignette]);

    // Minimal guides: a persistent objective banner + a contextual "Press E" hint.
    this.objBanner = this.add
      .text(this.scale.width / 2, 8, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cfe6ff",
        backgroundColor: "#0b1622",
        padding: { x: 10, y: 4 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(950);
    this.hintText = this.add
      .text(this.scale.width / 2, this.scale.height - 120, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffe6a8",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(950)
      .setVisible(false);
    this.uiLayer.add([this.objBanner, this.hintText]);
    this.updateObjective();

    this.scale.on("resize", this.onResize, this);
    this.applyPhaseVisual();
    if (!this.state.weather) this.state.weather = rollWeather(liveRng);
    this.applyWeatherVisual();

    if (freshRun) {
      this.state.player.x = startX;
      this.state.player.y = startY;
      saveGame(this.state);
    }

    this.hud = new HUD(this, this.uiLayer);
    this.hotbar = new HotBar(this, this.uiLayer);
    this.minimap = new Minimap(this, this.uiLayer);
    this.eventDelay = nextEventDelayMs(this.state.day, this.isNight());
    this.discoverAround(); // reveal the opening surroundings on the map

    // Interact-target highlight (U3): one additive pulse re-positioned each frame.
    this.highlightFx = this.add
      .image(0, 0, FX_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(3.5)
      .setTint(0xffe6a8)
      .setScale(0.2)
      .setVisible(false);

    // The opening arc's safehouse is pinned from the start (U3).
    if (currentStep(this.state)) {
      const t = arcSafehouse(this.state.seed);
      this.revealLocation("Safehouse", "objective", (t.cx * CHUNK_TILES + CHUNK_TILES / 2) * TILE_SIZE, (t.cy * CHUNK_TILES + CHUNK_TILES / 2) * TILE_SIZE);
    }
    for (const p of this.state.farmPlots ?? []) this.refreshPlotSprites(p); // restore farm plots

    // Split rendering: the main (zoomed, player-following) camera draws the world
    // and ignores the fixed UI; the UI camera draws only the screen-fixed UI (its
    // off-map scroll culls every scrollFactor-1 world object). The night overlay is
    // scrollFactor(0) and lives on the main camera, so the UI camera must skip it.
    this.cameras.main.ignore(this.uiLayer);
    this.uiCam.ignore(this.nightOverlay);

    this.modal = new EncounterModal();
    this.modal.setHandlers(
      (input) => this.onEncounterAction(input),
      () => this.onEncounterLeave(),
    );
    this.loot = new LootModal();
    this.loot.setOnClose(() => {
      this.lootOpen = false;
      this.setGameKeys(true);
    });
    this.loot.setOnRead((name) => this.readItem(name));
    this.reader = new ReaderModal();
    this.craftUi = new CraftModal();
    this.craftUi.setHandlers(
      (r) => {
        if (!craft(this.state, r, this.stationsNear())) return; // re-check station/skill/materials
        sfx.pickup();
        this.floatText(this.player.sprite.x, this.player.sprite.y - 8, `Crafted ${r.out}`, "#9ef0a0");
        pushRecentEvent(this.state, `Crafted ${r.out}.`);
        this.grantXp("crafting", 5);
        this.hud.update(this.state, this.debugInfo());
        this.persist();
        this.craftUi.refresh(this.state);
      },
      () => {
        this.craftOpen = false;
        this.setGameKeys(true);
      },
    );
    this.storeUi = new StorageModal();
    this.storeUi.setHandlers(
      () => {
        this.hud.update(this.state, this.debugInfo());
        this.persist();
      },
      () => {
        this.storeOpen = false;
        this.setGameKeys(true);
      },
    );
    this.tradeUi = new TradeModal();
    this.tradeUi.setHandlers(
      (offer) => this.onTradeAccept(offer),
      () => this.onRecruitToggle(),
      () => {
        this.tradeOpen = false;
        this.activeNpc = null;
        this.setGameKeys(true);
      },
    );
    this.restoreCompanions(); // re-spawn recruited companions from the save
    this.touch = new TouchControls();
    this.touch.setHandlers(
      () => this.tryInteract(),
      () => this.meleeAttack(),
      () => this.tryReload(),
      () => this.toggleLoot(),
    );
    this.bindKeys();

    // Desktop: hold left mouse to fire the equipped gun toward the cursor.
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    // Scroll wheel cycles the carried-weapon strip (or the build palette while in
    // build mode). Consumables live on [1-4] / Q; weapons on the wheel + [5-0].
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.buildMode) this.cycleBuild(dy > 0 ? 1 : -1);
      else this.cycleWeapon(dy > 0 ? 1 : -1);
    });

    // Stop the page from scrolling / middle-click autoscroll over the canvas so the
    // wheel drives the hotbar cleanly.
    const canvas = this.game.canvas;
    const noScroll = (e: WheelEvent) => e.preventDefault();
    const noAux = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    canvas.addEventListener("wheel", noScroll, { passive: false });
    canvas.addEventListener("mousedown", noAux);

    // Controls cheat-sheet on first spawn only (persisted via a world flag); H re-shows.
    if (!this.state.worldFlags.includes("seen_controls")) {
      this.state.worldFlags.push("seen_controls");
      this.showControlsHint();
    }

    window.addEventListener("beforeunload", this.saveOnUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("beforeunload", this.saveOnUnload);
      canvas.removeEventListener("wheel", noScroll);
      canvas.removeEventListener("mousedown", noAux);
      this.scale.off("resize", this.onResize, this);
      this.modal.destroy();
      this.loot.destroy();
      this.reader.destroy();
      sfx.stopAmbience(); // tear the bed/chirp loops down with the scene (U4)
      this.craftUi.destroy();
      this.storeUi.destroy();
      this.tradeUi.destroy();
      this.touch.destroy();
      this.terrain.destroy();
      this.chunks.destroy();
      this.persist();
    });

    // Day 0 is nearly empty — the streets fill as the outbreak spreads.
    resetSpawnVariety(); // fresh anti-repeat memory for this run
    if (!isDead(this.state)) this.spawnAmbientWalkers(this.ambientStartCount());
    this.ambientDelay = this.scheduleAmbientMs();

    // A fresh run opens with its AI-authored scenario intro.
    const intro = this.registry.get("intro") as string | undefined;
    if (intro) {
      this.registry.set("intro", undefined);
      if (!isDead(this.state)) this.showIntro(intro);
    }

    if (isDead(this.state)) this.enterDeath();
  }

  override update(time: number, delta: number): void {
    // The world pauses during an encounter, while an outcome is playing out, or
    // while the loot/craft/storage/trade screens are open.
    if (!this.dead && !this.inEncounter && !this.enacting && !this.lootOpen && !this.craftOpen && !this.storeOpen && !this.tradeOpen) {
      const canSprint = this.state.player.stamina > 5;
      const tv = this.touch.vector();
      // Living World: the tile underfoot slows wading/mud/lava, kicks up contact FX,
      // and ignites you on lava (stepping into water elsewhere douses the fire).
      const terr = terrainEffect(
        this.chunks.tileAt(Math.floor(this.player.sprite.x / TILE_SIZE), Math.floor(this.player.sprite.y / TILE_SIZE)),
      );
      this.player.terrainMult = this.driving ? 1 : terr.mult; // vehicles plough through
      if (!this.driving) {
        if (terr.hazard === "lava") ignitePlayer(this.state, 1600, time);
        else if (terr.stepFx === "splash") soakPlayer(this.state, 2200, time);
      }
      if (time < this.grabbedUntil) {
        this.player.sprite.setVelocity(0, 0); // held fast by a grabber
      } else {
        this.player.update(canSprint, { x: tv.x, y: tv.y, sprint: this.touch.sprintHeld });
        if (this.player.sprinting) {
          this.state.player.stamina = clampStat(this.state.player.stamina - delta * 0.012 * sprintDrainMult(this.state));
        }
      }
      this.chunks.ensureAround(this.player.sprite.x, this.player.sprite.y);
      this.reconcileVehicles();
      this.reconcilePlaceables();
      if (this.driving) this.driveTick(delta);
      if (this.buildMode) this.updateBuildGhost();
      if (this.search) this.tickSearch(delta);
      this.magnetDrops(); // nearby loot flies to the bag (U3)
      this.tickBeacons(); // distant happenings: audio, expiry, arrival (U4)
      this.corpseAcc += delta;
      if (this.corpseAcc >= 2000) {
        this.corpseAcc = 0;
        this.sweepCorpses();
        this.checkDangerSting();
        this.tickBuildingMoods(); // bangers burst, knockers get rescued (U5)
        this.checkRescue();
      }
      this.streetAcc += delta;
      if (this.streetAcc >= this.streetDelay) {
        this.streetAcc = 0;
        this.streetDelay = 60000 + Math.random() * 60000;
        this.streetEncounter(); // the roads are inhabited from day 0 (U5)
      }
      this.groanAcc += delta;
      if (this.groanAcc >= this.groanDelay) {
        this.groanAcc = 0;
        this.groanDelay = 3000 + Math.random() * 4000;
        this.proximityGroan();
      }
      this.tickClouds(time);
      this.updateEnemies(time);
      this.updateAnimals(time);
      this.updateNpcs(time);

      this.npcAcc += delta;
      if (this.npcAcc >= this.npcDelay) {
        this.npcAcc = 0;
        this.npcDelay = 22000 + Math.random() * 22000;
        this.spawnAmbientSurvivor();
      }

      this.siegeAcc += delta;
      if (this.siegeAcc >= SIEGE_MS) {
        this.siegeAcc -= SIEGE_MS;
        this.tickSiege();
      }

      this.discoverAround(); // map fog-of-war fills in as you explore (cheap; gated)

      this.eventAcc += delta;
      if (this.eventAcc >= this.eventDelay) {
        this.eventAcc = 0;
        this.eventDelay = nextEventDelayMs(this.effDay(), this.isNight());
        this.worldEvent();
      }

      this.disasterAcc += delta;
      if (this.disasterAcc >= this.disasterDelay) {
        this.disasterAcc = 0;
        this.disasterDelay = this.nextDisasterDelayMs();
        this.maybeSpawnDisaster(time);
      }
      this.updateDisasters(time, delta);

      if (hasItem(this.state, "Radio")) {
        this.radioAcc += delta;
        if (this.radioAcc >= 75000) {
          this.radioAcc = 0;
          this.radioBroadcast();
        }
      }

      if (this.player.isMoving() && time - this.lastStep > 300) {
        this.lastStep = time;
        const fx = this.player.sprite.x;
        const fy = this.player.sprite.y + 8;
        if (terr.stepFx === "splash") splashPuff(this, fx, fy, 5);
        else if (terr.stepFx === "ember") emberPuff(this, fx, fy, 4);
        else if (terr.stepFx === "mud") dustPuff(this, fx, fy, 3);
        else dustPuff(this, fx, fy, 2);
      }

      if (this.firing) this.fire(this.aimAngle()); // auto-fire while mouse held
      if (this.touch.fireHeld) this.fireAuto(); // mobile FIRE button: auto-aim nearest

      this.decayAcc += delta;
      if (this.decayAcc >= DECAY_MS) {
        this.decayAcc -= DECAY_MS;
        applyDecay(this.state, ratesFor(this.state));
        if (tickBurning(this.state, time) > 0) this.hurtPulse(0.4); // fire chips HP each tick
        if (isDead(this.state)) this.enterDeath();
      }

      this.segAcc += delta;
      if (this.segAcc >= SEG_MS) {
        this.segAcc -= SEG_MS;
        this.advanceClock();
      }

      this.ambientAcc += delta;
      if (this.ambientAcc >= this.ambientDelay) {
        this.ambientAcc = 0;
        this.ambientDelay = this.scheduleAmbientMs();
        this.ambientEvent();
      }

      this.animalAcc += delta;
      if (this.animalAcc >= this.animalDelay) {
        this.animalAcc = 0;
        this.animalDelay = 18000 + Math.random() * 22000;
        this.spawnWildAnimals();
      }

      this.saveAcc += delta;
      if (this.saveAcc >= SAVE_MS) {
        this.saveAcc -= SAVE_MS;
        this.persist();
      }
    }

    // The flashlight glow tracks the player even while paused.
    this.glow.setPosition(this.player.sprite.x, this.player.sprite.y);
    this.updateBurningFx(time);
    this.terrain.update(delta); // animate water/lava shimmer + shoreline FX
    this.applyLighting(this.dayFraction()); // continuous day/night easing (frozen while paused)
    this.updateWeaponSprite();
    this.minimap.render(this.state.seed, this.state, this.scale.width);

    // Contextual hint (build > driving > vehicle > storage > chest > farm > building)
    // — encounters are opt-in, so this is the invitation to engage; exploring never
    // forces one.
    if (!this.dead && this.buildMode) {
      this.hintText.setText(this.buildHint()).setVisible(true);
      this.setHighlight(null, time);
    } else if (!this.dead && this.driving) {
      this.hintText.setText(`Driving — Fuel ${Math.ceil(this.driving.data.fuel)}%  ·  Press E to park`).setVisible(true);
      this.setHighlight(null, time);
    } else if (!this.dead && !this.inEncounter) {
      const veh = this.nearestVehicle(52);
      const npc = veh ? null : this.nearestNpc(46);
      const store = veh || npc ? null : this.nearestPlaceable(44, (k) => placeableDef(k).storage === true);
      const chest = veh || npc || store ? null : this.nearestChest(42);
      const scav = veh || npc || store || chest ? null : this.nearestSearchable(40);
      const boards = veh || npc || store || chest || scav ? null : this.nearestBoards(42);
      const farm = veh || npc || store || chest || scav || boards ? null : this.farmHint();
      const near = veh || npc || store || chest || scav || boards || farm ? null : this.buildingAt();
      if (veh) this.hintText.setText(this.vehicleHint(veh)).setVisible(true);
      else if (npc) this.hintText.setText(`Press E to talk to ${npc.name}${npc.kind === "companion" ? " (companion)" : ""}`).setVisible(true);
      else if (store) this.hintText.setText("Press E to open base storage").setVisible(true);
      else if (chest) this.hintText.setText(`Press E to open the ${chest.kind.replace(/_/g, " ")}${chest.locked ? " (locked)" : ""}`).setVisible(true);
      else if (scav) this.hintText.setText(`Hold E to search the ${this.searchDefFor(scav).label}`).setVisible(true);
      else if (boards) this.hintText.setText("Boarded up — press E with a Crowbar to pry").setVisible(true);
      else if (farm) this.hintText.setText(farm).setVisible(true);
      else if (near) this.hintText.setText(this.buildingHint(near)).setVisible(true);
      else this.hintText.setVisible(false);
      // The resolved physical target gets a soft ground pulse so it reads at a glance (U3).
      const targetSprite = veh?.sprite ?? npc?.sprite ?? store?.sprite ?? chest?.sprite ?? scav?.sprite ?? boards?.sprite ?? null;
      this.setHighlight(targetSprite, time);
    } else {
      this.hintText.setVisible(false);
      this.setHighlight(null, time);
    }

    this.hud.update(this.state, this.debugInfo(), this.activeWeaponName(), this.clockLabel());
    if (!quickUseItems(this.state)[this.selectedQuick]) {
      const first = quickUseItems(this.state).findIndex((q) => q); // keep the cursor on a usable slot
      if (first >= 0) this.selectedQuick = first;
    }
    const weaponCount = this.carriedWeapons().length;
    if (weaponCount > 0) this.activeWeapon = Phaser.Math.Clamp(this.activeWeapon, 0, weaponCount - 1);
    this.hotbar.update(
      this.state,
      !this.inEncounter && !this.enacting && !this.dead && !this.lootOpen && !this.craftOpen && !this.storeOpen && !this.tradeOpen,
      this.selectedQuick,
      this.activeWeapon,
    );
  }

  private updateObjective(): void {
    if (this.state.bloodMoon) {
      // The blood moon overrides the run goal with one imperative: live to dawn.
      this.objBanner.setText("🔴 BLOOD MOON — survive until dawn").setVisible(true);
      return;
    }
    // The guided opening arc owns the banner until it's done (U3), then the run goal.
    const arc = objectiveLabel(this.state);
    if (arc) {
      this.objBanner.setText(arc).setVisible(true);
      return;
    }
    const g = this.state.goal ?? "";
    this.objBanner.setText(g ? `Objective: ${g}` : "").setVisible(!!g);
  }

  /** Feed an event into the opening arc; surface progress/toasts/reward (U3). */
  private objectiveEvent(ev: ObjectiveEvent): void {
    const r = notifyObjective(this.state, ev);
    if (!r.advanced) return;
    this.updateObjective();
    if (r.toast) this.showToast(r.toast);
    if (r.stepDone) sfx.ui();
    if (r.chainDone) this.grantArcReward();
    this.persist();
  }

  /** Fires the arm-objective once a real weapon is in hand (any equip path). */
  private checkArmed(): void {
    if (currentStep(this.state)?.kind !== "equip_weapon") return;
    const armed = !!this.state.equippedRanged || (!!this.state.equippedMelee && this.state.equippedMelee !== "Fists");
    if (armed) this.objectiveEvent({ kind: "weapon_equipped" });
  }

  /** Completing the opening arc drops a small supply reward at the player's feet. */
  private grantArcReward(): void {
    pushRecentEvent(this.state, "Saw the first day through — supplies secured.");
    this.showToast("Opening objective complete — supplies dropped at your feet");
    for (const s of rollLoot("chest:2", liveRng, 3, 0.3)) {
      this.spawnDrop(this.player.sprite.x + 10, this.player.sprite.y + 10, s.item, s.qty);
    }
    this.grantXp("combat", 6);
    this.grantXp("crafting", 6);
  }

  /** Soft additive pulse under the current interact target (U3 loot feel). */
  private setHighlight(target: { x: number; y: number } | null, time: number): void {
    if (!this.highlightFx) return;
    if (!target) {
      this.highlightFx.setVisible(false);
      return;
    }
    this.highlightFx
      .setVisible(true)
      .setPosition(target.x, target.y + 6)
      .setAlpha(0.22 + 0.1 * Math.sin(time / 170))
      .setScale(0.19 + 0.02 * Math.sin(time / 170));
  }

  /** Loot within arm's reach flies into the bag (U3): kill the bob, disable the
   *  body (the tween owns delivery), and run the normal pickup on arrival. */
  private magnetDrops(): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    for (const obj of this.itemGroup.getChildren() as Phaser.Physics.Arcade.Image[]) {
      if (!obj.active || obj.getData("magnet")) continue;
      const dx = obj.x - px;
      const dy = obj.y - py;
      if (dx * dx + dy * dy > 44 * 44) continue;
      obj.setData("magnet", true);
      const body = obj.body as Phaser.Physics.Arcade.Body | null;
      if (body) body.enable = false;
      const glow = obj.getData("glow") as DropGlow | undefined;
      const targets: Phaser.GameObjects.GameObject[] = [obj, ...(glow?.layers ?? [])];
      for (const t of targets) this.tweens.killTweensOf(t); // stop the bob
      this.tweens.add({
        targets,
        x: px,
        y: py,
        alpha: 0.9,
        duration: 160,
        ease: "Quad.easeIn",
        onComplete: () => this.pickupDrop(obj),
      });
    }
  }

  /** Burst-aggregate pickup floats so vacuuming a loot pile reads as ONE line. */
  private queuePickupFloat(item: string, qty: number): void {
    this.pickupAgg.set(item, (this.pickupAgg.get(item) ?? 0) + qty);
    this.pickupAggTimer?.remove();
    this.pickupAggTimer = this.time.delayedCall(620, () => this.flushPickupFloat());
  }

  private flushPickupFloat(): void {
    if (this.pickupAgg.size === 0) return;
    const entries = [...this.pickupAgg.entries()];
    this.pickupAgg.clear();
    let best = -1;
    let color = "#ffffff";
    for (const [name] of entries) {
      const r = rarityRank(defOf(name).rarity);
      if (r > best) {
        best = r;
        color = RARITY_META[defOf(name).rarity].css;
      }
    }
    const shown = entries.slice(0, 3).map(([n, q]) => `+${q > 1 ? `${q} ` : ""}${n}`).join(" · ");
    const extra = entries.length > 3 ? ` +${entries.length - 3} more` : "";
    this.floatText(this.player.sprite.x, this.player.sprite.y - 6, shown + extra, color);
  }

  // --- enemies (CLAUDE.md §11) -----------------------------------------------

  private updateEnemies(now: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const engine = this.driving && this.player.isMoving() ? 240 : 0; // a running car is LOUD
    const noise =
      (this.player.isMoving() ? 45 : 0) +
      (this.player.sprinting ? 70 : 0) +
      (this.search ? SEARCH_NOISE : 0) + // rummaging is loud — searching draws the dead
      this.nightNoise() +
      engine;
    for (const e of this.enemies) {
      e.update(px, py, noise, now);
      // The dead don't fear terrain: lava sears + bogs them (kite them into it),
      // shallow water/mud slows them. Cheap single tile lookup per enemy/frame.
      const et = this.chunks.tileAt(Math.floor(e.sprite.x / TILE_SIZE), Math.floor(e.sprite.y / TILE_SIZE));
      if (et === Tile.Lava) {
        e.applyDot(14, 600);
        this.scaleBodyVelocity(e.sprite, 0.3);
      } else if (et === Tile.ShallowWater || et === Tile.Mud) {
        this.scaleBodyVelocity(e.sprite, 0.6);
      }
      if (e.tryAttack(px, py, now) && !this.driving) this.takeHit(e); // in a car you're out of reach
      this.enemySpecials(e, px, py, now);
      if (e.tryBleedTrail(now)) bloodTrail(this, e.sprite.x, e.sprite.y, e.blood, e.velocity()); // wounded foes leave a trail
    }
    // reap enemies finished off by bleed/burn damage-over-time
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) {
        splatHit(this, e.sprite.x, e.sprite.y, e.blood, undefined, 1.1);
        this.onEnemyKilled(e);
      }
    }
  }

  private isNight(): boolean {
    return this.state.timeOfDay === "night" || this.state.timeOfDay === "dusk";
  }

  /** Zombies sense you from farther away in the dark. */
  private nightNoise(): number {
    if (this.state.timeOfDay === "night") return 80;
    if (this.state.timeOfDay === "dusk") return 35;
    return 0;
  }

  private advanceClock(announce = true): void {
    const idx = PHASES.indexOf(this.state.timeOfDay);
    const next = (idx + 1) % PHASES.length;
    if (next === 0) {
      this.state.day += 1; // wrapped night -> dawn
      this.objectiveEvent({ kind: "dawn" }); // opening arc: survived the night (U3)
    }
    this.state.timeOfDay = PHASES[next];
    const wasBlood = this.state.bloodMoon;
    this.updateBloodMoon(); // roll a new blood moon as night falls; lift it at dawn
    this.applyPhaseVisual();
    // Flavour the transition — but let the blood moon's own banner/fade speak for itself.
    if (announce && this.state.bloodMoon === wasBlood) this.announcePhase();
    if (liveRng.chance(0.35)) {
      this.state.weather = rollWeather(liveRng); // conditions shift
      this.applyWeatherVisual();
    }
    if (isWet(this.state.weather)) for (const p of this.state.farmPlots ?? []) p.watered = true; // rain waters crops
    growPlots(this.state); // crops advance one segment per time-of-day step
    for (const p of this.state.farmPlots ?? []) this.refreshPlotSprites(p);
    this.persist();
  }

  /** A short, atmospheric toast as the light shifts — and a reminder that night is deadly. */
  private announcePhase(): void {
    const lines: Record<string, string> = {
      dawn: "Dawn breaks — the dead lose their nerve.",
      day: "Daylight floods the streets.",
      dusk: "Dusk settles — shadows pool in the alleys.",
      night: "Night falls — the dead grow bold.",
    };
    const m = lines[this.state.timeOfDay];
    if (m) this.showToast(m);
  }

  // --- blood moon (rare, deadly night) ---------------------------------------

  /** Rolled each time the clock changes phase: a small chance a blood moon rises as
   *  night falls, and it always lifts at dawn. While active, the sky bleeds red and
   *  the undead swarm in far greater, faster numbers (see enemyCap / ambientEvent). */
  private updateBloodMoon(): void {
    if (this.state.timeOfDay === "night") {
      if (!this.state.bloodMoon && liveRng.chance(BLOOD_MOON_CHANCE)) this.beginBloodMoon();
    } else if (this.state.bloodMoon && this.state.timeOfDay === "dawn") {
      this.endBloodMoon();
    }
  }

  private beginBloodMoon(): void {
    this.state.bloodMoon = true;
    pushRecentEvent(this.state, "A blood moon rose — the dead swarmed in the red light.");
    sfx.boom();
    this.cameras.main.flash(700, 140, 0, 0);
    this.cameras.main.shake(420, 0.004);
    this.updateObjective(); // flip the banner to the survive-till-dawn imperative
    this.showBloodMoonBanner();
    // An immediate surge floods the streets around the player — runner-heavy.
    this.spawnNear([
      { type: "zombie_runner", count: Phaser.Math.Between(4, 6) },
      { type: "zombie", count: Phaser.Math.Between(5, 8) },
    ]);
  }

  private endBloodMoon(): void {
    this.state.bloodMoon = false;
    pushRecentEvent(this.state, "The blood moon faded with the dawn. You survived the night.");
    this.showToast("The blood moon fades. Dawn breaks — you survived the night.");
    this.updateObjective(); // restore the normal run objective
  }

  private showBloodMoonBanner(): void {
    this.modal.showBanner(
      "🔴 BLOOD MOON 🔴\n\nThe moon turns the colour of blood. The dead pour into the streets — " +
        "faster, and without number. Find cover and survive until dawn.",
      "",
    );
    this.modal.dismissSoon(6000);
  }

  /** Continuous progress through the day: 0 at the start of dawn → 1 at the end of night.
   *  Combines the discrete phase index with sub-progress through the current segment, so
   *  the lighting (and clock) advance smoothly rather than in four jumps. */
  private dayFraction(): number {
    const idx = Math.max(0, PHASES.indexOf(this.state.timeOfDay));
    const sub = Phaser.Math.Clamp(this.segAcc / SEG_MS, 0, 1);
    return (idx + sub) / PHASES.length;
  }

  /** Evocative HH:MM clock for the HUD, derived from the day fraction (dawn ≈ 05:00). */
  private clockLabel(): string {
    const hour = (this.dayFraction() * 24 + 5) % 24;
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** Drive the darkness overlay + player glow from the continuous day fraction by
   *  interpolating the surrounding LIGHT_KEYS. Called every frame, so phases ease into
   *  one another. A blood moon overrides the tint with deep red until dawn. */
  private applyLighting(t: number): void {
    let hi = 1;
    while (hi < LIGHT_KEYS.length - 1 && LIGHT_KEYS[hi].t < t) hi++;
    const lo = LIGHT_KEYS[hi - 1];
    const up = LIGHT_KEYS[hi];
    const f = Phaser.Math.Clamp((t - lo.t) / (up.t - lo.t || 1), 0, 1);
    let color = lerpColor(lo.color, up.color, f);
    const alpha = lo.a + (up.a - lo.a) * f;
    const glow = lo.glow + (up.glow - lo.glow) * f;

    // A blood moon drowns night (and dusk) in a deep, ominous red.
    const bloody = this.state.bloodMoon && this.isNight();
    if (bloody) color = 0x3a0008;
    if (this.nightOverlay) {
      this.nightOverlay.setFillStyle(color, 1);
      this.nightOverlay.setAlpha(alpha);
    }
    if (this.glow) {
      this.glow.setAlpha(glow);
      this.glow.setTint(bloody ? 0xff3a3a : 0xffffff); // the flashlight runs red under the blood moon
    }
  }

  /** Snap the lighting to the current time (no tween) — called on load and on each phase
   *  change; the per-frame applyLighting() in update() keeps the transition smooth. */
  private applyPhaseVisual(): void {
    this.applyLighting(this.dayFraction());
    this.updateAmbience(); // night layer follows the clock (idempotent, U4)
  }

  /** Screen-space weather haze (on the UI layer so it tracks the camera). */
  private applyWeatherVisual(): void {
    if (!this.weatherRect) {
      this.weatherRect = this.add
        .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(535);
      this.uiLayer.add(this.weatherRect);
    }
    const styles: Record<string, { c: number; a: number }> = {
      clear: { c: 0x000000, a: 0 },
      cloudy: { c: 0x2a3038, a: 0.12 },
      // Neutral grey-blue, lighter — rain used to stack a heavy cyan wash on top
      // of the water shader and read as "the whole world is underwater".
      rain: { c: 0x39424d, a: 0.2 },
      fog: { c: 0xb8c0c8, a: 0.3 },
      storm: { c: 0x141c2a, a: 0.42 },
    };
    const v = styles[this.state.weather ?? "clear"] ?? styles.clear;
    this.weatherRect.setFillStyle(v.c, 1);
    this.tweens.add({ targets: this.weatherRect, alpha: v.a, duration: 1500 });
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.uiCam?.setSize(size.width, size.height);
    this.nightOverlay?.setSize(size.width, size.height);
    this.vignette?.setDisplaySize(size.width, size.height);
    this.hurtVignette?.setDisplaySize(size.width, size.height);
    this.objBanner?.setPosition(size.width / 2, 8);
    this.hintText?.setPosition(size.width / 2, size.height - 120);
  }

  /** Brief red screen-edge pulse when the player is hurt (Batch G). */
  private hurtPulse(intensity = 0.5): void {
    if (!this.hurtVignette) return;
    this.tweens.killTweensOf(this.hurtVignette);
    this.hurtVignette.setAlpha(Math.min(0.85, intensity));
    this.tweens.add({ targets: this.hurtVignette, alpha: 0, duration: 360, ease: "Quad.easeOut" });
  }

  /** Dampen an arcade sprite's current-frame velocity (terrain drag). */
  private scaleBodyVelocity(sprite: Phaser.GameObjects.GameObject, f: number): void {
    const b = (sprite as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.Body | null;
    if (b) b.velocity.scale(f);
  }

  /** Start/stop the flame plume that clings to the player while they're on fire,
   *  with a steam puff when the fire is doused. Cheap; runs every frame. */
  private updateBurningFx(now: number): void {
    const burning = !this.dead && isBurning(this.state, now);
    if (burning && !this.burnFx) {
      this.burnFx = startBurning(this, this.player.sprite);
    } else if (!burning && this.burnFx) {
      stopBurning(this, this.burnFx);
      this.burnFx = undefined;
      steamPuff(this, this.player.sprite.x, this.player.sprite.y);
    }
  }

  /** A quick camera zoom-punch for weighty hits/kills (Batch G). Base zoom is 1.25. */
  private zoomPunch(intensity = 0.05): void {
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    cam.setZoom(1.25);
    this.tweens.add({
      targets: cam,
      zoom: 1.25 + intensity,
      duration: 70,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => cam.setZoom(1.25),
    });
  }

  private takeHit(e: Enemy): void {
    const bite = e.bite && Math.random() < 0.28;
    if (e.hasTrait("grabber")) this.grabbedUntil = this.time.now + 700; // held in place
    if (e.hasTrait("acidic")) this.state.player.infection = clampStat(this.state.player.infection + 4); // burns
    if (e.hasTrait("brute")) {
      const a = Math.atan2(this.player.sprite.y - e.sprite.y, this.player.sprite.x - e.sprite.x);
      this.player.sprite.setVelocity(Math.cos(a) * 260, Math.sin(a) * 260); // knocked back
    }
    this.damagePlayer(
      Math.round(e.damage * this.state.difficultyModifier),
      bite,
      bite ? "Bitten — the wound burns hot." : "Claws and teeth find you.",
    );
  }

  /** Apply damage to the player (shared by contact, acid, explosions, clouds). */
  private damagePlayer(rawDmg: number, bite: boolean, msg: string, kind: DamageKind = "physical"): void {
    if (this.dead) return;
    this.cancelSearch(); // taking a hit interrupts any rummaging
    const p = this.state.player;
    const dmg = Math.max(1, Math.round(rawDmg * (1 - this.playerArmorPct() / 100) * damageTakenMult(this.state, kind)));
    p.hp = clampStat(p.hp - dmg);
    if (bite) p.infection = clampStat(p.infection + Phaser.Math.Between(8, 16));
    pushRecentEvent(this.state, msg);
    sfx.hurt();
    bloodBurst(this, this.player.sprite.x, this.player.sprite.y, 8, 0xcc2222);
    bloodDecal(this, this.player.sprite.x, this.player.sprite.y, 0.7);
    this.floatText(this.player.sprite.x, this.player.sprite.y, `-${dmg}`, "#ff6b6b");
    this.player.recoil();
    this.hurtPulse(Math.min(0.82, 0.32 + dmg / 55)); // bigger hits flash redder
    this.cameras.main.shake(130, 0.007);
    this.cameras.main.flash(110, 120, 0, 0);
    if (isDead(this.state)) this.enterDeath();
  }

  /** Equipped armour (body + head) reduces incoming damage — only worn pieces
   *  protect, and the stacked defence is clamped 0..85. */
  private playerArmorPct(): number {
    return armorDefensePct(this.state);
  }

  // --- enemy special abilities (scene-orchestrated) --------------------------

  private enemySpecials(e: Enemy, px: number, py: number, now: number): void {
    if (this.inEncounter || this.enacting || this.lootOpen || this.dead) return;
    const dist = Math.hypot(px - e.sprite.x, py - e.sprite.y);
    if (e.hasTrait("spitter") && dist > 40 && dist < 380 && e.trySpecial(now, 2200)) {
      const a = Math.atan2(py - e.sprite.y, px - e.sprite.x);
      this.spawnAcid(e.sprite.x, e.sprite.y, a, Math.max(4, Math.round(e.damage * 0.8)), e.hasTrait("acidic") || e.hasTrait("toxic"));
    } else if (e.hasTrait("electric") && dist < 120 && e.trySpecial(now, 1600)) {
      this.arcZap(e);
    } else if (e.hasTrait("screamer") && dist < e.def.aggro + 60 && e.trySpecial(now, 5200)) {
      this.screamPulse(e);
    }
  }

  /** Electric enemies arc a jagged bolt to the player: damage + a brief jolt-stun. */
  private arcZap(e: Enemy): void {
    sfx.shot();
    const sx = e.sprite.x;
    const sy = e.sprite.y;
    const ex = this.player.sprite.x;
    const ey = this.player.sprite.y;
    const g = this.add.graphics().setDepth(11);
    g.lineStyle(2, 0x9be7ff, 0.9);
    g.beginPath();
    g.moveTo(sx, sy);
    const segs = 5;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      g.lineTo(sx + (ex - sx) * t + (Math.random() - 0.5) * 14, sy + (ey - sy) * t + (Math.random() - 0.5) * 14);
    }
    g.lineTo(ex, ey);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
    this.grabbedUntil = Math.max(this.grabbedUntil, this.time.now + 250); // brief jolt-stun
    this.damagePlayer(5, false, "A jolt of current arcs through you.", "shock");
  }

  private spawnAcid(x: number, y: number, angle: number, dmg: number, poison: boolean): void {
    const at = fxTexFor(this, PROJ_PELLET, 0x8fd14a);
    const spr = this.enemyProjGroup.create(x + Math.cos(angle) * 16, y + Math.sin(angle) * 16, at.key) as Phaser.Physics.Arcade.Image;
    spr.setTint(at.tint).setScale(1.5).setDepth(9);
    this.physics.velocityFromRotation(angle, 320, (spr.body as Phaser.Physics.Arcade.Body).velocity);
    spr.setData("dmg", dmg);
    spr.setData("poison", poison);
    this.time.delayedCall(1700, () => this.killProjectile(spr));
  }

  private onEnemyProjHit(projObj: unknown): void {
    const spr = projObj as Phaser.Physics.Arcade.Image;
    if (!spr.active) return;
    const dmg = (spr.getData("dmg") as number) ?? 5;
    bloodBurst(this, spr.x, spr.y, 5, 0x8fd14a);
    if (spr.getData("poison")) this.state.player.infection = clampStat(this.state.player.infection + 4);
    this.killProjectile(spr);
    this.damagePlayer(dmg, false, "Acid spatters across you.", "toxic");
  }

  private screamPulse(e: Enemy): void {
    sfx.ui();
    const ring = this.add.circle(e.sprite.x, e.sprite.y, 80, 0xff5a6e, 0).setStrokeStyle(3, 0xff8aa0, 0.7).setDepth(7).setScale(0.1);
    this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    const base = getZombie("shambler");
    if (base) {
      const tx = Math.floor(e.sprite.x / TILE_SIZE);
      const ty = Math.floor(e.sprite.y / TILE_SIZE);
      const k = Phaser.Math.Between(1, 2);
      for (let i = 0; i < k; i++) {
        const tile = this.chunks.walkableNear(tx, ty, 2, 5);
        if (tile) this.spawnEnemy(base, tile.x, tile.y);
      }
    }
  }

  private onDeathTraits(e: Enemy): void {
    const x = e.sprite.x;
    const y = e.sprite.y;
    if (e.hasTrait("exploder")) {
      sfx.boom();
      this.cameras.main.shake(120, 0.01);
      splatHit(this, x, y, e.blood, undefined, 2.0); // bursts in its own fluid
      bloodDecal(this, x, y, 1.6, e.blood.pool);
      const radius = 84;
      if (Math.hypot(this.player.sprite.x - x, this.player.sprite.y - y) < radius) {
        this.damagePlayer(Math.round(8 + e.damage * 0.5), true, "Caught in the burst.", "toxic");
      }
      for (const o of [...this.enemies]) {
        if (o === e || Math.hypot(o.sprite.x - x, o.sprite.y - y) >= radius) continue;
        const od = { x: o.sprite.x - x, y: o.sprite.y - y };
        if (o.takeDamage(12)) this.onEnemyKilled(o);
        else splatHit(this, o.sprite.x, o.sprite.y, o.blood, od, 0.9); // splashed neighbours bleed too
      }
    }
    if (e.hasTrait("bloated") || e.hasTrait("toxic")) this.spawnToxicCloud(x, y);
    if (e.hasTrait("splitter")) {
      const base = getZombie("crawler") ?? getZombie("shambler");
      if (base) {
        const tx = Math.floor(x / TILE_SIZE);
        const ty = Math.floor(y / TILE_SIZE);
        const k = Phaser.Math.Between(2, 3);
        for (let i = 0; i < k; i++) {
          const tile = this.chunks.walkableNear(tx, ty, 1, 4);
          if (tile) this.spawnEnemy(base, tile.x, tile.y);
        }
      }
    }
  }

  private spawnToxicCloud(x: number, y: number): void {
    const g = this.add.circle(x, y, 38, 0x8fd14a, 0.18).setDepth(6);
    this.tweens.add({ targets: g, alpha: 0, duration: 4000, onComplete: () => g.destroy() });
    this.clouds.push({ x, y, r: 42, until: this.time.now + 4000, last: 0 });
  }

  private tickClouds(now: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (now > c.until) {
        this.clouds.splice(i, 1);
        continue;
      }
      if (now - c.last > 600 && Math.hypot(this.player.sprite.x - c.x, this.player.sprite.y - c.y) < c.r) {
        c.last = now;
        this.state.player.infection = clampStat(this.state.player.infection + 2);
        this.damagePlayer(3, false, "The toxic air sears your lungs.", "toxic");
      }
    }
  }

  private freezeEnemies(): void {
    for (const e of this.enemies) e.sprite.setVelocity(0, 0);
  }

  private spawnEnemy(def: ZombieDef, x: number, y: number): void {
    if (this.enemies.length >= this.enemyCap()) return; // safety cap
    const e = new Enemy(this, x, y, def);
    this.enemyGroup.add(e.sprite);
    this.enemies.push(e);
    spawnPopIn(this, e.sprite);
  }

  /** Live ceiling on concurrent enemies — far higher on a blood moon so the streets
   *  genuinely swarm rather than hitting the normal cap. */
  private enemyCap(): number {
    return this.state.bloodMoon ? 80 : 40;
  }

  /** Effective danger driver for spawns: the day plus the local distance/biome tier. */
  private effDay(): number {
    // A blood moon nudges the danger tier up so spawn-table rolls lean nastier/faster.
    return this.state.day + this.chunks.dangerTier(this.player.sprite.x, this.player.sprite.y) + (this.state.bloodMoon ? 2 : 0);
  }

  private spawnNear(spawns: Spawn[]): void {
    const ptx = this.player.tilePos().tx;
    const pty = this.player.tilePos().ty;
    const day = this.effDay();
    for (const s of spawns) {
      for (let i = 0; i < s.count; i++) {
        const tile = this.chunks.walkableNear(ptx, pty, 3, 8);
        if (tile) this.spawnEnemy(rollZombie(s.type, liveRng, day, this.chunks.biomeAtPx(tile.x, tile.y)), tile.x, tile.y);
      }
    }
  }

  // --- wild animals (Feature 6) ----------------------------------------------

  private updateAnimals(now: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    for (const a of this.animals) a.update(px, py, now);
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (Math.hypot(a.sprite.x - px, a.sprite.y - py) > 2200) {
        a.destroy(); // wandered off — despawn to stay bounded
        this.animals.splice(i, 1);
      }
    }
  }

  private spawnWildAnimals(): void {
    if (this.animals.length >= 8) return;
    if (!ANIMAL_BIOMES.has(this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y))) return;
    const { tx, ty } = this.player.tilePos();
    const n = Phaser.Math.Between(1, 2);
    for (let i = 0; i < n; i++) {
      const t = this.chunks.walkableNear(tx, ty, 6, 12);
      if (t) this.spawnAnimal(liveRng.pick(["rabbit", "deer", "deer", "boar"]) as AnimalKind, t.x, t.y);
    }
  }

  private spawnAnimal(kind: AnimalKind, x: number, y: number): void {
    const a = new Animal(this, x, y, ANIMALS[kind]);
    this.animalGroup.add(a.sprite);
    this.animals.push(a);
    spawnPopIn(this, a.sprite);
  }

  /** A melee swing also strikes the nearest animal in reach (hunting). */
  private huntNearbyAnimal(range: number, damage: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: Animal | null = null;
    let bestD = range;
    for (const a of this.animals) {
      const d = Math.hypot(a.sprite.x - px, a.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) return;
    bloodBurst(this, best.sprite.x, best.sprite.y, 8);
    if (best.takeDamage(damage)) this.killAnimal(best);
  }

  private killAnimal(a: Animal): void {
    const i = this.animals.indexOf(a);
    if (i < 0) return;
    this.animals.splice(i, 1);
    sfx.kill();
    for (const d of a.def.drops) this.spawnDrop(a.sprite.x, a.sprite.y, d.item, d.qty);
    pushRecentEvent(this.state, `Hunted a ${a.def.name}.`);
    this.grantXp("combat", 3);
    const body = a.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
    deathFade(this, a.sprite);
  }

  /** A bullet/arrow striking an animal (ranged hunting). */
  private onProjAnimal(projObj: unknown, animalObj: unknown): void {
    const spr = projObj as Phaser.Physics.Arcade.Image;
    const data = spr.getData("p") as ProjData | undefined;
    if (!data) return;
    const animal = this.animals.find((a) => a.sprite === animalObj);
    if (!animal) return;
    bloodBurst(this, animal.sprite.x, animal.sprite.y, 8);
    if (animal.takeDamage(data.damage)) this.killAnimal(animal);
    this.killProjectile(spr);
  }

  private spawnAmbientWalkers(n: number): void {
    const day = this.effDay();
    for (let i = 0; i < n; i++) {
      const tile = this.chunks.randomWalkableInView(this.player.sprite.x, this.player.sprite.y, 12);
      if (tile) this.spawnEnemy(rollAmbientUndead(liveRng, day, this.chunks.biomeAtPx(tile.x, tile.y)), tile.x, tile.y);
    }
  }

  /** Starting walker count — visible from minute one (U1 day-0 retune), still
   *  light; ongoing threats (ambientEvent/GM spawns) scale as you explore out. */
  private ambientStartCount(): number {
    return Math.min(3 + this.state.day * 2, 16);
  }

  /** Time to the next ambient threat — rare early, more frequent later/at night/far out. */
  private scheduleAmbientMs(): number {
    const base = nextAmbientDelayMs();
    const day = this.effDay();
    const dayFactor = day === 0 ? 1.5 : 1 / (1 + day * 0.12);
    const bloodFactor = this.state.bloodMoon ? 0.35 : 1; // relentless waves under a blood moon
    return base * dayFactor * (this.isNight() ? 0.6 : 1) * (this.state.weather === "storm" ? 0.7 : 1) * bloodFactor;
  }

  private ambientEvent(): void {
    const day = this.effDay();
    const bloodMoon = !!this.state.bloodMoon;
    const extra = this.state.difficultyModifier > 1.15 ? 1 : 0;
    const dayBonus = Math.floor(day / 3);
    const surge = bloodMoon ? Phaser.Math.Between(4, 6) : 0; // blood moon floods every wave
    const n = Math.min(Phaser.Math.Between(1, 2) + extra + dayBonus + surge, bloodMoon ? 14 : 6);
    const runnerChance = bloodMoon ? 0.7 : this.isNight() ? 0.32 : 0.12 + day * 0.02;
    const kind: Spawn["type"] = Math.random() < runnerChance ? "zombie_runner" : "zombie";
    this.spawnNear([{ type: kind, count: n }]);
    if (!bloodMoon) this.showToast("You hear shuffling nearby…");
  }

  /** Controls cheat-sheet: shown once per run on first spawn (replaces the old
   *  always-on HUD line) and re-summonable any time with H. Fades on its own. */
  private showControlsHint(): void {
    this.controlsHint?.destroy();
    const lines =
      "WASD move · MOUSE aim/fire · SPACE/F melee · E interact · Z rest · Shift run\n" +
      "R reload · scroll/5–0 weapon · 1–4 (or Q) quick-use · I bag · C craft · B build\n" +
      "V claim base · M map · H this help · ESC menu";
    const t = this.add
      .text(this.scale.width / 2, this.scale.height - 78, lines, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cfe6ff",
        align: "center",
        backgroundColor: "rgba(7,9,12,0.72)",
        padding: { x: 10, y: 8 },
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1400);
    this.uiLayer.add(t);
    this.controlsHint = t;
    this.tweens.add({ targets: t, alpha: 0, delay: 6500, duration: 1200, onComplete: () => {
      t.destroy();
      if (this.controlsHint === t) this.controlsHint = undefined;
    } });
  }

  private showToast(msg: string): void {
    const t = this.add
      .text(this.scale.width / 2, 74, msg, {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#ffd7d7",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1500);
    this.uiLayer.add(t); // screen-space → UI camera (unzoomed)
    this.tweens.add({ targets: t, alpha: 0, y: 54, delay: 900, duration: 900, onComplete: () => t.destroy() });
  }

  private debugInfo(): { fps: number; tx: number; ty: number; brain: string } {
    const { tx, ty } = this.player.tilePos();
    return { fps: Math.round(this.game.loop.actualFps), tx, ty, brain: getActiveBrain() };
  }

  // --- encounters (CLAUDE.md §2, §8) -----------------------------------------

  /** The building whose interior the player stands in, or null on the street. */
  private buildingAt(): Building | null {
    const { tx, ty } = this.player.tilePos();
    return this.chunks.buildingAt(tx, ty);
  }

  /** Press E to act on the current surroundings. Encounters are OPT-IN — exploring
   *  never forces a prompt; you engage the AI Game Master only when you choose to. */
  private tryInteract(): void {
    if (this.driving) {
      this.exitVehicle();
      return;
    }
    if (this.buildMode) {
      this.placeBuildable(); // E places the selected structure
      return;
    }
    const veh = this.nearestVehicle(52);
    if (veh) {
      this.tryVehicleAction(veh);
      return;
    }
    const npc = this.nearestNpc(46);
    if (npc) {
      this.openTrade(npc);
      return;
    }
    const store = this.nearestPlaceable(44, (k) => placeableDef(k).storage === true);
    if (store) {
      this.openStorage();
      return;
    }
    const chest = this.nearestChest(42);
    if (chest) {
      this.openChest(chest);
      return;
    }
    const search = this.nearestSearchable(40);
    if (search) {
      this.startSearch(search);
      return;
    }
    const boards = this.nearestBoards(42);
    if (boards) {
      this.pryBoards(boards);
      return;
    }
    if (this.tryFarmAction()) return; // till / plant / water / harvest when applicable
    // No physical target → E does nothing. The GM choice/chat modal is NOT opened on
    // demand; it fires only on a rare "dilemma" world event (see dilemmaEvent).
  }

  // --- farming (Feature 5) -----------------------------------------------------

  /** Context farm action on the tile under the player: harvest > water > plant > till. */
  private tryFarmAction(): boolean {
    const { tx, ty } = this.player.tilePos();
    const plot = plotAt(this.state, tx, ty);

    if (plot?.crop && plot.growth >= 1) {
      const def = CROPS[plot.crop];
      if (def) {
        addItem(this.state, def.produce, def.yieldQty);
        addItem(this.state, def.seed, def.seedReturn);
        this.floatText(this.player.sprite.x, this.player.sprite.y - 8, `+${def.yieldQty} ${def.produce}`, "#9ef0a0");
        sfx.pickup();
        this.grantXp("farming", 6);
        plot.crop = undefined;
        plot.growth = 0;
        plot.watered = false;
        this.refreshPlotSprites(plot);
        this.persist();
      }
      return true;
    }
    if (plot?.crop && plot.growth < 1) {
      if (!hasItem(this.state, "Watering Can")) return false;
      if (!plot.watered) {
        plot.watered = true;
        this.floatText(this.player.sprite.x, this.player.sprite.y - 8, "Watered", "#4ec3ff");
        sfx.ui();
        this.persist();
      }
      return true;
    }
    if (plot && !plot.crop) {
      const seedStack = this.state.inventory.find((s) => SEED_TO_CROP[s.item]);
      if (!seedStack) {
        this.showToast("No seeds to plant");
        return true;
      }
      const crop = SEED_TO_CROP[seedStack.item];
      removeItem(this.state, seedStack.item, 1);
      plot.crop = crop;
      plot.growth = 0;
      plot.watered = false;
      this.floatText(this.player.sprite.x, this.player.sprite.y - 8, `Planted ${CROPS[crop].name}`, "#9ef0a0");
      sfx.ui();
      this.grantXp("farming", 3);
      this.refreshPlotSprites(plot);
      this.persist();
      return true;
    }
    if (!plot && hasItem(this.state, "Hoe") && this.isTillable(tx, ty)) {
      const p = tillPlot(this.state, tx, ty);
      this.floatText(this.player.sprite.x, this.player.sprite.y - 8, "Tilled soil", "#cdb89a");
      sfx.ui();
      this.grantXp("farming", 2);
      this.refreshPlotSprites(p);
      this.persist();
      return true;
    }
    return false;
  }

  private isTillable(tx: number, ty: number): boolean {
    if (this.buildingAt()) return false;
    const t = this.chunks.tileAt(tx, ty);
    return t === Tile.Grass || t === Tile.Dirt || t === Tile.TallGrass || t === Tile.Trail;
  }

  /** The contextual "Press E" farm label under the player, or null. */
  private farmHint(): string | null {
    const { tx, ty } = this.player.tilePos();
    const plot = plotAt(this.state, tx, ty);
    if (plot?.crop && plot.growth >= 1) return `Press E to harvest ${CROPS[plot.crop]?.name ?? "crop"}`;
    if (plot?.crop && plot.growth < 1) return hasItem(this.state, "Watering Can") ? "Press E to water the crop" : null;
    if (plot && !plot.crop) {
      const seed = this.state.inventory.find((s) => SEED_TO_CROP[s.item]);
      return seed ? `Press E to plant ${CROPS[SEED_TO_CROP[seed.item]].name}` : "Tilled soil — need seeds";
    }
    if (!plot && hasItem(this.state, "Hoe") && this.isTillable(tx, ty)) return "Press E to till soil";
    return null;
  }

  /** Create/update the soil + crop-stage sprites for a plot (world-space). */
  private refreshPlotSprites(plot: FarmPlot): void {
    const k = `${plot.tx},${plot.ty}`;
    const x = (plot.tx + 0.5) * TILE_SIZE;
    const y = (plot.ty + 0.5) * TILE_SIZE;
    let rec = this.farmSprites.get(k);
    if (!rec) {
      rec = { soil: this.add.image(x, y, propKey("farm_tilled")).setDepth(3) };
      this.farmSprites.set(k, rec);
    }
    const stage = plotStage(plot);
    if (stage === 0) {
      rec.crop?.destroy();
      rec.crop = undefined;
      return;
    }
    const tex = propKey(["", "farm_sprout", "farm_growing", "farm_ripe"][stage]);
    if (!rec.crop) rec.crop = this.add.image(x, y, tex).setDepth(5);
    else rec.crop.setTexture(tex);
    if (stage === 3 && plot.crop && CROPS[plot.crop]) rec.crop.setTint(CROPS[plot.crop].color);
    else rec.crop.clearTint();
  }

  // --- vehicles (Feature 4): find → fix → fuel → drive → park -----------------

  private playerChunk(): { cx: number; cy: number } {
    const CHUNK_PX = CHUNK_TILES * TILE_SIZE;
    return { cx: Math.floor(this.player.sprite.x / CHUNK_PX), cy: Math.floor(this.player.sprite.y / CHUNK_PX) };
  }

  /** Every vehicle that should currently have a sprite, keyed by gid: deterministic
   *  spawns in range (unless driven elsewhere) + any persisted car parked into range. */
  private computeWantedVehicles(): Map<string, Vehicle> {
    const seed = this.state.seed;
    const { cx, cy } = this.playerChunk();
    const R = CHUNK_LOAD_RADIUS;
    const wanted = new Map<string, Vehicle>();
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const ccx = cx + dx;
        const ccy = cy + dy;
        if (ccx < 0 || ccy < 0 || ccx >= WORLD_CHUNKS_X || ccy >= WORLD_CHUNKS_Y) continue;
        for (const sp of chunkVehicles(seed, ccx, ccy)) {
          const v = resolveVehicle(this.state, seed, sp);
          const vc = vehicleChunkOf(v);
          if (vc.cx === ccx && vc.cy === ccy) wanted.set(v.gid, v); // skip cars driven away
        }
      }
    }
    for (const v of this.state.vehicles ?? []) {
      if (wanted.has(v.gid)) continue; // persisted car parked away from its spawn chunk
      const vc = vehicleChunkOf(v);
      if (Math.abs(vc.cx - cx) <= R && Math.abs(vc.cy - cy) <= R) wanted.set(v.gid, v);
    }
    return wanted;
  }

  /** Stream parked-vehicle sprites in/out as the player crosses chunks (cheap; gated). */
  private reconcileVehicles(force = false): void {
    const { cx, cy } = this.playerChunk();
    if (!force && !this.vehiclesDirty && cx === this.lastVehCx && cy === this.lastVehCy) return;
    this.lastVehCx = cx;
    this.lastVehCy = cy;
    this.vehiclesDirty = false;
    const wanted = this.computeWantedVehicles();
    for (const [gid, av] of [...this.vehicleSprites]) {
      if (!wanted.has(gid) && this.driving?.gid !== gid) {
        av.sprite.destroy();
        this.vehicleSprites.delete(gid);
      }
    }
    for (const [gid, v] of wanted) {
      if (this.driving?.gid === gid) continue; // hidden while you're driving it
      const existing = this.vehicleSprites.get(gid);
      if (existing) {
        existing.data = v;
        this.styleVehicleSprite(existing);
      } else {
        this.spawnVehicleSprite(v);
      }
    }
  }

  private spawnVehicleSprite(v: Vehicle): ActiveVehicle {
    const key = propKey(`veh_${v.type}`);
    const tex = this.textures.exists(key) ? key : propKey("car");
    const spr = this.add.image(v.x, v.y, tex).setDepth(6);
    const av: ActiveVehicle = { gid: v.gid, type: v.type, sprite: spr, data: v };
    this.styleVehicleSprite(av);
    this.vehicleSprites.set(v.gid, av);
    return av;
  }

  private styleVehicleSprite(av: ActiveVehicle): void {
    const def = vehicleDef(av.type);
    // fxTexFor keeps the per-type body colour on the Canvas renderer too.
    const t = fxTexFor(this, propKey(`veh_${av.type}`), def.tint);
    if (this.textures.exists(t.key)) av.sprite.setTexture(t.key);
    av.sprite.setScale(def.scale).setTint(t.tint).setPosition(av.data.x, av.data.y);
    av.sprite.setAlpha(isRepaired(av.data) ? 1 : 0.82); // wrecks look duller until fixed
  }

  private nearestVehicle(maxDist: number): ActiveVehicle | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: ActiveVehicle | null = null;
    let bestD = maxDist;
    for (const av of this.vehicleSprites.values()) {
      const d = Math.hypot(av.sprite.x - px, av.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = av;
      }
    }
    return best;
  }

  private vehicleHint(av: ActiveVehicle): string {
    const name = vehicleDef(av.type).name;
    if (!isRepaired(av.data)) return `Press E to fit ${nextNeed(av.data)} — ${name} needs: ${av.data.needs.join(", ")}`;
    if (av.data.fuel <= 0) return `Press E to fuel the ${name} (Fuel Canister)`;
    return `Press E to drive the ${name}`;
  }

  private tryVehicleAction(av: ActiveVehicle): void {
    if (!isRepaired(av.data)) {
      this.tryRepairVehicle(av);
      return;
    }
    if (av.data.fuel <= 0) {
      this.tryFuelVehicle(av);
      return;
    }
    this.enterVehicle(av);
  }

  private tryRepairVehicle(av: ActiveVehicle): void {
    const part = nextNeed(av.data);
    if (!part) return;
    if (!hasItem(this.state, part)) {
      this.showToast(`Need ${part} to repair the ${vehicleDef(av.type).name}`);
      sfx.ui();
      return;
    }
    removeItem(this.state, part, 1);
    fitPart(av.data, part);
    sfx.swing();
    this.floatText(av.sprite.x, av.sprite.y - 12, `Fitted ${part}`, "#9ef0a0");
    this.grantXp("mechanics", 5);
    if (isRepaired(av.data)) {
      this.showToast("The engine turns over — it just needs fuel.");
      pushRecentEvent(this.state, `Repaired a ${vehicleDef(av.type).name}.`);
    }
    upsertVehicle(this.state, av.data);
    this.styleVehicleSprite(av);
    this.vehiclesDirty = true;
    this.persist();
  }

  private tryFuelVehicle(av: ActiveVehicle): void {
    if (!hasItem(this.state, "Fuel Canister")) {
      this.showToast("Need a Fuel Canister to fuel the tank");
      sfx.ui();
      return;
    }
    removeItem(this.state, "Fuel Canister", 1);
    av.data.fuel = Math.min(FUEL_MAX, av.data.fuel + FUEL_PER_CAN);
    sfx.pickup();
    this.floatText(av.sprite.x, av.sprite.y - 12, `Fuel +${FUEL_PER_CAN}`, "#ffd23f");
    upsertVehicle(this.state, av.data);
    this.vehiclesDirty = true;
    this.persist();
  }

  /** Climb in: the player "becomes" the car — faster, runs zombies down, immune to
   *  bites, but loud. The parked sprite is hidden until you park again. */
  private enterVehicle(av: ActiveVehicle): void {
    if (!isDrivable(av.data)) return;
    this.driving = av;
    av.sprite.destroy();
    this.vehicleSprites.delete(av.gid);
    const def = vehicleDef(av.type);
    const t = fxTexFor(this, propKey(`veh_${av.type}`), def.tint);
    if (this.textures.exists(t.key)) this.player.sprite.setTexture(t.key);
    this.player.sprite.setScale(def.scale).setTint(t.tint);
    this.player.speedMult = def.speedMult;
    this.weaponSprite.setVisible(false);
    this.weaponGlow.setVisible(false);
    this.firing = false;
    sfx.ui();
    this.showToast(`Driving the ${def.name} — run them down (E to park)`);
  }

  /** Park: write position + fuel back to the persisted record and step out on foot. */
  private exitVehicle(): void {
    const av = this.driving;
    if (!av) return;
    av.data.x = this.player.sprite.x;
    av.data.y = this.player.sprite.y;
    upsertVehicle(this.state, av.data);
    this.driving = null;
    this.player.speedMult = 1;
    this.player.sprite.setTexture(PLAYER_KEY).setScale(1);
    this.player.setAppearance(this.state.appearance?.color);
    this.spawnVehicleSprite(av.data); // re-show it where you parked
    this.vehiclesDirty = true;
    sfx.ui();
    this.showToast("Parked.");
    this.persist();
  }

  /** Per-frame driving: drain fuel while moving, mow down zombies, stall when empty. */
  private driveTick(delta: number): void {
    const av = this.driving;
    if (!av) return;
    if (this.player.isMoving()) {
      av.data.fuel = Math.max(0, av.data.fuel - delta * 0.0013);
      this.runOverZombies();
    }
    if (av.data.fuel <= 0) {
      this.showToast("Out of fuel — the engine dies.");
      this.exitVehicle();
    }
  }

  /** Zombies caught under a moving vehicle are crushed (heavy damage + blood). */
  private runOverZombies(): void {
    if (!this.driving) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const reach = 30 * vehicleDef(this.driving.type).scale;
    const now = this.time.now;
    for (const e of [...this.enemies]) {
      if (Math.hypot(e.sprite.x - px, e.sprite.y - py) < reach) {
        const dead = e.takeDamage(60);
        if (dead) this.onEnemyKilled(e); // gibs + pool handled there
        else if (e.crushFxReady(now)) {
          // throttled so a slow boss under the wheels doesn't spray every frame
          const rdir = { x: e.sprite.x - px, y: e.sprite.y - py };
          splatHit(this, e.sprite.x, e.sprite.y, e.blood, rdir, 1.5); // crushed under the wheels
          bloodDecal(this, e.sprite.x, e.sprite.y, 1.1, e.blood.pool); // splatHit already lays the smear
        }
      }
    }
  }

  // --- base building (Feature 7): claim → build → siege → storage -------------

  /** Stream built-structure sprites + static bodies in/out as the player crosses
   *  chunks (placeables are all player-built, so "wanted" is simply the persisted
   *  list filtered to in-range chunks). */
  private reconcilePlaceables(force = false): void {
    const { cx, cy } = this.playerChunk();
    if (!force && !this.placeablesDirty && cx === this.lastPlCx && cy === this.lastPlCy) return;
    this.lastPlCx = cx;
    this.lastPlCy = cy;
    this.placeablesDirty = false;
    const R = CHUNK_LOAD_RADIUS;
    const wanted = new Map<string, Placeable>();
    for (const p of this.state.placeables ?? []) {
      const pcx = Math.floor(p.tx / CHUNK_TILES);
      const pcy = Math.floor(p.ty / CHUNK_TILES);
      if (Math.abs(pcx - cx) <= R && Math.abs(pcy - cy) <= R) wanted.set(p.gid, p);
    }
    for (const [gid, ap] of [...this.placeableSprites]) {
      if (!wanted.has(gid)) this.destroyPlaceableSprite(ap);
    }
    for (const [gid, p] of wanted) {
      const ex = this.placeableSprites.get(gid);
      if (ex) ex.data = p;
      else this.spawnPlaceableSprite(p);
    }
  }

  private spawnPlaceableSprite(p: Placeable): ActivePlaceable {
    const def = placeableDef(p.kind);
    const x = (p.tx + 0.5) * TILE_SIZE;
    const y = (p.ty + 0.5) * TILE_SIZE;
    const key = propKey(`base_${p.kind}`);
    const tex = this.textures.exists(key) ? key : propKey("crate");
    let spr: Phaser.GameObjects.Image;
    if (def.blocks) {
      spr = this.placeGroup.create(x, y, tex) as Phaser.Physics.Arcade.Image; // static body fortifies
      spr.setDepth(5);
    } else {
      spr = this.add.image(x, y, tex).setDepth(def.station === "campfire" ? 4 : 5);
    }
    if (def.hp > 0) spr.setAlpha(0.55 + 0.45 * (p.hp / p.maxHp));
    const ap: ActivePlaceable = { gid: p.gid, kind: p.kind, sprite: spr, data: p };
    this.placeableSprites.set(p.gid, ap);
    return ap;
  }

  private destroyPlaceableSprite(ap: ActivePlaceable): void {
    ap.sprite.destroy(); // also removes it from placeGroup + frees its static body
    this.placeableSprites.delete(ap.gid);
  }

  private nearestPlaceable(maxDist: number, filter?: (kind: string) => boolean): ActivePlaceable | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: ActivePlaceable | null = null;
    let bestD = maxDist;
    for (const ap of this.placeableSprites.values()) {
      if (filter && !filter(ap.kind)) continue;
      const d = Math.hypot(ap.sprite.x - px, ap.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = ap;
      }
    }
    return best;
  }

  private currentBuildKind(): string {
    return BUILD_ORDER[this.buildIdx % BUILD_ORDER.length];
  }

  private itemHave(item: string): number {
    return this.state.inventory.find((i) => i.item === item)?.qty ?? 0;
  }

  private toggleBuild(): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen || this.driving) return;
    this.buildMode = !this.buildMode;
    if (this.buildMode) {
      this.firing = false;
      if (!this.buildGhost) {
        this.buildGhost = this.add
          .image(this.player.sprite.x, this.player.sprite.y, propKey(`base_${this.currentBuildKind()}`))
          .setDepth(12)
          .setAlpha(0.55);
      }
      this.buildGhost.setVisible(true);
      sfx.ui();
      this.showToast(`Build mode: ${placeableDef(this.currentBuildKind()).name} — wheel to switch, E to place, B to exit`);
    } else {
      this.buildGhost?.setVisible(false);
    }
  }

  private cycleBuild(dir: number): void {
    if (!this.buildMode) return;
    this.buildIdx = (this.buildIdx + dir + BUILD_ORDER.length) % BUILD_ORDER.length;
    const def = placeableDef(this.currentBuildKind());
    const key = propKey(`base_${def.id}`);
    if (this.buildGhost && this.textures.exists(key)) this.buildGhost.setTexture(key);
    sfx.ui();
    this.showToast(`Build: ${def.name} (${def.cost.map((c) => `${c.qty} ${c.item}`).join(", ")})`);
  }

  /** The tile one step ahead of the player's facing — where the ghost/structure goes. */
  private buildTargetTile(): { tx: number; ty: number } {
    const ang = this.player.sprite.rotation;
    const fx = this.player.sprite.x + Math.cos(ang) * TILE_SIZE;
    const fy = this.player.sprite.y + Math.sin(ang) * TILE_SIZE;
    return { tx: Math.floor(fx / TILE_SIZE), ty: Math.floor(fy / TILE_SIZE) };
  }

  private canPlaceAt(tx: number, ty: number): boolean {
    if (placeableAt(this.state, tx, ty)) return false; // one per tile
    return this.chunks.walkable(tx, ty); // not in a wall/water/tree
  }

  private updateBuildGhost(): void {
    if (!this.buildGhost) return;
    const { tx, ty } = this.buildTargetTile();
    this.buildGhost.setPosition((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE);
    const def = placeableDef(this.currentBuildKind());
    const ok = this.canPlaceAt(tx, ty) && canAfford(this.state, def);
    this.buildGhost.setTint(ok ? 0x6effa0 : 0xff6b6b);
  }

  private buildHint(): string {
    const def = placeableDef(this.currentBuildKind());
    const cost = def.cost.map((c) => `${this.itemHave(c.item)}/${c.qty} ${c.item}`).join(", ");
    return `Build ${def.name} — ${cost} · wheel switch · E place · B exit`;
  }

  private placeBuildable(): void {
    const { tx, ty } = this.buildTargetTile();
    const kind = this.currentBuildKind();
    const def = placeableDef(kind);
    if (!this.canPlaceAt(tx, ty)) {
      this.showToast("Can't build there");
      sfx.ui();
      return;
    }
    if (!canAfford(this.state, def)) {
      this.showToast(`Need ${def.cost.map((c) => `${c.qty} ${c.item}`).join(", ")}`);
      sfx.ui();
      return;
    }
    if (!buildPlaceable(this.state, kind, tx, ty)) return;
    this.placeablesDirty = true;
    this.reconcilePlaceables(true);
    sfx.swing();
    this.floatText((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE - 10, `Built ${def.name}`, "#9ef0a0");
    this.grantXp("crafting", 4);
    pushRecentEvent(this.state, `Built a ${def.name}.`);
    this.hud.update(this.state, this.debugInfo());
    this.persist();
  }

  /** V inside a building: claim it as home (or release it). The base anchors safety. */
  private claimToggle(): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen) return;
    const b = this.buildingAt();
    if (!b) {
      this.showToast("Stand inside a building to claim it");
      return;
    }
    if (isBaseClaimed(this.state, b.gid)) {
      this.state.base = undefined;
      this.showToast("Released your base claim");
    } else {
      claimBase(this.state, b.gid, b.center.x, b.center.y, b.type.replace(/_/g, " "));
      this.showToast(`Claimed the ${b.type.replace(/_/g, " ")} as your base`);
      pushRecentEvent(this.state, "Claimed a home base.");
    }
    sfx.ui();
    this.updateObjective();
    this.hud.update(this.state, this.debugInfo());
    this.persist();
  }

  private buildingHint(b: Building): string {
    // E no longer searches buildings (text-encounters are dormant) — the only
    // building action is claiming it as a base, so the hint shows just that.
    const name = b.type.replace(/_/g, " ");
    if (isBaseClaimed(this.state, b.gid)) return `${name} · your base (V to release)`;
    return `${name} · V to claim as base`;
  }

  private openStorage(): void {
    if (this.dead || this.inEncounter || this.tradeOpen) return;
    this.storeOpen = true;
    this.setGameKeys(false);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.storeUi.open(this.state);
  }

  /** Zombies pressed against barricades gnaw them down; spike traps wound crossers. */
  private tickSiege(): void {
    if (this.placeableSprites.size === 0 || this.enemies.length === 0) return;
    let changed = false;
    for (const ap of [...this.placeableSprites.values()]) {
      const def = placeableDef(ap.kind);
      const x = ap.sprite.x;
      const y = ap.sprite.y;
      if (def.damage && def.damage > 0) {
        let hits = 0;
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.sprite.x - x, e.sprite.y - y) < 22) {
            hits++;
            splatHit(this, e.sprite.x, e.sprite.y, e.blood, { x: e.sprite.x - x, y: e.sprite.y - y }, 0.9); // spikes bite
            if (e.takeDamage(def.damage)) this.onEnemyKilled(e);
          }
        }
        if (hits > 0 && def.hp > 0 && damagePlaceable(this.state, ap.data, hits * 2)) {
          this.destroyPlaceableSprite(ap);
          changed = true;
        }
      }
      if (def.hp > 0 && def.blocks) {
        let n = 0;
        for (const e of this.enemies) if (Math.hypot(e.sprite.x - x, e.sprite.y - y) < 40) n++;
        if (n > 0) {
          dustPuff(this, x, y, 3);
          if (damagePlaceable(this.state, ap.data, n * 5)) {
            bloodBurst(this, x, y, 8, 0x6e5230);
            this.destroyPlaceableSprite(ap);
            changed = true;
          } else {
            ap.sprite.setAlpha(0.55 + 0.45 * (ap.data.hp / ap.data.maxHp));
          }
        }
      }
    }
    if (changed) this.persist();
  }

  /** Crafting stations (campfire/workbench) within reach gate station-only recipes. */
  private stationsNear(): Set<string> {
    const out = new Set<string>();
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    for (const ap of this.placeableSprites.values()) {
      const st = placeableDef(ap.kind).station;
      if (st && Math.hypot(ap.sprite.x - px, ap.sprite.y - py) < 70) out.add(st);
    }
    return out;
  }

  // --- living world (Feature 10): discovery, events, radio --------------------

  /** Mark the player's chunk + neighbours discovered (minimap fog) and catalogue the
   *  current chunk's landmarks onto the map. Cheap — gated on a chunk crossing. */
  private discoverAround(): void {
    const { cx, cy } = this.playerChunk();
    if (cx === this.lastDiscCx && cy === this.lastDiscCy) return;
    this.lastDiscCx = cx;
    this.lastDiscCy = cy;
    this.state.discovered = this.state.discovered ?? [];
    const set = new Set(this.state.discovered);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_CHUNKS_X || ny >= WORLD_CHUNKS_Y) continue;
        const k = `${nx},${ny}`;
        if (!set.has(k)) {
          set.add(k);
          this.state.discovered.push(k);
        }
      }
    }
    for (const lm of this.chunks.landmarksAt(cx, cy)) this.revealLocation(lm.label, lm.kind, lm.x, lm.y);
    this.triggerAmbushes(cx, cy); // set-piece guard packs wake on first visit (U2)
    this.reconcileStashes(); // stream buried caches pinned by stash maps (U2)
    this.objectiveEvent({ kind: "chunk_entered", cx, cy }); // safehouse reach (U3)
    this.updateAmbience(); // the bed follows the biome (U4)
    this.reconcileBuildingOverlays(); // boarded/infested/trapped buildings (U5)
    this.reconcileCampNpcs(); // resident camp rosters (U5)
  }

  // --- interactive buildings (U5): boarded / infested / trapped ---------------

  /** Stream overlays for non-normal buildings in the 3×3 chunk window. */
  private reconcileBuildingOverlays(): void {
    const { cx, cy } = this.playerChunk();
    const wanted = new Map<string, Building>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const b of this.chunks.buildingsAt(cx + dx, cy + dy)) {
          if (effectiveState(this.state.seed, b, this.state) !== "normal") wanted.set(b.gid, b);
        }
      }
    }
    for (const [gid, fx] of [...this.buildingFx]) {
      if (!wanted.has(gid)) this.destroyBuildingFx(gid, fx);
    }
    for (const [gid, b] of wanted) {
      if (this.buildingFx.has(gid)) continue;
      const mood = effectiveState(this.state.seed, b, this.state);
      const rec: BuildingFx = { mood, b, lastCue: 0 };
      if (mood === "boarded") {
        const x = (b.door.x + 0.5) * TILE_SIZE;
        const y = (b.door.y + 0.5) * TILE_SIZE;
        rec.sprite = this.placeGroup.create(x, y, propKey("boards")) as Phaser.GameObjects.Image;
        rec.sprite.setDepth(5); // static body: the doorway is physically blocked
      }
      this.buildingFx.set(gid, rec);
    }
  }

  private destroyBuildingFx(gid: string, fx: BuildingFx): void {
    fx.sprite?.destroy();
    this.buildingFx.delete(gid);
  }

  /** The nearest pryable boarded doorway. */
  private nearestBoards(maxDist: number): BuildingFx | null {
    let best: BuildingFx | null = null;
    let bestD = maxDist;
    for (const fx of this.buildingFx.values()) {
      if (fx.mood !== "boarded" || !fx.sprite?.active) continue;
      const d = Math.hypot(fx.sprite.x - this.player.sprite.x, fx.sprite.y - this.player.sprite.y);
      if (d < bestD) {
        bestD = d;
        best = fx;
      }
    }
    return best;
  }

  /** Pry a boarded doorway open with a Crowbar — untouched shelves await (U5). */
  private pryBoards(fx: BuildingFx): void {
    if (!hasItem(this.state, "Crowbar")) {
      this.showToast("Boarded up tight — you need a Crowbar");
      sfx.ui();
      return;
    }
    this.state.worldFlags.push(priedFlag(fx.b.gid));
    sfx.pry();
    dustPuff(this, fx.sprite?.x ?? this.player.sprite.x, fx.sprite?.y ?? this.player.sprite.y, 5);
    this.floatText(this.player.sprite.x, this.player.sprite.y - 8, "Pried the boards loose", "#9ef0a0");
    this.grantXp("crafting", 2);
    pushRecentEvent(this.state, "Pried open a boarded building.");
    this.destroyBuildingFx(fx.b.gid, fx);
    this.persist();
  }

  /** Slow tick (2s): infested doors bang then burst; trapped survivors knock and
   *  are freed when you step inside. */
  private tickBuildingMoods(): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const now = this.time.now;
    for (const [gid, fx] of [...this.buildingFx]) {
      const doorX = (fx.b.door.x + 0.5) * TILE_SIZE;
      const doorY = (fx.b.door.y + 0.5) * TILE_SIZE;
      const d = Math.hypot(doorX - px, doorY - py);
      if (fx.mood === "infested") {
        if (d < 90) {
          this.state.worldFlags.push(clearedFlag(gid));
          this.destroyBuildingFx(gid, fx);
          const n = Phaser.Math.Between(3, 5);
          for (let i = 0; i < n; i++) {
            if (this.enemies.length >= 34) break;
            const spot = this.chunks.walkableNear(fx.b.door.x, fx.b.door.y, 1, 3);
            if (spot) this.spawnEnemy(rollZombie("zombie", liveRng, this.effDay(), this.chunks.biomeAtPx(spot.x, spot.y)), spot.x, spot.y);
          }
          sfx.sting();
          this.cameras.main.shake(120, 0.006);
          this.showToast("They were inside the walls!");
          pushRecentEvent(this.state, "An infested building burst open.");
          this.persist();
        } else if (d < 280 && now - fx.lastCue > 1700) {
          fx.lastCue = now;
          sfx.knock();
          dustPuff(this, doorX, doorY, 2);
        }
      } else if (fx.mood === "trapped") {
        if (this.buildingAt()?.gid === gid) {
          this.state.worldFlags.push(rescuedFlag(gid));
          this.destroyBuildingFx(gid, fx);
          const spot = this.chunks.walkableNear(fx.b.door.x, fx.b.door.y, 1, 3) ?? { x: px, y: py };
          const npc = this.spawnSurvivor(spot.x, spot.y);
          addStanding(this.state, npc.faction, 6);
          for (const s of rollLoot("house", liveRng, 1, 0.3)) this.spawnDrop(spot.x, spot.y, s.item, s.qty);
          this.showToast(`You freed ${npc.name}! (+${npc.faction} standing)`);
          pushRecentEvent(this.state, "Freed a trapped survivor.");
          this.persist();
        } else if (d < 220 && now - fx.lastCue > 2600) {
          fx.lastCue = now;
          sfx.knock();
        }
      }
    }
  }

  // --- living camps (U5): resident rosters around camp landmarks --------------

  /** Stream deterministic camp rosters (guards + a trader) with home tethers;
   *  recruitment/death suppress via npc_gone flags, so camps remember. */
  private reconcileCampNpcs(): void {
    const { cx, cy } = this.playerChunk();
    const wantedCamps = new Map<string, { x: number; y: number; ccx: number; ccy: number }>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ccx = cx + dx;
        const ccy = cy + dy;
        for (const lm of this.chunks.landmarksAt(ccx, ccy)) {
          if (CAMP_LANDMARKS.has(lm.kind)) {
            wantedCamps.set(`${ccx},${ccy}`, { x: lm.x, y: lm.y, ccx, ccy });
            break;
          }
        }
      }
    }
    for (const [key, fire] of [...this.campFires]) {
      if (!wantedCamps.has(key)) {
        fire?.destroy();
        this.campFires.delete(key);
      }
    }
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      if (n.kind !== "survivor" || !n.id.startsWith("camp_")) continue;
      const m = /^camp_(-?\d+)_(-?\d+)_/.exec(n.id);
      if (m && !wantedCamps.has(`${m[1]},${m[2]}`)) {
        n.destroy();
        this.npcs.splice(i, 1);
      }
    }
    for (const [key, c] of wantedCamps) {
      if (!this.campFires.has(key)) {
        const fireKey = propKey("base_campfire");
        this.campFires.set(key, this.textures.exists(fireKey) ? this.add.image(c.x + 16, c.y + 10, fireKey).setDepth(4) : null);
      }
      const biome = this.chunks.chunkBiome(c.ccx, c.ccy) ?? this.chunks.biomeAtPx(c.x, c.y);
      const fac = factionForBiome(biome);
      for (const mate of campRoster(this.state.seed, c.ccx, c.ccy, fac)) {
        if (this.state.worldFlags.includes(npcGoneFlag(mate.id))) continue; // recruited away or dead
        if (this.state.npcs?.some((n) => n.id === mate.id)) continue; // travelling with you
        if (this.npcs.some((n) => n.id === mate.id)) continue; // already live
        const spot = this.chunks.walkableNear(Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE), 1, 3) ?? { x: c.x + 20, y: c.y + 20 };
        const hp = Math.round(45 * tierMeta(mate.tier).hpMul);
        const name = mate.role === "trader" ? `${mate.name} (trader)` : mate.name;
        this.makeNpc(spot.x, spot.y, mate.id, name, fac, "survivor", hp, hp, mate.tier, { x: c.x, y: c.y, r: 90 });
      }
    }
  }

  // --- street encounters (U5): the roads are inhabited from day 0 -------------

  private streetEncounter(): void {
    if (this.dead || this.enemies.length >= 30 || this.npcs.length >= 6) return;
    const roll = Math.random();
    const { tx, ty } = this.player.tilePos();
    if (roll < 0.45) {
      // a survivor fleeing a pack — cover their escape for standing
      const spot = this.chunks.walkableNear(tx, ty, 8, 12);
      if (!spot) return;
      const npc = this.spawnSurvivor(spot.x, spot.y);
      this.spawnNear([{ type: "zombie", count: Phaser.Math.Between(2, 3) }]);
      this.rescueWatch = { id: npc.id, until: this.time.now + 25000, faction: npc.faction };
      this.showToast(`${npc.name} is running from a pack — cover them!`);
    } else if (roll < 0.7 && this.effDay() >= 1) {
      this.spawnNear([{ type: "survivor_hostile", count: 2 }]);
      this.showToast("Raiders spring an ambush!");
    } else {
      const spot = this.chunks.walkableNear(tx, ty, 6, 10);
      if (!spot) return;
      const npc = this.spawnSurvivor(spot.x, spot.y);
      this.showToast(`${npc.name} is passing through — trade while you can (E)`);
    }
  }

  /** Did the fleeing survivor make it? Checked on the slow sweep. */
  private checkRescue(): void {
    const w = this.rescueWatch;
    if (!w) return;
    const npc = this.npcs.find((n) => n.id === w.id);
    if (!npc) {
      this.rescueWatch = null; // they fell — the world moves on
      return;
    }
    if (this.time.now < w.until) return;
    this.rescueWatch = null;
    if (!this.nearestEnemyTo(npc.sprite.x, npc.sprite.y, 280)) {
      addStanding(this.state, w.faction, 6);
      this.showToast(`${npc.name} made it — the ${w.faction} will remember (+standing)`);
      pushRecentEvent(this.state, "Covered a fleeing survivor.");
      this.persist();
    }
  }

  /** Drive the ambient audio bed from the biome group + time of day (U4). */
  private updateAmbience(): void {
    const biome = this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y);
    const WATERY = new Set(["lake", "riverbank", "coast", "marsh", "ocean", "wetland"]);
    const urban = BIOMES[biome as BiomeId]?.urban ?? false;
    const group = WATERY.has(biome) ? "water" : urban ? "city" : "nature";
    sfx.setAmbience(group, this.isNight());
  }

  /** The nearest shambler within earshot rasps from its direction (U4). */
  private proximityGroan(): void {
    const e = this.nearestEnemy(600);
    if (!e) return;
    const dx = e.sprite.x - this.player.sprite.x;
    sfx.groan(Math.max(-1, Math.min(1, dx / 400)), Math.hypot(dx, e.sprite.y - this.player.sprite.y));
  }

  /** Edge-triggered dissonant sting when a pack closes in (≥3 within 260px). */
  private checkDangerSting(): void {
    let close = 0;
    for (const e of this.enemies) {
      const dx = e.sprite.x - this.player.sprite.x;
      const dy = e.sprite.y - this.player.sprite.y;
      if (dx * dx + dy * dy < 260 * 260) close++;
    }
    const packClose = close >= 3;
    if (packClose && !this.packWasClose && this.time.now >= this.stingReadyAt) {
      this.stingReadyAt = this.time.now + 20000;
      sfx.sting();
    }
    this.packWasClose = packClose;
  }

  /** Wake a set-piece scene's guard pack the first time its chunk is entered.
   *  Session-only — like all ambient undead, they regenerate between sessions. */
  private triggerAmbushes(cx: number, cy: number): void {
    const specs = this.chunks.ambushAt(cx, cy);
    for (let i = 0; i < specs.length; i++) {
      const key = `${cx},${cy}:${i}`;
      if (this.ambushDone.has(key) || this.enemies.length >= 30) continue;
      this.ambushDone.add(key);
      const a = specs[i];
      for (let k = 0; k < a.count; k++) {
        const spot = this.chunks.walkableNear(Math.floor(a.x / TILE_SIZE), Math.floor(a.y / TILE_SIZE), 1, 4);
        if (spot) this.spawnEnemy(rollZombie("zombie", liveRng, this.effDay(), this.chunks.biomeAtPx(spot.x, spot.y)), spot.x, spot.y);
      }
    }
  }

  /** Spawn/despawn the locked tier-3 chests pinned by read stash maps. Wanted =
   *  un-dug `stash_<tx>_<ty>` flags whose tile sits in a LOADED chunk. */
  private reconcileStashes(): void {
    const wanted = new Map<string, { tx: number; ty: number }>();
    for (const f of this.state.worldFlags) {
      if (!f.startsWith("stash_")) continue;
      if (this.state.worldFlags.includes(`chest_${f}`)) continue; // dug up already
      const t = parseStashFlag(f);
      if (!t || this.chunks.tileAt(t.tx, t.ty) === null) continue; // not loaded
      wanted.set(f, t);
    }
    for (const [f, chest] of this.stashChests) {
      if (!wanted.has(f)) {
        chest.sprite.destroy();
        chest.badge?.destroy();
        this.stashChests.delete(f);
      }
    }
    for (const [f, t] of wanted) {
      if (this.stashChests.has(f)) continue;
      const x = (t.tx + 0.5) * TILE_SIZE;
      const y = (t.ty + 0.5) * TILE_SIZE;
      const ct = fxTexFor(this, CHEST_CLOSED, 0x8a6a3a);
      const spr = this.add.image(x, y, ct.key).setDepth(6).setTint(ct.tint);
      const chest: ActiveChest = { gid: f, sprite: spr, tier: 3, kind: "crate", locked: true, opened: false };
      chest.badge = this.add.image(x + 9, y - 8, PADLOCK).setDepth(7);
      this.stashChests.set(f, chest);
    }
  }

  /** Read a note/journal (deterministic flavour, stored on the stack) or use a
   *  Stash Map (consumed; pins a buried cache as a stash_ flag + map marker). */
  private readItem(name: string): void {
    const def = defOf(name);
    if (def.kind !== "readable") return;
    if (def.flavor === "map") {
      const spot = rollStashSpot(this.state.seed, this.player.sprite.x, this.player.sprite.y, stashCount(this.state));
      removeItem(this.state, name, 1); // consumed either way
      if (!spot) {
        this.showToast("The map is water-ruined — unreadable");
        this.persist();
        return;
      }
      this.state.worldFlags.push(stashFlag(spot.tx, spot.ty));
      const px = (spot.tx + 0.5) * TILE_SIZE;
      const py = (spot.ty + 0.5) * TILE_SIZE;
      this.revealLocation("Buried cache", "stash", px, py);
      const dir = compassDir(px - this.player.sprite.x, py - this.player.sprite.y);
      this.reader.open(
        "Stash map",
        `A hand-drawn map, creased and bloodstained. An X marks a cache to the ${dir}.\n\nThe spot is pinned on your map (M). Bring something to force the lock.`,
      );
      pushRecentEvent(this.state, "Read a stash map — a cache is marked.");
      sfx.ui();
      this.reconcileStashes();
      this.persist();
      return;
    }
    const inv = this.state.inventory.find((i) => i.item === name);
    if (!inv) return;
    if (!inv.note) {
      const n = this.state.notesRead ?? 0;
      this.state.notesRead = n + 1;
      inv.note = noteText(this.state.seed, n, def.flavor === "journal" ? "journal" : "note");
    }
    this.reader.open(def.name, inv.note);
    sfx.ui();
    this.persist();
  }

  /** Add a point of interest to the map (deduped by name + position). */
  private revealLocation(name: string, type: string, x: number, y: number): void {
    const list: KnownLocation[] = this.state.knownLocations ?? (this.state.knownLocations = []);
    if (list.some((l) => l.name === name && Math.abs(l.x - x) < 8 && Math.abs(l.y - y) < 8)) return;
    list.push({ name, type, x, y });
  }

  /** A timed world set-piece — horde, raiders, flyover, supply drop, or trader. */
  private worldEvent(): void {
    if (this.dead) return;
    const day = this.effDay();
    const kind: WorldEventKind = rollWorldEvent(liveRng, day, this.isNight());
    switch (kind) {
      case "horde": {
        const n = Math.min(5 + Math.floor(day / 2) + (this.state.bloodMoon ? 6 : 0), this.state.bloodMoon ? 18 : 12);
        this.spawnNear([{ type: this.isNight() || this.state.bloodMoon ? "zombie_runner" : "zombie", count: n }]);
        sfx.sting(); // a horde deserves the dread chord (U4)
        this.showToast("A horde is moving through the area…");
        break;
      }
      case "raiders":
        this.spawnNear([{ type: "survivor_hostile", count: Phaser.Math.Between(2, 3) }]);
        this.showToast("Raiders are prowling nearby — watch yourself.");
        break;
      case "flyover":
        this.showToast("A military helicopter thunders overhead.");
        this.airDrop(2);
        this.spawnNear([{ type: "zombie", count: Phaser.Math.Between(2, 4) }]); // the noise draws them
        break;
      case "supply_drop":
        this.showToast("A supply drop came down nearby — check your map (M).");
        this.airDrop(3);
        break;
      case "trader": {
        const { tx, ty } = this.player.tilePos();
        const spot = this.chunks.walkableNear(tx, ty, 5, 10);
        if (spot) this.spawnSurvivor(spot.x, spot.y);
        this.showToast("A trader has wandered into the area — find them (E to trade).");
        break;
      }
      case "dilemma":
        this.dilemmaEvent(); // the rare event that opens the GM choice/chat modal
        break;
      case "smoke":
      case "flare":
      case "gunfight":
      case "car_alarm":
        this.spawnBeacon(kind); // a DISTANT happening you can go investigate (U4)
        break;
    }
  }

  // --- heartbeat beacons (U4): distant, investigable happenings --------------

  /** Drop an event beacon 1–2 chunks out: pulsing map ping + world FX/audio +
   *  a compass toast. Investigating (<400px) resolves it; otherwise it expires. */
  private spawnBeacon(kind: WorldEventKind): void {
    if (this.beacons.length >= 2) return; // cap live beacons
    const { tx, ty } = this.player.tilePos();
    const spot = this.chunks.walkableNear(tx, ty, 40, 90);
    if (!spot) return;
    const colors: Partial<Record<WorldEventKind, number>> = {
      smoke: 0xff9f43,
      flare: 0xff5577,
      gunfight: 0xffd23f,
      car_alarm: 0x4aa3ff,
    };
    const ttl = 200000;
    const b: Beacon = {
      kind,
      x: spot.x,
      y: spot.y,
      until: this.time.now + ttl,
      pingId: this.minimap.addPing(spot.x, spot.y, colors[kind] ?? 0xffffff, ttl),
      lastSound: 0,
    };
    const dx = spot.x - this.player.sprite.x;
    const dy = spot.y - this.player.sprite.y;
    const dir = compassDir(dx, dy);
    const pan = Math.max(-1, Math.min(1, dx / 800));
    const dist = Math.hypot(dx, dy);
    if (kind === "smoke") {
      const smokeTex = fxTexFor(this, FX_DUST, 0x1d1f22); // colour-true on canvas too
      b.emitter = this.add.particles(spot.x, spot.y, smokeTex.key, {
        speedY: { min: -42, max: -22 },
        speedX: { min: -7, max: 7 },
        scale: { start: 1.7, end: 3.4 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 2600,
        frequency: 130,
        tint: smokeTex.tint,
      });
      b.emitter.setDepth(8);
      this.showToast(`Smoke rises to the ${dir} — someone had a fire going (M)`);
    } else if (kind === "flare") {
      const ft = fxTexFor(this, FX_GLOW, 0xff4a66);
      b.glow = this.add
        .image(spot.x, spot.y, ft.key)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9)
        .setTint(ft.tint)
        .setScale(0.5)
        .setAlpha(0.85);
      this.tweens.add({ targets: b.glow, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });
      sfx.flare();
      this.showToast(`A flare bursts to the ${dir} — someone's in trouble (M)`);
    } else if (kind === "gunfight") {
      sfx.gunshotFar(pan, dist);
      this.showToast(`Gunfire echoes from the ${dir} (M)`);
    } else {
      sfx.alarm(pan, dist);
      this.showToast(`A car alarm wails to the ${dir} — it'll draw them (M)`);
    }
    this.beacons.push(b);
  }

  /** Per-frame (cheap, ≤2 live): expiry, repeating positional audio, arrival. */
  private tickBeacons(): void {
    if (this.beacons.length === 0) return;
    const now = this.time.now;
    for (const b of [...this.beacons]) {
      if (now >= b.until) {
        this.clearBeacon(b);
        continue;
      }
      const dx = b.x - this.player.sprite.x;
      const dy = b.y - this.player.sprite.y;
      const dist = Math.hypot(dx, dy);
      if ((b.kind === "gunfight" || b.kind === "car_alarm") && now - b.lastSound > (b.kind === "gunfight" ? 1700 : 1300)) {
        b.lastSound = now;
        sfx[b.kind === "gunfight" ? "gunshotFar" : "alarm"](Math.max(-1, Math.min(1, dx / 800)), dist);
      }
      if (dist < 400) this.resolveBeacon(b);
    }
  }

  private clearBeacon(b: Beacon): void {
    const i = this.beacons.indexOf(b);
    if (i >= 0) this.beacons.splice(i, 1);
    this.minimap.removePing(b.pingId);
    b.emitter?.destroy();
    if (b.glow) {
      this.tweens.killTweensOf(b.glow);
      b.glow.destroy();
    }
  }

  /** What you find when you investigate — supplies, people, or trouble. */
  private resolveBeacon(b: Beacon): void {
    this.clearBeacon(b);
    const bias = 0.2 + this.chunks.lootBias(b.x, b.y);
    switch (b.kind) {
      case "smoke": {
        for (const s of rollLoot("street", liveRng, 2, bias)) this.spawnDrop(b.x, b.y, s.item, s.qty);
        this.spawnNear([{ type: "zombie", count: Phaser.Math.Between(2, 3) }]);
        this.showToast("The remains of a camp — supplies left behind");
        break;
      }
      case "flare": {
        this.spawnSurvivor(b.x, b.y);
        this.spawnNear([{ type: "zombie", count: 2 }]);
        this.showToast("A survivor signalled from here — find them (E)");
        break;
      }
      case "gunfight": {
        for (const s of rollLoot("police_station", liveRng, 1, bias)) this.spawnDrop(b.x, b.y, s.item, s.qty);
        this.spawnNear([{ type: "survivor_hostile", count: Phaser.Math.Between(1, 2) }]);
        this.showToast("Spent brass everywhere — and someone's still here");
        break;
      }
      case "car_alarm": {
        for (const s of rollLoot("scav_vehicle", liveRng, 2, bias)) this.spawnDrop(b.x, b.y, s.item, s.qty);
        this.spawnNear([{ type: "zombie", count: Phaser.Math.Between(3, 4) }]);
        this.showToast("The alarm drew them — grab what you can and go");
        break;
      }
      default:
        break;
    }
    pushRecentEvent(this.state, "Investigated a disturbance.");
  }

  // --- natural disasters (Living World) -------------------------------------

  /** Time until the next disaster roll — rarer early, faster on deeper/stormier days. */
  private nextDisasterDelayMs(): number {
    const day = this.effDay();
    let base = (95000 + Math.random() * 85000) / (1 + day * 0.05); // ~1.5–3 min, tightening
    if (this.state.weather === "storm") base *= 0.5;
    return Math.max(35000, base);
  }

  /** Roll the context (day/weather/biome) for a disaster and, if one fires, begin it. */
  private maybeSpawnDisaster(now: number): void {
    if (this.dead) return;
    const biome = this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y);
    const spec = scheduleDisaster(liveRng, this.effDay(), this.state.weather, biome);
    if (!spec) return;
    // Epicentre near the player; cataclysms can land right on you, common ones offset.
    const ang = Math.random() * Math.PI * 2;
    const dist = (spec.cataclysm ? Math.random() * 3 : 5 + Math.random() * 7) * TILE_SIZE;
    const x = this.player.sprite.x + Math.cos(ang) * dist;
    const y = this.player.sprite.y + Math.sin(ang) * dist;
    let radius = spec.radius;
    // The common tier spares the player's claimed base; only a rare cataclysm wrecks it.
    if (!spec.cataclysm && this.state.base) {
      const bd = Math.hypot(this.state.base.x - x, this.state.base.y - y) / TILE_SIZE;
      if (bd < radius + 3) radius = Math.max(4, Math.floor(bd - 3));
    }
    const d: LiveDisaster = {
      id: `dis_${this.disasterSeq++}`, kind: spec.kind, x, y, radius,
      cataclysm: spec.cataclysm, startedAt: now, telegraphMs: spec.telegraphMs, activeMs: spec.activeMs,
    };
    this.liveDisasters.push(d);
    this.showToast(this.disasterWarning(d));
    sfx.ui();
    this.spawnTelegraph(d);
  }

  private disasterWarning(d: LiveDisaster): string {
    const hard = d.cataclysm;
    switch (d.kind) {
      case "earthquake": return hard ? "⚠ The earth is tearing apart — RUN!" : "The ground begins to tremble…";
      case "wildfire": return hard ? "⚠ A firestorm is sweeping in — flee!" : "Smoke on the wind — a wildfire is spreading.";
      case "flood": return hard ? "⚠ A flash flood is surging in — get to high ground!" : "Floodwaters are rising nearby.";
      case "eruption": return hard ? "⚠ The ground splits — lava is erupting!" : "The earth glows — a lava vent is opening.";
      case "storm_lightning": return hard ? "⚠ The storm is striking everywhere — take cover!" : "Lightning is striking nearby — keep off open ground.";
    }
  }

  /** A pulsing danger ring so the player can see where the disaster will hit (agency). */
  private spawnTelegraph(d: LiveDisaster): void {
    const col = d.kind === "flood" ? 0x4aa3ff : d.kind === "storm_lightning" ? 0xdff0ff : 0xff7a2a;
    const rPx = d.radius * TILE_SIZE;
    const ring = this.add.circle(d.x, d.y, rPx, col, 0.06).setStrokeStyle(3, col, 0.85).setDepth(8);
    this.tweens.add({ targets: ring, alpha: 0.32, scaleX: 1.04, scaleY: 1.04, yoyo: true, repeat: -1, duration: 520, ease: "Sine.easeInOut" });
    const dot = this.add.circle(d.x, d.y, 7, col, 0.9).setDepth(8);
    this.tweens.add({ targets: dot, scaleX: 1.7, scaleY: 1.7, alpha: 0.2, yoyo: true, repeat: -1, duration: 420 });
    this.pushVis(d.id, ring);
    this.pushVis(d.id, dot);
  }

  private pushVis(id: string, obj: Phaser.GameObjects.GameObject): void {
    const arr = this.disasterVis.get(id) ?? [];
    arr.push(obj);
    this.disasterVis.set(id, arr);
  }

  private clearDisasterVis(id: string): void {
    const arr = this.disasterVis.get(id);
    if (arr) for (const o of arr) o.destroy();
    this.disasterVis.delete(id);
  }

  /** Advance all live disasters: fire one-shot activation effects, run per-frame VFX
   *  + continuous damage during the active window, and reap the expired. */
  private updateDisasters(now: number, delta: number): void {
    if (this.liveDisasters.length === 0) return;
    const keep: LiveDisaster[] = [];
    for (const d of this.liveDisasters) {
      const phase = disasterPhase(d, now);
      if (phase === "telegraph") {
        keep.push(d);
      } else if (phase === "active") {
        if (!d.activated) this.activateDisaster(d);
        this.disasterTick(d, now, delta);
        keep.push(d);
      } else {
        this.clearDisasterVis(d.id); // expired — drop visuals (scar already persisted)
      }
    }
    this.liveDisasters = keep;
  }

  /** Fire the one-shot punch when a disaster goes active: write its lasting scar,
   *  shake the camera, and (quakes) hurl + hurt everything in the zone. */
  private activateDisaster(d: LiveDisaster): void {
    d.activated = true;
    this.clearDisasterVis(d.id); // telegraph ring done
    const cam = this.cameras.main;
    switch (d.kind) {
      case "earthquake":
        cam.shake(d.activeMs, d.cataclysm ? 0.016 : 0.008);
        sfx.boom();
        this.quakeImpact(d);
        this.scarWorld(d); // rubble — permanent
        break;
      case "eruption":
        cam.shake(Math.min(d.activeMs, 2600), d.cataclysm ? 0.014 : 0.007);
        sfx.boom();
        this.scarWorld(d); // fresh lava + basalt — permanent
        break;
      case "wildfire":
        this.scarWorld(d, d.cataclysm ? 8 : 5); // scorch — regrows over days
        break;
      case "flood":
        sfx.boom();
        this.scarWorld(d, d.cataclysm ? 6 : 4); // water — recedes over days
        break;
      case "storm_lightning":
        break; // strikes land individually during disasterTick
    }
  }

  /** Persist a disaster's lasting terrain scar + re-derive the resident chunks so it
   *  shows immediately. `healInDays` omitted = permanent (quake rubble / fresh lava). */
  private scarWorld(d: LiveDisaster, healInDays?: number): void {
    const zone: DisasterZone = {
      id: d.id, kind: d.kind, px: d.x, py: d.y, radius: d.radius,
      startDay: this.state.day,
      healDay: healInDays === undefined ? undefined : this.state.day + healInDays,
      intensity: d.cataclysm ? 1 : 0.82,
      cataclysm: d.cataclysm,
    };
    (this.state.disasters ??= []).push(zone);
    this.chunks.refreshLoaded();
  }

  private quakeImpact(d: LiveDisaster): void {
    const now = this.time.now;
    if (inZone(d, this.player.sprite.x, this.player.sprite.y)) {
      this.hurtPulse(0.7);
      this.damagePlayer(d.cataclysm ? 20 : 9, false, "The ground heaves and throws you off your feet.", "physical");
      this.grabbedUntil = Math.max(this.grabbedUntil, now + 350);
    }
    for (const e of this.enemies) {
      if (!inZone(d, e.sprite.x, e.sprite.y)) continue;
      const dx = e.sprite.x - d.x;
      const dy = e.sprite.y - d.y;
      const len = Math.hypot(dx, dy) || 1;
      e.knockback(dx / len, dy / len, 260, now);
      e.takeDamage(d.cataclysm ? 22 : 11);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * d.radius * TILE_SIZE;
      dustPuff(this, d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, 3);
    }
  }

  /** Per-frame VFX + continuous effects while a disaster is active. */
  private disasterTick(d: LiveDisaster, now: number, delta: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const inside = inZone(d, px, py);
    const I = intensityAt(d, now);
    const randInZone = (): { x: number; y: number } => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * d.radius * TILE_SIZE;
      return { x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r };
    };
    switch (d.kind) {
      case "wildfire":
      case "eruption": {
        if (Math.random() < delta / 80) {
          const p = randInZone();
          emberPuff(this, p.x, p.y, 3);
          if (Math.random() < 0.4) dustPuff(this, p.x, p.y - 6, 2); // smoke
        }
        if (d.kind === "eruption" && Math.random() < delta / 650) {
          const p = randInZone(); // ember-bomb landing
          emberPuff(this, p.x, p.y, 6);
        }
        if (inside) ignitePlayer(this.state, 1400, now); // burn DoT ticks on the survival cadence
        for (const e of this.enemies) if (inZone(d, e.sprite.x, e.sprite.y)) e.applyDot(12, 800);
        break;
      }
      case "flood": {
        if (inside) {
          soakPlayer(this.state, 1600, now);
          const b = this.player.sprite.body as Phaser.Physics.Arcade.Body;
          const dx = px - d.x;
          const dy = py - d.y;
          const len = Math.hypot(dx, dy) || 1;
          b.velocity.x += (dx / len) * 34 * I; // the current shoves you outward
          b.velocity.y += (dy / len) * 34 * I;
        }
        if (Math.random() < delta / 120) {
          const p = randInZone();
          splashPuff(this, p.x, p.y, 2);
        }
        break;
      }
      case "storm_lightning": {
        if (Math.random() < delta / (d.cataclysm ? 320 : 620)) this.lightningStrike(d, now);
        break;
      }
      case "earthquake": {
        if (Math.random() < delta / 170) {
          const p = randInZone();
          dustPuff(this, p.x, p.y, 2);
        }
        break;
      }
    }
  }

  /** A single lightning bolt: flash + thunder + jagged bolt + scorch + local damage. */
  private lightningStrike(d: LiveDisaster, now: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * d.radius * TILE_SIZE;
    const sx = d.x + Math.cos(a) * r;
    const sy = d.y + Math.sin(a) * r;
    this.cameras.main.flash(120, 200, 220, 255);
    sfx.boom();
    const g = this.add.graphics().setDepth(60);
    g.lineStyle(3, 0xdff0ff, 0.95);
    g.beginPath();
    g.moveTo(sx, sy - 380);
    const segs = 8;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      g.lineTo(sx + (Math.random() - 0.5) * 26 * (1 - t), sy - 380 + 380 * t);
    }
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
    emberPuff(this, sx, sy, 6);
    bloodDecal(this, sx, sy, 0.5, 0x1c140e); // a lingering scorch mark (transient decal — no save bloat)
    if (Math.hypot(sx - this.player.sprite.x, sy - this.player.sprite.y) < 44) {
      this.damagePlayer(d.cataclysm ? 24 : 14, false, "Lightning splits the air beside you.", "shock");
      ignitePlayer(this.state, 1200, now);
    }
    for (const e of this.enemies) {
      if (Math.hypot(sx - e.sprite.x, sy - e.sprite.y) < 36) {
        e.takeDamage(d.cataclysm ? 30 : 18);
        e.applyDot(8, 1200);
      }
    }
  }

  /** Scatter a small loot cache at a nearby tile and pin it on the map. */
  private airDrop(n: number): void {
    const { tx, ty } = this.player.tilePos();
    const spot = this.chunks.walkableNear(tx, ty, 4, 9);
    if (!spot) return;
    const bias = this.chunks.lootBias(spot.x, spot.y) + 0.3;
    for (const s of rollLoot("military", liveRng, n, bias)) this.spawnDrop(spot.x, spot.y, s.item, s.qty);
    this.revealLocation("Supply drop", "supply_cache", spot.x, spot.y);
  }

  /** With a Radio in your pack, periodic survivor chatter points you toward a POI. */
  private radioBroadcast(): void {
    if (this.dead) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const targets: { name: string; x: number; y: number }[] = [];
    for (const l of this.state.knownLocations ?? []) targets.push({ name: l.name, x: l.x, y: l.y });
    if (this.state.base) targets.push({ name: "your base", x: this.state.base.x, y: this.state.base.y });
    if (targets.length > 0 && liveRng.chance(0.6)) {
      const t = liveRng.pick(targets);
      this.showToast(`Radio: a survivor reports ${t.name} to the ${compassDir(t.x - px, t.y - py)}.`);
      return;
    }
    const lead = this.discoverRadioLead();
    if (lead) this.showToast(`Radio: chatter about ${lead.name} to the ${compassDir(lead.x - px, lead.y - py)}.`);
    else this.showToast("Radio: static… distant voices, nothing clear.");
  }

  /** Reveal one as-yet-uncatalogued landmark from a loaded neighbouring chunk. */
  private discoverRadioLead(): { name: string; x: number; y: number } | null {
    const { cx, cy } = this.playerChunk();
    const known = this.state.knownLocations ?? [];
    for (let r = 1; r <= CHUNK_LOAD_RADIUS; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]] as const) {
        for (const lm of this.chunks.landmarksAt(cx + dx, cy + dy)) {
          if (!known.some((l) => l.name === lm.label && Math.abs(l.x - lm.x) < 8)) {
            this.revealLocation(lm.label, lm.kind, lm.x, lm.y);
            return { name: lm.label, x: lm.x, y: lm.y };
          }
        }
      }
    }
    return null;
  }

  // --- survivors / companions / trade (Feature 10b) ---------------------------

  /** Re-spawn recruited companions from the save (they then follow the player). */
  private restoreCompanions(): void {
    for (const rec of this.state.npcs ?? []) {
      if (rec.kind !== "companion") continue;
      const near = Math.hypot(rec.x - this.player.sprite.x, rec.y - this.player.sprite.y) < 600;
      const x = near ? rec.x : this.player.sprite.x + Phaser.Math.Between(-40, 40);
      const y = near ? rec.y : this.player.sprite.y + Phaser.Math.Between(-40, 40);
      this.makeNpc(x, y, rec.id, rec.name, rec.faction, "companion", rec.hp, rec.maxHp, rec.tier);
    }
  }

  private makeNpc(x: number, y: number, id: string, name: string, faction: string, kind: "survivor" | "companion", hp: number, maxHp: number, tier?: string, home?: { x: number; y: number; r: number }): Npc {
    const meta = tierMeta(tier);
    const color = kind === "companion" ? 0x6effa0 : meta.tint; // companions read green; survivors tint by tier
    const tagPrefix = kind === "companion" ? "" : meta.namePrefix; // prime survivors flagged
    const npc = new Npc(this, x, y, { id, name, faction, kind, hp, maxHp, color, tier, tagPrefix, home });
    this.npcGroup.add(npc.sprite);
    this.npcs.push(npc);
    return npc;
  }

  private spawnSurvivor(x: number, y: number, faction?: string): Npc {
    const fac = faction ?? factionForBiome(this.chunks.biomeAtPx(x, y));
    const tier = rollTier(liveRng, this.effDay(), fac);
    const hp = Math.round(45 * tierMeta(tier).hpMul); // prime survivors are tougher, poor frailer
    const id = `npc_${Math.floor(this.time.now)}_${Math.floor(Math.random() * 1e4)}`;
    const npc = this.makeNpc(x, y, id, npcName(liveRng), fac, "survivor", hp, hp, tier);
    spawnPopIn(this, npc.sprite);
    return npc;
  }

  private spawnAmbientSurvivor(): void {
    if (this.npcs.filter((n) => n.kind === "survivor").length >= 4) return;
    if (!SAFE_BIOMES.has(this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y))) return;
    const { tx, ty } = this.player.tilePos();
    const t = this.chunks.walkableNear(tx, ty, 8, 14);
    if (t) this.spawnSurvivor(t.x, t.y);
  }

  private updateNpcs(now: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    for (const npc of this.npcs) {
      let zt: { x: number; y: number } | null = null;
      if (npc.kind === "companion") {
        const z = this.nearestEnemyTo(npc.sprite.x, npc.sprite.y, 240);
        if (z) zt = { x: z.sprite.x, y: z.sprite.y };
      }
      npc.update(px, py, zt, now);
    }
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      if (npc.kind === "companion") {
        const z = this.nearestEnemyTo(npc.sprite.x, npc.sprite.y, 34);
        if (z && now - npc.lastHit > 700) {
          npc.lastHit = now;
          const cdir = { x: z.sprite.x - npc.sprite.x, y: z.sprite.y - npc.sprite.y };
          splatHit(this, z.sprite.x, z.sprite.y, z.blood, cdir, 1);
          if (z.takeDamage(Math.round(12 * tierMeta(npc.tier).dmgMul))) this.onEnemyKilled(z); // prime companions hit harder
        }
        const zc = this.nearestEnemyTo(npc.sprite.x, npc.sprite.y, 24);
        if (zc && now - npc.lastHurt > 800) {
          npc.lastHurt = now;
          if (npc.takeDamage(Math.max(3, Math.round(zc.damage * 0.7)))) {
            this.killCompanion(npc);
            continue;
          }
        }
      } else if (!npc.home && Math.hypot(npc.sprite.x - px, npc.sprite.y - py) > 2400) {
        npc.destroy(); // ambient survivor wandered off (camp residents are reconcile-owned)
        this.npcs.splice(i, 1);
      }
    }
  }

  private killCompanion(npc: Npc): void {
    const i = this.npcs.indexOf(npc);
    if (i >= 0) this.npcs.splice(i, 1);
    if (this.state.npcs) this.state.npcs = this.state.npcs.filter((n) => n.id !== npc.id);
    // A camp remembers its dead — the roster never resurrects them (U5).
    if (npc.id.startsWith("camp_") && !this.state.worldFlags.includes(npcGoneFlag(npc.id))) {
      this.state.worldFlags.push(npcGoneFlag(npc.id));
    }
    sfx.death();
    this.showToast(`${npc.name} fell defending you.`);
    pushRecentEvent(this.state, `${npc.name} died.`);
    deathFade(this, npc.sprite);
    this.persist();
  }

  private nearestEnemyTo(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      const d = Math.hypot(e.sprite.x - x, e.sprite.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private nearestNpc(maxDist: number): Npc | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: Npc | null = null;
    let bestD = maxDist;
    for (const n of this.npcs) {
      const d = Math.hypot(n.sprite.x - px, n.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Build the trade/recruit panel payload for a survivor (tier-aware). */
  private tradeInfo(npc: Npc, offers: TradeOffer[]): {
    name: string;
    faction: string;
    offers: TradeOffer[];
    isCompanion: boolean;
    canRecruit: boolean;
    tier?: string;
    cost: RecruitCost;
    standing: number;
    atCompanionCap: boolean;
  } {
    const atCap = companionCount(this.state) >= MAX_COMPANIONS;
    return {
      name: npc.name,
      faction: npc.faction,
      offers,
      isCompanion: npc.kind === "companion",
      canRecruit: !atCap && canRecruit(this.state, npc.faction, npc.tier),
      tier: npc.tier,
      cost: recruitCost(npc.tier),
      standing: getStanding(this.state, npc.faction),
      atCompanionCap: atCap,
    };
  }

  /** Open the trade/recruit panel for a survivor (offers are stable per survivor). */
  private openTrade(npc: Npc): void {
    if (this.dead || this.inEncounter || this.enacting) return;
    this.tradeOpen = true;
    this.activeNpc = npc;
    this.setGameKeys(false);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    let offers = this.npcOffers.get(npc.id);
    if (!offers) {
      offers = generateOffers(createRng(`${this.state.seed}:npc:${npc.id}`), npc.faction, npc.tier);
      this.npcOffers.set(npc.id, offers);
    }
    sfx.ui();
    this.tradeUi.open(this.state, this.tradeInfo(npc, offers));
  }

  private onTradeAccept(offer: TradeOffer): void {
    if (!this.activeNpc || !acceptOffer(this.state, offer)) return;
    sfx.pickup();
    addStanding(this.state, this.activeNpc.faction, 2);
    pushRecentEvent(this.state, `Traded with ${this.activeNpc.name}.`);
    // deplete the survivor's stock so a deal can't be repeated endlessly
    const stock = this.npcOffers.get(this.activeNpc.id);
    if (stock) this.npcOffers.set(this.activeNpc.id, stock.filter((o) => o !== offer));
    this.hud.update(this.state, this.debugInfo(), this.activeWeaponName());
    this.persist();
    this.tradeUi.open(this.state, this.tradeInfo(this.activeNpc, this.npcOffers.get(this.activeNpc.id) ?? []));
  }

  private onRecruitToggle(): void {
    const npc = this.activeNpc;
    if (!npc) return;
    if (npc.kind === "companion") {
      npc.kind = "survivor";
      npc.setTint(tierMeta(npc.tier).tint); // back to its tier tint
      this.state.npcs = (this.state.npcs ?? []).filter((n) => n.id !== npc.id);
      this.showToast(`${npc.name} parts ways with you.`);
    } else {
      if (companionCount(this.state) >= MAX_COMPANIONS) {
        this.showToast("You can't lead any more companions.");
        return;
      }
      const cost = recruitCost(npc.tier);
      if (getStanding(this.state, npc.faction) < cost.standingReq) {
        this.showToast(`${npc.faction} don't trust you enough (need +${cost.standingReq}). Trade to earn standing.`);
        return;
      }
      if (!canRecruit(this.state, npc.faction, npc.tier)) {
        const need = cost.items.map((c) => `${c.qty} ${c.item}`).join(", ");
        this.showToast(`Recruiting needs supplies: ${need}.`);
        return;
      }
      payRecruit(this.state, npc.tier);
      npc.kind = "companion";
      npc.setTint(0x6effa0);
      this.state.npcs = this.state.npcs ?? [];
      this.state.npcs.push({ id: npc.id, name: npc.name, kind: "companion", faction: npc.faction, x: npc.sprite.x, y: npc.sprite.y, hp: npc.hp, maxHp: npc.maxHp, tier: npc.tier });
      addStanding(this.state, npc.faction, 5);
      this.showToast(`${npc.name} joins you.`);
      pushRecentEvent(this.state, `${npc.name} joined your group.`);
    }
    sfx.ui();
    this.persist();
    this.tradeUi.close();
  }

  private toggleLoot(): void {
    if (this.dead) return;
    if (this.lootOpen) {
      this.loot.close();
      return;
    }
    if (this.inEncounter || this.craftOpen || this.storeOpen || this.tradeOpen) return;
    this.lootOpen = true;
    this.setGameKeys(false);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.loot.open(this.state, () => {
      this.checkArmed(); // equipping from the bag can complete the arm objective
      this.hud.update(this.state, this.debugInfo());
      this.persist();
    });
  }

  /** Rest/sleep (Z): pass time, recover stamina, at the cost of food/water and a
   *  real chance of waking to the dead. Can't rest with enemies close. */
  private restAction(): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen || this.driving || this.buildMode) return;
    if (this.nearestEnemy(150)) {
      this.showToast("Too dangerous to rest here");
      return;
    }
    this.advanceClock(false);
    this.advanceClock(false); // ~2 segments pass (crops grow, weather may shift); rest speaks for itself
    this.state.player.stamina = clampStat(100);
    this.state.player.hunger = clampStat(this.state.player.hunger - 8);
    this.state.player.thirst = clampStat(this.state.player.thirst - 10);
    if (isDead(this.state)) {
      this.enterDeath();
      return;
    }
    if (liveRng.chance(0.3)) {
      this.spawnNear([{ type: this.isNight() ? "zombie_runner" : "zombie", count: Phaser.Math.Between(1, 2) }]);
      this.showToast("You wake to shuffling nearby…");
    } else {
      this.showToast("You rest and catch your breath.");
    }
    this.grantXp("fitness", 2);
    this.hud.update(this.state, this.debugInfo());
    this.persist();
  }

  private toggleCraft(): void {
    if (this.dead) return;
    if (this.craftOpen) {
      this.craftUi.close();
      return;
    }
    if (this.inEncounter || this.enacting || this.lootOpen || this.storeOpen || this.tradeOpen) return;
    this.craftOpen = true;
    this.setGameKeys(false);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.craftUi.open(this.state, this.stationsNear()); // nearby campfire/workbench unlock station recipes
  }

  private startEncounter(loc: string, situation: string, title: string, choices?: string[]): void {
    if (this.dead || this.inEncounter || this.enacting) return;
    this.inEncounter = true;
    this.encounterTurns = 0;
    this.setGameKeys(false); // so typing/keys can't move the player or fire actions
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.freezeEnemies();
    this.encounterLoc = loc;
    sfx.ui();
    // Ask FIRST — instant, no GM call until the player answers. A few contextual
    // quick actions PLUS a free-text box; the GM only runs on their choice.
    this.modal.openPrompt(title, situation, choices ?? this.openingChoicesFor(loc));
  }

  // Rare scripted dilemmas — the ONLY thing that opens the GM choice/chat modal
  // (E never does). Fired by the "dilemma" world event; the GM resolves the choice.
  private static readonly DILEMMAS: ReadonlyArray<{ title: string; situation: string; choices: string[] }> = [
    { title: "A cry for help", situation: "A voice cracks across the rooftops — someone's pinned nearby, begging for help. It could be real. It could be bait.", choices: ["Rush to help them", "Approach carefully, weapon up", "Call out and wait", "Ignore it and move on"] },
    { title: "Stranger at the treeline", situation: "A lone figure watches you from cover, hand hovering near their belt. Neither of you has moved.", choices: ["Lower your weapon and talk", "Aim and warn them off", "Offer to trade supplies", "Back away slowly"] },
    { title: "Distant gunfire", situation: "Gunshots crack a few streets over — a fight. Wherever there's a fight there's loot, and a good way to die.", choices: ["Move toward the gunfire", "Wait and scavenge the aftermath", "Slip away from the noise", "Set up an ambush nearby"] },
    { title: "A sealed cache", situation: "A chained cargo container, deep scratch-marks raked all around it. Something wanted in. Or out.", choices: ["Force it open", "Listen at the door first", "Mark it and leave", "Rig a trap and wait"] },
    { title: "The wounded one", situation: "A survivor slumps against the wall, bleeding — a bite half-hidden under a torn sleeve. They lock eyes with you.", choices: ["Help dress the wound", "Keep your distance", "Share water and talk", "End it, mercifully"] },
    { title: "Smoke on the wind", situation: "A thin column of smoke rises a block away — a campfire, freshly lit. Someone is close, and warm.", choices: ["Investigate the fire", "Watch from cover first", "Announce yourself loudly", "Avoid it entirely"] },
  ];

  /** Fire a rare narrative dilemma → opens the GM choice modal. Skipped if the player
   *  is mid-anything (a modal, driving, build mode) so it never interrupts. */
  private dilemmaEvent(): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen || this.buildMode || this.driving) return;
    const d = liveRng.pick(WorldScene.DILEMMAS as { title: string; situation: string; choices: string[] }[]);
    const b = this.buildingAt();
    const loc = b ? b.type : this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y);
    this.showToast("Something's happening nearby…");
    this.startEncounter(loc, d.situation, d.title, d.choices);
  }

  /** A few instant, contextual quick-actions for the opening prompt (plus free text). */
  private openingChoicesFor(loc: string): string[] {
    return OPEN_LOCS.has(loc)
      ? ["Search the area", "Scout ahead", "Move on quietly", "Set up to rest"]
      : ["Search for supplies", "Look for survivors", "Barricade up", "Slip back out"];
  }

  /** Enable/disable the Phaser keyboard so modal typing never leaks to gameplay.
   *  DISABLING also forgets held keys (nothing "sticks" through a modal), and
   *  RE-ENABLING is deferred one tick: Phaser drains its keydown queue before the
   *  scene updates, so the very keystroke that closed a DOM modal (ESC / I) would
   *  otherwise still fire game bindings the moment we re-enable — ESC would bounce
   *  the player to the main menu, I would instantly reopen the bag. */
  private setGameKeys(enabled: boolean): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    if (!enabled) {
      kb.enabled = false;
      kb.resetKeys();
      return;
    }
    this.time.delayedCall(0, () => {
      if (this.anyModalOpen() || !this.input.keyboard) return; // a chained modal opened meanwhile
      this.input.keyboard.enabled = true;
    });
  }

  /** True while any DOM overlay owns the keyboard. */
  private anyModalOpen(): boolean {
    return this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen || this.inEncounter || this.reader.isOpen();
  }

  private onEncounterAction(input: TurnInput): void {
    this.modal.openLoading("Encounter", this.thinkingMsg());
    void this.resolveTurn(input);
  }

  /** Spinner copy: a real model (WebLLM/Ollama) can be slow, so say it's thinking. */
  private thinkingMsg(): string | undefined {
    return getActiveBrain() === "offline" ? undefined : "the AI is thinking…";
  }

  private async resolveTurn(input: TurnInput): Promise<void> {
    const gm = await runTurn(this.state, input, this.encounterLoc);
    if (!this.aiNoticeShown && consumeFellBack()) {
      this.aiNoticeShown = true;
      this.showToast("AI model offline — using the local director. See README to enable Ollama.");
    }
    const result = applyOutcome(this.state, gm);
    this.encounterTurns += 1;
    this.spawnNear(result.spawns); // GM-decided spawns appear on the map (§8.5)
    if (gm.inventory_add.length > 0) sfx.pickup();
    this.hud.update(this.state, this.debugInfo());
    this.persist();

    if (result.gameOver) {
      this.endEncounter();
      this.enterDeath(result.reason || undefined);
      return;
    }

    // Show the narration in the bottom bar AND play it out in the visible world at
    // the same time — the player watches their character do what was just narrated.
    this.modal.showBanner(result.narrative, this.effectsSummary(gm));
    await this.enactOutcome(input, gm, result);

    // Most actions resolve in ONE turn and hand control straight back. Only an
    // immediate threat earns ONE tense follow-up — and the turn cap closes it regardless.
    const keepOpen =
      !result.encounterOver &&
      result.spawns.length > 0 &&
      this.encounterTurns < WorldScene.MAX_ENCOUNTER_TURNS;

    if (keepOpen) {
      this.modal.showChoices(result.narrative, result.interaction, this.effectsSummary(gm));
    } else {
      this.endEncounter(); // banner lingers + fades; free roaming resumes immediately
    }
  }

  /** Play a resolved GM outcome out in the visible world: animate the character
   *  doing the action and float the stat/loot changes over them. Resolves after the
   *  short beat so the caller can then close the encounter or offer the follow-up. */
  private async enactOutcome(input: TurnInput, gm: GMResponse, result: ApplyResult): Promise<void> {
    this.enacting = true;
    const intent = classifyIntent(input.value);
    const beatMs = this.playIntent(intent, gm, result);
    this.floatDeltas(gm);
    await new Promise<void>((resolve) => this.time.delayedCall(beatMs, resolve));
    this.enacting = false;
  }

  /** Map the player's intent to an in-world animation using existing FX. Returns
   *  the beat length (ms) to hold before control returns. */
  private playIntent(intent: Intent, gm: GMResponse, result: ApplyResult): number {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const face = this.player.sprite.rotation;
    switch (intent) {
      case "fight": {
        this.player.lunge();
        meleeArc(this, px, py, face);
        this.cameras.main.shake(60, 0.004);
        sfx.swing();
        const e = this.nearestEnemy(180);
        if (e) {
          const ang = Math.atan2(e.sprite.y - py, e.sprite.x - px);
          splatHit(this, e.sprite.x, e.sprite.y, e.blood, { x: Math.cos(ang), y: Math.sin(ang) }, 1.2);
          e.knockback(Math.cos(ang), Math.sin(ang), 220, this.time.now);
          // No NEW threat drawn in and the narrative reads like a win → finish it.
          if (result.spawns.length === 0 && this.narrativeImpliesKill(gm.narrative)) {
            e.takeDamage(e.hp);
            this.onEnemyKilled(e);
          }
        }
        return 1000;
      }
      case "flee": {
        const e = this.nearestEnemy(640);
        const ang = e ? Math.atan2(py - e.sprite.y, px - e.sprite.x) : face + Math.PI; // straight away
        this.dashPlayer(ang, 240, 760);
        sfx.swing();
        return 820;
      }
      case "scout":
      case "free": {
        this.dashPlayer(face, 150, 520);
        return 700;
      }
      case "search": {
        this.rummage();
        sfx.ui();
        return 900;
      }
      case "heal":
      case "eat":
      case "drink": {
        bloodBurst(this, px, py, 7, 0x6ed16e); // green "restore" puff
        this.player.recoil();
        return 880;
      }
      case "rest": {
        this.cameras.main.flash(280, 6, 9, 14);
        return 1100;
      }
      case "hide":
      case "barricade": {
        this.crouch();
        return 720;
      }
      case "talk": {
        this.floatText(px, py - 18, "…", "#cfe6ff");
        if (result.spawns.some((s) => s.type === "survivor_hostile")) this.player.lunge();
        return 800;
      }
      default: {
        this.player.lunge();
        return 700;
      }
    }
  }

  /** Float each non-zero stat delta and every inventory change over the player. */
  private floatDeltas(gm: GMResponse): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let i = 0;
    const pop = (text: string, color: string) => {
      const idx = i++;
      this.time.delayedCall(idx * 90, () => {
        if (this.player?.sprite?.active) this.floatText(px, py - 12 - idx * 15, text, color);
      });
    };
    const sc = gm.state_changes;
    const rows: Array<[string, number, string]> = [
      ["HP", sc.hp, sc.hp >= 0 ? "#6ed16e" : "#ff5555"],
      ["STA", sc.stamina, sc.stamina >= 0 ? "#ffd23f" : "#caa83f"],
      ["FOOD", sc.hunger, sc.hunger >= 0 ? "#ff9f43" : "#c77f33"],
      ["WATER", sc.thirst, sc.thirst >= 0 ? "#4ec3ff" : "#3f9fcc"],
      ["INF", sc.infection, sc.infection > 0 ? "#c060ff" : "#6ed16e"],
    ];
    for (const [label, v, color] of rows) if (v) pop(`${label} ${v > 0 ? "+" : ""}${v}`, color);
    for (const a of gm.inventory_add) pop(`+${a.qty > 1 ? a.qty + " " : ""}${a.item}`, RARITY_META[defOf(a.item).rarity].css);
    for (const r of gm.inventory_remove) pop(`−${r.qty > 1 ? r.qty + " " : ""}${r.item}`, "#9fb0c0");
  }

  /** Dash the player a short distance via velocity (respects wall colliders), then stop. */
  private dashPlayer(angle: number, speed: number, ms: number): void {
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    this.player.sprite.setRotation(angle);
    this.physics.velocityFromRotation(angle, speed, body.velocity);
    dustPuff(this, this.player.sprite.x, this.player.sprite.y + 8, 3);
    this.time.delayedCall(Math.round(ms * 0.5), () => {
      if (this.player?.sprite?.active) dustPuff(this, this.player.sprite.x, this.player.sprite.y + 8, 2);
    });
    this.time.delayedCall(ms, () => {
      if (this.player?.sprite?.active) this.player.sprite.setVelocity(0, 0);
    });
  }

  /** A quick "rummaging" wiggle in place when searching. */
  private rummage(): void {
    const s = this.player.sprite;
    const base = s.rotation;
    this.tweens.add({
      targets: s,
      rotation: base + 0.16,
      duration: 110,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onComplete: () => s.setRotation(base),
    });
    dustPuff(this, s.x, s.y + 8, 2);
  }

  /** A crouch squash for hiding / barricading. */
  private crouch(): void {
    const s = this.player.sprite;
    this.tweens.add({
      targets: s,
      scaleX: s.scaleX * 1.12,
      scaleY: s.scaleY * 0.8,
      duration: 160,
      yoyo: true,
      ease: "Quad.easeOut",
    });
  }

  private narrativeImpliesKill(text: string): boolean {
    return /\b(kill|killed|drop|dropped|put .* down|split|skull|slay|destroy|finish|cut down)/i.test(text);
  }

  /** A concise "here's what the GM just did" line so the AI's impact is visible. */
  private effectsSummary(gm: GMResponse): string {
    const parts: string[] = [];
    for (const a of gm.inventory_add) parts.push(`+${a.qty}× ${a.item}`);
    for (const r of gm.inventory_remove) parts.push(`−${r.qty}× ${r.item}`);
    const sc = gm.state_changes;
    const labels: Array<[string, number]> = [
      ["HP", sc.hp],
      ["Stamina", sc.stamina],
      ["Food", sc.hunger],
      ["Water", sc.thirst],
      ["Infection", sc.infection],
    ];
    for (const [label, v] of labels) if (v) parts.push(`${label} ${v > 0 ? "+" : ""}${v}`);
    const threats = gm.spawns.reduce((n, s) => n + s.count, 0);
    if (threats) parts.push(`⚠ ${threats} hostile${threats > 1 ? "s" : ""} drawn in`);
    return parts.join("   ·   ");
  }

  /** Manual bail (the "Leave encounter" link) — routes through the same teardown. */
  private onEncounterLeave(): void {
    this.endEncounter();
  }

  /** Centralized encounter teardown: return to free roaming and let the closing
   *  narration banner linger briefly. Guarded against double-invocation. */
  private endEncounter(): void {
    if (!this.inEncounter) {
      this.modal.dismissSoon();
      return;
    }
    this.inEncounter = false;
    this.enacting = false;
    this.encounterTurns = 0;
    this.setGameKeys(true);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.modal.dismissSoon();
    this.persist();
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    // R = reload the equipped gun. I = inventory/loot. ESC = menu (new run).
    kb.on("keydown-R", () => this.tryReload());
    kb.on("keydown-I", () => this.toggleLoot());
    kb.on("keydown-C", () => this.toggleCraft());
    kb.on("keydown-Z", () => this.restAction());
    kb.on("keydown-B", () => this.toggleBuild()); // build mode (barricades/stations)
    kb.on("keydown-V", () => this.claimToggle()); // claim/release the building as base
    kb.on("keydown-M", () => { this.minimap.toggle(); sfx.ui(); }); // minimap (Feature 10)
    kb.on("keydown-H", () => this.showControlsHint()); // re-show the controls cheat-sheet
    // ESC → main menu, but ONLY from the open world — never while a modal that
    // itself closes on ESC is up (its keystroke must not double as "quit").
    kb.on("keydown-ESC", () => {
      if (this.anyModalOpen() || this.dead) return;
      // A non-blocking narration banner (the run intro / a closing beat) reads as
      // "something is showing" — ESC dismisses IT; only a bare world quits.
      if (this.modal.isOpen()) {
        this.modal.close();
        return;
      }
      this.scene.start("MainMenuScene");
    });

    // E = interact with the physical target in range; HOLDING E sustains a
    // scavenging channel (the key handle is polled by tickSearch).
    kb.on("keydown-E", () => this.tryInteract());
    this.keyE = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // SPACE / F = melee swing at the nearest threat.
    kb.on("keydown-SPACE", () => this.meleeAttack());
    kb.on("keydown-F", () => this.meleeAttack());

    // [1-4] quick-use the consumable slots: food / drink / heal / cure.
    kb.on("keydown-ONE", () => this.useQuickSlot(0));
    kb.on("keydown-TWO", () => this.useQuickSlot(1));
    kb.on("keydown-THREE", () => this.useQuickSlot(2));
    kb.on("keydown-FOUR", () => this.useQuickSlot(3));
    // Q = use the currently selected quick-use slot (mouse-friendly).
    kb.on("keydown-Q", () => this.useQuickSlot(this.selectedQuick));

    // [5-0] select carried-weapon strip slots 1–6 (scroll-wheel also cycles them).
    kb.on("keydown-FIVE", () => this.selectWeapon(0));
    kb.on("keydown-SIX", () => this.selectWeapon(1));
    kb.on("keydown-SEVEN", () => this.selectWeapon(2));
    kb.on("keydown-EIGHT", () => this.selectWeapon(3));
    kb.on("keydown-NINE", () => this.selectWeapon(4));
    kb.on("keydown-ZERO", () => this.selectWeapon(5));
  }

  /** Use the consumable in quick-slot i (number keys 1–4); no-op if empty. */
  private useQuickSlot(i: number): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen) return;
    const slot = quickUseItems(this.state)[i];
    if (!slot || !useConsumable(this.state, slot.item)) return;
    this.selectedQuick = i; // scroll/Q/click all converge on the slot just used
    sfx.pickup();
    pushRecentEvent(this.state, `Used ${slot.item}.`);
    this.floatText(this.player.sprite.x, this.player.sprite.y - 8, `Used ${slot.item}`, "#9ef0a0");
    this.hud.update(this.state, this.debugInfo());
    this.persist();
  }

  /** Carried weapons (melee-first) the hotbar weapon strip cycles through. */
  private carriedWeapons(): WeaponDef[] {
    return weaponsInBag(this.state);
  }

  /** Name of the in-hand (ACTIVE) weapon — the selected carried weapon, or the
   *  equipped fallback (e.g. Fists) when the bag holds no weapons. */
  private activeWeaponName(): string | undefined {
    const list = this.carriedWeapons();
    if (list.length === 0) return this.state.equippedRanged ?? this.state.equippedMelee;
    const i = Phaser.Math.Clamp(this.activeWeapon, 0, list.length - 1);
    return list[i].name;
  }

  /** Select carried-weapon slot i: equip it (melee→melee slot, gun→gun slot) and make
   *  it the in-hand active weapon. No-op if empty or a modal/build mode is open. */
  private selectWeapon(i: number): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen || this.buildMode) return;
    const list = this.carriedWeapons();
    if (i < 0 || i >= list.length) return;
    this.activeWeapon = i;
    equipWeapon(this.state, list[i].name);
    sfx.ui();
    this.updateWeaponSprite();
    this.checkArmed(); // opening arc (U3)
  }

  /** Scroll-wheel cycle through the carried-weapon strip (wraps), equipping each. */
  private cycleWeapon(dir: number): void {
    if (this.dead || this.inEncounter || this.enacting || this.lootOpen || this.craftOpen || this.storeOpen || this.tradeOpen) return;
    const list = this.carriedWeapons();
    if (list.length === 0) return;
    const cur = Phaser.Math.Clamp(this.activeWeapon, 0, list.length - 1);
    this.selectWeapon((cur + (dir > 0 ? 1 : -1) + list.length) % list.length);
  }

  private enterDeath(reason?: string): void {
    if (this.dead) return;
    this.dead = true;
    this.inEncounter = false;
    this.enacting = false;
    if (this.driving) {
      this.driving = null; // step out of the wreck; the run is over
      this.player.speedMult = 1;
    }
    this.buildMode = false;
    this.buildGhost?.setVisible(false);
    if (this.storeOpen) this.storeUi.close();
    if (this.tradeOpen) this.tradeUi.close();
    this.player.sprite.setVelocity(0, 0);
    this.modal.close();
    sfx.death();
    clearSave(); // the run is over; the next run is fresh
    const msg =
      reason ??
      (this.state.player.infection >= 100 ? "The infection took you." : "Your wounds were too much.");
    this.scene.start("GameOverScene", {
      days: this.state.day,
      kills: this.kills,
      reason: msg,
      name: this.state.player.name,
    });
  }

  /** Melee swing at the nearest threat (SPACE/F). Weapons hit harder. */
  private meleeAttack(): void {
    if (this.dead || this.inEncounter || this.driving || this.storeOpen || this.tradeOpen || this.buildMode) return;
    const now = this.time.now;
    const hit = meleeOutcome(this.state, liveRng);
    if (now - this.lastMelee < hit.cooldownMs || this.state.player.stamina < 4) return;
    this.lastMelee = now;
    this.state.player.stamina = clampStat(this.state.player.stamina - 6);
    sfx.swing();

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    this.cameras.main.shake(50, 0.003);
    this.player.lunge();
    meleeArc(this, px, py, this.player.sprite.rotation);
    this.huntNearbyAnimal(hit.range + 16, hit.damage); // a swing also strikes nearby game

    const targets = this.enemies
      .map((e) => ({ e, d: Math.hypot(e.sprite.x - px, e.sprite.y - py) }))
      .filter((t) => t.d <= hit.range + 16)
      .sort((x, y) => x.d - y.d);
    if (targets.length === 0) return;

    const maxTargets = 1 + Math.max(0, hit.cleave); // cleave hits extra foes in the arc
    let healed = 0;
    for (let i = 0; i < targets.length && i < maxTargets; i++) {
      this.applyMeleeHit(targets[i].e, hit, px, py);
      healed += hit.lifestealHp;
    }
    if (healed > 0) this.state.player.hp = clampStat(this.state.player.hp + healed);
  }

  /** Apply one melee weapon's resolved hit (damage + abilities) to a target. */
  private applyMeleeHit(e: Enemy, hit: MeleeHit, px: number, py: number): void {
    const execute = hit.executePct > 0 && e.hpFrac() * 100 <= hit.executePct;
    const dmg = execute ? e.hp : hit.damage;
    const dead = e.takeDamage(dmg);
    const len = Math.hypot(e.sprite.x - px, e.sprite.y - py) || 1;
    const ndir = { x: (e.sprite.x - px) / len, y: (e.sprite.y - py) / len };
    splatHit(this, e.sprite.x, e.sprite.y, e.blood, ndir, hit.crit ? 1.6 : execute ? 1.5 : dead ? 1.3 : 1);
    bloodDecal(this, e.sprite.x, e.sprite.y, hit.crit ? 1.2 : 0.85, e.blood.pool); // splatHit lays the directional smear
    // Damage number on EVERY hit (CRIT/EXECUTE called out above it).
    this.floatText(e.sprite.x, e.sprite.y, execute ? "EXECUTE" : String(Math.round(dmg)), hit.crit ? "#ffd23f" : execute ? "#ff5a6e" : "#ffffff");
    if (hit.crit && !execute) this.floatText(e.sprite.x, e.sprite.y - 13, "CRIT!", "#ffd23f");
    if (hit.bleed > 0) e.applyDot(hit.bleed, hit.bleedMs);
    if (hit.stunMs > 0) e.applyStun(hit.stunMs);
    // Ability knockback, else a light stagger so every blow lands with weight.
    e.knockback(ndir.x, ndir.y, hit.knockback > 0 ? hit.knockback : 90, this.time.now);
    if (hit.crit || execute) {
      this.cameras.main.shake(70, 0.006);
      this.zoomPunch(0.05);
    }
    if (dead) {
      this.hitstop(hit.crit || execute ? 95 : 60); // longer freeze on a heavy/crit kill
      this.onEnemyKilled(e);
    }
  }

  private onEnemyKilled(e: Enemy): void {
    if (this.enemies.indexOf(e) < 0) return; // already reaped this frame
    this.kills += 1;
    this.grantXp("combat", 4);
    sfx.kill();
    gibs(this, e.sprite.x, e.sprite.y, e.blood); // gore chunks fly (type-coloured)
    bloodDecal(this, e.sprite.x, e.sprite.y, 1.5, e.blood.pool); // a pool where it fell
    pushRecentEvent(this.state, `Put down a ${e.def.name}.`);
    this.onDeathTraits(e); // exploder / splitter / bloated bursts
    this.dropLoot(e);
    if (this.leavesCorpse(e)) this.convertToCorpse(e); // body stays — searchable once
    else this.removeEnemy(e); // burst/fade death animation
  }

  /** Bursting deaths (exploder/splitter/bloated) and friendlies leave no body. */
  private leavesCorpse(e: Enemy): boolean {
    if (e.family === "survivor_friendly") return false;
    return !e.hasTrait("exploder") && !e.hasTrait("splitter") && !e.hasTrait("bloated");
  }

  /** Convert the dead enemy's OWN sprite into a lingering ground corpse (no new
   *  sprite): physics off, gore-layer depth, capped ring buffer + TTL (U1). */
  private convertToCorpse(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    e.cleanupUi();
    this.enemyGroup.remove(e.sprite);
    const body = e.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
    this.tweens.killTweensOf(e.sprite);
    e.sprite.setData("corpse", true); // pending hit-flash callbacks must not clear the tint
    e.sprite
      .setRotation((Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.5))
      .setTint(0x767676)
      .setAlpha(0.92)
      .setDepth(3); // gore layer: blood decals + bodies sit under props/actors
    this.corpses.push({ sprite: e.sprite, searched: false, diesAt: this.time.now + 90000 });
    while (this.corpses.length > 24) this.fadeCorpse(this.corpses.shift()!); // hard cap
  }

  private fadeCorpse(c: CorpseRec): void {
    if (this.search?.target.corpse === c) this.cancelSearch();
    this.tweens.add({ targets: c.sprite, alpha: 0, duration: 900, onComplete: () => c.sprite.destroy() });
  }

  /** Expire old corpses (every ~2s; cheap). */
  private sweepCorpses(): void {
    const now = this.time.now;
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (now >= c.diesAt || !c.sprite.active) {
        this.corpses.splice(i, 1);
        if (c.sprite.active) this.fadeCorpse(c);
      }
    }
  }

  private floatText(x: number, y: number, text: string, color = "#ffffff"): void {
    const t = this.add
      .text(x, y - 16, text, { fontFamily: "monospace", fontSize: "13px", color, stroke: "#000000", strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  private updateWeaponSprite(): void {
    const name = this.activeWeaponName();
    if (!name) {
      this.weaponSprite.setVisible(false);
      this.weaponGlow.setVisible(false);
      return;
    }
    const hk = heldKey(name);
    const key = this.textures.exists(hk) ? hk : iconKey(name); // plateless in-hand, fallback to icon
    if (this.textures.exists(key) && this.weaponSprite.texture.key !== key) this.weaponSprite.setTexture(key);
    const ang = this.aimAngle();
    const wx = this.player.sprite.x + Math.cos(ang) * 15;
    const wy = this.player.sprite.y + Math.sin(ang) * 15;
    this.weaponSprite.setPosition(wx, wy).setRotation(ang).setVisible(true);
    this.weaponGlow.setPosition(wx, wy).setTint(RARITY_META[defOf(name).rarity].glow).setVisible(true);
  }

  /** Direction the equipped weapon points — toward the mouse on desktop. */
  private aimAngle(): number {
    const p = this.input.activePointer;
    if (p && !p.wasTouch) {
      return Math.atan2(p.worldY - this.player.sprite.y, p.worldX - this.player.sprite.x);
    }
    return this.player.sprite.rotation;
  }

  // --- world loot: drops + chests --------------------------------------------

  /** Roll + scatter loot where an enemy died. */
  private dropLoot(e: Enemy): void {
    if (e.family === "survivor_friendly") return;
    const chance = e.family === "boss" ? 1 : 0.5;
    if (!liveRng.chance(chance)) return; // not every kill drops
    const n = e.family === "boss" ? 3 : 1;
    const bias = lootLuck(this.state) + this.chunks.lootBias(e.sprite.x, e.sprite.y);
    for (const s of rollLoot("enemy:" + e.lootFamily, liveRng, n, bias)) {
      this.spawnDrop(e.sprite.x, e.sprite.y, s.item, s.qty);
    }
    // The dead sometimes carry someone's last words (U2 readables).
    if (liveRng.chance(0.012)) this.spawnDrop(e.sprite.x, e.sprite.y, rollReadable(liveRng), 1);
  }

  private spawnDrop(x: number, y: number, item: string, qty: number): void {
    if (this.itemGroup.countActive(true) > 60) return; // perf cap
    const ox = (Math.random() - 0.5) * 16;
    const oy = (Math.random() - 0.5) * 16;
    const px = x + ox;
    const py = y + oy;
    const def = defOf(item);
    if (def.kind === "ammo" || def.kind === "material") qty = Math.round(qty * ammoMult(this.state)); // Scrapper perk
    // Rarity-driven glow: a faint shimmer on commons, a beacon on the rare stuff.
    const glow = makeDropGlow(this, px, py, rarityGlowSpec(def.rarity));
    const spr = this.itemGroup.create(px, py, iconKey(item)) as Phaser.Physics.Arcade.Image;
    spr.setScale(0.5).setDepth(7);
    spr.setData("item", item);
    spr.setData("qty", qty);
    spr.setData("glow", glow);
    this.tweens.add({ targets: [spr, ...glow.layers], y: "-=4", duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.time.delayedCall(45000, () => this.destroyDrop(spr));
  }

  private destroyDrop(spr: Phaser.Physics.Arcade.Image): void {
    if (!spr || !spr.active) return;
    const glow = spr.getData("glow") as DropGlow | undefined;
    this.tweens.killTweensOf(spr); // stop the infinite bob/glow tweens before destroying
    glow?.destroy();
    spr.destroy();
  }

  private pickupDrop(spr: Phaser.Physics.Arcade.Image): void {
    if (!spr.active) return;
    const item = spr.getData("item") as string;
    const qty = (spr.getData("qty") as number) ?? 1;
    addItem(this.state, item, qty);
    const equipped = autoEquip(this.state, item);
    // Rapid-loot combo: each pickup in a burst blips a step higher (U3).
    const now = this.time.now;
    this.pickupCombo = now - this.lastPickupAt < 1100 ? this.pickupCombo + 1 : 1;
    this.lastPickupAt = now;
    sfx.tick(this.pickupCombo);
    this.queuePickupFloat(item, qty);
    if (equipped) {
      this.showToast(`Equipped ${item}`);
      this.checkArmed();
    }
    this.destroyDrop(spr);
    this.persist();
  }

  private nearestChest(maxDist: number): ActiveChest | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: ActiveChest | null = null;
    let bestD = maxDist;
    const consider = (c: ActiveChest): void => {
      if (c.opened || !c.sprite.active) return;
      const d = Math.hypot(c.sprite.x - px, c.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    };
    for (const c of this.chunks.activeChests()) consider(c);
    for (const c of this.stashChests.values()) consider(c); // buried caches (U2)
    return best;
  }

  private openChest(chest: ActiveChest): void {
    if (chest.opened) return;
    if (chest.locked && !this.tryUnlock(chest)) return; // blocked — tryUnlock explains why
    chest.opened = true;
    chest.sprite.setTexture(CHEST_OPEN).clearTint();
    chest.badge?.destroy();
    chest.badge = undefined;
    if (!this.state.worldFlags.includes(`chest_${chest.gid}`)) this.state.worldFlags.push(`chest_${chest.gid}`);
    sfx.pickup();
    this.floatText(chest.sprite.x, chest.sprite.y, `${chest.kind.replace(/_/g, " ")} looted`, "#ffd23f");
    // Scarcer + smaller hauls (1+tier); locked containers reward the effort with a bias bump,
    // and specialised kinds route to themed loot (guns/meds/food/tools).
    const host = this.chunks.buildingAt(Math.floor(chest.sprite.x / TILE_SIZE), Math.floor(chest.sprite.y / TILE_SIZE));
    const bias =
      lootLuck(this.state) +
      this.chunks.lootBias(chest.sprite.x, chest.sprite.y) +
      (chest.locked ? 0.4 : 0) +
      priedLootBonus(this.state, host?.gid); // untouched (boarded) stock is richer (U5)
    for (const s of rollLoot(this.containerLootSource(chest.kind, chest.tier), liveRng, 1 + chest.tier, bias)) {
      this.spawnDrop(chest.sprite.x, chest.sprite.y, s.item, s.qty);
    }
    // Set-piece containers tell stories: a decent chance of a note/journal/map (U2).
    if (chest.gid.includes("_sc") && liveRng.chance(0.35)) {
      this.spawnDrop(chest.sprite.x, chest.sprite.y, rollReadable(liveRng), 1);
    }
    this.objectiveEvent({ kind: "container_searched" }); // opening arc (U3)
    this.persist();
  }

  /** Locked containers need a tool: Crowbar/Bolt Cutters are reusable; a Lockpick is consumed. */
  private tryUnlock(chest: ActiveChest): boolean {
    const tool = ["Bolt Cutters", "Crowbar", "Lockpick"].find((t) => hasItem(this.state, t));
    if (!tool) {
      this.showToast("Locked — need a Crowbar, Bolt Cutters, or Lockpick");
      sfx.ui();
      return false;
    }
    if (tool === "Lockpick") removeItem(this.state, "Lockpick", 1);
    this.floatText(chest.sprite.x, chest.sprite.y - 10, tool === "Lockpick" ? "Picked the lock" : `Forced with ${tool}`, "#9ef0a0");
    sfx.unlock();
    return true;
  }

  /** Specialised containers pull from themed loot; everything else uses the chest table. */
  private containerLootSource(kind: ActiveChest["kind"], tier: number): string {
    switch (kind) {
      case "gun_cabinet": return "police_station";
      case "med_cabinet": return "pharmacy";
      case "fridge": return "grocery";
      case "toolbox": return "hardware_store";
      default: return `chest:${Math.max(0, Math.min(4, tier))}`;
    }
  }

  // --- scavenging: hold-E searches of world props + fallen bodies (U1) --------

  /** The nearest unsearched searchable: streamed props first, then fallen bodies. */
  private nearestSearchable(maxDist: number): SearchTarget | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: SearchTarget | null = null;
    let bestD = maxDist;
    for (const s of this.chunks.activeSearchables()) {
      if (s.searched || !s.sprite.active) continue;
      const d = Math.hypot(s.sprite.x - px, s.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = { kind: s.kind, sprite: s.sprite, prop: s };
      }
    }
    for (const c of this.corpses) {
      if (c.searched || !c.sprite.active) continue;
      const d = Math.hypot(c.sprite.x - px, c.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = { kind: "body", sprite: c.sprite, corpse: c };
      }
    }
    return best;
  }

  private searchDefFor(t: SearchTarget): SearchableDef {
    return t.corpse ? CORPSE_BODY : (SEARCHABLE_PROPS[t.kind] ?? CORPSE_BODY);
  }

  private startSearch(t: SearchTarget): void {
    if (this.search || this.dead) return;
    // A "corpse" prop might lunge — deterministic per seed+prop, so no save-scum.
    if (t.prop && (t.kind === "corpse" || t.kind === "corpse_soldier") && playsDead(this.state.seed, t.prop.gid, this.effDay())) {
      markSearched(this.state, t.prop.gid);
      t.prop.searched = true;
      const x = t.sprite.x;
      const y = t.sprite.y;
      t.prop.sprite.destroy();
      this.spawnEnemy(rollZombie("zombie", liveRng, this.effDay(), this.chunks.biomeAtPx(x, y)), x, y);
      bloodBurst(this, x, y, 6);
      this.showToast("It wasn't dead!");
      sfx.hurt();
      this.cameras.main.shake(90, 0.005);
      this.persist();
      return;
    }
    this.search = { target: t, def: this.searchDefFor(t), done: 0, ring: this.add.graphics().setDepth(30) };
    sfx.rustle();
  }

  /** Channel tick: cancel if the hold broke (released / moved / hurt / target gone),
   *  else advance + draw the progress ring and finish at 100%. */
  private tickSearch(delta: number): void {
    const s = this.search;
    if (!s) return;
    const holding = (this.keyE?.isDown ?? false) || this.touch.actHeld;
    if (!holding || this.player.isMoving() || this.dead || !s.target.sprite.active) {
      this.cancelSearch();
      return;
    }
    s.done += delta;
    const frac = Math.min(1, s.done / s.def.ms);
    const x = s.target.sprite.x;
    const y = s.target.sprite.y - 24;
    s.ring.clear();
    s.ring.lineStyle(4, 0x10151b, 0.8).strokeCircle(x, y, 10);
    s.ring.lineStyle(3, 0xffe6a8, 0.95);
    s.ring.beginPath();
    s.ring.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    s.ring.strokePath();
    if (frac >= 1) this.completeSearch();
  }

  private cancelSearch(): void {
    if (!this.search) return;
    this.search.ring.destroy();
    this.search = null;
  }

  private completeSearch(): void {
    const s = this.search;
    if (!s) return;
    this.cancelSearch();
    const t = s.target;
    const x = t.sprite.x;
    const y = t.sprite.y;
    if (t.prop) {
      markSearched(this.state, t.prop.gid);
      t.prop.searched = true;
      t.prop.sprite.setTint(SEARCHED_TINT).setAlpha(0.55); // alpha too — canvas ignores tints
    }
    if (t.corpse) {
      t.corpse.searched = true;
      t.corpse.sprite.setTint(0x4c4c4c).setAlpha(0.7);
    }
    // Yields are THIN by design — chests stay the real prize (scavenge.ts).
    if (liveRng.chance(s.def.emptyChance)) {
      this.floatText(x, y - 6, "nothing useful", "#9fb3c8");
      sfx.ui();
    } else {
      const bias = lootLuck(this.state) + this.chunks.lootBias(x, y);
      for (const stack of rollLoot(s.def.source, liveRng, 1, bias)) this.spawnDrop(x, y, stack.item, stack.qty);
      // Themed bonus drop (PR3) — the fish at a fishing spot, planks in driftwood.
      const b = s.def.bonus;
      if (b && liveRng.chance(b.p)) this.spawnDrop(x, y, b.item, liveRng.int(b.min, b.max));
      this.grantXp("crafting", 1); // resourcefulness
      sfx.pickup();
    }
    // Drawers and shelves sometimes hold someone's writing (U2 readables).
    if (s.def.source === "scav_domestic" && liveRng.chance(0.04)) this.spawnDrop(x, y, rollReadable(liveRng), 1);
    this.objectiveEvent({ kind: "container_searched" }); // opening arc (U3)
    this.persist();
  }

  /** Grant skill XP and surface a level-up (Feature 9). */
  private grantXp(id: SkillId, amount: number): void {
    if (addXp(this.state, id, amount) > 0) {
      this.showToast(`${SKILL_NAMES[id]} level up!`);
      sfx.ui();
    }
  }

  // --- ranged combat ---------------------------------------------------------

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    if (ptr.wasTouch) return; // touch uses the FIRE button (Phase 6)
    if (ptr.middleButtonDown()) {
      this.useQuickSlot(this.selectedQuick); // wheel-click uses the selected quick item
      return;
    }
    if (ptr.leftButtonDown()) {
      this.firing = true;
      this.fire(this.aimAngle());
    }
  }
  private onPointerUp(ptr: Phaser.Input.Pointer): void {
    if (!ptr.wasTouch) this.firing = false;
  }

  /** Fire the equipped gun toward `angle` (one trigger pull). */
  private fire(angle: number): void {
    if (this.dead || this.inEncounter || this.reloading || this.lootOpen || this.driving || this.storeOpen || this.tradeOpen || this.buildMode) return;
    const plan = shotOutcome(this.state, liveRng);
    if (!plan) return; // no gun equipped
    const now = this.time.now;
    if (now - this.lastShot < plan.cooldownMs) return;
    if ((this.state.loadedAmmo ?? 0) <= 0) {
      this.tryReload();
      return;
    }
    this.lastShot = now;
    this.state.loadedAmmo = (this.state.loadedAmmo ?? 0) - 1;
    sfx.shot();
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    this.spawnMuzzle(px, py, angle);
    this.cameras.main.shake(40, 0.0018);
    const pellets = Math.max(1, plan.pellets);
    for (let i = 0; i < pellets; i++) {
      const jitter = pellets > 1 ? (Math.random() - 0.5) * plan.spread * 2 : (Math.random() - 0.5) * 0.05;
      this.spawnProjectile(px, py, angle + jitter, plan);
    }
    if ((this.state.loadedAmmo ?? 0) <= 0) this.tryReload();
  }

  /** Mobile auto-aim fire: shoot toward the nearest enemy. */
  private fireAuto(): void {
    const e = this.nearestEnemy(620);
    const angle = e
      ? Math.atan2(e.sprite.y - this.player.sprite.y, e.sprite.x - this.player.sprite.x)
      : this.player.sprite.rotation;
    this.fire(angle);
  }

  private nearestEnemy(maxDist: number): Enemy | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: Enemy | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      const d = Math.hypot(e.sprite.x - px, e.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private projTexture(wclass: string): string {
    if (wclass === "shotgun") return PROJ_PELLET;
    if (wclass === "bow" || wclass === "crossbow") return PROJ_ARROW;
    if (wclass === "launcher") return PROJ_ROCKET;
    return PROJ_BULLET;
  }

  private spawnProjectile(px: number, py: number, angle: number, plan: ShotPlan): void {
    const spr = this.projectileGroup.create(
      px + Math.cos(angle) * 16,
      py + Math.sin(angle) * 16,
      this.projTexture(plan.weapon.wclass),
    ) as Phaser.Physics.Arcade.Image;
    spr.setRotation(angle).setDepth(9);
    this.physics.velocityFromRotation(angle, plan.speed, (spr.body as Phaser.Physics.Arcade.Body).velocity);
    const data: ProjData = {
      damage: plan.damage,
      pierce: plan.pierce,
      knockback: plan.knockback,
      bleed: plan.bleed,
      bleedMs: plan.bleedMs,
      stunMs: plan.stunMs,
      burn: plan.burn,
      explosive: plan.explosive,
      executePct: plan.executePct,
      crit: plan.crit,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      hits: new Set<Enemy>(),
    };
    spr.setData("p", data);
    const lifeMs = Math.min(2000, (plan.range / plan.speed) * 1000);
    this.time.delayedCall(lifeMs, () => this.killProjectile(spr));
  }

  private onProjectileHit(projObj: unknown, enemyObj: unknown): void {
    const spr = projObj as Phaser.Physics.Arcade.Image;
    const data = spr.getData("p") as ProjData | undefined;
    if (!data) return;
    const enemy = this.enemies.find((e) => e.sprite === enemyObj);
    if (!enemy || data.hits.has(enemy)) return;
    data.hits.add(enemy);
    this.applyShotHit(enemy, data);
    if (data.explosive > 0) {
      this.explode(spr.x, spr.y, data);
      this.killProjectile(spr);
      return;
    }
    data.pierce -= 1;
    if (data.pierce < 0) this.killProjectile(spr);
  }

  private applyShotHit(e: Enemy, data: ProjData): void {
    const execute = data.executePct > 0 && e.hpFrac() * 100 <= data.executePct;
    const dmg = execute ? e.hp : data.damage;
    const dead = e.takeDamage(dmg);
    const sdir = { x: data.dirX, y: data.dirY };
    splatHit(this, e.sprite.x, e.sprite.y, e.blood, sdir, data.crit ? 1.5 : execute ? 1.4 : dead ? 1.3 : 1);
    bloodDecal(this, e.sprite.x, e.sprite.y, data.crit ? 1.0 : 0.7, e.blood.pool); // splatHit lays the directional smear
    this.floatText(e.sprite.x, e.sprite.y, execute ? "EXECUTE" : String(Math.round(dmg)), data.crit ? "#ffd23f" : execute ? "#ff5a6e" : "#ffffff");
    if (data.crit && !execute) this.floatText(e.sprite.x, e.sprite.y - 13, "CRIT!", "#ffd23f");
    if (data.bleed > 0) e.applyDot(data.bleed, data.bleedMs);
    if (data.burn > 0) e.applyDot(data.burn, 3000);
    if (data.stunMs > 0) e.applyStun(data.stunMs);
    if (data.knockback > 0) e.knockback(data.dirX, data.dirY, data.knockback, this.time.now);
    if (dead) this.onEnemyKilled(e);
  }

  private explode(x: number, y: number, data: ProjData): void {
    sfx.boom();
    this.cameras.main.shake(140, 0.012);
    bloodBurst(this, x, y, 18, 0xffa23f); // the fireball flash itself
    for (const e of [...this.enemies]) {
      if (data.hits.has(e)) continue;
      if (Math.hypot(e.sprite.x - x, e.sprite.y - y) <= data.explosive) {
        const dead = e.takeDamage(Math.round(data.damage * 0.7));
        if (data.burn > 0) e.applyDot(data.burn, 3000);
        // each caught enemy bleeds its OWN fluid, flung away from the blast
        const bdir = { x: e.sprite.x - x, y: e.sprite.y - y };
        if (dead) this.onEnemyKilled(e);
        else {
          splatHit(this, e.sprite.x, e.sprite.y, e.blood, bdir, 1.2);
          bloodDecal(this, e.sprite.x, e.sprite.y, 0.7, e.blood.pool);
        }
      }
    }
  }

  private killProjectile(spr: Phaser.Physics.Arcade.Image): void {
    if (!spr || !spr.active) return;
    spr.destroy();
  }

  private spawnMuzzle(px: number, py: number, angle: number): void {
    const f = this.add
      .image(px + Math.cos(angle) * 20, py + Math.sin(angle) * 20, PROJ_PELLET)
      .setTint(0xffe08a)
      .setScale(2.4)
      .setDepth(11);
    this.tweens.add({ targets: f, alpha: 0, scale: 0.5, duration: 90, onComplete: () => f.destroy() });
  }

  private tryReload(): void {
    if (this.reloading) return;
    const w = equippedRangedDef(this.state);
    if (!w) return;
    if ((this.state.loadedAmmo ?? 0) >= (w.magSize ?? 0)) return;
    if (ammoReserve(this.state, w.ammoType) <= 0) {
      this.showToast("No ammo in reserve");
      return;
    }
    this.reloading = true;
    sfx.reload();
    this.showToast("Reloading…");
    this.time.delayedCall(w.reloadMs ?? 1800, () => {
      this.reloading = false;
      if (this.dead) return;
      reloadEquipped(this.state);
      sfx.reload();
    });
  }

  /** Brief physics freeze for impact weight (kills only). */
  private hitstop(ms: number): void {
    if (this.physics.world.isPaused) return;
    this.physics.world.isPaused = true;
    this.time.delayedCall(ms, () => {
      this.physics.world.isPaused = false;
    });
  }

  private removeEnemy(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    e.cleanupUi(); // remove the health bar + name label
    const body = e.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
    deathFade(this, e.sprite); // fades + spins out, then destroys the sprite
  }

  /** Open the run with its AI-authored scenario as a NON-blocking banner — you can
   *  read it while already free to move and explore (no forced first prompt). */
  private showIntro(intro: string): void {
    this.modal.showBanner(intro, "");
    this.modal.dismissSoon(9000);
  }

  private persist(): void {
    if (this.dead) return; // never persist a finished run
    this.state.player.x = this.player.sprite.x;
    this.state.player.y = this.player.sprite.y;
    if (this.driving) {
      // a car-in-motion rides with the player so a mid-drive save isn't lost
      this.driving.data.x = this.player.sprite.x;
      this.driving.data.y = this.player.sprite.y;
      upsertVehicle(this.state, this.driving.data);
    }
    if (this.state.npcs && this.npcs.length > 0) {
      for (const npc of this.npcs) {
        if (npc.kind !== "companion") continue;
        const rec = this.state.npcs.find((n) => n.id === npc.id);
        if (rec) {
          rec.x = npc.sprite.x;
          rec.y = npc.sprite.y;
          rec.hp = npc.hp;
        }
      }
    }
    this.state.clockMs = this.segAcc; // preserve continuous clock progress across reloads
    saveGame(this.state);
  }
}
