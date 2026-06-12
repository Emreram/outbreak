// Renderer-free enemy body — a 1:1 port of engine/Enemy.ts AI + combat surface
// (3D master plan §6.4: "EnemySim state machine (verbatim); pixel noise radii
// unchanged"). Every constant matches the Phaser oracle: aggro = def.aggro +
// noise, attack cooldown 850ms, reach 20 + scale·12, knockback 160ms with
// brute/boss ×0.4 resist, bleed DoT ticking 500ms at dps·0.5, regenerator 2%
// max HP per 500ms after 1600ms damage-free, undying one revive at 30%,
// stalker creep ×0.4 inside 170px, lurcher 1.5/0.05 on an 850ms cycle, erratic
// perpendicular veer, leaper dash ×2.8 between 70–300px every 1700ms.
// Visual-only bits (tint flash, frames, health bar) stay in the view layer.

import type { EnemyFamily, LootFamily, ZombieDef, ZombieTrait } from "../../game/enemies/types";
import { moveAndSlide, type TileGrid } from "../physics";

export type EnemySimState = "wander" | "chase";

let seq = 1;

export class EnemySim {
  readonly id = seq++;
  readonly def: ZombieDef;
  readonly family: EnemyFamily;
  readonly lootFamily: LootFamily;
  readonly traits: ReadonlySet<ZombieTrait>;
  readonly damage: number;
  readonly bite: boolean;
  readonly body: number; // square arcade body, px
  hp: number;
  readonly maxHp: number;
  state: EnemySimState = "wander";
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx = 0;
  vy = 0;
  facing = 0;
  readonly phase = Math.random() * 6.28;

  /** Player distance, cached for the view's stalker creep sway-amp (anim parity). */
  lastDist = 9999;
  private lastAttack = 0;
  private wanderUntil = 0;
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
  private lastDrip = 0;

  constructor(x: number, y: number, def: ZombieDef) {
    this.def = def;
    this.family = def.family;
    this.lootFamily = def.lootFamily;
    this.traits = new Set(def.traits);
    this.damage = def.damage;
    this.bite = def.bite;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.body = Math.round(16 * def.scale + 6);
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
  }

  hasTrait(t: ZombieTrait): boolean {
    return this.traits.has(t);
  }

  get reach(): number {
    return 20 + this.def.scale * 12;
  }

  /** AI + DoT + regen for one tick, then velocity integration vs the grid.
   *  `now` is the sim clock (ms). Mirrors Enemy.update() ordering exactly. */
  update(px: number, py: number, noise: number, now: number, dt: number, grid: TileGrid, bounds: { w: number; h: number }): void {
    this.prevX = this.x;
    this.prevY = this.y;

    // damage over time
    if (this.bleedDps > 0) {
      if (now >= this.dotUntil) this.bleedDps = 0;
      else if (now - this.lastDotTick >= 500) {
        this.lastDotTick = now;
        this.hp -= this.bleedDps * 0.5;
      }
    }
    // regeneration
    if (this.hasTrait("regenerator") && this.hp < this.maxHp && now - this.lastDamaged > 1600 && now - this.lastRegen > 500) {
      this.lastRegen = now;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02);
    }

    if (now < this.knockedUntil) {
      this.integrate(dt, grid, bounds);
      return;
    }
    if (now < this.stunnedUntil) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    if (now < this.leapUntil) {
      this.integrate(dt, grid, bounds);
      return; // ride out the leap
    }

