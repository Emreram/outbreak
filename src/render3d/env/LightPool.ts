// LightPool (graphics plan WS9 / master plan §3.8): a fixed pool of
// PointLights (created once, parked at intensity 0 so shader light-counts
// stay stable — no recompiles) assigned per frame to the nearest registered
// sources: lava fields, night-lit doorways/windows, campfires. Warm 2600K
// fire colours against the cool night ambient is the §6.5 "saturation into
// light" carrier. Intensity crossfades ~250ms on reassignment; fire sources
// flicker.

import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { groundHeightAt, simToWorld } from "../space";

export interface LightSource {
  id: string;
  x: number; // sim px
  y: number;
  h: number; // meters above ground
  color: number;
  intensity: number;
  range: number;
  /** 0 = steady, 1 = full fire flicker. */
  flicker: number;
  /** Only lit while the night glow is up (windows/doorways). */
  nightOnly?: boolean;
}

interface Slot {
  light: PointLight;
  sourceId: string | null;
  current: number; // smoothed intensity
}

export class LightPool {
  private readonly sources = new Map<string, LightSource>();
  private readonly slots: Slot[] = [];
  private readonly tmp = { x: 0, y: 0, z: 0 };

  constructor(scene: Scene, poolSize: number) {
    for (let i = 0; i < poolSize; i++) {
      const light = new PointLight(`pool${i}`, new Vector3(0, -50, 0), scene);
      light.intensity = 0;
      light.range = 12;
      this.slots.push({ light, sourceId: null, current: 0 });
    }
  }

  register(s: LightSource): void {
    this.sources.set(s.id, s);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  update(px: number, py: number, nightGlow: number, timeS: number, dtMs: number): void {
    if (this.slots.length === 0) return;
    // nearest-N live sources
    const live: { s: LightSource; d: number }[] = [];
    for (const s of this.sources.values()) {
      if (s.nightOnly && nightGlow < 0.3) continue;
      const dx = s.x - px;
      const dy = s.y - py;
      live.push({ s, d: dx * dx + dy * dy });
    }
    live.sort((a, b) => a.d - b.d);
    const want = live.slice(0, this.slots.length).map((e) => e.s);

    // keep already-assigned slots when their source is still wanted
    const wantIds = new Set(want.map((s) => s.id));
    const unassigned: LightSource[] = want.filter((s) => !this.slots.some((sl) => sl.sourceId === s.id));
    for (const slot of this.slots) {
      if (slot.sourceId && !wantIds.has(slot.sourceId)) slot.sourceId = null;
      if (!slot.sourceId && unassigned.length > 0) slot.sourceId = unassigned.shift()!.id;
    }

    const k = Math.min(1, dtMs / 250); // crossfade
    for (const slot of this.slots) {
      const src = slot.sourceId ? this.sources.get(slot.sourceId) : undefined;
      let target = 0;
      if (src) {
        const flick = src.flicker > 0 ? 1 - src.flicker * 0.14 * (0.5 + 0.5 * Math.sin(timeS * 11 + src.x * 0.13) * Math.sin(timeS * 7.3 + src.y * 0.11)) : 1;
        target = src.intensity * flick * (src.nightOnly ? Math.min(1, nightGlow * 1.6) : 1);
        simToWorld(src.x, src.y, src.h + groundHeightAt(src.x, src.y), this.tmp);
        slot.light.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
        slot.light.diffuse = Color3.FromHexString(`#${(src.color & 0xffffff).toString(16).padStart(6, "0")}`);
        slot.light.range = src.range;
      }
      slot.current += (target - slot.current) * k;
      slot.light.intensity = slot.current < 0.01 ? 0 : slot.current;
    }
  }
}
