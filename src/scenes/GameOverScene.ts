import Phaser from "phaser";

// Death summary -> back to the menu to start a brand-new, noticeably different run
// (new name + new map seed + a freshly generated AI scenario; CLAUDE.md §12, §16).

interface GOData {
  days?: number;
  kills?: number;
  reason?: string;
  name?: string;
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super("GameOverScene");
  }

  create(data: GOData): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setBackgroundColor("#07090c");
    this.add.rectangle(0, 0, w, h, 0x07090c, 0.96).setOrigin(0).setScrollFactor(0);

    const cx = w / 2;
    this.add
      .text(cx, h * 0.24, "YOU DIED", {
        fontFamily: "monospace",
        fontSize: "44px",
        color: "#ff5555",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const summary = `${data.name ?? "You"} — survived to Day ${data.days ?? 1}\n${data.kills ?? 0} infected put down\n\n${data.reason ?? "Your story ends here."}`;
    this.add
      .text(cx, h * 0.45, summary, {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#d8e2ec",
        align: "center",
        lineSpacing: 6,
        wordWrap: { width: Math.min(560, w - 40) },
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(cx, h * 0.72, "[ Start a new run ]", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#7fd3ff",
        backgroundColor: "#12202c",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on("pointerover", () => btn.setColor("#bfe9ff"));
    btn.on("pointerout", () => btn.setColor("#7fd3ff"));
    btn.on("pointerup", () => this.newRun());
    this.input.keyboard?.on("keydown-R", () => this.newRun());
    this.input.keyboard?.on("keydown-ENTER", () => this.newRun());

    this.add
      .text(cx, h * 0.72 + 46, "(a new city and a new story await)", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#7f93a8",
      })
      .setOrigin(0.5);
  }

  private newRun(): void {
    this.scene.start("MainMenuScene");
  }
}
