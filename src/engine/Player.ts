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
  private facing = 0; // radians; Kenney top-down sprites default-face east (+x)
  private walkT = 0; // walk-bob phase accumulator
  private _sprinting = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, PLAYER_KEY);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);

    // Compact square body centred in the sprite frame (whatever its size) so the
    // player passes cleanly through 1-tile doorways. The visual rotation applied
    // in update() is cosmetic — the arcade body stays an axis-aligned box.
    const bodySize = 20;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(bodySize, bodySize);
    body.setOffset((this.sprite.width - bodySize) / 2, (this.sprite.height - bodySize) / 2);

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

  update(canSprint = false): void {
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

    const len = Math.hypot(vx, vy);
    const sprint = len > 0 && canSprint && this.cursors.shift.isDown;
    this._sprinting = sprint;
    const speed = sprint ? PLAYER_SPEED * 1.6 : PLAYER_SPEED;

    // Normalise so diagonals aren't faster.
    if (len > 0) {
      this.sprite.setVelocity((vx / len) * speed, (vy / len) * speed);
      this.facing = Math.atan2(vy, vx); // turn to face the direction of travel
      this.walkT += sprint ? 2 : 1;
      this.sprite.setScale(1 + 0.03 * Math.sin(this.walkT * 0.35)); // subtle walk bob
    } else {
      this.sprite.setVelocity(0, 0);
      this.sprite.setScale(1);
    }
    this.sprite.setRotation(this.facing);
  }

  /** True while sprinting this frame (drains stamina, widens enemy aggro). */
  get sprinting(): boolean {
    return this._sprinting;
  }

  /** Player tile coordinates, handy for the debug overlay. */
  tilePos(): { tx: number; ty: number } {
    return {
      tx: Math.floor(this.sprite.x / TILE_SIZE),
      ty: Math.floor(this.sprite.y / TILE_SIZE),
    };
  }

  /** Whether the player is moving (makes noise that widens zombie aggro). */
  isMoving(): boolean {
    const b = this.sprite.body as Phaser.Physics.Arcade.Body;
    return Math.abs(b.velocity.x) > 1 || Math.abs(b.velocity.y) > 1;
  }
}
