// Hold-to-search scavenging (extracted from WorldScene U1): nearest searchable
// prop or corpse, the playsDead lunge (deterministic per seed+gid+day), the
// hold channel (1.2–1.8s by kind, broken by moving/damage/release), thin loot
// rolls with the empty chance + themed bonus + readables, SEARCH_NOISE while
// rummaging, crafting XP, and the opening-arc objective ping.

import {
  CORPSE_BODY,
  SEARCHABLE_PROPS,
  SEARCH_NOISE,
  markSearched,
  playsDead,
  type SearchableDef,
} from "../../game/scavenge";
import { liveRng } from "../../game/rng";
import { lootLuck } from "../../game/perks";
import { rollLoot } from "../../game/items/lootTables";
import { rollReadable } from "../../game/notes";
import { rollZombie } from "../../game/enemies/spawnTable";
import { notifyObjective } from "../../game/objectives";
import type { SearchableRec } from "../world";
import type { Sim, SimSystem } from "../Sim";
import type { CorpseRec, HostilesSystem } from "./hostiles";
import type { DropsSystem } from "./drops";

export interface SearchTarget {
  kind: string;
  x: number;
  y: number;
  prop?: SearchableRec;
  corpse?: CorpseRec;
}

export interface SearchChannel {
  target: SearchTarget;
  def: SearchableDef;
  done: number; // ms held
}

export class ScavengeSystem implements SimSystem {
  readonly id = "scavenge";
  search: SearchChannel | null = null;

  nearestSearchable(sim: Sim, maxDist: number): SearchTarget | null {
    const px = sim.player.x;
    const py = sim.player.y;
    let best: SearchTarget | null = null;
    let bestD = maxDist;
    for (const s of sim.world.activeSearchables()) {
      if (s.searched) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bestD) {
        bestD = d;
        best = { kind: s.kind, x: s.x, y: s.y, prop: s };
      }
    }
    const hostiles = sim.getSystem<HostilesSystem>("hostiles");
    for (const c of hostiles?.corpses ?? []) {
      if (c.searched) continue;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < bestD) {
        bestD = d;
        best = { kind: "body", x: c.x, y: c.y, corpse: c };
      }
    }
    return best;
  }

  private searchDefFor(t: SearchTarget): SearchableDef {
    return t.corpse ? CORPSE_BODY : (SEARCHABLE_PROPS[t.kind] ?? CORPSE_BODY);
  }

  startSearch(sim: Sim, t: SearchTarget): void {
    if (this.search || sim.dead) return;
    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    // A "corpse" prop might lunge — deterministic per seed+prop, so no save-scum.
    if (t.prop && (t.kind === "corpse" || t.kind === "corpse_soldier") && playsDead(sim.state.seed, t.prop.gid, hostiles.effDay(sim))) {
      markSearched(sim.state, t.prop.gid);
      t.prop.searched = true;
      hostiles.spawnEnemy(sim, rollZombie("zombie", liveRng, hostiles.effDay(sim), sim.world.biomeAtPx(t.x, t.y)), t.x, t.y);
      sim.events.emit("corpseLunged", { x: t.x, y: t.y });
      sim.events.emit("banner", { text: "It wasn't dead!" });
      sim.events.emit("sound", { id: "hurt" });
      sim.events.emit("impulse", { kind: "shake", amount: 0.18 });
      return;
    }
    this.search = { target: t, def: this.searchDefFor(t), done: 0 };
    sim.searchNoise = SEARCH_NOISE;
    sim.events.emit("sound", { id: "rustle" });
    sim.events.emit("searchStarted", { x: t.x, y: t.y });
  }

  /** Channel progress 0..1 for the view's progress ring. */
  progress(): number {
    return this.search ? Math.min(1, this.search.done / this.search.def.ms) : 0;
  }

  tick(sim: Sim, dt: number): void {
    const s = this.search;
    if (!s) return;
    const holding = sim.input.interact;
    const targetGone = s.target.prop ? s.target.prop.searched : s.target.corpse ? s.target.corpse.searched : true;
    if (!holding || sim.player.moving || sim.dead || targetGone) {
      this.cancelSearch(sim);
      return;
    }
    s.done += dt * 1000;
    if (s.done >= s.def.ms) this.completeSearch(sim);
  }

  cancelSearch(sim: Sim): void {
    if (!this.search) return;
    this.search = null;
    sim.searchNoise = 0;
    sim.events.emit("searchCancelled", {});
  }

  private completeSearch(sim: Sim): void {
    const s = this.search;
    if (!s) return;
    this.cancelSearch(sim);
    const t = s.target;
    if (t.prop) {
      markSearched(sim.state, t.prop.gid);
      t.prop.searched = true;
    }
    if (t.corpse) t.corpse.searched = true;
    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    const drops = sim.getSystem<DropsSystem>("drops")!;
    // Yields are THIN by design — chests stay the real prize (scavenge.ts).
    const empty = liveRng.chance(s.def.emptyChance);
    if (empty) {
      sim.events.emit("floatText", { x: t.x, y: t.y - 6, text: "nothing useful", color: "#9fb3c8" });
      sim.events.emit("sound", { id: "ui" });
    } else {
      const bias = lootLuck(sim.state) + sim.world.lootBias(t.x, t.y);
      for (const stack of rollLoot(s.def.source, liveRng, 1, bias)) drops.spawnDrop(sim, t.x, t.y, stack.item, stack.qty);
      const b = s.def.bonus;
      if (b && liveRng.chance(b.p)) drops.spawnDrop(sim, t.x, t.y, b.item, liveRng.int(b.min, b.max));
      hostiles.grantXp(sim, "crafting", 1); // resourcefulness
      sim.events.emit("sound", { id: "pickup" });
    }
    // Drawers and shelves sometimes hold someone's writing (U2 readables).
    if (s.def.source === "scav_domestic" && liveRng.chance(0.04)) drops.spawnDrop(sim, t.x, t.y, rollReadable(liveRng), 1);
    const r = notifyObjective(sim.state, { kind: "container_searched" });
    if (r.toast) sim.events.emit("banner", { text: r.toast });
    sim.events.emit("searchDone", { x: t.x, y: t.y, empty, gid: t.prop?.gid });
  }
}
