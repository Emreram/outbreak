// Landmark set-pieces — the curated points of interest the chunk generator
// sprinkles per biome (defined as LandmarkRule[] in biomes.ts and placed in
// generateChunk). This module maps each landmark KIND to how it reads on the
// map: a glyph + colour for its label and an optional anchor prop sprite
// (reused from propSprites.ts). Story-agnostic visual metadata.

export interface LandmarkStyle {
  glyph: string; // marker symbol shown before the label
  color: string; // label colour (css)
  prop?: string; // optional anchor prop sprite kind (see propSprites.ts)
}

const STYLES: Record<string, LandmarkStyle> = {
  crashed_helicopter: { glyph: "✶", color: "#ffd27f", prop: "wreck" },
  derailed_train: { glyph: "▦", color: "#cdd9e5", prop: "wreck" },
  blocked_overpass: { glyph: "≡", color: "#cdd9e5", prop: "wreck" },
  roadblock: { glyph: "⛒", color: "#ffb36b", prop: "car" },
  gas_truck: { glyph: "⚠", color: "#ffb36b", prop: "wreck" },
  horde_nest: { glyph: "☣", color: "#ff7a7a", prop: "corpse" },
  survivor_camp: { glyph: "⛺", color: "#9be29b", prop: "tent" },
  campsite: { glyph: "⛺", color: "#9be29b", prop: "tent" },
  quarantine_tents: { glyph: "✚", color: "#e8eef4", prop: "tent" },
  supply_cache: { glyph: "✦", color: "#ffe08a", prop: "crate" },
  school_bus: { glyph: "▣", color: "#ffe08a", prop: "wreck" },
  crane: { glyph: "⌖", color: "#ffb36b", prop: "wreck" },
  ranger_lookout: { glyph: "▲", color: "#bfe3a8", prop: "tent" },
  hunters_cabin: { glyph: "⌂", color: "#bfe3a8", prop: "crate" },
  grain_silos: { glyph: "◍", color: "#e6d28a", prop: "hay" },
  radio_tower: { glyph: "✸", color: "#9be7ff", prop: "wreck" },
  fishing_dock: { glyph: "⚓", color: "#8fc7e6", prop: "crate" },
  sunken_shack: { glyph: "⌂", color: "#9fb38a", prop: "wreck" },
  lighthouse: { glyph: "✦", color: "#ffe08a", prop: "boulder" },
  beached_boat: { glyph: "⛵", color: "#e6d8a8", prop: "wreck" },
  mining_rig: { glyph: "⛏", color: "#cdb89a", prop: "boulder" },
  bandstand: { glyph: "♪", color: "#bfe3a8", prop: "bench" },
  lava_vent: { glyph: "▲", color: "#ff7a2a", prop: "boulder" },
};

const DEFAULT_STYLE: LandmarkStyle = { glyph: "⚑", color: "#ffe6a8", prop: "crate" };

export function landmarkStyle(kind: string): LandmarkStyle {
  return STYLES[kind] ?? DEFAULT_STYLE;
}

/** True if a landmark kind has an explicit (curated) style. */
export function hasLandmarkStyle(kind: string): boolean {
  return kind in STYLES;
}
