import Phaser from "phaser";
import { SURVIVOR_NPC_KEY, PLAYER_KEY } from "./textures";

// Survivor NPC entity (Feature 10b): a lightweight, non-infected actor. Ambient
// survivors wander; recruited COMPANIONS follow the player and lunge at nearby
// zombies. Deliberately simple AI (no pathfinding) — like the Animal entity — so it
// stays readable and bug-light. Combat resolution (dealing damage) lives in the scene.

export type NpcKind = "survivor" | "companion";

export interface NpcOpts {
  id: string;
  name: string;
  faction: string;
  kind: NpcKind;
  hp: number;
  maxHp: number;
  color?: number;
  tier?: string; // survivor quality tier (poor/average/prime) — drives a name tag
  tagPrefix?: string; // name-tag label (e.g. "Prime"); empty = no tag
}

const SPEED = 150;

export class Npc {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly id: string;
  readonly name: string;
  readonly faction: string;
  readonly tier?: string;
  kind: NpcKind;
  hp: number;
  maxHp: number;
  lastHit = 0; // companion attack cooldown
  lastHurt = 0; // companion damage-taken cooldown
  private facing = 0;
  private wanderUntil = 0;
  private baseTint?: number; // tier/kind tint, re-applied after a hurt flash
  private tag?: Phaser.GameObjects.Text; // floating quality name-tag

  constructor(scene: Phaser.Scene, x: number, y: number, opts: NpcOpts) {
    this.id = opts.id;
    this.name = opts.name;
    this.faction = opts.faction;
    this.kind = opts.kind;
    this.tier = opts.tier;
    this.hp = opts.hp;
    this.maxHp = opts.maxHp;
    const tex = scene.textures.exists(SURVIVOR_NPC_KEY) ? SURVIVOR_NPC_KEY : PLAYER_KEY;
    this.sprite = scene.physics.add.sprite(x, y, tex).setDepth(9);
    this.sprite.setCollideWorldBounds(true);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 20);
    if (opts.color !== undefined) {
      this.baseTint = opts.color;
      this.sprite.setTint(opts.color);
    }
    if (opts.tagPrefix) {
      this.tag = scene.add
        .text(x, y - 24, opts.tagPrefix, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#ffe08a",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(10);
    }
  }

  /** Companions follow the player and rush nearby zombies; survivors mill about. */
  update(px: number, py: number, zombie: { x: number; y: number } | null, now: number): void {
    if (this.tag) this.tag.setPosition(this.sprite.x, this.sprite.y - 24);
    if (this.kind === "companion") {
      if (zombie) {
        const dx = zombie.x - this.sprite.x;
        const dy = zombie.y - this.sprite.y;
        const d = Math.hypot(dx, dy) || 1;
        this.move(dx / d, dy / d, SPEED);
        return;
      }
      const dx = px - this.sprite.x;
      const dy = py - this.sprite.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 64) this.move(dx / d, dy / d, Math.min(SPEED * 1.3, d * 3));
      else this.idle();
      return;
    }
    // ambient survivor: gentle wander, stay roughly in place
    if (now > this.wanderUntil) {
      this.wanderUntil = now + 1000 + Math.random() * 1800;
      if (Math.random() < 0.5) {
        this.idle();
      } else {
        const a = Math.random() * Math.PI * 2;
        this.move(Math.cos(a), Math.sin(a), SPEED * 0.4);
      }
    }
    this.sprite.setRotation(this.facing + Math.sin(now * 0.015) * 0.08);
  }

  private move(nx: number, ny: number, speed: number): void {
    this.sprite.setVelocity(nx * speed, ny * speed);
    this.facing = Math.atan2(ny, nx);
    this.sprite.setRotation(this.facing);
  }

  private idle(): void {
    this.sprite.setVelocity(0, 0);
    this.sprite.setRotation(this.facing);
  }

  takeDamage(n: number): boolean {
    this.hp -= n;
    this.sprite.setTintFill(0xffffff);
    this.sprite.scene.time.delayedCall(70, () => {
      if (!this.sprite.active) return;
      if (this.baseTint !== undefined) this.sprite.setTint(this.baseTint); // keep the tier/kind tint
      else this.sprite.clearTint();
    });
    return this.hp <= 0;
  }

  /** Re-tint (e.g. survivor → companion on recruit) and keep it through hurt flashes. */
  setTint(color: number): void {
    this.baseTint = color;
    this.sprite.setTint(color);
  }

  destroy(): void {
    this.tag?.destroy();
    this.sprite.destroy();
  }
}
