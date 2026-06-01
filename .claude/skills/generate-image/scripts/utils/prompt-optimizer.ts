// Prompt optimizer for OUTBREAK 2D game assets. Unlike the original skill (which
// targeted isometric/3D-conversion assets), OUTBREAK is a TOP-DOWN 2D survival
// game, so we frame prompts top-down, centered, on a plain background that the
// post-processor can key out to transparency, in a cohesive gritty art style.

export type AssetType =
  | "vehicle" | "building" | "character" | "animal" | "prop" | "obstacle"
  | "tile" | "item" | "general";

const TYPE_HINTS: Record<string, string> = {
  vehicle: "seen from directly overhead, roof and hood visible, four wheels at the corners",
  building: "rooftop view from directly above, clear rectangular footprint, distinct roof details",
  character: "seen from directly above, head and shoulders centered, facing upward",
  animal: "seen from directly above, full body centered, facing upward",
  prop: "recognizable silhouette, centered, single object",
  obstacle: "simple readable shape, centered",
  tile: "seamless tileable ground texture, flat, no objects, no perspective",
  item: "single object centered, clean inventory-icon framing",
  general: "centered, clear readable silhouette",
};

const STYLE =
  "2D video game sprite, top-down orthographic view, plain flat neutral grey background, " +
  "no drop shadow, crisp clean edges, cohesive gritty post-apocalyptic zombie-survival art style, " +
  "high detail, 1:1 aspect ratio";

/** Build the final image prompt from a short description + asset type. */
export function optimizePrompt(description: string, assetType: string = "general"): string {
  const hint = TYPE_HINTS[assetType] ?? TYPE_HINTS.general;
  return `${description}, ${hint}, ${STYLE}`;
}
