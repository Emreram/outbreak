import type { GameState } from "../shared/contracts";
import { isWeaponDef } from "../game/items/types";
import { defOf } from "../game/items/catalog";
import { ammoReserve, equipWeapon, equippedMeleeDef, equippedRangedDef, removeItem, unequip } from "../game/inventory";
import { useConsumable } from "../game/GameState";
import { iconDataUrl } from "../engine/icons";
import { RARITY_META } from "../game/items/rarity";

// Loot / inventory / equip screen (Phase 6). DOM overlay with rarity-framed icons,
// equip slots, item tooltips, and Equip / Use / Drop actions. Reads + mutates the
// authoritative GameState only through the inventory/equip APIs.

const STYLE_ID = "ob-loot-style";
const CSS = `
.ob-loot{position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.66);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-loot.ob-show{display:flex}
.ob-lootpanel{width:min(720px,96vw);max-height:90vh;display:flex;flex-direction:column;gap:10px;background:#0e1318;
  border:1px solid #2a3a4a;border-radius:12px;padding:16px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-loothead{display:flex;justify-content:space-between;align-items:center}
.ob-loottitle{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#7fd3ff}
.ob-x{background:none;border:none;color:#8398ac;font:inherit;font-size:20px;cursor:pointer;line-height:1}
.ob-equip{display:flex;gap:10px}
.ob-slot{flex:1;display:flex;gap:8px;align-items:center;background:#0c1620;border:1px solid #24384a;border-radius:8px;padding:8px}
.ob-slot img{width:34px;height:34px}
.ob-slotlabel{font-size:10px;color:#7f93a8;letter-spacing:.1em}
.ob-lootbody{display:flex;gap:10px;min-height:0;flex:1}
.ob-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,52px);grid-auto-rows:52px;gap:6px;overflow:auto;align-content:start;max-height:54vh}
.ob-cell{position:relative;width:52px;height:52px;border-radius:8px;background:#0a0f14;border:2px solid #34506a;cursor:pointer;padding:0}
.ob-cell img{width:46px;height:46px;display:block;margin:1px auto}
.ob-cell.sel{outline:2px solid #7fd3ff;outline-offset:1px}
.ob-qty{position:absolute;right:3px;bottom:1px;font-size:10px;color:#e8eef4;text-shadow:0 1px 2px #000}
.ob-detail{width:240px;flex:none;background:#0c1620;border:1px solid #24384a;border-radius:8px;padding:12px;
  display:flex;flex-direction:column;gap:6px;overflow:auto;max-height:54vh}
.ob-dname{font-size:15px;font-weight:600}
.ob-dmeta{font-size:11px;color:#9fb3c8}
.ob-dstat{font-size:12px;color:#cdd9e5}
.ob-dabil{font-size:12px;color:#bfe9ff}
.ob-actions{display:flex;gap:8px;margin-top:auto;flex-wrap:wrap;padding-top:8px}
.ob-act{flex:1;min-width:70px;background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:9px;font:inherit;font-weight:600;cursor:pointer;font-size:13px}
.ob-act.sec{background:#2a3a4a}
.ob-empty{color:#7f93a8;font-size:12px}
.ob-hint{font-size:11px;color:#6f8296}
@media(max-width:560px){.ob-lootbody{flex-direction:column}.ob-detail{width:auto}}
`;

export class LootModal {
  private readonly root: HTMLDivElement;
  private readonly equipEl: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;

  private state?: GameState;
  private onChange?: () => void;
  private onCloseCb?: () => void;
  private selected?: string;
  private opened = false;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = div("ob-loot");
    const panel = div("ob-lootpanel");
    const head = div("ob-loothead");
    const title = div("ob-loottitle");
    title.textContent = "Inventory";
    const x = document.createElement("button");
    x.className = "ob-x";
    x.textContent = "×";
    x.addEventListener("click", () => this.close());
    head.append(title, x);
    this.equipEl = div("ob-equip");
    const body = div("ob-lootbody");
    this.gridEl = div("ob-grid");
    this.detailEl = div("ob-detail");
    body.append(this.gridEl, this.detailEl);
    const hint = div("ob-hint");
    hint.textContent = "Tap an item to equip / use / drop · ESC or I to close";
    panel.append(head, this.equipEl, body, hint);
    this.root.append(panel);
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  isOpen(): boolean {
    return this.opened;
  }
  setOnClose(fn: () => void): void {
    this.onCloseCb = fn;
  }

