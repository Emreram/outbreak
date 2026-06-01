import Phaser from "phaser";
import type { GameState, GMResponse, Spawn, TurnInput } from "../shared/contracts";
import type { Building } from "../game/worldgen";
import { randomSeed, liveRng } from "../game/rng";
import {
  clampStat,
  clearSave,
  isDead,
  loadGame,
  newGame,
  pushRecentEvent,
  saveGame,
} from "../game/GameState";
import { applyDecay, ratesFor } from "../game/survival";
import { ammoMult, damageTakenMult, lootLuck, sprintDrainMult, type DamageKind } from "../game/perks";
import { addItem, ammoReserve, autoEquip, equippedRangedDef, reloadEquipped, removeItem } from "../game/inventory";
import { meleeOutcome, shotOutcome, type MeleeHit, type ShotPlan } from "../game/combat";
import { rollLoot } from "../game/items/lootTables";
import { defOf } from "../game/items/catalog";
import { RARITY_META } from "../game/items/rarity";
import {
  CHEST_OPEN,
  iconKey,
  PROJ_ARROW,
  PROJ_BULLET,
  PROJ_PELLET,
  PROJ_ROCKET,
} from "../engine/icons";
import { applyOutcome, type ApplyResult } from "../game/outcomes";
import { classifyIntent, type Intent } from "../game/intent";
import { buildingEnteredFlag, nextAmbientDelayMs } from "../game/encounters";
import { runTurn, getActiveBrain, consumeFellBack } from "../ai/gameMaster";
import { ChunkManager, type ActiveChest } from "../game/world/ChunkManager";
import type { ColliderSpec } from "../engine/ChunkRenderer";
import { Player } from "../engine/Player";
import { Enemy } from "../engine/Enemy";
import type { ZombieDef } from "../game/enemies/types";
import { rollAmbientUndead, rollZombie } from "../game/enemies/spawnTable";
import { getZombie } from "../game/enemies/catalog";
import { setupCamera } from "../engine/Camera";
import { HUD } from "../ui/HUD";
import { EncounterModal } from "../ui/EncounterModal";
import { LootModal } from "../ui/LootModal";
import { TouchControls } from "../ui/TouchControls";
import { sfx } from "../engine/audio";
import { bloodBurst, dustPuff, deathFade, spawnPopIn, meleeArc, makeGlow, FX_DUST, FX_GLOW, FX_VIGNETTE } from "../engine/fx";
import { TILE_SIZE } from "../game/constants";

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

type StatKey = "hp" | "stamina" | "hunger" | "thirst" | "infection";
const DECAY_MS = 2000;
const SAVE_MS = 4000;
const PHASES = ["dawn", "day", "dusk", "night"] as const;
const SEG_MS = 45000; // real seconds per time-of-day segment

// Open-ground locations (outdoor biomes) vs enclosed buildings — shapes which
// instant quick-actions an encounter's opening prompt offers.
const OPEN_LOCS = new Set<string>([
  "street", "forest", "dense_woods", "grassland", "farmland", "riverbank", "lake",
  "marsh", "coast", "quarry", "parkland", "construction_site", "ocean",
]);

