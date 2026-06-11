import Phaser from "phaser";
import { PLAYER_KEY, PLAYER_WALK_A, PLAYER_WALK_B } from "./textures";
import { fxTexFor } from "./fx";
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
  /** Movement multiplier — 1 on foot, raised while driving a vehicle (Feature 4). */
  speedMult = 1;
  /** Terrain multiplier — 1 on dry ground, <1 wading shallow water / mud / lava
   *  (set each frame by the scene from the tile underfoot; Living World). */
  terrainMult = 1;
  /** True while a vehicle/mount owns the sprite's texture — the 2-frame walk
   *  cycle (PR-E) must not stomp it. */
  artLocked = false;
  // The current frame trio (re-pointed at tinted copies by setAppearance).
  private frames = { idle: PLAYER_KEY, a: PLAYER_WALK_A, b: PLAYER_WALK_B };

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

  update(canSprint = false, ext?: { x: number; y: number; sprint?: boolean }): void {
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

    // Combine with external (touch joystick) input, if any.
    if (ext) {
      vx += ext.x;
      vy += ext.y;
    }

    const len = Math.hypot(vx, vy);
    const sprint = len > 0 && canSprint && (this.cursors.shift.isDown || ext?.sprint === true);
    this._sprinting = sprint;
    const speed = (sprint ? PLAYER_SPEED * 1.6 : PLAYER_SPEED) * this.speedMult * this.terrainMult;

    // Normalise so diagonals aren't faster.
    if (len > 0) {
      this.sprite.setVelocity((vx / len) * speed, (vy / len) * speed);
      this.facing = Math.atan2(vy, vx); // turn to face the direction of travel
      this.walkT += sprint ? 2 : 1;
      // Walk lean/sway via rotation — scale is left free for the hit/lunge tweens.
      this.sprite.setRotation(this.facing + Math.sin(this.walkT * 0.35) * 0.07);
    } else {
      this.sprite.setVelocity(0, 0);
      this.sprite.setRotation(this.facing);
    }

    // Two-frame walk cycle (PR-E): arms swing with the same phase as the body
    // sway; idle returns to the even frame. Vehicles/mounts lock the texture.
    if (!this.artLocked) {
      const want = len > 0 ? (Math.sin(this.walkT * 0.35) >= 0 ? this.frames.a : this.frames.b) : this.frames.idle;
      if (this.sprite.texture.key !== want && this.sprite.scene.textures.exists(want)) {
        this.sprite.setTexture(want);
      }
    }
  }

  /** Tint the survivor sprite (character-creation appearance). fxTexFor bakes the
   *  colour into a texture copy on the Canvas renderer, which ignores live tints —
   *  all three walk frames get their own tinted copy so the cycle stays coloured. */
  setAppearance(color?: number): void {
    const scene = this.sprite.scene;
    if (color !== undefined) {
      const i = fxTexFor(scene, PLAYER_KEY, color);
      const a = fxTexFor(scene, PLAYER_WALK_A, color);
      const b = fxTexFor(scene, PLAYER_WALK_B, color);
      this.frames = { idle: i.key, a: a.key, b: b.key };
      if (scene.textures.exists(i.key)) this.sprite.setTexture(i.key);
      this.sprite.setTint(i.tint);
    } else {
      this.frames = { idle: PLAYER_KEY, a: PLAYER_WALK_A, b: PLAYER_WALK_B };
      this.sprite.setTexture(PLAYER_KEY).clearTint();
    }
  }

  /** Quick squash-stretch punch when swinging a melee hit. */
  lunge(): void {
    this.sprite.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1.3,
      scaleY: 0.8,
      duration: 100,
      yoyo: true,
      ease: "Back.easeOut",
    });
  }

  /** Recoil pop when taking a hit. */
  recoil(): void {
    this.sprite.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1.34,
      scaleY: 1.34,
      duration: 120,
      yoyo: true,
      ease: "Back.easeOut",
    });
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
