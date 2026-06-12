// Containers (extracted from WorldScene.openChest/tryUnlock): locked chests
// need Bolt Cutters / Crowbar / Lockpick (only the pick is consumed), loot
// rolls 1+tier from themed tables (gun_cabinet→police, med_cabinet→pharmacy,
// fridge→grocery, toolbox→hardware) with luck + distance + locked(+0.4) +
// pried-building biases, set-piece chests carry notes 35%, top tiers can hold
// pet eggs, and tier-2+/locked stock earns the reveal ceremony (items banked
// FIRST — presentation can never eat loot).

import { hasItem, removeItem, addItem } from "../../game/inventory";
import { lootLuck } from "../../game/perks";
import { rollLoot } from "../../game/items/lootTables";
import { rollReadable } from "../../game/notes";
import { liveRng } from "../../game/rng";
import { chestEggChance, chestEggName, deservesCeremony } from "../../game/openables";
import { priedLootBonus } from "../../game/world/buildingStates";
import { notifyObjective } from "../../game/objectives";
import { TILE_SIZE } from "../../game/constants";
import type { ChestRec } from "../world";
import type { Sim, SimSystem } from "../Sim";
import type { DropsSystem } from "./drops";

export interface ChestOpenedEvent {
  gid: string;
  x: number;
  y: number;
  kind: string;
  tier: number;
  /** Ceremony path: items already banked; the view runs the reveal. */
  ceremony: boolean;
  rolls: { item: string; qty: number }[];
}

export class ChestsSystem implements SimSystem {
  readonly id = "chests";
  /** Last ceremony payload for the view (also evented). */
  onOpened: ((e: ChestOpenedEvent) => void) | null = null;

  tick(): void {
    // event-driven; nothing per-tick
  }

  nearestChest(sim: Sim, maxDist: number): ChestRec | null {
    let best: ChestRec | null = null;
    let bestD = maxDist;
    for (const c of sim.world.activeChests()) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - sim.player.x, c.y - sim.player.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private tryUnlock(sim: Sim, chest: ChestRec): boolean {
    const tool = ["Bolt Cutters", "Crowbar", "Lockpick"].find((t) => hasItem(sim.state, t));
    if (!tool) {
      sim.events.emit("banner", { text: "Locked — need a Crowbar, Bolt Cutters, or Lockpick" });
      sim.events.emit("sound", { id: "ui" });
      return false;
    }
    if (tool === "Lockpick") removeItem(sim.state, "Lockpick", 1);
    sim.events.emit("floatText", {
      x: chest.x,
      y: chest.y - 10,
      text: tool === "Lockpick" ? "Picked the lock" : `Forced with ${tool}`,
      color: "#9ef0a0",
    });
    sim.events.emit("sound", { id: "unlock" });
    return true;
  }

  /** Specialised containers pull from themed loot; everything else by tier. */
  private containerLootSource(kind: string, tier: number): string {
    switch (kind) {
      case "gun_cabinet":
        return "police_station";
      case "med_cabinet":
        return "pharmacy";
      case "fridge":
        return "grocery";
      case "toolbox":
        return "hardware_store";
      default:
        return `chest:${Math.max(0, Math.min(4, tier))}`;
    }
  }

  openChest(sim: Sim, chest: ChestRec): void {
    if (chest.opened) return;
    if (chest.locked && !this.tryUnlock(sim, chest)) return;
    chest.opened = true;
    if (!sim.state.worldFlags.includes(`chest_${chest.gid}`)) sim.state.worldFlags.push(`chest_${chest.gid}`);
    sim.events.emit("sound", { id: "pickup" });

    const host = sim.world.buildingAt(Math.floor(chest.x / TILE_SIZE), Math.floor(chest.y / TILE_SIZE));
    const bias =
      lootLuck(sim.state) +
      sim.world.lootBias(chest.x, chest.y) +
      (chest.locked ? 0.4 : 0) +
      priedLootBonus(sim.state, host?.gid);
    const rolls = rollLoot(this.containerLootSource(chest.kind, chest.tier), liveRng, 1 + chest.tier, bias);
    if (chest.gid.includes("_sc") && liveRng.chance(0.35)) rolls.push({ item: rollReadable(liveRng), qty: 1 });
    if (liveRng.chance(chestEggChance(chest.tier))) rolls.push({ item: chestEggName(chest.tier, liveRng.next()), qty: 1 });

    const ceremony = deservesCeremony(chest.tier, chest.locked);
    if (ceremony) {
      for (const s of rolls) addItem(sim.state, s.item, s.qty); // bank FIRST
    } else {
      sim.events.emit("floatText", { x: chest.x, y: chest.y, text: `${chest.kind.replace(/_/g, " ")} looted`, color: "#ffd23f" });
      const drops = sim.getSystem<DropsSystem>("drops")!;
      for (const s of rolls) drops.spawnDrop(sim, chest.x, chest.y, s.item, s.qty);
    }
    const r = notifyObjective(sim.state, { kind: "container_searched" });
    if (r.toast) sim.events.emit("banner", { text: r.toast });
    const payload: ChestOpenedEvent = { gid: chest.gid, x: chest.x, y: chest.y, kind: chest.kind, tier: chest.tier, ceremony, rolls };
    this.onOpened?.(payload);
    sim.events.emit("searchDone", { x: chest.x, y: chest.y, empty: false, gid: chest.gid }); // prop pools refresh
  }
}