export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private chunks!: ChunkManager;
  private hud!: HUD;
  private modal!: EncounterModal;
  private loot!: LootModal;
  private lootOpen = false;
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
  private ambientAcc = 0;
  private ambientDelay = 30000;
  private currentBuildingId: string | null = null;
  private aiNoticeShown = false; // show the "AI offline" toast at most once per run
  private nightOverlay!: Phaser.GameObjects.Rectangle;
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
  private objBanner!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private weaponSprite!: Phaser.GameObjects.Image;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private uiLayer!: Phaser.GameObjects.Layer;
  private readonly saveOnUnload = () => this.persist();

  constructor() {
    super("WorldScene");
  }

  create(): void {
    this.dead = false;
    this.inEncounter = false;
    this.enacting = false;
    this.encounterTurns = 0;
    this.lootOpen = false;
    this.grabbedUntil = 0;
    this.clouds = [];
    this.decayAcc = 0;
    this.saveAcc = 0;
    this.enemies = [];
    this.ambientAcc = 0;
    this.ambientDelay = 30000; // set properly once state/day is known (below)
    this.currentBuildingId = null;
    this.aiNoticeShown = false;
    this.segAcc = 0;
    this.kills = 0;
    this.lastMelee = 0;
    this.lastShot = 0;
    this.firing = false;
    this.reloading = false;
    this.lastStep = 0;

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
    this.projectileGroup = this.physics.add.group();
    this.enemyProjGroup = this.physics.add.group();
    this.itemGroup = this.physics.add.group();

    const collide: ColliderSpec[] = [];
    this.chunks = new ChunkManager(this, this.state.seed, {
      collide,
      isChestLooted: (gid) => this.state.worldFlags.includes(`chest_${gid}`),
    });

    // A fresh run (new game / character creation / ?seed) carries an AI intro, and
    // its freshly-saved state sits at the unplaced (0,0) origin — which is the ocean
    // border. Spawn it at the world's spawn chunk instead; a resumed run keeps its spot.
    const freshRun = !saved || !!this.registry.get("intro");
    const startX = freshRun ? this.chunks.start.x : this.state.player.x;
    const startY = freshRun ? this.chunks.start.y : this.state.player.y;
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

    // Equipped weapon shown in-hand (icon swaps on equip).
    this.weaponSprite = this.add.image(startX, startY, iconKey("Fists")).setDepth(11).setScale(0.42).setVisible(false);

    // Collider specs applied to every streamed chunk layer (walls/water/trees).
    collide.push(
      { target: this.player.sprite },
      { target: this.enemyGroup },
      { target: this.projectileGroup, callback: (o) => this.killProjectile(o as unknown as Phaser.Physics.Arcade.Image) },
      { target: this.enemyProjGroup, callback: (o) => this.killProjectile(o as unknown as Phaser.Physics.Arcade.Image) },
    );

    // Projectiles hit enemies; enemy acid + dropped loot overlap the player.
    this.physics.add.overlap(this.projectileGroup, this.enemyGroup, (a, b) => this.onProjectileHit(a, b));
    this.physics.add.overlap(this.player.sprite, this.enemyProjGroup, (_p, pr) => this.onEnemyProjHit(pr));
    this.physics.add.overlap(this.player.sprite, this.itemGroup, (_p, item) =>
      this.pickupDrop(item as unknown as Phaser.Physics.Arcade.Image),
    );

    // Stream the initial ring of chunks (and their chests) around the spawn.
    this.chunks.ensureAround(startX, startY);

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
    this.uiLayer.add(this.vignette);

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
      .text(this.scale.width / 2, this.scale.height - 96, "", {
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

    if (freshRun) {
      this.state.player.x = startX;
      this.state.player.y = startY;
      saveGame(this.state);
    }

    this.hud = new HUD(this, this.uiLayer);

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

    window.addEventListener("beforeunload", this.saveOnUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("beforeunload", this.saveOnUnload);
      this.scale.off("resize", this.onResize, this);
      this.modal.destroy();
      this.loot.destroy();
      this.touch.destroy();
      this.chunks.destroy();
      this.persist();
    });

    // Day 0 is nearly empty — the streets fill as the outbreak spreads.
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
    // while the loot screen is open.
    if (!this.dead && !this.inEncounter && !this.enacting && !this.lootOpen) {
      const canSprint = this.state.player.stamina > 5;
      const tv = this.touch.vector();
      if (time < this.grabbedUntil) {
        this.player.sprite.setVelocity(0, 0); // held fast by a grabber
      } else {
        this.player.update(canSprint, { x: tv.x, y: tv.y, sprint: this.touch.sprintHeld });
        if (this.player.sprinting) {
          this.state.player.stamina = clampStat(this.state.player.stamina - delta * 0.012 * sprintDrainMult(this.state));
        }
      }
      this.chunks.ensureAround(this.player.sprite.x, this.player.sprite.y);
      this.tickClouds(time);
      this.updateEnemies(time);
      this.checkBuildingTrigger();

      if (this.player.isMoving() && time - this.lastStep > 300) {
        this.lastStep = time;
        dustPuff(this, this.player.sprite.x, this.player.sprite.y + 8, 2);
      }

      if (this.firing) this.fire(this.aimAngle()); // auto-fire while mouse held
      if (this.touch.fireHeld) this.fireAuto(); // mobile FIRE button: auto-aim nearest

      this.decayAcc += delta;
      if (this.decayAcc >= DECAY_MS) {
        this.decayAcc -= DECAY_MS;
        applyDecay(this.state, ratesFor(this.state));
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

      this.saveAcc += delta;
      if (this.saveAcc >= SAVE_MS) {
        this.saveAcc -= SAVE_MS;
        this.persist();
      }
    }

    // The flashlight glow tracks the player even while paused.
    this.glow.setPosition(this.player.sprite.x, this.player.sprite.y);
    this.updateWeaponSprite();

    // Contextual "Press E" hint (chest > building) when free to act.
    if (!this.dead && !this.inEncounter) {
      const chest = this.nearestChest(42);
      const near = chest ? null : this.buildingAt();
      if (chest) this.hintText.setText("Press E to open the chest").setVisible(true);
      else if (near) this.hintText.setText(`Press E to enter the ${near.type.replace(/_/g, " ")}`).setVisible(true);
      else this.hintText.setVisible(false);
    } else {
      this.hintText.setVisible(false);
    }

    this.hud.update(this.state, this.debugInfo());
  }

  private updateObjective(): void {
    const g = this.state.goal ?? "";
    this.objBanner.setText(g ? `Objective: ${g}` : "").setVisible(!!g);
  }

  // --- enemies (CLAUDE.md §11) -----------------------------------------------

  private updateEnemies(now: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const noise =
      (this.player.isMoving() ? 45 : 0) + (this.player.sprinting ? 70 : 0) + this.nightNoise();
    for (const e of this.enemies) {
      e.update(px, py, noise, now);
      if (e.tryAttack(px, py, now)) this.takeHit(e);
      this.enemySpecials(e, px, py, now);
    }
    // reap enemies finished off by bleed/burn damage-over-time
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) {
        bloodBurst(this, e.sprite.x, e.sprite.y, 8);
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

  private advanceClock(): void {
    const idx = PHASES.indexOf(this.state.timeOfDay);
    const next = (idx + 1) % PHASES.length;
    if (next === 0) this.state.day += 1; // wrapped night -> dawn
    this.state.timeOfDay = PHASES[next];
    this.applyPhaseVisual();
    this.persist();
  }

  private applyPhaseVisual(): void {
    const tints: Record<string, { color: number; alpha: number }> = {
      dawn: { color: 0x24304f, alpha: 0.22 },
      day: { color: 0x000000, alpha: 0.0 },
      dusk: { color: 0x3a1f10, alpha: 0.3 },
      night: { color: 0x00040c, alpha: 0.56 },
    };
    const v = tints[this.state.timeOfDay] ?? tints.day;
    this.nightOverlay.setFillStyle(v.color, 1);
    this.tweens.add({ targets: this.nightOverlay, alpha: v.alpha, duration: 1200 });

    const glowAlpha: Record<string, number> = { dawn: 0.22, day: 0, dusk: 0.5, night: 0.72 };
    if (this.glow) this.tweens.add({ targets: this.glow, alpha: glowAlpha[this.state.timeOfDay] ?? 0, duration: 1200 });
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.uiCam?.setSize(size.width, size.height);
    this.nightOverlay?.setSize(size.width, size.height);
    this.vignette?.setDisplaySize(size.width, size.height);
    this.objBanner?.setPosition(size.width / 2, 8);
    this.hintText?.setPosition(size.width / 2, size.height - 96);
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
    const p = this.state.player;
    const dmg = Math.max(1, Math.round(rawDmg * (1 - this.playerArmorPct() / 100) * damageTakenMult(this.state, kind)));
    p.hp = clampStat(p.hp - dmg);
    if (bite) p.infection = clampStat(p.infection + Phaser.Math.Between(8, 16));
    pushRecentEvent(this.state, msg);
    sfx.hurt();
    bloodBurst(this, this.player.sprite.x, this.player.sprite.y, 6, 0xcc2222);
    this.player.recoil();
    this.cameras.main.shake(120, 0.006);
    this.cameras.main.flash(110, 120, 0, 0);
    if (isDead(this.state)) this.enterDeath();
  }

  /** Best armor the player is carrying (worn) reduces incoming damage. */
  private playerArmorPct(): number {
    let best = 0;
    for (const it of this.state.inventory) {
      const d = defOf(it.item);
      if (d.kind === "armor") best = Math.max(best, d.defense);
    }
    return best;
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
    const spr = this.enemyProjGroup.create(x + Math.cos(angle) * 16, y + Math.sin(angle) * 16, PROJ_PELLET) as Phaser.Physics.Arcade.Image;
    spr.setTint(0x8fd14a).setScale(1.5).setDepth(9);
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
      bloodBurst(this, x, y, 16, 0x8fd14a);
      const radius = 84;
      if (Math.hypot(this.player.sprite.x - x, this.player.sprite.y - y) < radius) {
        this.damagePlayer(Math.round(8 + e.damage * 0.5), true, "Caught in the burst.", "toxic");
      }
      for (const o of [...this.enemies]) {
        if (o !== e && Math.hypot(o.sprite.x - x, o.sprite.y - y) < radius && o.takeDamage(12)) this.onEnemyKilled(o);
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
    if (this.enemies.length >= 40) return; // safety cap
    const e = new Enemy(this, x, y, def);
    this.enemyGroup.add(e.sprite);
    this.enemies.push(e);
    spawnPopIn(this, e.sprite);
  }

  /** Effective danger driver for spawns: the day plus the local distance/biome tier. */
  private effDay(): number {
    return this.state.day + this.chunks.dangerTier(this.player.sprite.x, this.player.sprite.y);
  }

  private spawnNear(spawns: Spawn[]): void {
    const ptx = this.player.tilePos().tx;
    const pty = this.player.tilePos().ty;
    const day = this.effDay();
    for (const s of spawns) {
      for (let i = 0; i < s.count; i++) {
        const tile = this.chunks.walkableNear(ptx, pty, 3, 8);
        if (tile) this.spawnEnemy(rollZombie(s.type, liveRng, day), tile.x, tile.y);
      }
    }
  }

  private spawnAmbientWalkers(n: number): void {
    const day = this.effDay();
    for (let i = 0; i < n; i++) {
      const tile = this.chunks.randomWalkableInView(this.player.sprite.x, this.player.sprite.y, 12);
      if (tile) this.spawnEnemy(rollAmbientUndead(liveRng, day), tile.x, tile.y);
    }
  }

  /** Starting walker count — near-empty at day 0 (the calm start); ongoing
   *  threats (ambientEvent/GM spawns) scale with distance as you explore out. */
  private ambientStartCount(): number {
    return Math.min(1 + this.state.day * 2, 16);
  }

  /** Time to the next ambient threat — rare early, more frequent later/at night/far out. */
  private scheduleAmbientMs(): number {
    const base = nextAmbientDelayMs();
    const day = this.effDay();
    const dayFactor = day === 0 ? 2.6 : 1 / (1 + day * 0.12);
    return base * dayFactor * (this.isNight() ? 0.6 : 1);
  }

  private ambientEvent(): void {
    const day = this.effDay();
    const extra = this.state.difficultyModifier > 1.15 ? 1 : 0;
    const dayBonus = Math.floor(day / 3);
    const n = Math.min(Phaser.Math.Between(1, 2) + extra + dayBonus, 6);
    const runnerChance = this.isNight() ? 0.32 : 0.12 + day * 0.02;
    const kind: Spawn["type"] = Math.random() < runnerChance ? "zombie_runner" : "zombie";
    this.spawnNear([{ type: kind, count: n }]);
    this.showToast("You hear shuffling nearby…");
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

  /** Entering a building fires a one-time GM encounter (then it stays "cleared"). */
  private checkBuildingTrigger(): void {
    const b = this.buildingAt();
    const gid = b ? b.gid : null;
    if (gid === this.currentBuildingId) return;
    this.currentBuildingId = gid;
    if (b && !this.state.worldFlags.includes(buildingEnteredFlag(b.gid))) {
      this.state.worldFlags.push(buildingEnteredFlag(b.gid));
      const name = b.type.replace(/_/g, " ");
      this.startEncounter(b.type, `You slip inside the ${name}, staying low — it's dim and still.`, name);
    }
  }

  /** Press E to act on the current surroundings. */
  private tryInteract(): void {
    const chest = this.nearestChest(42);
    if (chest) {
      this.openChest(chest);
      return;
    }
    const b = this.buildingAt();
    if (b) {
      const name = b.type.replace(/_/g, " ");
      this.startEncounter(b.type, `You take stock of the ${name} around you.`, name);
    } else {
      const biome = this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y);
      this.startEncounter(biome, "You scan the area and the way ahead.", "The area");
    }
  }

  private toggleLoot(): void {
    if (this.dead) return;
    if (this.lootOpen) {
      this.loot.close();
      return;
    }
    if (this.inEncounter) return;
    this.lootOpen = true;
    this.setGameKeys(false);
    this.firing = false;
    this.player.sprite.setVelocity(0, 0);
    this.loot.open(this.state, () => {
      this.hud.update(this.state, this.debugInfo());
      this.persist();
    });
  }

  private startEncounter(loc: string, situation: string, title: string): void {
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
    this.modal.openPrompt(title, situation, this.openingChoicesFor(loc));
  }

  /** A few instant, contextual quick-actions for the opening prompt (plus free text). */
  private openingChoicesFor(loc: string): string[] {
    return OPEN_LOCS.has(loc)
      ? ["Search the area", "Scout ahead", "Move on quietly", "Set up to rest"]
      : ["Search for supplies", "Look for survivors", "Barricade up", "Slip back out"];
  }

  /** Enable/disable the Phaser keyboard so encounter typing never leaks to gameplay. */
  private setGameKeys(enabled: boolean): void {
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
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
          bloodBurst(this, e.sprite.x, e.sprite.y, 8);
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
    kb.on("keydown-ESC", () => this.scene.start("MainMenuScene"));

    // E = act on your surroundings (open an AI Game Master encounter).
    kb.on("keydown-E", () => this.tryInteract());

    // SPACE / F = melee swing at the nearest threat.
    kb.on("keydown-SPACE", () => this.meleeAttack());
    kb.on("keydown-F", () => this.meleeAttack());

    // Debug actions (Phase 3) so stats/inventory are visibly alive. Phase 4
    // replaces these with GM-driven, validated outcomes.
    kb.on("keydown-ONE", () => this.consume("Canned Food", { hunger: 25, hp: 5 }, "Ate canned food."));
    kb.on("keydown-TWO", () => this.consume("Water Bottle", { thirst: 30 }, "Drank water."));
    kb.on("keydown-THREE", () => this.debugHurt());
    kb.on("keydown-FOUR", () => this.consume("Bandage", { hp: 30 }, "Patched a wound."));
  }

  /** Consume one of an item (if held) and apply clamped stat gains. */
  private consume(item: string, gains: Partial<Record<StatKey, number>>, msg: string): void {
    if (this.dead || this.inEncounter) return;
    if (removeItem(this.state, item, 1) === 0) return;
    const p = this.state.player;
    (Object.keys(gains) as StatKey[]).forEach((k) => {
      p[k] = clampStat(p[k] + (gains[k] ?? 0));
    });
    pushRecentEvent(this.state, msg);
    this.persist();
  }

  private debugHurt(): void {
    if (this.dead || this.inEncounter) return;
    this.state.player.hp = clampStat(this.state.player.hp - 15);
    pushRecentEvent(this.state, "Took a hit.");
    if (isDead(this.state)) this.enterDeath();
    this.persist();
  }

  private enterDeath(reason?: string): void {
    if (this.dead) return;
    this.dead = true;
    this.inEncounter = false;
    this.enacting = false;
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
    if (this.dead || this.inEncounter) return;
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
    const dead = e.takeDamage(execute ? e.hp : hit.damage);
    bloodBurst(this, e.sprite.x, e.sprite.y, hit.crit ? 14 : dead ? 12 : 6, hit.crit ? 0xff5a6e : 0x9c1414);
    if (hit.crit) this.floatText(e.sprite.x, e.sprite.y, "CRIT!", "#ffd23f");
    else if (execute) this.floatText(e.sprite.x, e.sprite.y, "EXECUTE", "#ff5a6e");
    if (hit.bleed > 0) e.applyDot(hit.bleed, hit.bleedMs);
    if (hit.stunMs > 0) e.applyStun(hit.stunMs);
    if (hit.knockback > 0) {
      const ang = Math.atan2(e.sprite.y - py, e.sprite.x - px);
      e.knockback(Math.cos(ang), Math.sin(ang), hit.knockback, this.time.now);
    }
    if (dead) {
      this.hitstop(55);
      this.onEnemyKilled(e);
    }
  }

  private onEnemyKilled(e: Enemy): void {
    if (this.enemies.indexOf(e) < 0) return; // already reaped this frame
    this.kills += 1;
    sfx.kill();
    pushRecentEvent(this.state, `Put down a ${e.def.name}.`);
    this.onDeathTraits(e); // exploder / splitter / bloated bursts
    this.dropLoot(e);
    this.removeEnemy(e); // death animation
  }

  private floatText(x: number, y: number, text: string, color = "#ffffff"): void {
    const t = this.add
      .text(x, y - 16, text, { fontFamily: "monospace", fontSize: "13px", color, stroke: "#000000", strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  private updateWeaponSprite(): void {
    const name = this.state.equippedRanged ?? this.state.equippedMelee;
    if (!name) {
      this.weaponSprite.setVisible(false);
      return;
    }
    const key = iconKey(name);
    if (this.textures.exists(key) && this.weaponSprite.texture.key !== key) this.weaponSprite.setTexture(key);
    const ang = this.aimAngle();
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    this.weaponSprite
      .setPosition(px + Math.cos(ang) * 15, py + Math.sin(ang) * 15)
      .setRotation(ang)
      .setVisible(true);
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
  }

  private spawnDrop(x: number, y: number, item: string, qty: number): void {
    if (this.itemGroup.countActive(true) > 60) return; // perf cap
    const ox = (Math.random() - 0.5) * 16;
    const oy = (Math.random() - 0.5) * 16;
    const def = defOf(item);
    if (def.kind === "ammo" || def.kind === "material") qty = Math.round(qty * ammoMult(this.state)); // Scrapper perk
    const color = RARITY_META[def.rarity].color;
    const glow = this.add.image(x + ox, y + oy, FX_GLOW).setTint(color).setScale(0.22).setDepth(6).setAlpha(0.5);
    const spr = this.itemGroup.create(x + ox, y + oy, iconKey(item)) as Phaser.Physics.Arcade.Image;
    spr.setScale(0.5).setDepth(7);
    spr.setData("item", item);
    spr.setData("qty", qty);
    spr.setData("glow", glow);
    this.tweens.add({ targets: [spr, glow], y: "-=4", duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.tweens.add({ targets: glow, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });
    this.time.delayedCall(45000, () => this.destroyDrop(spr));
  }

  private destroyDrop(spr: Phaser.Physics.Arcade.Image): void {
    if (!spr || !spr.active) return;
    const glow = spr.getData("glow") as Phaser.GameObjects.Image | undefined;
    this.tweens.killTweensOf(spr); // stop the infinite bob/glow tweens before destroying
    if (glow) {
      this.tweens.killTweensOf(glow);
      glow.destroy();
    }
    spr.destroy();
  }

  private pickupDrop(spr: Phaser.Physics.Arcade.Image): void {
    if (!spr.active) return;
    const item = spr.getData("item") as string;
    const qty = (spr.getData("qty") as number) ?? 1;
    const meta = RARITY_META[defOf(item).rarity];
    addItem(this.state, item, qty);
    const equipped = autoEquip(this.state, item);
    sfx.pickup();
    this.floatText(this.player.sprite.x, this.player.sprite.y - 6, `+${qty > 1 ? qty + " " : ""}${item}`, meta.css);
    if (equipped) this.showToast(`Equipped ${item}`);
    this.destroyDrop(spr);
    this.persist();
  }

  private nearestChest(maxDist: number): ActiveChest | null {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let best: ActiveChest | null = null;
    let bestD = maxDist;
    for (const c of this.chunks.activeChests()) {
      if (c.opened) continue;
      const d = Math.hypot(c.sprite.x - px, c.sprite.y - py);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private openChest(chest: ActiveChest): void {
    if (chest.opened) return;
    chest.opened = true;
    chest.sprite.setTexture(CHEST_OPEN);
    if (!this.state.worldFlags.includes(`chest_${chest.gid}`)) this.state.worldFlags.push(`chest_${chest.gid}`);
    sfx.pickup();
    this.floatText(chest.sprite.x, chest.sprite.y, "Chest opened!", "#ffd23f");
    const bias = lootLuck(this.state) + this.chunks.lootBias(chest.sprite.x, chest.sprite.y);
    for (const s of rollLoot(`chest:${chest.tier}`, liveRng, 2 + chest.tier, bias)) {
      this.spawnDrop(chest.sprite.x, chest.sprite.y, s.item, s.qty);
    }
    this.persist();
  }

  // --- ranged combat ---------------------------------------------------------

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    if (ptr.wasTouch) return; // touch uses the FIRE button (Phase 6)
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
    if (this.dead || this.inEncounter || this.reloading || this.lootOpen) return;
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
    const dead = e.takeDamage(execute ? e.hp : data.damage);
    bloodBurst(this, e.sprite.x, e.sprite.y, data.crit ? 12 : 6, data.crit ? 0xff5a6e : 0x9c1414);
    if (data.crit) this.floatText(e.sprite.x, e.sprite.y, "CRIT!", "#ffd23f");
    if (data.bleed > 0) e.applyDot(data.bleed, data.bleedMs);
    if (data.burn > 0) e.applyDot(data.burn, 3000);
    if (data.stunMs > 0) e.applyStun(data.stunMs);
    if (data.knockback > 0) e.knockback(data.dirX, data.dirY, data.knockback, this.time.now);
    if (dead) this.onEnemyKilled(e);
  }

  private explode(x: number, y: number, data: ProjData): void {
    sfx.boom();
    this.cameras.main.shake(140, 0.012);
    bloodBurst(this, x, y, 18, 0xffa23f);
    for (const e of [...this.enemies]) {
      if (data.hits.has(e)) continue;
      if (Math.hypot(e.sprite.x - x, e.sprite.y - y) <= data.explosive) {
        const dead = e.takeDamage(Math.round(data.damage * 0.7));
        if (data.burn > 0) e.applyDot(data.burn, 3000);
        if (dead) this.onEnemyKilled(e);
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

  /** Open the run with its AI-authored scenario intro; first action goes to the GM. */
  private showIntro(intro: string): void {
    this.inEncounter = true;
    this.enacting = false;
    this.encounterTurns = 0;
    this.setGameKeys(false);
    this.player.sprite.setVelocity(0, 0);
    this.freezeEnemies();
    const b = this.buildingAt();
    this.encounterLoc = b ? b.type : this.chunks.biomeAtPx(this.player.sprite.x, this.player.sprite.y);
    this.modal.openPrompt(this.state.player.name, intro, this.openingChoicesFor(this.encounterLoc));
  }

  private persist(): void {
    if (this.dead) return; // never persist a finished run
    this.state.player.x = this.player.sprite.x;
    this.state.player.y = this.player.sprite.y;
    saveGame(this.state);
  }
}
