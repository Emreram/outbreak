import Phaser from "phaser";
import type { SpawnType } from "../shared/contracts";
import { PLAYER_KEY, SURVIVOR_NPC_KEY, ZOMBIE_KEY } from "./textures";

// Enemy/NPC state machine (CLAUDE.md §11): wander -> alerted -> chase -> attack.
// Walkers are slow/common, runners fast/rare. Hostile survivors behave like fast
// humans. Friendly survivors mill about and never attack. Engine-only: it moves
// and faces; the SCENE applies any damage to GameState (three-layer rule §5).

export type EnemyState = "wander" | "chase";

interface Params {
  texture: string;
  speed: number;
  aggro: number; // px detection radius
  damage: number; // hp per hit (0 = harmless)
  bite: boolean; // can transmit infection
  hp: number; // melee hits to put down
  tint?: number;
  scale: number;
}

const PARAMS: Record<SpawnType, Params> = {
  zombie: { texture: ZOMBIE_KEY, speed: 55, aggro: 150, damage: 6, bite: true, hp: 2, scale: 0.8 },
  zombie_runner: { texture: ZOMBIE_KEY, speed: 132, aggro: 240, damage: 9, bite: true, hp: 3, tint: 0xff6b6b, scale: 0.78 },
  survivor_hostile: { texture: SURVIVOR_NPC_KEY, speed: 88, aggro: 210, damage: 8, bite: false, hp: 3, tint: 0xffae6b, scale: 0.82 },
  survivor_friendly: { texture: SURVIVOR_NPC_KEY, speed: 38, aggro: 0, damage: 0, bite: false, hp: 1, tint: 0x9affa6, scale: 0.82 },
};

export class Enemy {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly kind: SpawnType;
  readonly damage: number;
  readonly bite: boolean;
  hp: number;
  state: EnemyState = "wander";
  private lastAttack = 0;
  private wanderUntil = 0;
  private readonly p: Params;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: SpawnType) {
    this.kind = kind;
    this.p = PARAMS[kind] ?? PARAMS.zombie;
    this.damage = this.p.damage;
    this.bite = this.p.bite;
    this.hp = this.p.hp;

    const tex = scene.textures.exists(this.p.texture) ? this.p.texture : PLAYER_KEY;
    this.sprite = scene.physics.add.sprite(x, y, tex);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setScale(this.p.scale);
    this.sprite.setDepth(8);
    this.sprite.setCollideWorldBounds(true);
    if (this.p.tint !== undefined) this.sprite.setTint(this.p.tint);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const size = 18;
    body.setSize(size, size);
    body.setOffset((this.sprite.width - size) / 2, (this.sprite.height - size) / 2);
  }

  /** AI tick. noise widens aggro (sprinting/gunfire). Returns nothing — the scene
   *  reads state/position and applies damage on contact. */
  update(px: number, py: number, noise: number, now: number): void {
    const dx = px - this.sprite.x;
    const dy = py - this.sprite.y;
    const dist = Math.hypot(dx, dy);
    const aggro = this.p.aggro + noise;

    if (this.p.aggro > 0 && dist < aggro) {
      this.state = "chase";
      const inv = 1 / (dist || 1);
      this.sprite.setVelocity(dx * inv * this.p.speed, dy * inv * this.p.speed);
      this.sprite.setRotation(Math.atan2(dy, dx));
    } else {
      this.state = "wander";
      if (now > this.wanderUntil) {
        this.wanderUntil = now + 700 + Math.random() * 1600;
        if (Math.random() < 0.4) {
          this.sprite.setVelocity(0, 0);
        } else {
          const a = Math.random() * Math.PI * 2;
          const s = this.p.speed * 0.35;
          this.sprite.setVelocity(Math.cos(a) * s, Math.sin(a) * s);
          this.sprite.setRotation(a);
        }
      }
    }
  }

  /** True if this enemy can land a hit now (within range + off cooldown). */
  tryAttack(px: number, py: number, now: number): boolean {
    if (this.damage <= 0) return false;
    const dist = Math.hypot(px - this.sprite.x, py - this.sprite.y);
    if (dist <= 24 && now - this.lastAttack >= 850) {
      this.lastAttack = now;
      return true;
    }
    return false;
  }

  /** Apply melee damage; returns true if this put the enemy down. */
  takeDamage(n: number): boolean {
    this.hp -= n;
    if (this.hp <= 0) return true;
    this.sprite.setTint(0xffffff);
    this.sprite.scene.time.delayedCall(80, () => {
      if (this.p.tint !== undefined) this.sprite.setTint(this.p.tint);
      else this.sprite.clearTint();
    });
    return false;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
