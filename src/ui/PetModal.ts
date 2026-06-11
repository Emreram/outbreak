// Pet roster overlay (Companions & Spectacle PR-A) — manage your tamed creatures:
// set the active companion, feed, rename, release. DOM overlay in the LootModal
// mold: Esc-closable, openedTs keystroke guard (the opening keypress must never
// also act inside), pure presentation — every mutation goes through the scene's
// handlers so game state stays engine-owned.

import type { GameState, PetState } from "../shared/contracts";
import { PETS, activePet, isRideable } from "../game/pets";
import { petPortraitUrl } from "../engine/petSprites";
import { RARITY_META } from "../game/items/rarity";

const STYLE_ID = "ob-pet-style";
const CSS = `
.ob-pet{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.7);font-family:ui-monospace,Menlo,Consolas,monospace;padding:14px;box-sizing:border-box}
.ob-pet.ob-show{display:flex}
.ob-petcard{width:min(640px,95vw);max-height:88vh;overflow:auto;background:#0e1318;border:1px solid #2a3a4a;
  border-radius:12px;padding:16px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-pettitle{font-size:16px;color:#ff9fc0;letter-spacing:.06em;margin-bottom:10px;display:flex;justify-content:space-between}
.ob-petx{background:none;border:none;color:#7f93a8;font:inherit;font-size:16px;cursor:pointer}
.ob-petempty{color:#7f93a8;font-size:13px;padding:18px 4px}
.ob-petrow{display:flex;gap:12px;align-items:center;background:#0c1620;border:1px solid #24384a;border-radius:10px;
  padding:10px;margin-bottom:8px}
.ob-petrow.ob-active{border-color:#ff9fc0;background:#161019}
.ob-petport{width:52px;height:52px;border-radius:8px;background:#0a0f14;border:1px solid #34506a;image-rendering:pixelated}
.ob-petinfo{flex:1;min-width:0}
.ob-petname{font-size:14px;font-weight:600}
.ob-petspec{font-size:11px;margin-top:1px}
.ob-petbars{display:flex;gap:10px;align-items:center;font-size:11px;color:#9fb3c8;margin-top:4px}
.ob-pethp{width:90px;height:6px;background:#0a0f14;border-radius:3px;overflow:hidden}
.ob-pethp i{display:block;height:100%;background:#d64646}
.ob-pethearts{color:#ff9fc0;letter-spacing:1px}
.ob-petacts{display:flex;flex-direction:column;gap:5px}
.ob-petbtn{background:#16212c;border:1px solid #34506a;border-radius:7px;color:#cdd9e5;padding:5px 10px;
  font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.ob-petbtn:hover{border-color:#7fd3ff}
.ob-petbtn.ob-on{background:#3a2030;border-color:#ff9fc0;color:#ffd9e8}
.ob-pethint{font-size:11px;color:#7f93a8;margin-top:8px}
`;

export interface PetModalHandlers {
  onSetActive: (id: string) => void;
  onFeed: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRelease: (id: string) => void;
  onClose: () => void;
}

export class PetModal {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private handlers?: PetModalHandlers;
  private opened = false;
  private openedTs = 0; // ignore the keystroke that opened us (same-event guard)

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = document.createElement("div");
    this.root.className = "ob-pet";
    this.card = document.createElement("div");
    this.card.className = "ob-petcard";
    const title = document.createElement("div");
    title.className = "ob-pettitle";
    title.textContent = "Your pets";
    const x = document.createElement("button");
    x.className = "ob-petx";
    x.textContent = "✕ (Esc / P)";
    x.addEventListener("click", () => this.close());
    title.appendChild(x);
    this.list = document.createElement("div");
    const hint = document.createElement("div");
    hint.className = "ob-pethint";
    hint.textContent = "One pet travels with you; the rest wait at your side of the world. Feed with their favourite food to heal + bond.";
    this.card.append(title, this.list, hint);
    this.root.append(this.card);
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  setHandlers(h: PetModalHandlers): void {
    this.handlers = h;
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(state: GameState): void {
    this.opened = true;
    this.openedTs = performance.now();
    this.root.classList.add("ob-show");
    this.refresh(state);
  }

  refresh(state: GameState): void {
    this.list.innerHTML = "";
    const pets = state.pets ?? [];
    if (pets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ob-petempty";
      empty.textContent = "No companions yet. Find a creature in the wild and offer it food (hold E).";
      this.list.appendChild(empty);
      return;
    }
    const act = activePet(state);
    for (const p of pets) this.list.appendChild(this.row(p, p.id === act?.id));
  }

  private row(p: PetState, isActive: boolean): HTMLDivElement {
    const def = PETS[p.species];
    const row = document.createElement("div");
    row.className = "ob-petrow" + (isActive ? " ob-active" : "");
    const img = document.createElement("img");
    img.className = "ob-petport";
    img.src = petPortraitUrl(p.species);
    const info = document.createElement("div");
    info.className = "ob-petinfo";
    const nm = document.createElement("div");
    nm.className = "ob-petname";
    nm.textContent = (p.name ?? def?.name ?? p.species) + (isActive ? "  · with you" : "");
    const spec = document.createElement("div");
    spec.className = "ob-petspec";
    const meta = def ? RARITY_META[def.rarity] : RARITY_META.common;
    spec.style.color = meta.css;
    const moveChip = def?.move === "fly" ? " · flies" : def?.move === "swim" ? " · swims" : "";
    spec.textContent = `${def?.name ?? p.species} · ${meta.label}${moveChip}${def && isRideable(def) ? " · rideable" : ""}`;
    const bars = document.createElement("div");
    bars.className = "ob-petbars";
    const hpWrap = document.createElement("div");
    hpWrap.className = "ob-pethp";
    const hpFill = document.createElement("i");
    hpFill.style.width = `${Math.round((p.hp / Math.max(1, def?.hp ?? p.hp)) * 100)}%`;
    hpWrap.appendChild(hpFill);
    const hpTxt = document.createElement("span");
    hpTxt.textContent = `${Math.max(0, Math.round(p.hp))}/${def?.hp ?? "?"}`;
    const hearts = document.createElement("span");
    hearts.className = "ob-pethearts";
    hearts.textContent = "♥".repeat(Math.floor(p.bond)) + "♡".repeat(5 - Math.floor(p.bond));
    bars.append(hpWrap, hpTxt, hearts);
    info.append(nm, spec, bars);
    const acts = document.createElement("div");
    acts.className = "ob-petacts";
    const mk = (label: string, on: boolean, fn: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "ob-petbtn" + (on ? " ob-on" : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    acts.appendChild(mk(isActive ? "Active ✓" : "Set active", isActive, () => this.handlers?.onSetActive(p.id)));
    acts.appendChild(mk("Feed", false, () => this.handlers?.onFeed(p.id)));
    acts.appendChild(
      mk("Name", false, () => {
        const name = window.prompt("Name this companion:", p.name ?? "");
        if (name !== null) this.handlers?.onRename(p.id, name);
      }),
    );
    acts.appendChild(
      mk("Release", false, () => {
        if (window.confirm(`Release ${p.name ?? def?.name ?? "this pet"} back to the wild?`)) this.handlers?.onRelease(p.id);
      }),
    );
    row.append(img, info, acts);
    return row;
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("ob-show");
    this.handlers?.onClose();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.timeStamp <= this.openedTs) return; // the opening keypress doesn't count
    if (e.key === "Escape" || e.key.toLowerCase() === "p") {
      e.stopPropagation();
      this.close();
    }
  };
}