  open(state: GameState, onChange: () => void): void {
    this.state = state;
    this.onChange = onChange;
    this.selected = undefined;
    this.opened = true;
    this.root.classList.add("ob-show");
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("ob-show");
    this.onCloseCb?.();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.key === "Escape" || e.key === "i" || e.key === "I") {
      e.stopPropagation();
      this.close();
    }
  };

  private render(): void {
    if (!this.state) return;
    this.equipEl.innerHTML = "";
    this.equipEl.append(
      this.slot("MELEE", equippedMeleeDef(this.state).name, false),
      this.slot("RANGED", equippedRangedDef(this.state)?.name, true),
    );

    this.gridEl.innerHTML = "";
    if (this.state.inventory.length === 0) {
      const e = div("ob-empty");
      e.textContent = "(empty)";
      this.gridEl.append(e);
    }
    for (const it of this.state.inventory) {
      const def = defOf(it.item);
      const cell = document.createElement("button");
      cell.className = "ob-cell" + (this.selected === it.item ? " sel" : "");
      cell.style.borderColor = RARITY_META[def.rarity].css;
      const img = document.createElement("img");
      img.src = iconDataUrl(it.item);
      cell.append(img);
      if (it.qty > 1) {
        const q = document.createElement("span");
        q.className = "ob-qty";
        q.textContent = "x" + it.qty;
        cell.append(q);
      }
      cell.addEventListener("click", () => {
        this.selected = it.item;
        this.render();
      });
      this.gridEl.append(cell);
    }
    this.renderDetail();
  }

  private slot(label: string, name: string | undefined, ranged: boolean): HTMLDivElement {
    const slot = div("ob-slot");
    const img = document.createElement("img");
    const col = document.createElement("div");
    const lab = div("ob-slotlabel");
    lab.textContent = label;
    const txt = document.createElement("div");
    if (name) {
      const def = defOf(name);
      img.src = iconDataUrl(name);
      txt.style.color = RARITY_META[def.rarity].css;
      txt.style.fontSize = "12px";
      txt.textContent = name;
      if (ranged && this.state) {
        const rd = equippedRangedDef(this.state);
        if (rd) {
          const sub = div("ob-dmeta");
          sub.textContent = `${this.state.loadedAmmo ?? 0} / ${ammoReserve(this.state, rd.ammoType)}`;
          txt.append(sub);
        }
      }
    } else {
      img.src = iconDataUrl("Fists");
      txt.className = "ob-dmeta";
      txt.textContent = ranged ? "(no gun)" : "Fists";
    }
    col.append(lab, txt);
    slot.append(img, col);
    return slot;
  }

  private renderDetail(): void {
    this.detailEl.innerHTML = "";
    if (!this.state || !this.selected) {
      const e = div("ob-empty");
      e.textContent = "Select an item.";
      this.detailEl.append(e);
      return;
    }
    const def = defOf(this.selected);
    const name = div("ob-dname");
    name.style.color = RARITY_META[def.rarity].css;
    name.textContent = def.name;
    const meta = div("ob-dmeta");
    meta.textContent = `${RARITY_META[def.rarity].label} · ${def.kind}`;
    this.detailEl.append(name, meta);

    if (isWeaponDef(def)) {
      const stat = div("ob-dstat");
      stat.textContent = `DMG ${def.damage} · RNG ${Math.round(def.range)} · ${def.hand}${def.ammoType ? ` · ${def.ammoType}` : ""}`;
      this.detailEl.append(stat);
      if (def.abilities.length) {
        const ab = div("ob-dabil");
        ab.textContent = def.abilities.map((a) => `${a.kind} ${a.value}`).join(" · ");
        this.detailEl.append(ab);
      }
    } else if (def.kind === "consumable") {
      const stat = div("ob-dstat");
      const eff = Object.entries(def.effects).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ");
      stat.textContent = eff || (def.cure ? "cures infection" : "");
      this.detailEl.append(stat);
    } else if (def.kind === "ammo") {
      const stat = div("ob-dstat");
      stat.textContent = `Ammo · ${def.ammoType}`;
      this.detailEl.append(stat);
    } else if (def.kind === "armor") {
      const stat = div("ob-dstat");
      stat.textContent = `Defense ${def.defense}%`;
      this.detailEl.append(stat);
    }
    if (def.desc) {
      const d = div("ob-dmeta");
      d.textContent = def.desc;
      this.detailEl.append(d);
    }

    const actions = div("ob-actions");
    if (isWeaponDef(def)) actions.append(this.actBtn("Equip", () => this.doEquip(def.name)));
    if (def.kind === "consumable") actions.append(this.actBtn("Use", () => this.doUse(def.name)));
    actions.append(this.actBtn("Drop", () => this.doDrop(def.name), true));
    this.detailEl.append(actions);
  }

  private actBtn(label: string, fn: () => void, secondary = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "ob-act" + (secondary ? " sec" : "");
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  private doEquip(name: string): void {
    if (!this.state) return;
    equipWeapon(this.state, name);
    this.changed();
  }
  private doUse(name: string): void {
    if (!this.state) return;
    useConsumable(this.state, name);
    if (!this.state.inventory.some((i) => i.item === name)) this.selected = undefined;
    this.changed();
  }
  private doDrop(name: string): void {
    if (!this.state) return;
    if (this.state.equippedMelee === name) unequip(this.state, "melee");
    if (this.state.equippedRanged === name) unequip(this.state, "ranged");
    removeItem(this.state, name, 99);
    this.selected = undefined;
    this.changed();
  }
  private changed(): void {
    this.onChange?.();
    this.render();
  }
}

function div(className: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = className;
  return e;
}
