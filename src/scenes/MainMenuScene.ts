import Phaser from "phaser";
import { loadGame, saveGame } from "../game/GameState";
import { newRunState } from "../ai/gameMaster";
import { sfx } from "../engine/audio";

// Title screen (CLAUDE.md §13 Phase 7). "New run" always asks for the player's
// name first, then generates a new seed + AI scenario. "Continue" resumes a save.

const NAME_STYLE_ID = "ob-name-style";
const NAME_CSS = `
.ob-name{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.72);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-name.ob-show{display:flex}
.ob-namecard{width:min(420px,92vw);background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;padding:20px;
  display:flex;flex-direction:column;gap:14px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-nametitle{font-size:18px;color:#7fd3ff}
.ob-namesub{font-size:13px;color:#9fb3c8;margin-top:-6px}
.ob-nameinput{background:#0a0f14;border:1px solid #34506a;border-radius:8px;color:#e8eef4;padding:12px;font:inherit;font-size:16px}
.ob-nameinput:focus{outline:none;border-color:#7fd3ff}
.ob-namebtn{background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:12px;font:inherit;font-weight:600;font-size:15px;cursor:pointer}
.ob-namebtn:hover{background:#2a7bff}
`;

export class MainMenuScene extends Phaser.Scene {
  private busy = false;
  private nameRoot?: HTMLDivElement;
  private nameInput?: HTMLInputElement;
  private nameBtn?: HTMLButtonElement;

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
      .text(cx, h * 0.22, "OUTBREAK", {
        fontFamily: "monospace",
        fontSize: "56px",
        color: "#e8eef4",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add
      .text(cx, h * 0.33, "hour zero of the outbreak · an AI Game Master decides\nwhat happens to you — every run is different", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#7fd3ff",
        align: "center",
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    const existing = loadGame();
    let y = h * 0.55;
    if (existing) {
      this.button(cx, y, "Continue run", () => this.continueRun(existing.seed));
      y += 66;
    }
    this.button(cx, y, "New run", () => this.promptName());

    this.add
      .text(cx, h * 0.9, "WASD/arrows move · E act · SPACE/F attack · Shift sprint", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#7f93a8",
        align: "center",
      })
      .setOrigin(0.5);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.nameRoot?.remove();
      this.nameRoot = undefined;
    });
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

  private promptName(): void {
    if (!document.getElementById(NAME_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = NAME_STYLE_ID;
      style.textContent = NAME_CSS;
      document.head.appendChild(style);
    }
    if (!this.nameRoot) {
      const root = document.createElement("div");
      root.className = "ob-name";
      const card = document.createElement("div");
      card.className = "ob-namecard";
      const title = document.createElement("div");
      title.className = "ob-nametitle";
      title.textContent = "Who are you?";
      const sub = document.createElement("div");
      sub.className = "ob-namesub";
      sub.textContent = "Enter the name of the survivor about to live (or die).";
      const input = document.createElement("input");
      input.className = "ob-nameinput";
      input.type = "text";
      input.maxLength = 24;
      input.placeholder = "Your name";
      input.autocomplete = "off";
      const btn = document.createElement("button");
      btn.className = "ob-namebtn";
      btn.textContent = "Begin";
      btn.addEventListener("click", () => void this.startRun());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") void this.startRun();
      });
      card.append(title, sub, input, btn);
      root.append(card);
      document.body.appendChild(root);
      this.nameRoot = root;
      this.nameInput = input;
      this.nameBtn = btn;
    }
    this.nameRoot.classList.add("ob-show");
    this.nameInput?.focus();
  }

  private async startRun(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const name = this.nameInput?.value.trim() ?? "";
    if (this.nameBtn) this.nameBtn.textContent = "Entering the outbreak…";
    const { state, intro } = await newRunState(undefined, name);
    saveGame(state);
    this.registry.set("seed", state.seed);
    this.registry.set("seedFromUrl", false);
    this.registry.set("intro", intro);
    this.nameRoot?.remove();
    this.nameRoot = undefined;
    this.scene.start("WorldScene");
  }
}
