import type { GameState } from "../shared/contracts";
import { canAccept, getStanding, standingLabel, type RecruitCost, type TradeOffer } from "../game/npcs";
import { itemCount } from "../game/inventory";

// Trade / recruit overlay (Feature 10b): a DOM panel for a survivor encounter —
// shows who they are + your standing with their faction, a Recruit/Dismiss button,
// and their barter offers (give → get) with have/need readouts and Accept buttons.
// Mirrors CraftModal. Reads GameState; mutates only via scene callbacks.

const STYLE_ID = "ob-trade-style";
const CSS = `
.ob-trade{position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.6);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-trade.ob-on{display:flex}
.ob-tradep{width:min(560px,95vw);max-height:84vh;display:flex;flex-direction:column;gap:10px;overflow:auto;
  background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;padding:16px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-tradeh{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ob-tradeh b{font-size:15px;letter-spacing:.05em}
.ob-tradeh .fac{font-size:11px;color:#8fa3b8}
.ob-tradex{background:none;border:1px solid #34506a;color:#cdd9e5;border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit}
.ob-recwrap{display:flex;flex-direction:column;gap:4px}
.ob-traderec{background:#2f8f3c;border:none;color:#fff;border-radius:8px;padding:8px 12px;font:inherit;font-weight:600;cursor:pointer}
.ob-traderec:disabled{background:#26323c;color:#6f8296;cursor:not-allowed}
.ob-rechint{font-size:11px;color:#8fa3b8}
.ob-offer{display:flex;justify-content:space-between;align-items:center;gap:10px;
  background:#0c1620;border:1px solid #24384a;border-radius:8px;padding:9px 11px}
.ob-oinfo{font-size:13px;min-width:0}
.ob-oinfo .get{color:#9ef0a0;font-weight:600}
.ob-oinfo .give{font-size:11.5px;margin-top:2px}
.ob-tradeb{background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer;white-space:nowrap}
.ob-tradeb:disabled{background:#26323c;color:#6f8296;cursor:not-allowed}
.ob-tradetip{font-size:11px;color:#6f8296}
`;

export class TradeModal {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly facEl: HTMLDivElement;
  private readonly recBtn: HTMLButtonElement;
  private readonly recHintEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private state?: GameState;
  private offers: TradeOffer[] = [];
  private faction = "";
  private isCompanion = false;
  private canRecruit = false;
  private tier?: string;
  private cost?: RecruitCost;
  private atCompanionCap = false;
  private onAccept?: (o: TradeOffer) => void;
  private onRecruit?: () => void;
  private onClose?: () => void;
  private opened = false;
  private openedTs = 0; // the keystroke that opened us must not also close us
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = div("ob-trade");
    const panel = div("ob-tradep");
    const head = div("ob-tradeh");
    const titleWrap = document.createElement("div");
    this.titleEl = document.createElement("b");
    this.facEl = div("fac");
    titleWrap.append(this.titleEl, this.facEl);
    const x = document.createElement("button");
    x.className = "ob-tradex";
    x.textContent = "Leave (Esc)";
    x.addEventListener("click", () => this.close());
    head.append(titleWrap, x);

    const recWrap = div("ob-recwrap");
    this.recBtn = document.createElement("button");
    this.recBtn.className = "ob-traderec";
    this.recBtn.addEventListener("click", () => this.onRecruit?.());
    this.recHintEl = div("ob-rechint");
    recWrap.append(this.recBtn, this.recHintEl);

    this.listEl = div("ob-trade-list");
    const tip = div("ob-tradetip");
    tip.textContent = "Barter staples (food, water, scrap, ammo) for their goods — trading earns standing. Recruit costs supplies + good standing, scaled by the survivor's quality.";
    panel.append(head, recWrap, this.listEl, tip);
    this.root.append(panel);
    document.body.appendChild(this.root);

