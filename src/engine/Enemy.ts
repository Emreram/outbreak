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

// hp is now a real damage pool so weapon damage differentiates (CLAUDE.md loot system).
const PARAMS: Record<SpawnType, Params> = {
  zombie: { texture: ZOMBIE_KEY, speed: 55, aggro: 150, damage: 6, bite: true, hp: 14, scale: 0.8 },
  zombie_runner: { texture: ZOMBIE_KEY, speed: 132, aggro: 240, damage: 9, bite: true, hp: 20, tint: 0xff6b6b, scale: 0.78 },
  survivor_hostile: { texture: SURVIVOR_NPC_KEY, speed: 88, aggro: 210, damage: 8, bite: false, hp: 26, tint: 0xffae6b, scale: 0.82 },
  survivor_friendly: { texture: SURVIVOR_NPC_KEY, speed: 38, aggro: 0, damage: 0, bite: false, hp: 8, tint: 0x9affa6, scale: 0.82 },
};

export class Enemy {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly kind: SpawnType;
  readonly damage: number;
  readonly bite: boolean;
  hp: number;
  readonly maxHp: number;
  state: EnemyState = "wander";
  private lastAttack = 0;
  private wanderUntil = 0;
  private facing = 0;
  private phase = Math.random() * 6.28; // desync the shamble between enemies
  private knockedUntil = 0;
  private bleedDps = 0;
  private dotUntil = 0;
  private lastDotTick = 0;
  private stunnedUntil = 0;
  private readonly p: Params;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: SpawnType) {
    this.kind = kind;
    this.p = PARAMS[kind] ?? PARAMS.zombie;
    this.damage = this.p.damage;
    this.bite = this.p.bite;
    this.hp = this.p.hp;
    this.maxHp = this.p.hp;

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
    // damage over time (bleed / burn / poison)
    if (this.bleedDps > 0) {
      if (now >= this.dotUntil) {
        this.bleedDps = 0;
      } else if (now - this.lastDotTick >= 500) {
        this.lastDotTick = now;
        this.hp -= this.bleedDps * 0.5;
        this.flash(0xff4d4d);
      }
    }

    if (now < this.knockedUntil) return; // ride out a knockback; keep current velocity
    if (now < this.stunnedUntil) {
      this.sprite.setVelocity(0, 0);
      return; // stunned: frozen but DoT still ticks
    }

    const dx = px - this.sprite.x;
    const dy = py - this.sprite.y;
    const dist = Math.hypot(dx, dy);
    const aggro = this.p.aggro + noise;

    if (this.p.aggro > 0 && dist < aggro) {
      this.state = "chase";
      const inv = 1 / (dist || 1);
      this.sprite.setVelocity(dx * inv * this.p.speed, dy * inv * this.p.speed);
      this.facing = Math.atan2(dy, dx);
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
          this.facing = a;
        }
      }
    }

    // Shamble: walkers sway slowly, runners jitter — around the facing, every frame.
    const fast = this.kind === "zombie_runner";
    const sway = Math.sin(now * (fast ? 0.022 : 0.008) + this.phase) * (fast ? 0.22 : 0.12);
    this.sprite.setRotation(this.facing + sway);
  }

  /** Shove the enemy in a direction for a short while (melee knockback). */
  knockback(dirX: number, dirY: number, force: number, now: number): void {
    this.sprite.setVelocity(dirX * force, dirY * force);
    this.knockedUntil = now + 160;
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

  /** Apply damage; returns true if this put the enemy down. */
  takeDamage(n: number): boolean {
    this.hp -= n;
    if (this.hp <= 0) return true;
    this.flash(0xffffff);
    return false;
  }

  /** Apply a damage-over-time effect (bleed/burn/poison): dps for ms milliseconds. */
  applyDot(dps: number, ms: number): void {
    if (dps <= 0 || ms <= 0) return;
    const now = this.sprite.scene.time.now;
    this.bleedDps = Math.max(this.bleedDps, dps);
    this.dotUntil = Math.max(this.dotUntil, now + ms);
  }

  /** Freeze the enemy for ms milliseconds. */
  applyStun(ms: number): void {
    if (ms <= 0) return;
    this.stunnedUntil = Math.max(this.stunnedUntil, this.sprite.scene.time.now + ms);
  }

  hpFrac(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  private flash(color: number, ms = 80): void {
    this.sprite.setTint(color);
    this.sprite.scene.time.delayedCall(ms, () => {
      if (this.p.tint !== undefined) this.sprite.setTint(this.p.tint);
      else this.sprite.clearTint();
    });
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
