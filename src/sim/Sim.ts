// The renderer-agnostic simulation host (3D master plan §3.1/§3.2): a
// fixed-step 60 Hz accumulator with render-side interpolation, a registry of
// systems extracted from WorldScene, and the entity world. Views call
// frame(dtMs) once per render frame and read interpolated positions via
// alpha(); the sim itself never sees a renderer.

import type { GameState } from "../shared/contracts";
import { EventBus } from "./events";
import { newInputState, type InputState } from "./input";
import { PlayerSim } from "./entities/PlayerSim";
import { SimChunkStore, type SimChunkStoreOpts } from "./world";

/** Fixed simulation step (seconds) — 60 Hz, matching typical Phaser cadence. */
export const SIM_STEP = 1 / 60;
/** Cap a render frame's catch-up work so a tab-switch doesn't spiral. */
const MAX_FRAME_S = 0.25;

export interface SimSystem {
  id: string;
  /** Called every fixed step while the world is running (not paused). */
  tick(sim: Sim, dt: number): void;
}

export class Sim {
  readonly events = new EventBus();
  readonly input: InputState = newInputState();
  readonly world: SimChunkStore;
  readonly player: PlayerSim;
  readonly state: GameState;
  /** Monotonic sim clock, ms (advances only while unpaused — Phaser parity:
   *  WorldScene froze all cadence accumulators during modal pauses). */
  now = 0;
  /** World pause (encounter/modal open). Movement + systems freeze. */
  paused = false;
  /** Sprint gate from survival (stamina > 0) — set by the survival system. */
  canSprint = true;

  private systems: SimSystem[] = [];
  private acc = 0;

  constructor(state: GameState, worldOpts: SimChunkStoreOpts) {
    this.state = state;
    // Bridge store callbacks onto the typed bus so any number of views can
    // subscribe without the store knowing about them.
    this.world = new SimChunkStore(state.seed, {
      ...worldOpts,
      onChunkLoad: (d) => {
        worldOpts.onChunkLoad?.(d);
        this.events.emit("chunkLoaded", { cx: d.cx, cy: d.cy });
      },
      onChunkUnload: (cx, cy) => {
        worldOpts.onChunkUnload?.(cx, cy);
        this.events.emit("chunkUnloaded", { cx, cy });
      },
    });
    const fresh = state.player.x === 0 && state.player.y === 0;
    const sx = fresh ? this.world.start.x : state.player.x;
    const sy = fresh ? this.world.start.y : state.player.y;
    this.player = new PlayerSim(sx, sy);
    state.player.x = sx;
    state.player.y = sy;
    this.world.ensureAround(sx, sy);
  }

  addSystem(s: SimSystem): void {
    this.systems.push(s);
  }

  getSystem<T extends SimSystem>(id: string): T | undefined {
    return this.systems.find((s) => s.id === id) as T | undefined;
  }

  /** Advance the sim by one render frame's worth of fixed steps.
   *  Returns the number of fixed steps executed. */
  frame(dtMs: number): number {
    this.acc += Math.min(dtMs / 1000, MAX_FRAME_S);
    let steps = 0;
    while (this.acc >= SIM_STEP) {
      this.acc -= SIM_STEP;
      if (!this.paused) this.step(SIM_STEP);
      steps++;
    }
    return steps;
  }

  /** Interpolation factor for views (0..1 between the last two fixed steps). */
  alpha(): number {
    return this.acc / SIM_STEP;
  }

  private step(dt: number): void {
    this.now += dt * 1000;
    this.player.tick(this.input, dt, this.world, this.world.worldPxBounds(), this.canSprint);
    this.world.ensureAround(this.player.x, this.player.y);
    for (const s of this.systems) s.tick(this, dt);
    // Keep the authoritative state's position current (persist cadence reads it).
    this.state.player.x = this.player.x;
    this.state.player.y = this.player.y;
  }
}
