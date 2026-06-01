// Tunable world/gameplay constants.
// CLAUDE.md §10: "Map size is a tunable constant — start modest, scale up."

export const TILE_SIZE = 32; // pixels per tile

export const PLAYER_SPEED = 190; // px/sec walking speed

// --- Streamed open world (huge, finite, seamless) --------------------------
// The world is a fixed grid of CHUNK_TILES² chunks, generated deterministically
// from (seed, chunkX, chunkY) and streamed in/out around the player. It is
// bounded (a real edge) but enormous: WORLD_CHUNKS_* × CHUNK_TILES tiles.
export const CHUNK_TILES = 48; // tiles per chunk edge
export const WORLD_CHUNKS_X = 40; // world is this many chunks wide …
export const WORLD_CHUNKS_Y = 40; // … and tall
export const CHUNK_LOAD_RADIUS = 2; // keep a (2r+1)² ring of chunks resident
export const SPAWN_CHUNK = { x: Math.floor(WORLD_CHUNKS_X / 2), y: Math.floor(WORLD_CHUNKS_Y / 2) };

// Derived world size, in tiles and pixels (the finite extent / bounds).
export const WORLD_TILES_X = WORLD_CHUNKS_X * CHUNK_TILES;
export const WORLD_TILES_Y = WORLD_CHUNKS_Y * CHUNK_TILES;
export const WORLD_WIDTH_PX = WORLD_TILES_X * TILE_SIZE;
export const WORLD_HEIGHT_PX = WORLD_TILES_Y * TILE_SIZE;

// Legacy single-map dimensions (kept for back-compat references); the live world
// is now chunk-based and uses the constants above.
export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 80;
