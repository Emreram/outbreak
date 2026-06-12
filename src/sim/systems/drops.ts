// Ground loot (extracted from WorldScene: spawnDrop/magnetDrops/pickupDrop):
// drop records with the 60-cap and 45s TTL, the 44px magnet that vacuums loot
// into the bag after a 160ms flight, rapid-pickup combos (1100ms window), the
// Scrapper ammo multiplier, and auto-equip with the opening-arc objective ping.

import { addItem, autoEquip } from "../../game/inventory";
import { defOf } from "../../game/items/catalog";
import { ammoMult } from "../../game/perks";
import { notifyObjective } from "../../game/objectives";
import type { Sim, SimSystem } from "../Sim";

export interface DropRec {
  id: number;
  item: string;
  qty: number;
  x: number;
  y: number;
  diesAt: number;
  /** Set when the magnet caught it; it lands in the bag 160ms later. */
  magnetAt: number | null;
}

const DROP_CAP = 60;
const TTL_MS = 45000;
const MAGNET_R = 44;
const MAGNET_FLIGHT_MS = 160;
const COMBO_WINDOW_MS = 1100;

let seq = 1;

export class DropsSystem implements SimSystem {
  readonly id = "drops";
  readonly drops: DropRec[] = [];
  private pickupCombo = 0;
  private lastPickupAt = -99999;

  spawnDrop(sim: Sim, x: number, y: number, item: string, qty: number): void {
    if (this.drops.length > DROP_CAP) return; // perf cap
    const def = defOf(item);
    if (def.kind === "ammo" || def.kind === "material") qty = Math.round(qty * ammoMult(sim.state)); // Scrapper perk
    const rec: DropRec = {
      id: seq++,
      item,
      qty,
      x: x + (Math.random() - 0.5) * 16,
      y: y + (Math.random() - 0.5) * 16,
      diesAt: sim.now + TTL_MS,
      magnetAt: null,
    };
    this.drops.push(rec);
    sim.events.emit("dropSpawned", { id: rec.id });
  }

  tick(sim: Sim, _dt: number): void {
    if (this.drops.length === 0) return;
    const px = sim.player.x;
    const py = sim.player.y;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (sim.now >= d.diesAt) {
        this.drops.splice(i, 1);
        sim.events.emit("dropRemoved", { id: d.id, pickedUp: false });
        continue;
      }
      if (d.magnetAt === null) {
        if (!sim.airborne) {
          const dx = d.x - px;
          const dy = d.y - py;
          if (dx * dx + dy * dy <= MAGNET_R * MAGNET_R) d.magnetAt = sim.now;
        }
      } else if (sim.now - d.magnetAt >= MAGNET_FLIGHT_MS) {
        this.drops.splice(i, 1);
        this.pickup(sim, d);
      }
    }
  }

  private pickup(sim: Sim, d: DropRec): void {
    addItem(sim.state, d.item, d.qty);
    const equipped = autoEquip(sim.state, d.item);
    this.pickupCombo = sim.now - this.lastPickupAt < COMBO_WINDOW_MS ? this.pickupCombo + 1 : 1;
    this.lastPickupAt = sim.now;
    sim.events.emit("dropRemoved", { id: d.id, pickedUp: true });
    sim.events.emit("pickup", { item: d.item, qty: d.qty, combo: this.pickupCombo, equipped });
    if (equipped) {
      sim.events.emit("banner", { text: `Equipped ${d.item}` });
      const r = notifyObjective(sim.state, { kind: "weapon_equipped" });
      if (r.toast) sim.events.emit("banner", { text: r.toast });
    }
  }
}
