import Phaser from "phaser";
import type { GameState, GMResponse, Spawn, TurnInput } from "../shared/contracts";
import { generateWorld, SOLID_TILES, type Building, type WorldData } from "../game/worldgen";
import { randomSeed } from "../game/rng";
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
import { isArmed, removeItem } from "../game/inventory";
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
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "../game/constants";

const SOLID = new Set<number>(SOLID_TILES as number[]);

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

    // Enemies live in a group that collides with walls (CLAUDE.md §11).
    this.enemyGroup = this.physics.add.group();
    this.physics.add.collider(this.enemyGroup, this.worldRenderer.layer);

    // Day/night tint overlay (screen-space, above the world, below HUD).
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x00040c, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(500);
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

    this.hud.update(this.state, this.debugInfo());
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
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.nightOverlay?.setSize(size.width, size.height);
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
    this.modal.openLoading(title);
    void this.resolveTurn({ mode: "free_text", value: openingValue });
  }

  /** Enable/disable the Phaser keyboard so encounter typing never leaks to gameplay. */
  private setGameKeys(enabled: boolean): void {
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
  }

  private onEncounterAction(input: TurnInput): void {
    this.modal.openLoading();
    void this.resolveTurn(input);
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

    // R = back to the menu to begin a fresh, named run.
    kb.on("keydown-R", () => this.scene.start("MainMenuScene"));

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
    if (now - this.lastMelee < 380 || this.state.player.stamina < 4) return;
    this.lastMelee = now;
    this.state.player.stamina = clampStat(this.state.player.stamina - 6);
    sfx.swing();

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let nearest: Enemy | null = null;
    let best = 50;
    for (const e of this.enemies) {
      const d = Math.hypot(e.sprite.x - px, e.sprite.y - py);
      if (d < best) {
        best = d;
        nearest = e;
      }
    }
    this.cameras.main.shake(50, 0.003);
    if (!nearest) return;

    const armed = isArmed(this.state);
    if (nearest.takeDamage(armed ? 2 : 1)) {
      const kind = nearest.kind.replace(/_/g, " ");
      this.removeEnemy(nearest);
      this.kills += 1;
      sfx.kill();
      pushRecentEvent(this.state, `Put down a ${kind}.`);
    } else if (!armed && Math.random() < 0.4) {
      this.takeHit(nearest); // bare hands are risky
    }
  }

  private removeEnemy(e: Enemy): void {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    e.destroy();
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
