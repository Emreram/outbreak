// Leaf registry (Animation Pass): which runtime texture keys were loaded from
// GENERATED PNGs this boot. Filled by assets.ts (loadGeneratedAssets); consulted
// by the procedural generators so a generated single-frame sprite is never
// paired with a procedural _b stride frame (style flicker) — generated art only
// cycles against generated art, otherwise the gait motion layer carries it.
// Zero imports so petSprites/propSprites/assets can all use it without cycles.

export const generatedTextureKeys = new Set<string>();

export function isGeneratedTexture(key: string): boolean {
  return generatedTextureKeys.has(key);
}
