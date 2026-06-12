import Phaser from "phaser";
import { ZOMBIE_KEY } from "./textures";
import { propKey } from "./propSprites";
import { applyFrame, frameFor, resolveFrames, type FrameSet } from "./anim";

// Wild animals (Feature 6): lightweight, NON-infected prey that wander and flee the
// player — hunt them with melee for meat/hide/bone. Deliberately separate from the
// Enemy/zombie system (and its strict catalog tests): simpler AI, own group, no
// player damage in v1 (predators/livestock come later). Ambient, not persisted.

// Defs now live in game/animals.ts (pure data) so the renderer-agnostic sim
// shares them; re-exported here for back-compat.
export { ANIMALS, type AnimalDef, type AnimalKind } from "../game/animals";
import { type AnimalDef } from "../game/animals";

export class Animal {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly def: AnimalDef;
  hp: number;
  private facing = Math.random() * Math.PI * 2;
  private wanderUntil = 0;
  private alarmed = false; // hit/seen → flees from a wider radius
  private readonly frames: FrameSet; // stride pair (Animation Pass)
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, x: number, y: number, def: AnimalDef) {
    this.def = def;
    this.hp = def.hp;
    const key = propKey(`animal_${def.kind}`);
    const tex = scene.textures.exists(key) ? key : ZOMBIE_KEY;
    this.frames = resolveFrames((k) => scene.textures.exists(k), tex, { b: key + "_b" });
    this.sprite = scene.physics.add.sprite(x, y, tex).setScale(def.scale).setDepth(8);
    this.sprite.setCollideWorldBounds(true);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const s = Math.round(14 * def.scale + 4);
    body.setSize(s, s);
  }

  update(px: number, py: number, now: number): void {
    const dx = px - this.sprite.x;
    const dy = py - this.sprite.y;
    const dist = Math.hypot(dx, dy) || 1;
    const fleeRadius = this.alarmed ? 340 : 190;
    const fleeing = dist < fleeRadius;
    if (fleeing) {
      this.facing = Math.atan2(-dy, -dx); // run directly away
      this.sprite.setVelocity((-dx / dist) * this.def.speed, (-dy / dist) * this.def.speed);
    } else if (now > this.wanderUntil) {
      this.wanderUntil = now + 800 + Math.random() * 1600;
      if (Math.random() < 0.4) {
        this.sprite.setVelocity(0, 0);
      } else {
        const a = Math.random() * Math.PI * 2;
        this.sprite.setVelocity(Math.cos(a) * this.def.speed * 0.4, Math.sin(a) * this.def.speed * 0.4);
        this.facing = a;
      }
    }
    // Bounding stride (Animation Pass): frames swap with the body sway, which
    // stretches wider in full flight.
    this.sprite.setRotation(this.facing + Math.sin(now * 0.02) * (fleeing ? 0.14 : 0.12));
    applyFrame(this.sprite, frameFor(this.frames, (this.sprite.body as Phaser.Physics.Arcade.Body).speed > 4, now * 0.014 + this.phase));
  }

  /** Apply melee/ranged damage. Returns true if it dies. */
  takeDamage(n: number): boolean {
    this.hp -= n;
    this.alarmed = true;
    this.sprite.setTintFill(0xffffff);
    this.sprite.scene.time.delayedCall(70, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
    return this.hp <= 0;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
