import Phaser from "phaser";
import type { GameState, GMResponse, Spawn, TurnInput } from "../shared/contracts";
import { generateWorld, SOLID_TILES, type Building, type WorldData } from "../game/worldgen";
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
import { applyDecay } from "../game/survival";
import { ammoReserve, equippedRangedDef, reloadEquipped, removeItem } from "../game/inventory";
import { meleeOutcome, shotOutcome, type MeleeHit, type ShotPlan } from "../game/combat";
import { iconKey, PROJ_ARROW, PROJ_BULLET, PROJ_PELLET, PROJ_ROCKET } from "../engine/icons";
import { applyOutcome } from "../game/outcomes";
import { buildingEnteredFlag, nextAmbientDelayMs } from "../game/encounters";
import { runTurn, getActiveBrain, consumeFellBack } from "../ai/gameMaster";
import { WorldRenderer } from "../engine/WorldRenderer";
import { Player } from "../engine/Player";
import { Enemy } from "../engine/Enemy";
import { setupCamera } from "../engine/Camera";
import { HUD } from "../ui/HUD";
import { EncounterModal } from "../ui/EncounterModal";
import { TouchControls } from "../ui/TouchControls";
import { sfx } from "../engine/audio";
import { bloodBurst, dustPuff, deathFade, spawnPopIn, meleeArc, makeGlow, FX_DUST, FX_VIGNETTE } from "../engine/fx";
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "../game/constants";

const SOLID = new Set<number>(SOLID_TILES as number[]);

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

