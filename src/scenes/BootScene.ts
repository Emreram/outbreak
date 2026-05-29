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

    if (!this.registry.has("seed")) {
      const fromUrl = new URLSearchParams(window.location.search).get("seed");
      this.registry.set("seed", fromUrl ?? randomSeed());
    }

    this.scene.start("WorldScene");
  }
}
