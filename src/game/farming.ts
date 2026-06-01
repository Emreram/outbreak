// Farming (Feature 5): crop definitions + the pure plot lifecycle (till → plant →
// water → grow → harvest). State lives on GameState.farmPlots (persisted); growth
// advances on the time-of-day clock. The scene owns rendering + interaction.

import type { FarmPlot, GameState } from "../shared/contracts";

export interface CropDef {
  id: string;
  name: string;
  seed: string; // seed item name
  produce: string; // harvested food item name
  growthSegments: number; // time-of-day segments to ripen (unwatered)
  yieldQty: number; // produce per harvest
  seedReturn: number; // seeds returned on harvest
  color: number; // ripe tint (render)
}

export const CROPS: Record<string, CropDef> = {
  wheat: { id: "wheat", name: "Wheat", seed: "Wheat Seeds", produce: "Wheat", growthSegments: 8, yieldQty: 3, seedReturn: 1, color: 0xe6c34a },
  corn: { id: "corn", name: "Corn", seed: "Corn Seeds", produce: "Corn", growthSegments: 10, yieldQty: 2, seedReturn: 1, color: 0xf2d43f },
  tomato: { id: "tomato", name: "Tomato", seed: "Tomato Seeds", produce: "Tomato", growthSegments: 9, yieldQty: 3, seedReturn: 1, color: 0xe2462f },
  potato: { id: "potato", name: "Potato", seed: "Potato Seeds", produce: "Potato", growthSegments: 7, yieldQty: 4, seedReturn: 1, color: 0xb98a4a },
  carrot: { id: "carrot", name: "Carrot", seed: "Carrot Seeds", produce: "Carrot", growthSegments: 7, yieldQty: 3, seedReturn: 1, color: 0xe07a2f },
};

/** Seed item name → crop id (for planting). */
export const SEED_TO_CROP: Record<string, string> = Object.fromEntries(
  Object.values(CROPS).map((c) => [c.seed, c.id]),
);

export function plotAt(s: GameState, tx: number, ty: number): FarmPlot | undefined {
  return s.farmPlots?.find((p) => p.tx === tx && p.ty === ty);
}

/** Create (or return) a tilled, empty plot at a tile. */
export function tillPlot(s: GameState, tx: number, ty: number): FarmPlot {
  s.farmPlots = s.farmPlots ?? [];
  let p = plotAt(s, tx, ty);
  if (!p) {
    p = { tx, ty, growth: 0, watered: false };
    s.farmPlots.push(p);
  }
  return p;
}

/** Render stage: 0 tilled · 1 sprout · 2 growing · 3 ripe. */
export function plotStage(p: FarmPlot): number {
  if (!p.crop) return 0;
  if (p.growth >= 1) return 3;
  if (p.growth >= 0.5) return 2;
  return 1;
}

/** Advance every planted plot one time-of-day segment; watered grows ~2× then dries. */
export function growPlots(s: GameState): void {
  for (const p of s.farmPlots ?? []) {
    if (!p.crop || p.growth >= 1) continue;
    const def = CROPS[p.crop];
    if (!def) continue;
    p.growth += (1 / def.growthSegments) * (p.watered ? 2 : 1);
    if (p.growth >= 1 - 1e-9) p.growth = 1; // snap (avoid float drift leaving it at 0.999…)
    p.watered = false;
  }
}
