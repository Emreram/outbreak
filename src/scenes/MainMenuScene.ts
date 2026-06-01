import Phaser from "phaser";
import { loadGame, saveGame } from "../game/GameState";
import { newRunState } from "../ai/gameMaster";
import { hasWebGPU, webllmEnabled, setWebllmEnabled, webllmState, webllmModel, loadWebLLM, warmUpWebLLM } from "../ai/webllm";
import { CharacterCreate, type CreationResult } from "../ui/CharacterCreate";
import { sfx } from "../engine/audio";

// Title screen. "New run" opens the character creation screen, then generates a
// new seed + AI scenario with the chosen survivor. "Continue" resumes a save.

export class MainMenuScene extends Phaser.Scene {
  private busy = false;
  private cc?: CharacterCreate;
  private aiBtn?: Phaser.GameObjects.Text;
  private aiHint?: Phaser.GameObjects.Text;
  private menuDestroyed = false;
  private aiBusy = false;

  constructor() {
    super("MainMenuScene");
  }

  create(): void {
    this.busy = false;
    this.menuDestroyed = false;
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
    this.button(cx, y, "New run", () => this.openCreate());

    this.add
      .text(cx, h * 0.635, "Playable offline — no GPU needed. The in-browser AI below is an optional upgrade.", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#7f93a8",
        align: "center",
      })
      .setOrigin(0.5);

    this.buildAiToggle(cx, h * 0.72);

    this.add
      .text(cx, h * 0.9, "WASD/arrows move · E act · SPACE/F attack · Shift sprint", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#7f93a8",
        align: "center",
      })
      .setOrigin(0.5);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menuDestroyed = true;
      this.cc?.destroy();
      this.cc = undefined;
    });
  }

  /** Optional in-browser AI (WebLLM/WebGPU): a real LLM Game Master with no key/server. */
  private buildAiToggle(x: number, y: number): void {
    this.aiBtn = this.add
      .text(x, y, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#7fd3ff",
        backgroundColor: "#101a22",
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.aiHint = this.add
      .text(x, y + 26, "", { fontFamily: "monospace", fontSize: "11px", color: "#7f93a8", align: "center" })
      .setOrigin(0.5);
    this.aiBtn.on("pointerup", () => this.onAiToggle());
    this.refreshAiToggle();
    // Previously opted in? Warm-load from the browser cache automatically.
    if (hasWebGPU() && webllmEnabled() && webllmState() === "idle") void this.startWebllmLoad();
  }

  private refreshAiToggle(): void {
    if (this.menuDestroyed || !this.aiBtn || !this.aiHint) return;
    if (!hasWebGPU()) {
      this.aiBtn.setText("In-browser AI: unsupported").setColor("#6b7a89").disableInteractive();
      this.aiHint.setText("needs WebGPU — try desktop Chrome/Edge");
      return;
    }
    switch (webllmState()) {
      case "ready":
        if (webllmEnabled()) {
          this.aiBtn.setText("In-browser AI: ON ✓").setColor("#8ef0a0");
          this.aiHint.setText(`${webllmModel()} · tap to turn off`);
        } else {
          this.aiBtn.setText("In-browser AI: OFF").setColor("#7fd3ff");
          this.aiHint.setText("model loaded · tap to use it");
        }
        break;
      case "loading":
        this.aiBtn.setText("Loading AI model…").setColor("#ffd98a");
        break;
      case "error":
        this.aiBtn.setText("In-browser AI: unavailable").setColor("#ff9d9d");
        this.aiHint.setText(
          "Needs WebGPU — enable hardware acceleration (Chrome/Edge) + update GPU drivers.\nYou can still play now — the game runs on the offline director. (tap to retry)",
        );
        break;
      default:
        this.aiBtn.setText("Enable in-browser AI").setColor("#7fd3ff");
        this.aiHint.setText("real LLM in your browser · ~2 GB one-time download");
    }
  }

  private onAiToggle(): void {
    if (this.menuDestroyed || this.aiBusy || !hasWebGPU()) return;
    const st = webllmState();
    if (st === "loading") return;
    if (st === "ready") {
      setWebllmEnabled(!webllmEnabled()); // already loaded — just flip use on/off
      this.refreshAiToggle();
      return;
    }
    void this.startWebllmLoad(); // includes "tap to retry" from the error state
  }

  private async startWebllmLoad(): Promise<void> {
    if (this.aiBusy) return; // one attempt at a time; ignore extra taps
    this.aiBusy = true;
    setWebllmEnabled(true);
    // Immediate feedback so a retry is OBVIOUSLY happening — a GPU-adapter failure
    // throws before any download progress fires, so without this the button would
    // never visibly change and a real retry looks like a no-op.
    if (!this.menuDestroyed) {
      this.aiBtn?.setText("Loading AI model…").setColor("#ffd98a");
      this.aiHint?.setText("checking WebGPU…");
    }
    const startedAt = performance.now();
    try {
      await loadWebLLM((r) => {
        if (this.menuDestroyed) return;
        const pct = Math.round((r.progress ?? 0) * 100);
        this.aiHint?.setText(`${pct}%  ${r.text}`.slice(0, 56));
        this.refreshAiToggle();
      });
      if (!this.menuDestroyed) this.aiHint?.setText("warming up the model…");
      await warmUpWebLLM(); // compile shaders now so the first in-game turn is fast
    } catch {
      /* state=error; refreshAiToggle shows the friendly message + tap-to-retry */
    }
    // Hold the "Loading…" state briefly so even an instant failure reads as a real retry.
    const elapsed = performance.now() - startedAt;
    if (elapsed < 600) await new Promise((res) => setTimeout(res, 600 - elapsed));
    this.aiBusy = false;
    this.refreshAiToggle();
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

  private openCreate(): void {
    if (!this.cc) this.cc = new CharacterCreate();
    this.cc.open((r) => void this.startRun(r));
  }

  private async startRun(r: CreationResult): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const { state, intro } = await newRunState(undefined, r.name, r.creation);
    saveGame(state);
    this.registry.set("seed", state.seed);
    this.registry.set("seedFromUrl", false);
    this.registry.set("intro", intro);
    this.cc?.close();
    this.scene.start("WorldScene");
  }
}
