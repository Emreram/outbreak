// World events (extracted from WorldScene.worldEvent): the ~150s cadence
// (scaled by day/night) rolling the 10-kind table. Fully simulated here:
// horde (runner-heavy wave + banner), raiders (hostile survivors), dilemma
// (THE GM entry point — the only thing that opens the choice/chat modal),
// supply_drop (a crate haul scattered nearby), flyover (sound + banner).
// Beacon kinds (smoke/flare/gunfight/car_alarm) and the trader currently
// surface as compass-direction notices — their investigation/NPC mechanics
// arrive with the M4 systems (parity gap tracked in the milestone notes).

import { nextEventDelayMs, rollWorldEvent, compassDir, BEACON_EVENTS } from "../../game/worldEvents";
import { rollLoot } from "../../game/items/lootTables";
import { lootLuck } from "../../game/perks";
import { liveRng } from "../../game/rng";
import { pushRecentEvent } from "../../game/GameState";
import type { Sim, SimSystem } from "../Sim";
import type { ClockSystem } from "./clock";
import type { DropsSystem } from "./drops";
import type { HostilesSystem } from "./hostiles";

/** WorldScene.DILEMMAS, verbatim — the rare scripted GM openers. */
const DILEMMAS: ReadonlyArray<{ title: string; situation: string; choices: string[] }> = [
  { title: "A cry for help", situation: "A voice cracks across the rooftops — someone's pinned nearby, begging for help. It could be real. It could be bait.", choices: ["Rush to help them", "Approach carefully, weapon up", "Call out and wait", "Ignore it and move on"] },
  { title: "Stranger at the treeline", situation: "A lone figure watches you from cover, hand hovering near their belt. Neither of you has moved.", choices: ["Lower your weapon and talk", "Aim and warn them off", "Offer to trade supplies", "Back away slowly"] },
  { title: "Distant gunfire", situation: "Gunshots crack a few streets over — a fight. Wherever there's a fight there's loot, and a good way to die.", choices: ["Move toward the gunfire", "Wait and scavenge the aftermath", "Slip away from the noise", "Set up an ambush nearby"] },
  { title: "A sealed cache", situation: "A chained cargo container, deep scratch-marks raked all around it. Something wanted in. Or out.", choices: ["Force it open", "Listen at the door first", "Mark it and leave", "Rig a trap and wait"] },
  { title: "The wounded one", situation: "A survivor slumps against the wall, bleeding — a bite half-hidden under a torn sleeve. They lock eyes with you.", choices: ["Help dress the wound", "Keep your distance", "Share water and talk", "End it, mercifully"] },
  { title: "Smoke on the wind", situation: "A thin column of smoke rises a block away — a campfire, freshly lit. Someone is close, and warm.", choices: ["Investigate the fire", "Watch from cover first", "Announce yourself loudly", "Avoid it entirely"] },
];

export class WorldEventsSystem implements SimSystem {
  readonly id = "worldEvents";
  private acc = 0;
  private delay = 150000;

  tick(sim: Sim, dt: number): void {
    this.acc += dt * 1000;
    if (this.acc < this.delay) return;
    this.acc = 0;
    const clock = sim.getSystem<ClockSystem>("clock")!;
    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    this.delay = nextEventDelayMs(hostiles.effDay(sim), clock.isNight(sim));
    this.fire(sim, clock, hostiles);
  }

  private fire(sim: Sim, clock: ClockSystem, hostiles: HostilesSystem): void {
    const kind = rollWorldEvent(liveRng, hostiles.effDay(sim), clock.isNight(sim));
    const dir = compassDir(liveRng.range(-1, 1), liveRng.range(-1, 1));
    switch (kind) {
      case "horde": {
        const n = Math.min(8, 3 + Math.floor(hostiles.effDay(sim) / 2));
        hostiles.spawnNear(sim, [{ type: liveRng.chance(0.4) ? "zombie_runner" : "zombie", count: n }]);
        sim.events.emit("banner", { text: "A horde shambles into the area…", color: "#ff8aa0" });
        pushRecentEvent(sim.state, "A horde swept through the streets.");
        break;
      }
      case "raiders": {
        hostiles.spawnNear(sim, [{ type: "survivor_hostile", count: liveRng.int(2, 3) }]);
        sim.events.emit("banner", { text: "Voices — armed, and not friendly.", color: "#ffb056" });
        pushRecentEvent(sim.state, "Raiders moved in nearby.");
        break;
      }
      case "supply_drop": {
        const drops = sim.getSystem<DropsSystem>("drops")!;
        const spot = sim.world.randomWalkableInView(sim.player.x, sim.player.y, 8) ?? { x: sim.player.x + 96, y: sim.player.y };
        const bias = lootLuck(sim.state) + sim.world.lootBias(spot.x, spot.y);
        for (const s of rollLoot("chest:2", liveRng, 3, bias)) drops.spawnDrop(sim, spot.x, spot.y, s.item, s.qty);
        sim.events.emit("banner", { text: `A supply drop streaks down to the ${compassDir(spot.x - sim.player.x, spot.y - sim.player.y)}.`, color: "#9ef0a0" });
        sim.events.emit("sound", { id: "flare" });
        break;
      }
      case "flyover":
        sim.events.emit("sound", { id: "boom" });
        sim.events.emit("banner", { text: "A helicopter thunders overhead and is gone." });
        break;
      case "dilemma": {
        const d = liveRng.pick([...DILEMMAS]);
        sim.events.emit("encounterRequested", {
          title: d.title,
          situation: d.situation,
          choices: [...d.choices],
          loc: sim.world.biomeAtPx(sim.player.x, sim.player.y),
        });
        break;
      }
      case "trader":
        sim.events.emit("banner", { text: `A trader's bell rings out to the ${dir}. (They move on quickly.)` });
        break;
      default: {
        // beacons: smoke/flare/gunfight/car_alarm — distant happenings
        if ((BEACON_EVENTS as readonly string[]).includes(kind)) {
          const label =
            kind === "smoke" ? "Smoke rises" : kind === "flare" ? "A flare arcs up" : kind === "gunfight" ? "A gunfight crackles" : "A car alarm wails";
          sim.events.emit("banner", { text: `${label} to the ${dir}.` });
          if (kind === "gunfight") sim.events.emit("sound", { id: "gunshotFar" });
          if (kind === "car_alarm") sim.events.emit("sound", { id: "alarm" });
        }
      }
    }
  }
}
