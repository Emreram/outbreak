// Tunable world/gameplay constants.
// CLAUDE.md §10: "Map size is a tunable constant — start modest, scale up."

export const TILE_SIZE = 32; // pixels per tile
export const MAP_WIDTH = 80; // tiles wide
export const MAP_HEIGHT = 80; // tiles tall

export const PLAYER_SPEED = 190; // px/sec walking speed

// Derived world size in pixels.
export const WORLD_WIDTH_PX = MAP_WIDTH * TILE_SIZE;
export const WORLD_HEIGHT_PX = MAP_HEIGHT * TILE_SIZE;
