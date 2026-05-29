import Phaser from "phaser";
import { TILE_SIZE } from "../game/constants";
import {
  ASSET_PATHS,
  generatePlayerTexture,
  generateTileTexture,
} from "../engine/textures";
import { randomSeed } from "../game/rng";

// Boot: load CC0 art (Phase 2), fall back to generated placeholders for anything
// that failed to load, decide the run seed, then enter the world. A seed can be
// pinned via ?seed=<value> for reproducible debugging (CLAUDE.md §10).

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    for (const [key, path] of Object.entries(ASSET_PATHS)) {
      this.load.image(key, path);
    }
  }

  create(): void {
    // Placeholder fallback: these no-op if the CC0 texture already loaded.
    generateTileTexture(this, TILE_SIZE);
    generatePlayerTexture(this, TILE_SIZE);

    const urlSeed = new URLSearchParams(window.location.search).get("seed");
    if (!this.registry.has("seed")) {
      this.registry.set("seed", urlSeed ?? randomSeed());
    }
    // A ?seed= in the URL pins a fresh, reproducible run (ignores any save).
    this.registry.set("seedFromUrl", urlSeed !== null);

    this.scene.start("WorldScene");
  }
}
