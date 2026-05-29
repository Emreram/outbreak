import Phaser from "phaser";
import { TILE_SIZE } from "../game/constants";
import { ASSET_PATHS, generatePlayerTexture, generateTileTexture } from "../engine/textures";
import { loadGame, saveGame } from "../game/GameState";
import { newRunState } from "../ai/gameMaster";

// Boot: load CC0 art (fall back to placeholders), then either resume a saved run
// or generate a fresh run (new seed + AI scenario) and hand off to the world.
// ?seed=<value> forces a fresh, reproducible run (CLAUDE.md §10, §8.6).

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    for (const [key, path] of Object.entries(ASSET_PATHS)) {
      this.load.image(key, path);
    }
  }

  async create(): Promise<void> {
    generateTileTexture(this, TILE_SIZE);
    generatePlayerTexture(this, TILE_SIZE);

    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#9fb3c8",
      })
      .setOrigin(0.5);

    const urlSeed = new URLSearchParams(window.location.search).get("seed");
    const existing = loadGame();

    if (urlSeed !== null) {
      const { state, intro } = await newRunState(urlSeed);
      saveGame(state);
      this.registry.set("seed", state.seed);
      this.registry.set("intro", intro);
    } else if (existing) {
      this.registry.set("seed", existing.seed); // resume the saved run
    } else {
      const { state, intro } = await newRunState();
      saveGame(state);
      this.registry.set("seed", state.seed);
      this.registry.set("intro", intro);
    }
    this.registry.set("seedFromUrl", false);

    loading.destroy();
    this.scene.start("WorldScene");
  }
}
