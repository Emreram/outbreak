import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { GameOverScene } from "./scenes/GameOverScene";

// Phaser bootstrap (CLAUDE.md §6). Arcade physics for movement/collision,
// FIT scaling so the canvas fills the window, pixel-art friendly rendering.

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0d0e",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: "100%",
    height: "100%",
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [BootScene, WorldScene, GameOverScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
