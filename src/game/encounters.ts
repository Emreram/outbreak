// Encounter trigger policy (CLAUDE.md §13 Phase 5): WHEN the game pauses for a GM
// call, and the world flags that make triggers fire once. The scene owns the HOW;
// this module owns the WHEN, kept tiny and pure.

/** Flag set the first time a building is entered, so it triggers only once. */
export function buildingEnteredFlag(gid: string): string {
  return `entered_building_${gid}`;
}

/** Milliseconds until the next ambient threat (a wandering spawn near the player). */
export function nextAmbientDelayMs(): number {
  return 26000 + Math.random() * 30000; // 26–56s of exploration
}