    const dx = px - this.x;
    const dy = py - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.lastDist = dist;
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
      this.vx = vx;
      this.vy = vy;
      // leaper (movement OR trait): dash toward the player from mid-range
      if ((this.def.movement === "leaper" || this.hasTrait("leaper")) && dist > 70 && dist < 300 && now - this.lastLeap > 1700) {
        this.lastLeap = now;
        this.leapUntil = now + 280;
        this.vx = dx * inv * speed * 2.8;
        this.vy = dy * inv * speed * 2.8;
      }
    } else {
      this.state = "wander";
      if (now > this.wanderUntil) {
        this.wanderUntil = now + 700 + Math.random() * 1600;
        if (Math.random() < 0.4) {
          this.vx = 0;
          this.vy = 0;
        } else {
          const a = Math.random() * Math.PI * 2;
          const s = this.def.speed * 0.35;
          this.vx = Math.cos(a) * s;
          this.vy = Math.sin(a) * s;
          this.facing = a;
        }
      }
    }

    this.integrate(dt, grid, bounds);
  }

  /** Multiply current velocity (terrain slow — lava/water/mud, applied per tick
   *  by the hostiles system exactly like WorldScene.scaleBodyVelocity). */
  scaleVelocity(f: number): void {
    this.vx *= f;
    this.vy *= f;
  }

  private integrate(dt: number, grid: TileGrid, bounds: { w: number; h: number }): void {
    if (this.vx === 0 && this.vy === 0) return;
    const r = moveAndSlide(grid, this.x, this.y, this.vx, this.vy, dt, this.body, { bounds });
    this.x = r.x;
    this.y = r.y;
  }

  private frenzyMult(): number {
    return this.hasTrait("frenzied") ? 1 + (1 - this.hpFrac()) * 0.7 : 1;
  }

  /** Movement speed of the body this tick (the view's gait driver reads this). */
  speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  knockback(dirX: number, dirY: number, force: number, now: number): void {
    if (this.hasTrait("brute") || this.family === "boss") force *= 0.4; // heavy enemies resist
    this.vx = dirX * force;
    this.vy = dirY * force;
    this.knockedUntil = now + 160;
  }

  tryAttack(px: number, py: number, now: number): boolean {
    if (this.damage <= 0) return false;
    const dist = Math.hypot(px - this.x, py - this.y);
    if (dist <= this.reach && now - this.lastAttack >= 850) {
      this.lastAttack = now;
      return true;
    }
    return false;
  }

  /** Off-cooldown gate for system-driven special abilities (spit/scream/zap). */
  trySpecial(now: number, cooldownMs: number): boolean {
    if (now - this.lastSpecial >= cooldownMs) {
      this.lastSpecial = now;
      return true;
    }
    return false;
  }

  /** Returns true when this damage kills (undying revives once instead). */
  takeDamage(n: number, now: number): boolean {
    let dmg = n;
    if (this.hasTrait("armored")) dmg *= 0.6;
    if (this.hasTrait("shielded")) dmg *= 0.78;
    this.hp -= dmg;
    this.lastDamaged = now;
    if (this.hp <= 0) {
      if (this.hasTrait("undying") && !this.revived) {
        this.revived = true;
        this.hp = Math.max(1, this.maxHp * 0.3);
        return false;
      }
      return true;
    }
    return false;
  }

  applyDot(dps: number, ms: number, now: number): void {
    if (dps <= 0 || ms <= 0) return;
    this.bleedDps = Math.max(this.bleedDps, dps);
    this.dotUntil = Math.max(this.dotUntil, now + ms);
  }

  applyStun(ms: number, now: number): void {
    if (ms <= 0) return;
    this.stunnedUntil = Math.max(this.stunnedUntil, now + ms);
  }

  isStunned(now: number): boolean {
    return now < this.stunnedUntil;
  }

  /** Mid-leap (view-side leap-stretch pose; additive getter, no sim change). */
  isLeaping(now: number): boolean {
    return now < this.leapUntil;
  }

  hpFrac(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** Blood-drip cadence gate, ported verbatim (bleeding/wounded + moving). */
  tryBleedTrail(now: number): boolean {
    const bleeding = this.bleedDps > 0 && now < this.dotUntil;
    const wounded = this.hpFrac() < 0.55;
    if (!bleeding && !wounded) return false;
    const moving = this.vx * this.vx + this.vy * this.vy > 400; // > ~20 px/s
    if (!moving && !bleeding) return false;
    const interval = bleeding ? (moving ? 150 : 420) : 260;
    if (now - this.lastDrip < interval + (this.phase % 1) * 130) return false;
    this.lastDrip = now;
    return true;
  }
}
