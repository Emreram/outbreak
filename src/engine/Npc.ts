import Phaser from "phaser";
import { npcJacketFrames, SURVIVOR_NPC_KEY, SURVIVOR_NPC_WALK_A, SURVIVOR_NPC_WALK_B, PLAYER_KEY } from "./textures";
import { applyFrame, frameFor, type FrameSet } from "./anim";

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
  /** Camp tether (U5): wandering stays within r of (x, y); the camp reconcile —
   *  not the distance despawn — owns this NPC's lifecycle. */
  home?: { x: number; y: number; r: number };
}

const SPEED = 150;

export class Npc {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly id: string;
  readonly name: string;
  readonly faction: string;
  readonly tier?: string;
  readonly home?: { x: number; y: number; r: number };
  kind: NpcKind;
  hp: number;
  maxHp: number;
  lastHit = 0; // companion attack cooldown
  lastHurt = 0; // companion damage-taken cooldown
  private facing = 0;
  private wanderUntil = 0;
  private tag?: Phaser.GameObjects.Text; // floating quality name-tag
  private frames: FrameSet; // walk cycle — the faction colour is baked into the JACKET
  private readonly phase = Math.random() * Math.PI * 2; // desync the crowd

  constructor(scene: Phaser.Scene, x: number, y: number, opts: NpcOpts) {
    this.id = opts.id;
    this.name = opts.name;
    this.faction = opts.faction;
    this.kind = opts.kind;
    this.tier = opts.tier;
    this.home = opts.home;
    this.hp = opts.hp;
    this.maxHp = opts.maxHp;
    // The faction/tier colour recolours the JACKET only (npcJacketFrames) — the
    // survivor keeps its face/hair/pack instead of flattening under a whole-
    // sprite multiply.
    this.frames = this.colorFrames(scene, opts.color);
    this.sprite = scene.physics.add.sprite(x, y, this.frames.idle).setDepth(9);
    this.sprite.setCollideWorldBounds(true);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 20);
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

  /** Resolve the walk-cycle frames: a jacket-coloured set when a faction colour
   *  is given, else the default neutral survivor (constructor/setTint only). */
  private colorFrames(scene: Phaser.Scene, color?: number): FrameSet {
    if (color !== undefined) return npcJacketFrames(scene, color);
    const base = scene.textures.exists(SURVIVOR_NPC_KEY) ? SURVIVOR_NPC_KEY : PLAYER_KEY;
    return {
      idle: base,
      a: scene.textures.exists(SURVIVOR_NPC_WALK_A) ? SURVIVOR_NPC_WALK_A : base,
      b: scene.textures.exists(SURVIVOR_NPC_WALK_B) ? SURVIVOR_NPC_WALK_B : base,
    };
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
        this.animate(now);
        return;
      }
      const dx = px - this.sprite.x;
      const dy = py - this.sprite.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 64) this.move(dx / d, dy / d, Math.min(SPEED * 1.3, d * 3));
      else this.idle();
      this.animate(now);
      return;
    }
    // ambient survivor: gentle wander, stay roughly in place. Camp residents (U5)
    // drift back toward their tether whenever they stray past its radius.
    if (now > this.wanderUntil) {
      this.wanderUntil = now + 1000 + Math.random() * 1800;
      const hx = this.home ? this.home.x - this.sprite.x : 0;
      const hy = this.home ? this.home.y - this.sprite.y : 0;
      if (this.home && Math.hypot(hx, hy) > this.home.r) {
        const d = Math.hypot(hx, hy) || 1;
        this.move(hx / d, hy / d, SPEED * 0.5); // head home
      } else if (Math.random() < 0.5) {
        this.idle();
      } else {
        const a = Math.random() * Math.PI * 2;
        this.move(Math.cos(a), Math.sin(a), SPEED * 0.4);
      }
    }
    this.sprite.setRotation(this.facing + Math.sin(now * 0.015) * 0.08);
    this.animate(now);
  }

  /** Walk-frame swap + a livelier bob while moving (Animation Pass). */
  private animate(now: number): void {
    const moving = (this.sprite.body as Phaser.Physics.Arcade.Body).speed > 4;
    applyFrame(this.sprite, frameFor(this.frames, moving, now * 0.011 + this.phase));
    if (moving) this.sprite.setRotation(this.facing + Math.sin(now * 0.011 + this.phase) * 0.09);
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
    this.sprite.setTintFill(0xffffff); // full-white hurt flash; jacket colour is baked
    this.sprite.scene.time.delayedCall(70, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
    return this.hp <= 0;
  }

  /** Recolour the jacket (e.g. survivor → companion green on recruit) — rebuilds
   *  the cycle in the new colour; no whole-sprite tint to carry through flashes. */
  setTint(color: number): void {
    this.frames = npcJacketFrames(this.sprite.scene, color);
    this.sprite.setTexture(this.frames.idle).clearTint();
  }

  destroy(): void {
    this.tag?.destroy();
    this.sprite.destroy();
  }
}