    this.keyHandler = (e) => {
      if (!this.opened) return;
      if (e.timeStamp <= this.openedTs) return; // the E that opened us must not also close us
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
  setHandlers(onAccept: (o: TradeOffer) => void, onRecruit: () => void, onClose: () => void): void {
    this.onAccept = onAccept;
    this.onRecruit = onRecruit;
    this.onClose = onClose;
  }

  open(
    state: GameState,
    info: {
      name: string;
      faction: string;
      offers: TradeOffer[];
      isCompanion: boolean;
      canRecruit: boolean;
      tier?: string;
      cost?: RecruitCost;
      standing?: number;
      atCompanionCap?: boolean;
    },
  ): void {
    this.state = state;
    this.offers = info.offers;
    this.faction = info.faction;
    this.isCompanion = info.isCompanion;
    this.canRecruit = info.canRecruit;
    this.tier = info.tier;
    this.cost = info.cost;
    this.atCompanionCap = info.atCompanionCap ?? false;
    this.titleEl.textContent = info.name;
    this.opened = true;
    this.openedTs = performance.now(); // ignore the keystroke that opened us
    this.root.classList.add("ob-on");
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("ob-on");
    this.onClose?.();
  }

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
    const standing = getStanding(s, this.faction);
    const tierLabel = this.tier && this.tier !== "average" ? ` · ${this.tier} survivor` : "";
    this.facEl.textContent = `${this.faction} · ${standingLabel(standing)} (${standing > 0 ? "+" : ""}${standing})${tierLabel}`;

    this.renderRecruit(s, standing);

    this.listEl.innerHTML = "";
    for (const o of this.offers) {
      const row = div("ob-offer");
      const info = div("ob-oinfo");
      const get = document.createElement("div");
      get.className = "get";
      get.textContent = `Get ${o.get.item}${o.get.qty > 1 ? ` ×${o.get.qty}` : ""}`;
      const give = document.createElement("div");
      give.className = "give";
      give.innerHTML = o.give
        .map((g) => {
          const have = itemCount(s, g.item);
          const okc = have >= g.qty ? "#5ed66e" : "#ff6b6b";
          return `<span style="color:${okc}">Give ${g.item} ${have}/${g.qty}</span>`;
        })
        .join("  ·  ");
      info.append(get, give);
      const btn = document.createElement("button");
      btn.className = "ob-tradeb";
      btn.textContent = "Trade";
      btn.disabled = !canAccept(s, o);
      btn.addEventListener("click", () => this.onAccept?.(o));
      row.append(info, btn);
      this.listEl.appendChild(row);
    }
  }

  /** Recruit button + cost/standing requirement readout (red until each is met). */
  private renderRecruit(s: GameState, standing: number): void {
    if (this.isCompanion) {
      this.recBtn.textContent = "Dismiss companion";
      this.recBtn.disabled = false;
      this.recHintEl.textContent = "They'll part ways and roam as a survivor again.";
      return;
    }
    const cost = this.cost;
    const costStr = cost ? cost.items.map((c) => `${c.qty} ${c.item}`).join(", ") : "";
    this.recBtn.textContent = costStr ? `Recruit (${costStr})` : "Recruit as companion";
    this.recBtn.disabled = !this.canRecruit;

    if (this.atCompanionCap) {
      this.recHintEl.innerHTML = `<span style="color:#ff6b6b">Companion limit reached.</span>`;
      return;
    }
    const parts: string[] = [];
    if (cost) {
      const standOk = standing >= cost.standingReq;
      parts.push(`<span style="color:${standOk ? "#5ed66e" : "#ff6b6b"}">standing ${standing}/${cost.standingReq}</span>`);
      for (const c of cost.items) {
        const have = itemCount(s, c.item);
        const ok = have >= c.qty;
        parts.push(`<span style="color:${ok ? "#5ed66e" : "#ff6b6b"}">${c.item} ${have}/${c.qty}</span>`);
      }
    }
    this.recHintEl.innerHTML = parts.join("  ·  ");
  }
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}
