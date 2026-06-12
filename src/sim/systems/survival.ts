// Survival ticks (extracted from WorldScene): the 2s decay cadence over
// game/survival.ts pure rules, sprint stamina drain (0.012/ms × perk), the
// canSprint > 5 gate, terrain hazards underfoot (lava ignites 1600ms, splash
// soaks 2200ms — soaked bodies resist ignition, water douses fire), burn
// damage pulses, and the two death doors (hp ≤ 0, infection ≥ 100).

import { clampStat, isDead } from "../../game/GameState";
import { applyDecay, ignitePlayer, ratesFor, soakPlayer, tickBurning } from "../../game/survival";
import { sprintDrainMult } from "../../game/perks";
import { terrainEffect } from "../../game/terrain";
import { Tile } from "../../game/world/tiles";
import { TILE_SIZE } from "../../game/constants";
import type { Sim, SimSystem } from "../Sim";

export const DECAY_MS = 2000;

export class SurvivalSystem implements SimSystem {
  readonly id = "survival";
  private decayAcc = 0;

  tick(sim: Sim, dt: number): void {
    const s = sim.state;

    // Sprint gate + drain (WorldScene update() parity).
    sim.canSprint = s.player.stamina > 5;
    if (sim.player.sprinting) {
      s.player.stamina = clampStat(s.player.stamina - dt * 1000 * 0.012 * sprintDrainMult(s));
    }

    // Terrain hazards underfoot (skipped while driving or aloft).
    if (!sim.driving && !sim.airborne) {
      const tile = sim.world.tileAt(Math.floor(sim.player.x / TILE_SIZE), Math.floor(sim.player.y / TILE_SIZE));
      const terr = terrainEffect(tile);
      const onWater = tile === Tile.Water || tile === Tile.DeepWater || tile === Tile.ShallowWater;
      if (terr.hazard === "lava") ignitePlayer(s, 1600, sim.now);
      else if (terr.stepFx === "splash" || (onWater && sim.riding)) soakPlayer(s, 2200, sim.now);
    }

    this.decayAcc += dt * 1000;
    if (this.decayAcc >= DECAY_MS) {
      this.decayAcc -= DECAY_MS;
      applyDecay(s, ratesFor(s));
      if (tickBurning(s, sim.now) > 0) sim.events.emit("impulse", { kind: "hurtPulse", amount: 0.4 });
      if (isDead(s)) {
        sim.enterDeath(
          s.player.infection >= 100 ? "The infection took hold."
          : s.player.hunger <= 0 || s.player.thirst <= 0 ? "Starved and spent."
          : "Your wounds won.",
        );
      }
    }
  }
}
