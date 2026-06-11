// Pet entity (Companions & Spectacle PR-A): one lightweight actor class for both
// WILD pets (calm, curious, tamable — flee when spooked, predators turn on you
// after a botched tame) and OWNED companions (follow the player, lunge at the
// dead, run when badly hurt). Same no-pathfinding philosophy as Animal/Npc so it
// stays readable; combat damage resolution lives in the scene. All tunables come
// from the PetDef (game/pets.ts) — data-driven per the AI rules.

import Phaser from "phaser";
import type { PetDef } from "../game/pets";
import { bondedDamage } from "../game/pets";
import { petTexKey, petWingKey, PET_SHADOW } from "./petSprites";
import { ZOMBIE_KEY } from "./textures";

export type PetMode = "wild" | "owned";

const BASE_SPEED = 150; // px/s ground reference (Npc parity)
const FOLLOW_AT = 70; // owned: keep this close to the player
const FIGHT_RADIUS = 220; // owned: lunge at the dead inside this
const FLEE_HP_FRAC = 0.25; // owned: run when this hurt
const CURIOUS_RADIUS = 200; // wild: watch the player inside this
const FLEE_RADIUS = 320; // wild + spooked: run while player is inside this

export class Pet {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly def: PetDef;
  mode: PetMode;
  hp: number;
  bond = 0;
  stateId?: string; // PetState.id when owned
  lastBite = 0; // owned attack cooldown (scene applies the damage)
  hostileUntil = 0; // wild predator: failed tame → turns on you briefly
  docile = false; // the day-0 stray (PR-D): pads after the player, hoping
  lastCry = 0; // docile whimper cadence (scene-paced)
  private alarmedUntil = 0;
  private facing = Math.random() * Math.PI * 2;
  private wanderUntil = 0;
  private wing?: Phaser.GameObjects.Image;
  private shadow?: Phaser.GameObjects.Image;
  private bobT = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, x: number, y: number, def: PetDef, mode: PetMode) {
    this.def = def;
    this.mode = mode;
    this.hp = def.hp;
    const key = petTexKey(def.id);
    const tex = scene.textures.exists(key) ? key : ZOMBIE_KEY;
    this.sprite = scene.physics.add.sprite(x, y, tex).setDepth(8);
    this.sprite.setCollideWorldBounds(true);
    (this.sprite.body as Phaser.Physics.Arcade.Body).setSize(20, 20);
    if (def.move === "fly") {
      // Detached shadow + wing overlay sell the hover (altitude illusion).
      this.shadow = scene.add.image(x, y + 14, PET_SHADOW).setDepth(3).setAlpha(0.8).setScale(0.8);
      const wk = petWingKey(def.id);
      if (scene.textures.exists(wk)) this.wing = scene.add.image(x, y, wk).setDepth(9);
    }
  }

  /** True while a botched tame has this predator hunting the player. */
  isHostile(now: number): boolean {
    return now < this.hostileUntil;
  }

  spook(now: number, hostile: boolean): void {
    this.alarmedUntil = now + 6000;
    if (hostile) this.hostileUntil = now + 10000;
  }

  damage(): number {
    return this.mode === "owned" ? bondedDamage(this.def, this.bond) : this.def.damage;
  }

  update(px: number, py: number, zombie: { x: number; y: number } | null, now: number): void {
    this.bobT += 0.05;
    const dx = px - this.sprite.x;
    const dy = py - this.sprite.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = BASE_SPEED * Math.min(1.6, Math.max(0.8, this.def.speed));

    if (this.mode === "owned") {
      if (this.hp <= this.def.hp * FLEE_HP_FRAC && zombie) {
        // badly hurt: keep away from the threat instead of brawling
        const zx = this.sprite.x - zombie.x;
        const zy = this.sprite.y - zombie.y;
        const zd = Math.hypot(zx, zy) || 1;
        if (zd < 160) this.move(zx / zd, zy / zd, speed);
        else this.followOrIdle(dx, dy, dist, speed);
      } else if (zombie) {
        const zx = zombie.x - this.sprite.x;
        const zy = zombie.y - this.sprite.y;
        const zd = Math.hypot(zx, zy) || 1;
        if (zd < FIGHT_RADIUS) this.move(zx / zd, zy / zd, speed);
        else this.followOrIdle(dx, dy, dist, speed);
      } else {
        this.followOrIdle(dx, dy, dist, speed);
      }
    } else if (this.docile && !this.isHostile(now)) {
      // the stray: pads after the player and sits hopeful at arm's length
      if (dist > 110) this.move(dx / dist, dy / dist, speed * 0.55);
      else {
        this.sprite.setVelocity(0, 0);
        this.facing = Math.atan2(dy, dx);
      }
    } else if (this.isHostile(now)) {
      this.move(dx / dist, dy / dist, speed); // predator: it remembers the insult
    } else if (now < this.alarmedUntil && dist < FLEE_RADIUS) {
      this.move(-dx / dist, -dy / dist, speed); // spooked: run
    } else if (dist < CURIOUS_RADIUS) {
      // wild + calm: stop and watch — this is the tame window
      this.sprite.setVelocity(0, 0);
      this.facing = Math.atan2(dy, dx);
    } else if (now > this.wanderUntil) {
      this.wanderUntil = now + 1200 + Math.random() * 2200;
      if (Math.random() < 0.45) this.sprite.setVelocity(0, 0);
      else {
        const a = Math.random() * Math.PI * 2;
        this.move(Math.cos(a), Math.sin(a), speed * 0.35);
      }
    }

    // facing + idle breath/walk bob
    const moving = (this.sprite.body as Phaser.Physics.Arcade.Body).speed > 4;
    const bob = moving ? Math.sin(now * 0.02) * 0.07 : 0;
    this.sprite.setRotation(this.facing + bob);
    this.sprite.setScale(this.sprite.scaleX, 1 + (moving ? 0 : Math.sin(this.bobT) * 0.02));

    // fly accessories: hover bob, flapping wings, detached shadow
    if (this.def.move === "fly") {
      const hover = Math.sin(this.bobT * 1.4) * 5;
      this.sprite.y += hover * 0.02; // gentle drift (body is authoritative)
      if (this.wing) {
        this.wing.setPosition(this.sprite.x, this.sprite.y).setRotation(this.sprite.rotation);
        this.wing.setScale(1, 0.6 + Math.abs(Math.sin(this.bobT * 2.4)) * 0.4); // flap
      }
      this.shadow?.setPosition(this.sprite.x, this.sprite.y + 14).setScale(0.75 + Math.sin(this.bobT * 1.4) * 0.05);
    }
  }

  private followOrIdle(dx: number, dy: number, dist: number, speed: number): void {
    if (dist > FOLLOW_AT) this.move(dx / dist, dy / dist, Math.min(speed * 1.3, dist * 3));
    else this.sprite.setVelocity(0, 0);
  }

  private move(nx: number, ny: number, speed: number): void {
    this.sprite.setVelocity(nx * speed, ny * speed);
    this.facing = Math.atan2(ny, nx);
  }

  /** Returns true on death. White-flash like every other actor. */
  takeDamage(n: number, now: number): boolean {
    this.hp -= n;
    this.alarmedUntil = now + 6000;
    this.sprite.setTintFill(0xffffff);
    this.sprite.scene.time.delayedCall(70, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
    return this.hp <= 0;
  }

  destroy(): void {
    this.wing?.destroy();
    this.shadow?.destroy();
    this.sprite.destroy();
  }
}
