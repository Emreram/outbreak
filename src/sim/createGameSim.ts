// Assembles a fully-systemed Sim for a run — the one place that knows the
// system roster and its tick order (mirroring WorldScene.update()'s order:
// world/streaming → hostiles AI → combat projectiles → loot → scavenge channel
// → survival decay → clock → persistence).

import type { GameState } from "../shared/contracts";
import { isPropSearched } from "../game/scavenge";
import { Sim } from "./Sim";
import { ClockSystem } from "./systems/clock";
import { CombatSystem } from "./systems/combat";
import { DiscoverySystem } from "./systems/discovery";
import { DropsSystem } from "./systems/drops";
import { HostilesSystem } from "./systems/hostiles";
import { PersistenceSystem } from "./systems/persistence";
import { ScavengeSystem } from "./systems/scavenge";
import { SurvivalSystem } from "./systems/survival";

export function createGameSim(state: GameState): {
  sim: Sim;
  clock: ClockSystem;
  hostiles: HostilesSystem;
  combat: CombatSystem;
  drops: DropsSystem;
  scavenge: ScavengeSystem;
} {
  const sim = new Sim(state, {
    isChestLooted: (gid) => state.worldFlags.includes(`chest_${gid}`),
    isPropSearched: (gid) => isPropSearched(state, gid),
    disasters: () => state.disasters ?? [],
    currentDay: () => state.day,
  });
  const clock = new ClockSystem(sim);
  const hostiles = new HostilesSystem();
  const combat = new CombatSystem();
  const drops = new DropsSystem();
  const scavenge = new ScavengeSystem();
  sim.addSystem(hostiles);
  sim.addSystem(combat);
  sim.addSystem(drops);
  sim.addSystem(scavenge);
  sim.addSystem(new SurvivalSystem());
  sim.addSystem(clock);
  sim.addSystem(new DiscoverySystem());
  sim.addSystem(new PersistenceSystem(sim));
  return { sim, clock, hostiles, combat, drops, scavenge };
}
