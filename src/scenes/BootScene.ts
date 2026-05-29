import Phaser from "phaser";
import { TILE_SIZE } from "../game/constants";
import { generatePlayerTexture, generateTileTexture } from "../engine/textures";
import { randomSeed } from "../game/rng";

// Boot: generate placeholder textures, decide the run seed, then enter the world.
// A seed can be pinned via ?seed=<value> in the URL for reproducible debugging
// (CLAUDE.md §10 "same seed -> same map").

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    generateTileTexture(this, TILE_SIZE);
    generatePlayerTexture(this, TILE_SIZE);

    if (!this.registry.has("seed")) {
      const fromUrl = new URLSearchParams(window.location.search).get("seed");
      this.registry.set("seed", fromUrl ?? randomSeed());
    }

    this.scene.start("WorldScene");
  }
}
