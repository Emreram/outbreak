// Save cadence (extracted from WorldScene): the same 4s autosave through the
// SAME frozen save path (GameState.saveGame → localStorage outbreak_save_v4),
// plus an immediate save on death. Player position and clockMs are already
// kept current by Sim/ClockSystem each step, so a save is just a write.

import { saveGame } from "../../game/GameState";
import type { Sim, SimSystem } from "../Sim";

export const SAVE_MS = 4000;

export class PersistenceSystem implements SimSystem {
  readonly id = "persistence";
  private saveAcc = 0;
  /** Swappable writer (IndexedDB slots arrive at M5; default = localStorage v4). */
  write: (sim: Sim) => void = (sim) => saveGame(sim.state);

  constructor(sim: Sim) {
    sim.events.on("death", () => this.write(sim));
  }

  tick(sim: Sim, dt: number): void {
    this.saveAcc += dt * 1000;
    if (this.saveAcc >= SAVE_MS) {
      this.saveAcc -= SAVE_MS;
      this.write(sim);
    }
  }
}
