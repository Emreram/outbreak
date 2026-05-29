import Phaser from "phaser";
import { loadGame, saveGame } from "../game/GameState";
import { newRunState } from "../ai/gameMaster";
import { sfx } from "../engine/audio";

// Title screen (CLAUDE.md §13 Phase 7). New run = new seed + new AI scenario;
// Continue resumes the saved run.

export class MainMenuScene extends Phaser.Scene {
  private busy = false;
  private newBtn!: Phaser.GameObjects.Text;

  constructor() {
    super("MainMenuScene");
  }

  create(): void {
    this.busy = false;
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;
    this.cameras.main.setBackgroundColor("#0b0d0e");
    this.add.rectangle(0, 0, w, h, 0x0b0d0e, 1).setOrigin(0).setScrollFactor(0);

    this.add
      .text(cx, h * 0.24, "OUTBREAK", {
        fontFamily: "monospace",
        fontSize: "56px",
        color: "#e8eef4",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(cx, h * 0.35, "top-down survival horror · an AI Game Master\ndecides what happens — every run is different", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#7fd3ff",
        align: "center",
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    const existing = loadGame();
    let y = h * 0.56;
    if (existing) {
      this.button(cx, y, "Continue run", () => this.continueRun(existing.seed));
      y += 66;
    }
    this.newBtn = this.button(cx, y, "New run", () => void this.newRun());

    this.input.keyboard?.on("keydown-ENTER", () => void this.newRun());

    this.add
      .text(cx, h * 0.9, "WASD/arrows move · E act · SPACE/F attack · Shift sprint · R new run", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#7f93a8",
        align: "center",
      })
      .setOrigin(0.5);
  }

  private button(x: number, y: number, label: string, fn: () => void): Phaser.GameObjects.Text {
    const b = this.add
      .text(x, y, `[ ${label} ]`, {
        fontFamily: "monospace",
        fontSize: "22px",
        color: "#7fd3ff",
        backgroundColor: "#12202c",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    b.on("pointerover", () => b.setColor("#bfe9ff"));
    b.on("pointerout", () => b.setColor("#7fd3ff"));
    b.on("pointerup", () => {
      sfx.ui();
      fn();
    });
    return b;
  }

  private continueRun(seed: string): void {
    this.registry.set("seed", seed);
    this.registry.set("seedFromUrl", false);
    this.registry.set("intro", undefined);
    this.scene.start("WorldScene");
  }

  private async newRun(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.newBtn.setText("[ Generating world… ]");
    const { state, intro } = await newRunState();
    saveGame(state);
    this.registry.set("seed", state.seed);
    this.registry.set("seedFromUrl", false);
    this.registry.set("intro", intro);
    this.scene.start("WorldScene");
  }
}