export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private world!: WorldData;
  private worldRenderer!: WorldRenderer;
  private hud!: HUD;
  private modal!: EncounterModal;
  private touch!: TouchControls;
  private state!: GameState;
  private decayAcc = 0;
  private saveAcc = 0;
  private dead = false;
  private inEncounter = false;
  private encounterLoc = "street";
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private ambientAcc = 0;
  private ambientDelay = 30000;
  private currentBuildingId: number | null = null;
  private aiNoticeShown = false; // show the "AI offline" toast at most once per run
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private segAcc = 0;
  private kills = 0;
  private lastMelee = 0;
  private lastShot = 0;
  private firing = false;
  private reloading = false;
  private projectileGroup!: Phaser.Physics.Arcade.Group;
  private lastStep = 0;
  private glow!: Phaser.GameObjects.Image;
  private vignette!: Phaser.GameObjects.Image;
  private objBanner!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private weaponSprite!: Phaser.GameObjects.Image;
  private readonly saveOnUnload = () => this.persist();

  constructor() {
    super("WorldScene");
  }

  create(): void {
    this.dead = false;
    this.inEncounter = false;
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

    this.world = generateWorld(this.state.seed, {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      tileSize: TILE_SIZE,
    });

    const worldW = this.world.width * this.world.tileSize;
    const worldH = this.world.height * this.world.tileSize;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.worldRenderer = new WorldRenderer(this, this.world);

    // New runs spawn at the world's central road; resumed runs keep their spot.
    const startX = saved ? this.state.player.x : this.world.start.x;
    const startY = saved ? this.state.player.y : this.world.start.y;
    this.player = new Player(this, startX, startY);
    this.physics.add.collider(this.player.sprite, this.worldRenderer.layer);
    setupCamera(this, this.player.sprite, worldW, worldH);

    // Equipped weapon shown in-hand (icon swaps on equip; aims in Phase 4).
    this.weaponSprite = this.add.image(startX, startY, iconKey("Fists")).setDepth(11).setScale(0.42).setVisible(false);

    // Enemies live in a group that collides with walls (CLAUDE.md §11).
    this.enemyGroup = this.physics.add.group();
    this.physics.add.collider(this.enemyGroup, this.worldRenderer.layer);

    // Bullets/arrows/rockets: hit enemies, stop on walls.
    this.projectileGroup = this.physics.add.group();
    this.physics.add.overlap(this.projectileGroup, this.enemyGroup, (a, b) => this.onProjectileHit(a, b));
    this.physics.add.collider(this.projectileGroup, this.worldRenderer.layer, (obj) =>
      this.killProjectile(obj as unknown as Phaser.Physics.Arcade.Image),
    );

    // Day/night tint overlay (screen-space, above the world, below HUD).
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x00040c, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(500);

    // Atmosphere (procedural): drifting motes, a flashlight glow that brightens at
    // night, and a vignette. All camera-fixed except the glow, which follows the player.
    this.add
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
    this.glow = makeGlow(this, this.player.sprite.x, this.player.sprite.y);
    this.vignette = this.add.image(0, 0, FX_VIGNETTE).setOrigin(0, 0).setScrollFactor(0).setDepth(540);
    this.vignette.setDisplaySize(this.scale.width, this.scale.height);

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
    this.updateObjective();

    this.scale.on("resize", this.onResize, this);
    this.applyPhaseVisual();

    if (!saved) {
      this.state.player.x = startX;
      this.state.player.y = startY;
      saveGame(this.state);
    }

    this.hud = new HUD(this);
    this.modal = new EncounterModal();
    this.modal.setHandlers(
      (input) => this.onEncounterAction(input),
      () => this.onEncounterLeave(),
    );
    this.touch = new TouchControls();
    this.touch.setHandlers(
      () => this.tryInteract(),
      () => this.meleeAttack(),
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
      this.touch.destroy();
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
    // The world pauses during an encounter (CLAUDE.md §2).
    if (!this.dead && !this.inEncounter) {
      const canSprint = this.state.player.stamina > 5;
      const tv = this.touch.vector();
      this.player.update(canSprint, { x: tv.x, y: tv.y, sprint: this.touch.sprintHeld });
      if (this.player.sprinting) {
        this.state.player.stamina = clampStat(this.state.player.stamina - delta * 0.012);
      }
      this.updateEnemies(time);
      this.checkBuildingTrigger();

      if (this.player.isMoving() && time - this.lastStep > 300) {
        this.lastStep = time;
        dustPuff(this, this.player.sprite.x, this.player.sprite.y + 8, 2);
      }

      if (this.firing) this.fire(this.aimAngle()); // auto-fire while mouse held

      this.decayAcc += delta;
      if (this.decayAcc >= DECAY_MS) {
        this.decayAcc -= DECAY_MS;
        applyDecay(this.state);
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

    // Contextual "Press E" hint when standing on a building (and free to act).
    const near = !this.dead && !this.inEncounter ? this.buildingAt() : null;
    this.hintText.setVisible(!!near);
    if (near) this.hintText.setText(`Press E to enter the ${near.type.replace(/_/g, " ")}`);

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
    this.nightOverlay?.setSize(size.width, size.height);
    this.vignette?.setDisplaySize(size.width, size.height);
    this.objBanner?.setPosition(size.width / 2, 8);
    this.hintText?.setPosition(size.width / 2, size.height - 96);
  }

  private takeHit(e: Enemy): void {
    const p = this.state.player;
    const dmg = Math.max(1, Math.round(e.damage * this.state.difficultyModifier));
    p.hp = clampStat(p.hp - dmg);
    let msg = "Claws and teeth find you.";
    if (e.bite && Math.random() < 0.28) {
      p.infection = clampStat(p.infection + Phaser.Math.Between(8, 16));
      msg = "Bitten — the wound burns hot.";
    }
    pushRecentEvent(this.state, msg);
    sfx.hurt();
    bloodBurst(this, this.player.sprite.x, this.player.sprite.y, 6, 0xcc2222);
    this.player.recoil();
    this.cameras.main.shake(120, 0.006);
    this.cameras.main.flash(110, 120, 0, 0);
    if (isDead(this.state)) this.enterDeath();
  }

  private freezeEnemies(): void {
    for (const e of this.enemies) e.sprite.setVelocity(0, 0);
  }

  private spawnEnemy(kind: Spawn["type"], x: number, y: number): void {
    if (this.enemies.length >= 40) return; // safety cap
    const e = new Enemy(this, x, y, kind);
    this.enemyGroup.add(e.sprite);
    this.enemies.push(e);
    spawnPopIn(this, e.sprite);
  }

  private spawnNear(spawns: Spawn[]): void {
    const ptx = this.player.tilePos().tx;
    const pty = this.player.tilePos().ty;
    for (const s of spawns) {
      for (let i = 0; i < s.count; i++) {
        const tile = this.findWalkableNear(ptx, pty, 3, 8);
        if (tile) this.spawnEnemy(s.type, tile.x, tile.y);
      }
    }
  }

  private spawnAmbientWalkers(n: number): void {
    const ptx = this.player.tilePos().tx;
    const pty = this.player.tilePos().ty;
    for (let i = 0; i < n; i++) {
      const tile = this.findWalkableFar(ptx, pty, 12);
      if (tile) this.spawnEnemy("zombie", tile.x, tile.y);
    }
  }

  /** Starting walker count — near-empty at day 0, busier as the outbreak spreads. */
  private ambientStartCount(): number {
    return Math.min(1 + this.state.day * 2, 16);
  }

  /** Time to the next ambient threat — rare at day 0, more frequent later/at night. */
  private scheduleAmbientMs(): number {
    const base = nextAmbientDelayMs();
    const dayFactor = this.state.day === 0 ? 2.6 : 1 / (1 + this.state.day * 0.12);
    return base * dayFactor * (this.isNight() ? 0.6 : 1);
  }

  private ambientEvent(): void {
    const extra = this.state.difficultyModifier > 1.15 ? 1 : 0;
    const dayBonus = Math.floor(this.state.day / 3);
    const n = Math.min(Phaser.Math.Between(1, 2) + extra + dayBonus, 5);
    const runnerChance = this.isNight() ? 0.32 : 0.12 + this.state.day * 0.02;
    const kind: Spawn["type"] = Math.random() < runnerChance ? "zombie_runner" : "zombie";
    this.spawnNear([{ type: kind, count: n }]);
    this.showToast("You hear shuffling nearby…");
  }

  private walkable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) return false;
    return !SOLID.has(this.world.grid[ty][tx]);
  }

  private findWalkableNear(
    tx: number,
    ty: number,
    minR: number,
    maxR: number,
  ): { x: number; y: number } | null {
    for (let tries = 0; tries < 40; tries++) {
      const r = Phaser.Math.Between(minR, maxR);
      const a = Math.random() * Math.PI * 2;
      const nx = Math.round(tx + Math.cos(a) * r);
      const ny = Math.round(ty + Math.sin(a) * r);
      if (this.walkable(nx, ny)) {
        return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
      }
    }
    return null;
  }

  private findWalkableFar(tx: number, ty: number, minR: number): { x: number; y: number } | null {
    for (let tries = 0; tries < 60; tries++) {
      const nx = Phaser.Math.Between(0, this.world.width - 1);
      const ny = Phaser.Math.Between(0, this.world.height - 1);
      if (Math.hypot(nx - tx, ny - ty) >= minR && this.walkable(nx, ny)) {
        return { x: (nx + 0.5) * TILE_SIZE, y: (ny + 0.5) * TILE_SIZE };
      }
    }
    return null;
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
    for (const b of this.world.buildings) {
      if (tx >= b.tx && tx <= b.tx + b.tw - 1 && ty >= b.ty && ty <= b.ty + b.th - 1) return b;
    }
    return null;
  }

  /** Entering a building fires a one-time GM encounter (then it stays "cleared"). */
  private checkBuildingTrigger(): void {
    const b = this.buildingAt();
    const id = b ? b.id : null;
    if (id === this.currentBuildingId) return;
    this.currentBuildingId = id;
    if (b && !this.state.worldFlags.includes(buildingEnteredFlag(b.id))) {
      this.state.worldFlags.push(buildingEnteredFlag(b.id));
      const name = b.type.replace(/_/g, " ");
      this.startEncounter(b.type, `I step inside the ${name}, staying alert.`, name);
    }
  }

  /** Press E to act on the current surroundings. */
  private tryInteract(): void {
    const b = this.buildingAt();
    if (b) {
      const name = b.type.replace(/_/g, " ");
      this.startEncounter(b.type, `I search the ${name}.`, name);
    } else {
      this.startEncounter("street", "I scan the ruined street and the buildings around me.", "The street");
    }
  }

  private startEncounter(loc: string, openingValue: string, title: string): void {
    if (this.dead || this.inEncounter) return;
    this.inEncounter = true;
    this.setGameKeys(false); // so typing/keys can't move the player or fire actions
    this.player.sprite.setVelocity(0, 0);
    this.freezeEnemies();
    this.encounterLoc = loc;
    sfx.ui();
    this.modal.openLoading(title, this.thinkingMsg());
    void this.resolveTurn({ mode: "free_text", value: openingValue });
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
    this.spawnNear(result.spawns); // GM-decided spawns appear on the map (§8.5)
    if (gm.inventory_add.length > 0) sfx.pickup();
    this.hud.update(this.state, this.debugInfo());
    this.persist();
    if (result.gameOver) {
      this.modal.close();
      this.enterDeath(result.reason || undefined);
      return;
    }
    this.modal.showResult(result.narrative, result.interaction, this.effectsSummary(gm));
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

  private onEncounterLeave(): void {
    this.inEncounter = false;
    this.setGameKeys(true);
    this.persist();
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    // R = reload the equipped gun. ESC = back to the menu (new run).
    kb.on("keydown-R", () => this.tryReload());
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
    pushRecentEvent(this.state, `Put down a ${e.kind.replace(/_/g, " ")}.`);
    this.dropLoot(e); // Phase 5
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

  /** Spawn loot where an enemy died (implemented in Phase 5). */
  private dropLoot(_e: Enemy): void {
    // no-op until the drop system lands
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
    if (this.dead || this.inEncounter || this.reloading) return;
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
    const body = e.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.enable = false;
    deathFade(this, e.sprite); // fades + spins out, then destroys the sprite
  }

  /** Open the run with its AI-authored scenario intro; first action goes to the GM. */
  private showIntro(intro: string): void {
    this.inEncounter = true;
    this.setGameKeys(false);
    this.player.sprite.setVelocity(0, 0);
    this.freezeEnemies();
    const b = this.buildingAt();
    this.encounterLoc = b ? b.type : "street";
    this.modal.showResult(intro, { type: "free_text", prompt: "What do you do?", options: [] });
  }

  private persist(): void {
    if (this.dead) return; // never persist a finished run
    this.state.player.x = this.player.sprite.x;
    this.state.player.y = this.player.sprite.y;
    saveGame(this.state);
  }
}
