// World clock + blood moon (extracted from WorldScene per 3D master plan M1):
// 4 phases × SEG_MS (45s real) per segment, day++ as night wraps to dawn,
// weather shifts 35% per phase change, rain waters crops, crops grow one
// segment per phase, blood moon rolled 6% as night falls and lifted at dawn
// with an immediate runner-heavy surge. clockMs persists mid-segment progress.

import { liveRng } from "../../game/rng";
import { isWet, rollWeather } from "../../game/weather";
import { growPlots } from "../../game/farming";
import { pushRecentEvent } from "../../game/GameState";
import { notifyObjective } from "../../game/objectives";
import type { Sim, SimSystem } from "../Sim";
import type { HostilesSystem } from "./hostiles";

export const SEG_MS = 45000;
export const BLOOD_MOON_CHANCE = 0.06;
const PHASES = ["dawn", "day", "dusk", "night"] as const;

const PHASE_LINES: Record<string, string> = {
  dawn: "Dawn breaks — the dead lose their nerve.",
  day: "Daylight floods the streets.",
  dusk: "Dusk settles — shadows pool in the alleys.",
  night: "Night falls — the dead grow bold.",
};

export class ClockSystem implements SimSystem {
  readonly id = "clock";
  segAcc = 0;

  constructor(sim: Sim) {
    this.segAcc = sim.state.clockMs ?? 0;
  }

  /** 0..1 progress through the full 4-phase day (drives lighting). */
  dayFraction(sim: Sim): number {
    const idx = Math.max(0, PHASES.indexOf(sim.state.timeOfDay as (typeof PHASES)[number]));
    return (idx + Math.min(1, this.segAcc / SEG_MS)) / PHASES.length;
  }

  isNight(sim: Sim): boolean {
    return sim.state.timeOfDay === "night" || sim.state.timeOfDay === "dusk";
  }

  /** Zombies sense you from farther away in the dark. */
  nightNoise(sim: Sim): number {
    if (sim.state.timeOfDay === "night") return 80;
    if (sim.state.timeOfDay === "dusk") return 35;
    return 0;
  }

  tick(sim: Sim, dt: number): void {
    this.segAcc += dt * 1000;
    sim.state.clockMs = this.segAcc;
    if (this.segAcc >= SEG_MS) {
      this.segAcc -= SEG_MS;
      this.advanceClock(sim);
    }
  }

  advanceClock(sim: Sim, announce = true): void {
    const s = sim.state;
    const idx = PHASES.indexOf(s.timeOfDay as (typeof PHASES)[number]);
    const next = (idx + 1) % PHASES.length;
    if (next === 0) {
      s.day += 1; // wrapped night -> dawn
      sim.events.emit("dayStarted", { day: s.day });
      const r = notifyObjective(s, { kind: "dawn" }); // opening arc: survived the night
      if (r.toast) sim.events.emit("banner", { text: r.toast });
    }
    s.timeOfDay = PHASES[next];
    const wasBlood = s.bloodMoon;
    this.updateBloodMoon(sim);
    sim.events.emit("phaseChanged", { phase: s.timeOfDay, day: s.day });
    if (announce && s.bloodMoon === wasBlood) {
      const m = PHASE_LINES[s.timeOfDay];
      if (m) sim.events.emit("banner", { text: m });
    }
    if (liveRng.chance(0.35)) {
      s.weather = rollWeather(liveRng); // conditions shift
      sim.events.emit("weatherChanged", { kind: s.weather });
    }
    if (isWet(s.weather)) for (const p of s.farmPlots ?? []) p.watered = true; // rain waters crops
    growPlots(s); // crops advance one segment per time-of-day step
  }

  private updateBloodMoon(sim: Sim): void {
    const s = sim.state;
    if (s.timeOfDay === "night") {
      if (!s.bloodMoon && liveRng.chance(BLOOD_MOON_CHANCE)) this.beginBloodMoon(sim);
    } else if (s.bloodMoon && s.timeOfDay === "dawn") {
      s.bloodMoon = false;
      sim.events.emit("bloodMoon", { active: false });
      sim.events.emit("banner", { text: "The blood moon sets. The dead thin out." });
    }
  }

  private beginBloodMoon(sim: Sim): void {
    sim.state.bloodMoon = true;
    pushRecentEvent(sim.state, "A blood moon rose — the dead swarmed in the red light.");
    sim.events.emit("sound", { id: "boom" });
    sim.events.emit("impulse", { kind: "flash", amount: 0.7 });
    sim.events.emit("impulse", { kind: "shake", amount: 0.3 });
    sim.events.emit("bloodMoon", { active: true });
    sim.events.emit("banner", { text: "BLOOD MOON — survive until dawn", color: "#ff5a6e" });
    // An immediate surge floods the streets around the player — runner-heavy.
    const hostiles = sim.getSystem<HostilesSystem>("hostiles");
    hostiles?.spawnNear(sim, [
      { type: "zombie_runner", count: liveRng.int(4, 6) },
      { type: "zombie", count: liveRng.int(5, 8) },
    ]);
  }
}
