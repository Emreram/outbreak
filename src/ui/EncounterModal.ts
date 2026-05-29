import type { NextInteraction, TurnInput } from "../shared/contracts";

// Encounter UI (CLAUDE.md §13 Phase 4): a DOM overlay over the Phaser canvas with
// BOTH a free-text box and 4-choice buttons, a typewriter narrative, and a "the
// world reacts…" spinner. DOM (not in-canvas) so the text input + tap targets work
// well on desktop and mobile.

export type ActionHandler = (input: TurnInput) => void;

const STYLE_ID = "ob-encounter-style";
const CSS = `
.ob-modal{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.62);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-modal.ob-show{display:flex}
.ob-panel{width:min(580px,94vw);max-height:86vh;display:flex;flex-direction:column;gap:12px;
  background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;padding:18px 18px 16px;
  box-shadow:0 18px 60px rgba(0,0,0,.6);color:#e8eef4}
.ob-title{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#7fd3ff;opacity:.9}
.ob-narr{font-size:15px;line-height:1.5;color:#e8eef4;min-height:48px;white-space:pre-wrap;overflow:auto;max-height:46vh}
.ob-prompt{font-size:13px;color:#9fb3c8}
.ob-spin{display:flex;align-items:center;gap:10px;color:#9fb3c8;font-size:14px}
.ob-dot{width:9px;height:9px;border-radius:50%;background:#7fd3ff;animation:ob-pulse 1s infinite ease-in-out}
@keyframes ob-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
.ob-choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:460px){.ob-choices{grid-template-columns:1fr}}
.ob-btn{appearance:none;border:1px solid #34506a;background:#16212c;color:#e8eef4;border-radius:8px;
  padding:11px 12px;font:inherit;font-size:14px;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.ob-btn:hover{background:#1d2c39;border-color:#4a7396}
.ob-btn:active{background:#24384a}
.ob-row{display:flex;gap:8px}
.ob-input{flex:1;min-width:0;background:#0a0f14;border:1px solid #34506a;border-radius:8px;color:#e8eef4;
  padding:11px 12px;font:inherit;font-size:14px}
.ob-input:focus{outline:none;border-color:#7fd3ff}
.ob-send{background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:0 16px;font:inherit;font-weight:600;cursor:pointer}
.ob-send:hover{background:#2a7bff}
.ob-leave{align-self:flex-end;background:none;border:none;color:#8398ac;font:inherit;font-size:12px;cursor:pointer;text-decoration:underline}
.ob-leave:hover{color:#cdd9e5}
.ob-hidden{display:none!important}
`;

export class EncounterModal {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly narrEl: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly spinEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  private readonly rowEl: HTMLDivElement;
  private readonly inputEl: HTMLInputElement;
  private readonly leaveEl: HTMLButtonElement;

  private onAction?: ActionHandler;
  private onLeave?: () => void;
  private typeTimer?: ReturnType<typeof setInterval>;
  private fullText = "";
  private opened = false;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = el("div", "ob-modal");
    const panel = el("div", "ob-panel");
    this.titleEl = el("div", "ob-title");
    this.narrEl = el("div", "ob-narr");
    this.promptEl = el("div", "ob-prompt");

    this.spinEl = el("div", "ob-spin");
    this.spinEl.append(el("span", "ob-dot"), text("the world reacts…"));

    this.choicesEl = el("div", "ob-choices");

