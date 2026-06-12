// The player's simulation body — movement rules ported verbatim from
// engine/Player.ts (PLAYER_SPEED 190 px/s, sprint ×1.6, 20px square arcade
// body, diagonal normalisation, facing = direction of travel) on top of
// sim/physics.moveAndSlide. The renderer reads positions and drives cosmetic
// gait/sway itself; nothing here is visual.

import { PLAYER_SPEED, TILE_SIZE } from "../../game/constants";
import { terrainEffect } from "../../game/terrain";
import { moveAndSlide, type TileGate, type TileGrid } from "../physics";
import type { InputState } from "../input";

export const PLAYER_BODY = 20; // px square, centred (passes 1-tile doorways)
export const SPRINT_MULT = 1.6;

export class PlayerSim {
  x: number;
  y: number;
  /** Previous fixed-step position (render interpolation). */
  prevX: number;
  prevY: number;
  facing = 0; // radians
  moving = false;
  sprinting = false;
  /** Movement multiplier — 1 on foot, raised while driving/riding. */
  speedMult = 1;
  /** Terrain multiplier from the tile underfoot (set each tick). */
  terrainMult = 1;
  /** Optional per-tile pass gate (flying mount passes all, swimmer water only). */
  gate: TileGate | null = null;
  /** When false, movement input is ignored (encounter pause, death). */
  controllable = true;
  /** One-shot knockback impulse (brute hit) — overrides input while active. */
  impulseX = 0;
  impulseY = 0;
  impulseUntil = -1;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
  }

  tick(
    input: InputState,
    dt: number,
    grid: TileGrid,
    bounds: { w: number; h: number },
    canSprint: boolean,
    now: number,
    grabbedUntil: number,
  ): void {
    this.prevX = this.x;
    this.prevY = this.y;

    // Tile underfoot → terrain speed multiplier (Living World rules).
    this.terrainMult = terrainEffect(grid.tileAt(Math.floor(this.x / TILE_SIZE), Math.floor(this.y / TILE_SIZE))).mult;

    // Held fast by a grabber: velocity zeroed (WorldScene parity).
    if (now < grabbedUntil) {
      this.moving = false;
      this.sprinting = false;
      return;
    }

    // Brute knockback wins the frame it lands (Phaser setVelocity semantics).
    if (now < this.impulseUntil) {
      const r = moveAndSlide(grid, this.x, this.y, this.impulseX, this.impulseY, dt, PLAYER_BODY, {
        gate: this.gate ?? undefined,
        bounds,
      });
      this.x = r.x;
      this.y = r.y;
      this.moving = true;
      this.sprinting = false;
      return;
    }

    let vx = this.controllable ? input.moveX : 0;
    let vy = this.controllable ? input.moveY : 0;
    const len = Math.hypot(vx, vy);
    const sprint = len > 0 && canSprint && input.sprint;
    this.sprinting = sprint;
    this.moving = len > 0;

    if (len > 0) {
      vx /= len;
      vy /= len;
      const speed = (sprint ? PLAYER_SPEED * SPRINT_MULT : PLAYER_SPEED) * this.speedMult * this.terrainMult;
      const r = moveAndSlide(grid, this.x, this.y, vx * speed, vy * speed, dt, PLAYER_BODY, {
        gate: this.gate ?? undefined,
        bounds,
      });
      this.x = r.x;
      this.y = r.y;
      this.facing = Math.atan2(vy, vx);
    }
  }
}
