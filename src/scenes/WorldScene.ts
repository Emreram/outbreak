import Phaser from "phaser";
import { generateWorld, type WorldData } from "../game/worldgen";
import { randomSeed } from "../game/rng";
import { WorldRenderer } from "../engine/WorldRenderer";
import { Player } from "../engine/Player";
import { setupCamera } from "../engine/Camera";
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from "../game/constants";

// The open world (CLAUDE.md §13 Phase 1): a seeded procedural city you can walk
// around, with camera-follow and wall collisions. Press R for a fresh city.

export class WorldScene extends Phaser.Scene {
  private player!: Player;
  private world!: WorldData;
  private worldRenderer!: WorldRenderer;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super("WorldScene");
  }

  create(): void {
    const seed = (this.registry.get("seed") as string) ?? randomSeed();
    this.world = generateWorld(seed, {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      tileSize: TILE_SIZE,
    });

    const worldW = this.world.width * this.world.tileSize;
    const worldH = this.world.height * this.world.tileSize;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.worldRenderer = new WorldRenderer(this, this.world);
    this.player = new Player(this, this.world.start.x, this.world.start.y);
    this.physics.add.collider(this.player.sprite, this.worldRenderer.layer);
    setupCamera(this, this.player.sprite, worldW, worldH);

    this.createHud();

    // R = regenerate a brand-new city (demonstrates the procedural variety).
    this.input.keyboard?.on("keydown-R", () => {
      this.registry.set("seed", randomSeed());
      this.scene.restart();
    });
  }

  override update(): void {
    this.player.update();
    this.updateHud();
  }

  private createHud(): void {
    this.hud = this.add
      .text(10, 8, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#d6f5ff",
        backgroundColor: "rgba(8,12,16,0.6)",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  private updateHud(): void {
    const { tx, ty } = this.player.tilePos();
    const fps = Math.round(this.game.loop.actualFps);
    this.hud.setText(
      [
        "OUTBREAK — Phase 1 (walkable city)",
        `seed: ${this.world.seed}   buildings: ${this.world.buildings.length}`,
        `tile: ${tx},${ty}   fps: ${fps}`,
        "move: WASD / arrows    new city: R",
      ].join("\n"),
    );
  }
}