    this.rowEl = el("div", "ob-row");
    this.inputEl = document.createElement("input");
    this.inputEl.className = "ob-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "What do you do?";
    this.inputEl.autocomplete = "off";
    const send = document.createElement("button");
    send.className = "ob-send";
    send.textContent = "Act";
    send.addEventListener("click", () => this.submitText());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submitText();
    });
    this.rowEl.append(this.inputEl, send);

    this.leaveEl = document.createElement("button");
    this.leaveEl.className = "ob-leave";
    this.leaveEl.textContent = "Leave (Esc)";
    this.leaveEl.addEventListener("click", () => this.leave());

    // Click the narrative to skip the typewriter.
    this.narrEl.addEventListener("click", () => this.finishTyping());

    panel.append(this.titleEl, this.narrEl, this.spinEl, this.promptEl, this.choicesEl, this.rowEl, this.leaveEl);
    this.root.append(panel);
    document.body.appendChild(this.root);

    window.addEventListener("keydown", this.onKey);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setHandlers(onAction: ActionHandler, onLeave: () => void): void {
    this.onAction = onAction;
    this.onLeave = onLeave;
  }

  /** Show the modal in the "thinking" state while the GM resolves a turn. */
  openLoading(title = "Encounter"): void {
    this.opened = true;
    this.titleEl.textContent = title;
    this.root.classList.add("ob-show");
    this.clearTyping();
    this.narrEl.textContent = "";
    this.promptEl.classList.add("ob-hidden");
    this.choicesEl.classList.add("ob-hidden");
    this.rowEl.classList.add("ob-hidden");
    this.spinEl.classList.remove("ob-hidden");
  }

  /** Render a resolved outcome: typewriter narrative, then free-text or choices. */
  showResult(narrative: string, interaction: NextInteraction): void {
    this.opened = true;
    this.root.classList.add("ob-show");
    this.spinEl.classList.add("ob-hidden");
    this.choicesEl.innerHTML = "";
    this.choicesEl.classList.add("ob-hidden");
    this.rowEl.classList.add("ob-hidden");
    this.promptEl.classList.add("ob-hidden");

    this.typewriter(narrative, () => {
      this.promptEl.textContent = interaction.prompt;
      this.promptEl.classList.remove("ob-hidden");
      if (interaction.type === "choices" && interaction.options.length > 0) {
        for (const opt of interaction.options) {
          const b = document.createElement("button");
          b.className = "ob-btn";
          b.textContent = opt;
          b.addEventListener("click", () => this.pick(opt));
          this.choicesEl.appendChild(b);
        }
        this.choicesEl.classList.remove("ob-hidden");
      } else {
        this.inputEl.value = "";
        this.rowEl.classList.remove("ob-hidden");
        this.inputEl.focus();
      }
    });
  }

  close(): void {
    this.opened = false;
    this.clearTyping();
    this.root.classList.remove("ob-show");
  }

  destroy(): void {
    this.clearTyping();
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  // --- internals ---

  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.key === "Escape") this.leave();
  };

  private submitText(): void {
    const v = this.inputEl.value.trim();
    if (!v) return;
    this.lockInputs();
    this.onAction?.({ mode: "free_text", value: v });
  }

  private pick(option: string): void {
    this.lockInputs();
    this.onAction?.({ mode: "choice", value: option });
  }

  private leave(): void {
    this.close();
    this.onLeave?.();
  }

  private lockInputs(): void {
    this.choicesEl.classList.add("ob-hidden");
    this.rowEl.classList.add("ob-hidden");
    this.promptEl.classList.add("ob-hidden");
  }

  private typewriter(full: string, done: () => void): void {
    this.clearTyping();
    this.fullText = full;
    this.narrEl.textContent = "";
    let i = 0;
    this.typeTimer = setInterval(() => {
      i += 2;
      this.narrEl.textContent = full.slice(0, i);
      if (i >= full.length) {
        this.clearTyping();
        this.narrEl.textContent = full;
        done();
      }
    }, 14);
    this.pendingDone = done;
  }

  private pendingDone?: () => void;

  private finishTyping(): void {
    if (this.typeTimer) {
      this.clearTyping();
      this.narrEl.textContent = this.fullText;
      const d = this.pendingDone;
      this.pendingDone = undefined;
      d?.();
    }
  }

  private clearTyping(): void {
    if (this.typeTimer) {
      clearInterval(this.typeTimer);
      this.typeTimer = undefined;
    }
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = className;
  return e;
}
function text(s: string): Text {
  return document.createTextNode(s);
}
