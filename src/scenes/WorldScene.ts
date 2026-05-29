import Phaser from "phaser";
import type { GameState, TurnInput } from "../shared/contracts";
import { generateWorld, type WorldData } from "../game/worldgen";
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
import { runTurn } from "../ai/gameMaster";
import { WorldRenderer } from "../engine/WorldRenderer";
import { Player } from "../engine/Player";
import { setupCamera } from "../engine/Camera";
import { HUD } from "../ui/HUD";
import { EncounterModal } from "../ui/EncounterModal";
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "../game/constants";

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
  private readonly saveOnUnload = () => this.persist();

  constructor() {
    super("WorldScene");
  }

  create(): void {
    this.dead = false;
    this.inEncounter = false;
    this.decayAcc = 0;
    this.saveAcc = 0;

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

    if (isDead(this.state)) this.enterDeath();
  }

  override update(_time: number, delta: number): void {
    // The world pauses during an encounter (CLAUDE.md §2).
    if (!this.dead && !this.inEncounter) {
      this.player.update();

      this.decayAcc += delta;
      if (this.decayAcc >= DECAY_MS) {
        this.decayAcc -= DECAY_MS;
        applyDecay(this.state);
        if (isDead(this.state)) this.enterDeath();
      }

      this.saveAcc += delta;
      if (this.saveAcc >= SAVE_MS) {
        this.saveAcc -= SAVE_MS;
        this.persist();
      }
    }

    this.hud.update(this.state, this.debugInfo());
  }

  private debugInfo(): { fps: number; tx: number; ty: number } {
    const { tx, ty } = this.player.tilePos();
    return { fps: Math.round(this.game.loop.actualFps), tx, ty };
  }

  // --- encounters (CLAUDE.md §2, §8) -----------------------------------------

  /** What location the player is standing in (building type, or "street"). */
  private locationTypeAt(): string {
    const { tx, ty } = this.player.tilePos();
    for (const b of this.world.buildings) {
      if (tx >= b.tx && tx <= b.tx + b.tw - 1 && ty >= b.ty && ty <= b.ty + b.th - 1) {
        return b.type;
      }
    }
    return "street";
  }

  /** Press E to act on the current surroundings — opens an encounter. */
  private tryInteract(): void {
    if (this.dead || this.inEncounter) return;
    this.inEncounter = true;
    this.player.sprite.setVelocity(0, 0);
    this.encounterLoc = this.locationTypeAt();
    const inside = this.encounterLoc !== "street";
    const title = inside ? this.encounterLoc.replace(/_/g, " ") : "The street";
    const opening: TurnInput = {
      mode: "free_text",
      value: inside
        ? `I search the ${this.encounterLoc.replace(/_/g, " ")}.`
        : "I scan the ruined street and the buildings around me.",
    };
    this.modal.openLoading(title);
    void this.resolveTurn(opening);
  }

  private onEncounterAction(input: TurnInput): void {
    this.modal.openLoading();
    void this.resolveTurn(input);
  }

  private async resolveTurn(input: TurnInput): Promise<void> {
    const gm = await runTurn(this.state, input, this.encounterLoc);
    const result = applyOutcome(this.state, gm);
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
