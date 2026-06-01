import type { GameState } from "../shared/contracts";
import { RECIPES, canCraft, type Recipe } from "../game/crafting";
import { itemCount } from "../game/inventory";

// Crafting UI (Feature 8): a DOM overlay listing recipes with have/need readouts
// and a Craft button per row. Opened with C; Esc or C closes. Reads GameState and
// calls back to the scene to apply each craft.

const STYLE_ID = "ob-craft-style";
const CSS = `
.ob-craft{position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.6);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-craft.ob-on{display:flex}
.ob-craftp{width:min(560px,95vw);max-height:84vh;display:flex;flex-direction:column;gap:10px;overflow:auto;
  background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;padding:16px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-crafth{display:flex;justify-content:space-between;align-items:center}
.ob-crafth b{font-size:15px;letter-spacing:.08em}
.ob-craftx{background:none;border:1px solid #34506a;color:#cdd9e5;border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit}
.ob-recipe{display:flex;justify-content:space-between;align-items:center;gap:10px;
  background:#0c1620;border:1px solid #24384a;border-radius:8px;padding:9px 11px}
.ob-rinfo{font-size:13px;min-width:0}
.ob-rinfo .nm{color:#e8eef4;font-weight:600}
.ob-rinfo .ds{color:#8fa3b8;font-size:11px}
.ob-rinfo .ing{font-size:11.5px;margin-top:2px}
.ob-craftb{background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer;white-space:nowrap}
.ob-craftb:disabled{background:#26323c;color:#6f8296;cursor:not-allowed}
.ob-crafttip{font-size:11px;color:#6f8296}
`;

export class CraftModal {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private onCraft?: (r: Recipe) => void;
  private onClose?: () => void;
  private opened = false;
  private state?: GameState;
  private stations: Set<string> = new Set();
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = div("ob-craft");
    const panel = div("ob-craftp");
    const head = div("ob-crafth");
    const title = document.createElement("b");
    title.textContent = "CRAFTING";
    const x = document.createElement("button");
    x.className = "ob-craftx";
    x.textContent = "Close (Esc)";
    x.addEventListener("click", () => this.close());
    head.append(title, x);
    this.listEl = div("ob-craft-list");
    const tip = div("ob-crafttip");
    tip.textContent = "Materials are consumed on craft. Find/scavenge components out in the world.";
    panel.append(head, this.listEl, tip);
    this.root.append(panel);
    document.body.appendChild(this.root);

    this.keyHandler = (e) => {
      if (!this.opened) return;
      if (e.key === "Escape" || e.key === "c" || e.key === "C") {
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
  setHandlers(onCraft: (r: Recipe) => void, onClose: () => void): void {
    this.onCraft = onCraft;
    this.onClose = onClose;
  }

  open(state: GameState, stations?: Set<string>): void {
    this.state = state;
    this.stations = stations ?? new Set();
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

  /** Re-render in place after a craft (counts/buttons change). */
  refresh(state: GameState): void {
    this.state = state;
    if (this.opened) this.render();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.keyHandler);
    this.root.remove();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    this.listEl.innerHTML = "";
    for (const r of RECIPES) {
      const stationOk = !r.station || this.stations.has(r.station);
      const row = div("ob-recipe");
      const info = div("ob-rinfo");
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = `${r.out}${r.outQty > 1 ? ` ×${r.outQty}` : ""}${r.station ? `  ·  ${r.station}${stationOk ? "" : " (need station)"}` : ""}`;
      const ds = document.createElement("div");
      ds.className = "ds";
      ds.textContent = r.desc;
      const ing = document.createElement("div");
      ing.className = "ing";
      ing.innerHTML = r.inputs
        .map((i) => {
          const have = itemCount(s, i.item);
          const okc = have >= i.qty ? "#5ed66e" : "#ff6b6b";
          return `<span style="color:${okc}">${i.item} ${have}/${i.qty}</span>`;
        })
        .join("  ·  ");
      info.append(nm, ds, ing);
      const btn = document.createElement("button");
      btn.className = "ob-craftb";
      btn.textContent = stationOk ? "Craft" : r.station ?? "Station";
      btn.disabled = !canCraft(s, r) || !stationOk;
      btn.addEventListener("click", () => stationOk && this.onCraft?.(r));
      row.append(info, btn);
      this.listEl.appendChild(row);
    }
  }
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}
