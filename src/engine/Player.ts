import Phaser from "phaser";
import { PLAYER_KEY } from "./textures";
import { PLAYER_SPEED, TILE_SIZE } from "../game/constants";

// The player: a physics-bodied placeholder sprite with 8-direction WASD/arrow
// movement and wall collision (CLAUDE.md §13 Phase 1). The engine layer knows
// nothing about story — just movement, animation, and collision.

type WasdKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: WasdKeys;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, PLAYER_KEY);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);

    // Square body slightly smaller than a tile -> clean collision through doors.
    const bodySize = Math.floor(TILE_SIZE * 0.7);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(bodySize, bodySize);
    body.setOffset((TILE_SIZE - bodySize) / 2, (TILE_SIZE - bodySize) / 2);

    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input plugin unavailable — cannot create Player.");
    }
    this.cursors = keyboard.createCursorKeys();
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.wasd = keyboard.addKeys({
      up: KC.W,
      down: KC.S,
      left: KC.A,
      right: KC.D,
    }) as WasdKeys;
  }

  update(): void {
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    let vx = 0;
    let vy = 0;
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;

    // Normalise so diagonals aren't faster.
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      this.sprite.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);
    } else {
      this.sprite.setVelocity(0, 0);
    }
  }

  /** Player tile coordinates, handy for the debug overlay. */
  tilePos(): { tx: number; ty: number } {
    return {
      tx: Math.floor(this.sprite.x / TILE_SIZE),
      ty: Math.floor(this.sprite.y / TILE_SIZE),
    };
  }
}
