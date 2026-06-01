import Phaser from "phaser";
import type { EnemyFamily, LootFamily, ZombieDef, ZombieTrait } from "../game/enemies/types";
import { zombieTextureKey } from "./zombieSprites";
import { ZOMBIE_KEY, PLAYER_KEY } from "./textures";
import { RARITY_META, rarityRank } from "../game/items/rarity";

// Def-driven enemy (CLAUDE.md §11 + the 102-type catalog). Movement + defensive
// traits live here; offensive traits (spitter/exploder/splitter/screamer/grabber/
// toxic) are orchestrated by the SCENE (three-layer rule §5). Keeps the combat
// surface the loot system depends on: takeDamage / applyDot / applyStun / knockback
// / hpFrac / tryAttack / update.

export type EnemyState = "wander" | "chase";

export class Enemy {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly def: ZombieDef;
  readonly family: EnemyFamily;
  readonly lootFamily: LootFamily;
  readonly traits: ReadonlySet<ZombieTrait>;
  readonly damage: number;
  readonly bite: boolean;
  hp: number;
  readonly maxHp: number;
  state: EnemyState = "wander";

  private readonly scene: Phaser.Scene;
  private lastAttack = 0;
  private wanderUntil = 0;
  private facing = 0;
  private phase = Math.random() * 6.28;
  private knockedUntil = 0;
  private bleedDps = 0;
  private dotUntil = 0;
  private lastDotTick = 0;
  private stunnedUntil = 0;
  private lastDamaged = -9999;
  private lastRegen = 0;
  private leapUntil = 0;
  private lastLeap = 0;
  private lastSpecial = 0;
  private revived = false;
  private healthBar?: Phaser.GameObjects.Graphics;
  private label?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, def: ZombieDef) {
    this.scene = scene;
    this.def = def;
    this.family = def.family;
    this.lootFamily = def.lootFamily;
    this.traits = new Set(def.traits);
    this.damage = def.damage;
    this.bite = def.bite;
    this.hp = def.hp;
    this.maxHp = def.hp;

    const key = zombieTextureKey(def.id);
    const tex = scene.textures.exists(key) ? key : scene.textures.exists(ZOMBIE_KEY) ? ZOMBIE_KEY : PLAYER_KEY;
    this.sprite = scene.physics.add.sprite(x, y, tex);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setScale(def.scale);
    this.sprite.setDepth(8);
    this.sprite.setCollideWorldBounds(true);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const size = Math.round(16 * def.scale + 6);
    body.setSize(size, size);
    body.setOffset((this.sprite.width - size) / 2, (this.sprite.height - size) / 2);

    // Rarity name label for notable types (rare+); cheap, only a handful on screen.
    if (rarityRank(def.rarity) >= 2) {
      this.label = scene.add
        .text(x, y, def.name, { fontFamily: "monospace", fontSize: "10px", color: RARITY_META[def.rarity].css, stroke: "#000", strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setDepth(9);
    }
  }

  hasTrait(t: ZombieTrait): boolean {
    return this.traits.has(t);
  }

  /** Contact reach scales with body size. */
  private get reach(): number {
    return 20 + this.def.scale * 12;
  }

  update(px: number, py: number, noise: number, now: number): void {
    // damage over time
    if (this.bleedDps > 0) {
      if (now >= this.dotUntil) this.bleedDps = 0;
      else if (now - this.lastDotTick >= 500) {
        this.lastDotTick = now;
        this.hp -= this.bleedDps * 0.5;
        this.flash(0xff4d4d);
      }
    }
    // regeneration
    if (this.hasTrait("regenerator") && this.hp < this.maxHp && now - this.lastDamaged > 1600 && now - this.lastRegen > 500) {
      this.lastRegen = now;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02);
    }

    if (now < this.knockedUntil) {
      this.drawUi();
      return;
    }
    if (now < this.stunnedUntil) {
      this.sprite.setVelocity(0, 0);
      this.drawUi();
      return;
    }
    if (now < this.leapUntil) {
      this.applySway(now);
      this.drawUi();
      return; // ride out the leap
    }

    const dx = px - this.sprite.x;
    const dy = py - this.sprite.y;
    const dist = Math.hypot(dx, dy) || 1;
    const aggro = this.def.aggro + noise;
    const speed = this.def.speed * this.frenzyMult();

    if (this.def.aggro > 0 && dist < aggro) {
      this.state = "chase";
      const inv = 1 / dist;
      this.facing = Math.atan2(dy, dx);
      let mvSpeed = speed;
      if (this.def.movement === "stalker") mvSpeed *= dist > 170 ? 1 : 0.4; // creep in close
      else if (this.def.movement === "lurcher") mvSpeed *= now % 850 < 450 ? 1.5 : 0.05; // lunge-pause
      let vx = dx * inv * mvSpeed;
      let vy = dy * inv * mvSpeed;
      if (this.def.movement === "erratic") {
        const veer = Math.sin(now * 0.02 + this.phase) * speed * 0.5;
        vx += Math.cos(this.facing + Math.PI / 2) * veer;
        vy += Math.sin(this.facing + Math.PI / 2) * veer;
      }
      this.sprite.setVelocity(vx, vy);
      // leaper (movement OR trait): dash toward the player from mid-range
      if ((this.def.movement === "leaper" || this.hasTrait("leaper")) && dist > 70 && dist < 300 && now - this.lastLeap > 1700) {
        this.lastLeap = now;
        this.leapUntil = now + 280;
        this.sprite.setVelocity(dx * inv * speed * 2.8, dy * inv * speed * 2.8);
      }
    } else {
      this.state = "wander";
      if (now > this.wanderUntil) {
        this.wanderUntil = now + 700 + Math.random() * 1600;
        if (Math.random() < 0.4) {
          this.sprite.setVelocity(0, 0);
        } else {
          const a = Math.random() * Math.PI * 2;
          const s = this.def.speed * 0.35;
          this.sprite.setVelocity(Math.cos(a) * s, Math.sin(a) * s);
          this.facing = a;
        }
      }
    }

    this.applySway(now);
    this.drawUi();
  }

  private frenzyMult(): number {
    return this.hasTrait("frenzied") ? 1 + (1 - this.hpFrac()) * 0.7 : 1;
  }

  private applySway(now: number): void {
    const fast = this.family === "zombie_runner" || this.hasTrait("fast");
    const wide = this.def.movement === "crawler";
    const amp = wide ? 0.2 : fast ? 0.22 : 0.12;
    const freq = fast ? 0.022 : 0.008;
    this.sprite.setRotation(this.facing + Math.sin(now * freq + this.phase) * amp);
  }

  private drawUi(): void {
    const s = this.sprite;
    if (this.label) this.label.setPosition(s.x, s.y - s.displayHeight * 0.5 - 4);
    if (this.hp < this.maxHp) {
      if (!this.healthBar) this.healthBar = this.scene.add.graphics().setDepth(9);
      const w = Math.max(16, s.displayWidth * 0.7);
      const frac = Math.max(0, this.hpFrac());
      const bx = s.x - w / 2;
      const by = s.y - s.displayHeight * 0.5 - (this.label ? 14 : 6);
      this.healthBar.clear();
      this.healthBar.fillStyle(0x1a1a1a, 0.85).fillRect(bx - 1, by - 1, w + 2, 4);
      this.healthBar.fillStyle(frac > 0.5 ? 0x6ed16e : frac > 0.25 ? 0xffd23f : 0xff5555, 1).fillRect(bx, by, w * frac, 2);
    } else if (this.healthBar) {
      this.healthBar.clear();
    }
  }

  knockback(dirX: number, dirY: number, force: number, now: number): void {
    if (this.hasTrait("brute") || this.family === "boss") force *= 0.4; // heavy enemies resist
    this.sprite.setVelocity(dirX * force, dirY * force);
    this.knockedUntil = now + 160;
  }

  tryAttack(px: number, py: number, now: number): boolean {
    if (this.damage <= 0) return false;
    const dist = Math.hypot(px - this.sprite.x, py - this.sprite.y);
    if (dist <= this.reach && now - this.lastAttack >= 850) {
      this.lastAttack = now;
      return true;
    }
    return false;
  }

  /** Off-cooldown gate for scene-driven special abilities (spit/scream). */
  trySpecial(now: number, cooldownMs: number): boolean {
    if (now - this.lastSpecial >= cooldownMs) {
      this.lastSpecial = now;
      return true;
    }
    return false;
  }

  takeDamage(n: number): boolean {
    let dmg = n;
    if (this.hasTrait("armored")) dmg *= 0.6;
    if (this.hasTrait("shielded")) dmg *= 0.78;
    this.hp -= dmg;
    this.lastDamaged = this.scene.time.now;
    if (this.hp <= 0) {
      if (this.hasTrait("undying") && !this.revived) {
        this.revived = true;
        this.hp = Math.max(1, this.maxHp * 0.3);
        this.flash(0x6fc3ff, 140);
        return false;
      }
      return true;
    }
    this.flash(0xffffff);
    return false;
  }

  applyDot(dps: number, ms: number): void {
    if (dps <= 0 || ms <= 0) return;
    const now = this.scene.time.now;
    this.bleedDps = Math.max(this.bleedDps, dps);
    this.dotUntil = Math.max(this.dotUntil, now + ms);
  }

  applyStun(ms: number): void {
    if (ms <= 0) return;
    this.stunnedUntil = Math.max(this.stunnedUntil, this.scene.time.now + ms);
  }

  hpFrac(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  private flash(color: number, ms = 80): void {
    this.sprite.setTint(color);
    this.sprite.scene.time.delayedCall(ms, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
  }

  /** Remove the UI bits (call when the body starts its death animation). */
  cleanupUi(): void {
    this.healthBar?.destroy();
    this.healthBar = undefined;
    this.label?.destroy();
    this.label = undefined;
  }

  destroy(): void {
    this.cleanupUi();
    this.sprite.destroy();
  }
}
