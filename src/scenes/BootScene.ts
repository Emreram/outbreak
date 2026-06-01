import Phaser from "phaser";
import { TILE_SIZE } from "../game/constants";
import { ASSET_PATHS, generatePlayerTexture, generateTileTexture } from "../engine/textures";
import { generatePropTextures } from "../engine/propSprites";
import { generateFxTextures } from "../engine/fx";
import { generateAllIcons, generateLootWorldTextures } from "../engine/icons";
import { generateZombieTextures } from "../engine/zombieSprites";
import { saveGame } from "../game/GameState";
import { newRunState } from "../ai/gameMaster";

// Boot: load CC0 art (fall back to placeholders), then go to the main menu.
// ?seed=<value> skips the menu and starts a fresh, reproducible run (CLAUDE.md §10).

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
    generatePropTextures(this);
    generateFxTextures(this);
    generateAllIcons(this);
    generateLootWorldTextures(this);
    generateZombieTextures(this);

    const urlSeed = new URLSearchParams(window.location.search).get("seed");
    if (urlSeed !== null) {
      const loading = this.add
        .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#9fb3c8",
        })
        .setOrigin(0.5);
      const { state, intro } = await newRunState(urlSeed);
      saveGame(state);
      this.registry.set("seed", state.seed);
      this.registry.set("intro", intro);
      this.registry.set("seedFromUrl", false);
      loading.destroy();
      this.scene.start("WorldScene");
      return;
    }

    this.scene.start("MainMenuScene");
  }
}
