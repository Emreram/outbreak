import Phaser from "phaser";
import type { GameState, Spawn, TurnInput } from "../shared/contracts";
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
import { removeItem } from "../game/inventory";
import { applyOutcome } from "../game/outcomes";
import { buildingEnteredFlag, nextAmbientDelayMs } from "../game/encounters";
import { runTurn } from "../ai/gameMaster";
import { WorldRenderer } from "../engine/WorldRenderer";
import { Player } from "../engine/Player";
import { Enemy } from "../engine/Enemy";
import { setupCamera } from "../engine/Camera";
import { HUD } from "../ui/HUD";
import { EncounterModal } from "../ui/EncounterModal";
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "../game/constants";

const SOLID = new Set<number>(SOLID_TILES as number[]);

// The open world (CLAUDE.md §13 Phases 1–3): a walkable seeded city plus the
// authoritative GameState, survival decay, HUD, and localStorage persistence.
// The scene orchestrates; mechanics live in the game-logic modules.

type StatKey = "hp" | "stamina" | "hunger" | "thirst" | "infection";
const DECAY_MS = 2000;
const SAVE_MS = 4000;

export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private world!: WorldData;
  private worldRenderer!: WorldRenderer;
  private hud!: HUD;
  private modal!: EncounterModal;
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
    this.ambientDelay = nextAmbientDelayMs();
    this.currentBuildingId = null;

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
    this.bindKeys();

    window.addEventListener("beforeunload", this.saveOnUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("beforeunload", this.saveOnUnload);
      this.modal.destroy();
      this.persist();
    });

    // Seed the streets with a few wandering walkers so the world feels alive.
    if (!isDead(this.state)) this.spawnAmbientWalkers(Phaser.Math.Between(4, 7));

    if (isDead(this.state)) this.enterDeath();
  }

  override update(time: number, delta: number): void {
    // The world pauses during an encounter (CLAUDE.md §2).
    if (!this.dead && !this.inEncounter) {
      this.player.update();
      this.updateEnemies(time);
      this.checkBuildingTrigger();

      this.decayAcc += delta;
      if (this.decayAcc >= DECAY_MS) {
        this.decayAcc -= DECAY_MS;
        applyDecay(this.state);
        if (isDead(this.state)) this.enterDeath();
      }

      this.ambientAcc += delta;
      if (this.ambientAcc >= this.ambientDelay) {
        this.ambientAcc = 0;
        this.ambientDelay = nextAmbientDelayMs();
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
    const noise = this.player.isMoving() ? 45 : 0;
    for (const e of this.enemies) {
      e.update(px, py, noise, now);
      if (e.tryAttack(px, py, now)) this.takeHit(e);
    }
  }

  private takeHit(e: Enemy): void {
    const p = this.state.player;
    p.hp = clampStat(p.hp - e.damage);
    let msg = "Claws and teeth find you.";
    if (e.bite && Math.random() < 0.28) {
      p.infection = clampStat(p.infection + Phaser.Math.Between(8, 16));
      msg = "Bitten — the wound burns hot.";
    }
    pushRecentEvent(this.state, msg);
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

  private ambientEvent(): void {
    const n = Phaser.Math.Between(1, 2);
    const kind: Spawn["type"] = Math.random() < 0.15 ? "zombie_runner" : "zombie";
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

  private debugInfo(): { fps: number; tx: number; ty: number } {
    const { tx, ty } = this.player.tilePos();
    return { fps: Math.round(this.game.loop.actualFps), tx, ty };
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
    this.player.sprite.setVelocity(0, 0);
    this.freezeEnemies();
    this.encounterLoc = loc;
    this.modal.openLoading(title);
    void this.resolveTurn({ mode: "free_text", value: openingValue });
  }

  private onEncounterAction(input: TurnInput): void {
    this.modal.openLoading();
    void this.resolveTurn(input);
  }

  private async resolveTurn(input: TurnInput): Promise<void> {
    const gm = await runTurn(this.state, input, this.encounterLoc);
    const result = applyOutcome(this.state, gm);
    this.spawnNear(result.spawns); // GM-decided spawns appear on the map (§8.5)
    this.hud.update(this.state, this.debugInfo());
    this.persist();
    if (result.gameOver) {
      this.modal.close();
      this.enterDeath(result.reason || undefined);
      return;
    }
    this.modal.showResult(result.narrative, result.interaction);
  }

  private onEncounterLeave(): void {
    this.inEncounter = false;
    this.persist();
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    // R = brand-new run (new seed + fresh state).
    kb.on("keydown-R", () => {
      clearSave();
      this.registry.set("seed", randomSeed());
      this.scene.restart();
    });

    // E = act on your surroundings (open an AI Game Master encounter).
    kb.on("keydown-E", () => this.tryInteract());

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
    const msg =
      reason ??
      (this.state.player.infection >= 100 ? "The infection takes you." : "Your body gives out.");
    this.hud.showDeath(msg);
    this.persist();
  }

  private persist(): void {
    if (this.player) {
      this.state.player.x = this.player.sprite.x;
      this.state.player.y = this.player.sprite.y;
    }
    saveGame(this.state);
  }
}
