// Map discovery (extracted from WorldScene.discoverAround): entering a new
// chunk reveals the 3×3 window on the fog-of-war map, pins the chunk's
// landmarks as known locations, and feeds the opening-arc "reach the
// safehouse" objective. (Set-piece ambushes, stash streaming, camp rosters
// and building overlays join at M4 with their systems.)

import { WORLD_CHUNKS_X, WORLD_CHUNKS_Y, CHUNK_TILES, TILE_SIZE } from "../../game/constants";
import { notifyObjective } from "../../game/objectives";
import type { Sim, SimSystem } from "../Sim";

const CHUNK_PX = CHUNK_TILES * TILE_SIZE;

export class DiscoverySystem implements SimSystem {
  readonly id = "discovery";
  private lastCx = NaN;
  private lastCy = NaN;

  tick(sim: Sim, _dt: number): void {
    const cx = Math.floor(sim.player.x / CHUNK_PX);
    const cy = Math.floor(sim.player.y / CHUNK_PX);
    if (cx === this.lastCx && cy === this.lastCy) return;
    this.lastCx = cx;
    this.lastCy = cy;
    const s = sim.state;
    s.discovered = s.discovered ?? [];
    const set = new Set(s.discovered);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_CHUNKS_X || ny >= WORLD_CHUNKS_Y) continue;
        const k = `${nx},${ny}`;
        if (!set.has(k)) {
          set.add(k);
          s.discovered.push(k);
        }
      }
    }
    for (const lm of sim.world.landmarksAt(cx, cy)) {
      if (!s.knownLocations.some((l) => l.name === lm.label && l.x === lm.x && l.y === lm.y)) {
        s.knownLocations.push({ name: lm.label, type: lm.kind, x: lm.x, y: lm.y });
        sim.events.emit("banner", { text: `Discovered: ${lm.label}` });
      }
    }
    const r = notifyObjective(s, { kind: "chunk_entered", cx, cy });
    if (r.toast) sim.events.emit("banner", { text: r.toast });
  }
}
