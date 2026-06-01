import type { GameState } from "../shared/contracts";
import { stash, unstash } from "../game/base";

// Base storage (Feature 7): a DOM overlay with two columns — your pack and the base
// stash — click a stack to move it across. Opened by pressing E on a Storage Crate;
// Esc or E closes. Mutates GameState only through base.ts stash/unstash.

const STYLE_ID = "ob-store-style";
const CSS = `
.ob-store{position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.6);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-store.ob-on{display:flex}
.ob-storep{width:min(620px,96vw);max-height:86vh;display:flex;flex-direction:column;gap:10px;
  background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;padding:16px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-storeh{display:flex;justify-content:space-between;align-items:center}
.ob-storeh b{font-size:14px;letter-spacing:.1em}
.ob-storex{background:none;border:1px solid #34506a;color:#cdd9e5;border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit}
.ob-storecols{display:flex;gap:12px;min-height:0}
.ob-storecol{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
.ob-storecol h4{margin:0;font-size:11px;letter-spacing:.1em;color:#7fd3ff;text-transform:uppercase}
.ob-storelist{display:flex;flex-direction:column;gap:5px;overflow:auto;max-height:56vh;padding-right:2px}
.ob-storerow{display:flex;justify-content:space-between;align-items:center;gap:8px;
  background:#0c1620;border:1px solid #24384a;border-radius:8px;padding:7px 10px;cursor:pointer;font-size:13px}
.ob-storerow:hover{border-color:#34506a;background:#10202c}
.ob-storerow .q{color:#8fa3b8;font-size:12px}
.ob-storeempty{color:#7f93a8;font-size:12px;padding:6px}
.ob-storetip{font-size:11px;color:#6f8296}
@media(max-width:560px){.ob-storecols{flex-direction:column}}
`;

export class StorageModal {
  private readonly root: HTMLDivElement;
  private readonly packEl: HTMLDivElement;
  private readonly stashEl: HTMLDivElement;
  private state?: GameState;
  private onChange?: () => void;
  private onClose?: () => void;
  private opened = false;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = div("ob-store");
    const panel = div("ob-storep");
    const head = div("ob-storeh");
    const title = document.createElement("b");
    title.textContent = "BASE STORAGE";
    const x = document.createElement("button");
    x.className = "ob-storex";
    x.textContent = "Close (Esc)";
    x.addEventListener("click", () => this.close());
    head.append(title, x);

    const cols = div("ob-storecols");
    const packCol = div("ob-storecol");
    const ph = document.createElement("h4");
    ph.textContent = "Your pack →";
    this.packEl = div("ob-storelist");
    packCol.append(ph, this.packEl);
    const stashCol = div("ob-storecol");
    const sh = document.createElement("h4");
    sh.textContent = "← Stored";
    this.stashEl = div("ob-storelist");
    stashCol.append(sh, this.stashEl);
    cols.append(packCol, stashCol);

    const tip = div("ob-storetip");
    tip.textContent = "Click a stack to move it. Stored items are safe at base.";
    panel.append(head, cols, tip);
    this.root.append(panel);
    document.body.appendChild(this.root);

    this.keyHandler = (e) => {
      if (!this.opened) return;
      if (e.key === "Escape" || e.key === "e" || e.key === "E") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  isOpen(): boolean {
    return this.opened;
  }
  setHandlers(onChange: () => void, onClose: () => void): void {
    this.onChange = onChange;
    this.onClose = onClose;
  }

  open(state: GameState): void {
    this.state = state;
    this.opened = true;
    this.root.classList.add("ob-on");
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("ob-on");
    this.onClose?.();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.keyHandler);
    this.root.remove();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    this.packEl.innerHTML = "";
    this.stashEl.innerHTML = "";
    const pack = s.inventory;
    const stored = s.baseStorage ?? [];
    if (pack.length === 0) this.packEl.append(empty());
    for (const it of pack) {
      this.packEl.append(this.row(it.item, it.qty, () => {
        stash(s, it.item, it.qty);
        this.changed();
      }));
    }
    if (stored.length === 0) this.stashEl.append(empty());
    for (const it of stored) {
      this.stashEl.append(this.row(it.item, it.qty, () => {
        unstash(s, it.item, it.qty);
        this.changed();
      }));
    }
  }

  private row(item: string, qty: number, onClick: () => void): HTMLDivElement {
    const r = div("ob-storerow");
    const nm = document.createElement("span");
    nm.textContent = item;
    const q = document.createElement("span");
    q.className = "q";
    q.textContent = "×" + qty;
    r.append(nm, q);
    r.addEventListener("click", onClick);
    return r;
  }

  private changed(): void {
    this.onChange?.();
    this.render();
  }
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}
function empty(): HTMLDivElement {
  const e = div("ob-storeempty");
  e.textContent = "(empty)";
  return e;
}
