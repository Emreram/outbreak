// Renderer-free wild animal — a 1:1 port of engine/Animal.ts (Feature 6):
// flee radius 190 calm / 340 alarmed, wander 800+rand·1600ms at ×0.4 speed
// with 40% idle rolls, full-speed direct flight from the player. The defs
// (rabbit/deer/boar HP, speeds, drops) are imported from the engine module —
// it is data, and importing keeps one source of truth. Visual frame swaps and
// tint flashes stay in the view.

import { ANIMALS, type AnimalDef, type AnimalKind } from "../../game/animals";
import { moveAndSlide, type TileGrid } from "../physics";

export { ANIMALS, type AnimalDef, type AnimalKind };

let seq = 1;

export class AnimalSim {
  readonly id = seq++;
  readonly def: AnimalDef;
  hp: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx = 0;
  vy = 0;
  facing = Math.random() * Math.PI * 2;
  alarmed = false;
  fleeing = false;
  readonly body: number;
  readonly phase = Math.random() * Math.PI * 2;
  private wanderUntil = 0;

  constructor(x: number, y: number, def: AnimalDef) {
    this.def = def;
    this.hp = def.hp;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.body = Math.round(14 * def.scale + 4);
  }

  update(px: number, py: number, now: number, dt: number, grid: TileGrid, bounds: { w: number; h: number }): void {
    this.prevX = this.x;
    this.prevY = this.y;
    const dx = px - this.x;
    const dy = py - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const fleeRadius = this.alarmed ? 340 : 190;
    this.fleeing = dist < fleeRadius;
    if (this.fleeing) {
      this.facing = Math.atan2(-dy, -dx); // run directly away
      this.vx = (-dx / dist) * this.def.speed;
      this.vy = (-dy / dist) * this.def.speed;
    } else if (now > this.wanderUntil) {
      this.wanderUntil = now + 800 + Math.random() * 1600;
      if (Math.random() < 0.4) {
        this.vx = 0;
        this.vy = 0;
      } else {
        const a = Math.random() * Math.PI * 2;
        this.vx = Math.cos(a) * this.def.speed * 0.4;
        this.vy = Math.sin(a) * this.def.speed * 0.4;
        this.facing = a;
      }
    }
    if (this.vx !== 0 || this.vy !== 0) {
      const r = moveAndSlide(grid, this.x, this.y, this.vx, this.vy, dt, this.body, { bounds });
      this.x = r.x;
      this.y = r.y;
    }
  }

  speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Apply damage; alarms it for good. Returns true if it dies. */
  takeDamage(n: number): boolean {
    this.hp -= n;
    this.alarmed = true;
    return this.hp <= 0;
  }
}
