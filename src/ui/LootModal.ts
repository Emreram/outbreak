import type { GameState } from "../shared/contracts";
import { isWeaponDef } from "../game/items/types";
import { defOf } from "../game/items/catalog";
import { ammoReserve, equipArmor, equipWeapon, equippedArmorDef, equippedMeleeDef, equippedRangedDef, removeItem, unequip, unequipArmor } from "../game/inventory";
import { useConsumable } from "../game/GameState";
import { iconDataUrl } from "../engine/icons";
import { RARITY_META } from "../game/items/rarity";
import { SKILLS, SKILL_ABBR, skillLevel } from "../game/skills";

// Loot / inventory / equip screen — styled as a rugged survival BACKPACK: a stitched
// leather/canvas frame with brass rivets, MOLLE-style loadout pouches (melee / gun /
// body / head), a worn main compartment grid, a field-notes detail card, and a load
// gauge. Pure presentation over the same logic — it only reads + mutates the
// authoritative GameState through the inventory/equip APIs.

const STYLE_ID = "ob-loot-style";
const CSS = `
.ob-loot{position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center, rgba(6,9,12,.5), rgba(2,3,5,.82));
  font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-loot.ob-show{display:flex;animation:ob-fade .16s ease}
@keyframes ob-fade{from{opacity:0}to{opacity:1}}

.ob-bp{position:relative;width:min(800px,96vw);max-height:92vh;display:flex;flex-direction:column;
  color:#e9e0cd;border-radius:16px;padding:15px;box-sizing:border-box;
  background:
    repeating-linear-gradient(45deg, rgba(255,255,255,.012) 0 2px, transparent 2px 7px),
    linear-gradient(160deg,#23271d,#171a13 58%,#10120c);
  border:2px solid #3a2c1c;
  box-shadow:0 26px 72px rgba(0,0,0,.66), inset 0 0 0 4px rgba(0,0,0,.32), inset 0 0 46px rgba(0,0,0,.5);
  animation:ob-rise .22s cubic-bezier(.2,.85,.3,1)}
@keyframes ob-rise{from{transform:translateY(12px) scale(.98);opacity:0}to{transform:none;opacity:1}}
.ob-bp::before{content:"";position:absolute;inset:7px;border:1.5px dashed rgba(190,150,90,.32);border-radius:11px;pointer-events:none}
.ob-bp::after{content:"";position:absolute;inset:0;border-radius:16px;pointer-events:none;
  background:
    radial-gradient(circle at 15px 15px, #6b5326 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 15px) 15px, #6b5326 2.5px, transparent 3.5px),
    radial-gradient(circle at 15px calc(100% - 15px), #6b5326 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 15px) calc(100% - 15px), #6b5326 2.5px, transparent 3.5px)}

.ob-bp-flap{position:relative;z-index:1;display:flex;align-items:center;gap:12px;padding:4px 6px 11px;
  border-bottom:2px solid #3a2c1c;margin-bottom:11px}
.ob-bp-badge{display:flex;flex-direction:column;line-height:1.2;min-width:0}
.ob-bp-title{font-size:15px;letter-spacing:.24em;font-weight:700;color:#e8d6a8;text-shadow:0 1px 0 #000}
.ob-bp-sub{font-size:10px;letter-spacing:.1em;color:#9a8e6f;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ob-bp-skills{flex:1;font-size:11px;color:#bfe9ff;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-bp-x{flex:none;width:36px;height:36px;border-radius:50%;border:2px solid #6b5326;cursor:pointer;line-height:1;
  color:#221a0e;font:inherit;font-size:18px;font-weight:700;background:radial-gradient(circle at 38% 32%,#e3bd5f,#8a6320);
  box-shadow:inset 0 1px 2px rgba(255,255,255,.5), 0 2px 5px rgba(0,0,0,.55)}
.ob-bp-x:hover{filter:brightness(1.12)}

.ob-bp-strap{display:flex;align-items:center;gap:10px;margin:0 2px 12px;font-size:10px;letter-spacing:.16em;color:#9a8e6f}
.ob-bp-gauge{flex:1;height:9px;border-radius:6px;background:#0c0f0a;border:1px solid #3a2c1c;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.6)}
.ob-bp-gaugefill{height:100%;width:0;background:linear-gradient(90deg,#7c9a3a,#c2d24a);transition:width .25s}
.ob-bp-capnum{color:#cdd2b8;white-space:nowrap}

.ob-bp-body{display:grid;grid-template-columns:184px 1fr 234px;gap:12px;min-height:0;flex:1}
.ob-bp-col{display:flex;flex-direction:column;gap:7px;min-height:0}
.ob-bp-cap{font-size:10px;letter-spacing:.2em;color:#8a7e60;text-transform:uppercase;padding-left:2px}

.ob-bp-pouches{display:flex;flex-direction:column;gap:8px;overflow:auto}
.ob-slot{display:flex;gap:9px;align-items:center;padding:8px;border-radius:9px;
  background:linear-gradient(160deg,#1b2016,#121509);border:1.5px solid #3a2c1c;box-shadow:inset 0 0 0 1px rgba(0,0,0,.4)}
.ob-slot img{width:34px;height:34px;flex:none}
.ob-slotcol{min-width:0;display:flex;flex-direction:column;gap:2px}
.ob-slotcol>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ob-slot.ob-slotbtn{cursor:pointer}
.ob-slot.ob-slotbtn:hover{border-color:#6b5326;background:linear-gradient(160deg,#222717,#15180c)}
.ob-slotlabel{font-size:9px;letter-spacing:.18em;color:#8a7e60}

.ob-bp-main{min-width:0}
.ob-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,54px);grid-auto-rows:54px;gap:7px;overflow:auto;align-content:start;
  padding:10px;border-radius:10px;background:radial-gradient(ellipse at top,#0e120b,#080a06);
  border:1.5px solid #2a2114;box-shadow:inset 0 6px 18px rgba(0,0,0,.6)}
.ob-cell{position:relative;width:54px;height:54px;border-radius:9px;cursor:pointer;padding:0;
  background:linear-gradient(160deg,#141811,#0a0c07);border:2px solid #3a4a2f;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);transition:transform .08s, box-shadow .12s}
.ob-cell:hover{transform:translateY(-2px);box-shadow:0 5px 11px rgba(0,0,0,.55)}
.ob-cell img{width:46px;height:46px;display:block;margin:2px auto}
.ob-cell.sel{outline:2px solid #e8d6a8;outline-offset:2px}
.ob-qty{position:absolute;right:4px;bottom:2px;font-size:10px;color:#fff;text-shadow:0 1px 2px #000}
.ob-newb{position:absolute;left:2px;top:2px;font-size:7px;letter-spacing:.06em;font-weight:700;color:#10130a;
  background:linear-gradient(180deg,#ffe08a,#d9a441);border-radius:3px;padding:1px 3px;box-shadow:0 1px 2px rgba(0,0,0,.5)}

.ob-detail{display:flex;flex-direction:column;gap:7px;padding:13px;border-radius:10px;overflow:auto;
  background:linear-gradient(160deg,#1a1f15,#10130b);border:1.5px solid #3a2c1c;box-shadow:inset 0 0 0 1px rgba(0,0,0,.4)}
.ob-dname{font-size:16px;font-weight:700;line-height:1.2}
.ob-dmeta{font-size:11px;color:#9a8e6f}
.ob-dstat{font-size:12px;color:#cdd2b8}
.ob-dabil{font-size:12px;color:#bfe9ff}
.ob-actions{display:flex;gap:7px;margin-top:auto;flex-wrap:wrap;padding-top:9px}
.ob-act{flex:1;min-width:64px;border:none;border-radius:8px;padding:9px;font:inherit;font-weight:700;cursor:pointer;font-size:12px;letter-spacing:.04em;
  color:#10130b;background:linear-gradient(180deg,#cdd24a,#8a9a2f);box-shadow:0 2px 4px rgba(0,0,0,.45)}
.ob-act:hover{filter:brightness(1.08)}
.ob-act.sec{color:#e9e0cd;background:linear-gradient(180deg,#3a2c1c,#241a10)}
.ob-empty{color:#8a7e60;font-size:12px}
.ob-bp-foot{font-size:11px;color:#7a6f54;text-align:center;padding-top:11px}

@media(max-width:640px){.ob-bp-body{grid-template-columns:1fr}.ob-bp-pouches{flex-direction:row;flex-wrap:wrap}.ob-slot{flex:1;min-width:130px}.ob-detail{max-height:30vh}}
`;

export class LootModal {
  private readonly root: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly skillsEl: HTMLDivElement;
  private readonly capFill: HTMLDivElement;
  private readonly capText: HTMLDivElement;
  private readonly equipEl: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;

  private state?: GameState;
  private onChange?: () => void;
  private onCloseCb?: () => void;
  private onRead?: (name: string) => void;
  // "NEW" badges (U3): names seen at the last open; first open seeds the set.
  private readonly seen = new Set<string>();
  private seenInit = false;
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
    const bp = div("ob-bp");

    // Flap header: stamped title + survivor line, skills, brass buckle close.
    const flap = div("ob-bp-flap");
    const badge = div("ob-bp-badge");
    const title = div("ob-bp-title");
    title.textContent = "BACKPACK";
    this.subEl = div("ob-bp-sub");
    badge.append(title, this.subEl);
    this.skillsEl = div("ob-bp-skills");
    const x = document.createElement("button");
    x.className = "ob-bp-x";
    x.textContent = "×";
    x.addEventListener("click", () => this.close());
    flap.append(badge, this.skillsEl, x);

    // Load gauge (cosmetic strap).
    const strap = div("ob-bp-strap");
    const strapLabel = div("ob-bp-straplabel");
    strapLabel.textContent = "LOAD";
    const gauge = div("ob-bp-gauge");
    this.capFill = div("ob-bp-gaugefill");
    gauge.append(this.capFill);
    this.capText = div("ob-bp-capnum");
    strap.append(strapLabel, gauge, this.capText);

    // Three compartments: loadout pouches · main pocket grid · field notes.
    const body = div("ob-bp-body");
    const loadCol = div("ob-bp-col");
    loadCol.append(cap("Loadout"));
    this.equipEl = div("ob-bp-pouches");
    loadCol.append(this.equipEl);

    const mainCol = div("ob-bp-col ob-bp-main");
    mainCol.append(cap("Main Pocket"));
    this.gridEl = div("ob-grid");
    mainCol.append(this.gridEl);

    const sideCol = div("ob-bp-col");
    sideCol.append(cap("Field Notes"));
    this.detailEl = div("ob-detail");
    sideCol.append(this.detailEl);

    body.append(loadCol, mainCol, sideCol);

    const foot = div("ob-bp-foot");
    foot.textContent = "Click an item to equip / use / drop  ·  click a worn piece to remove it  ·  ESC or I to close";

    bp.append(flap, strap, body, foot);
    this.root.append(bp);
    document.body.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  isOpen(): boolean {
    return this.opened;
  }
  setOnClose(fn: () => void): void {
    this.onCloseCb = fn;
  }
  /** Reading is scene-owned (flavour vs stash-map pinning) — see WorldScene.readItem. */
  setOnRead(fn: (name: string) => void): void {
    this.onRead = fn;
  }

  open(state: GameState, onChange: () => void): void {
    this.state = state;
    this.onChange = onChange;
    this.selected = undefined;
    this.opened = true;
    if (!this.seenInit) {
      this.seenInit = true;
      for (const it of state.inventory) this.seen.add(it.item); // starting kit isn't "NEW"
    }
    this.root.classList.add("ob-show");
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    if (this.state) for (const it of this.state.inventory) this.seen.add(it.item); // inspected
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
    const s = this.state;
    this.subEl.textContent = `${s.player.name}  ·  Day ${s.day}`;
    this.skillsEl.textContent = SKILLS.map((id) => `${SKILL_ABBR[id]} ${skillLevel(s, id)}`).join(" · ");

    const stacks = s.inventory.length;
    const totalQty = s.inventory.reduce((a, i) => a + i.qty, 0);
    this.capFill.style.width = Math.min(100, (stacks / 36) * 100) + "%";
    this.capText.textContent = `${stacks} pocket${stacks === 1 ? "" : "s"} · ${totalQty} item${totalQty === 1 ? "" : "s"}`;

    this.equipEl.innerHTML = "";
    this.equipEl.append(
      this.slot("MELEE", equippedMeleeDef(s).name, false),
      this.slot("RANGED", equippedRangedDef(s)?.name, true),
      this.armorSlot("BODY", "body"),
      this.armorSlot("HEAD", "head"),
    );

    this.gridEl.innerHTML = "";
    if (this.state.inventory.length === 0) {
      const e = div("ob-empty");
      e.textContent = "The pack is empty — scavenge the world for supplies.";
      this.gridEl.append(e);
    }
    for (const it of this.state.inventory) {
      const def = defOf(it.item);
      const cell = document.createElement("button");
      cell.className = "ob-cell" + (this.selected === it.item ? " sel" : "");
      // The rarer the item, the hotter its cell glows — and epic+ gets an outer aura.
      const meta = RARITY_META[def.rarity];
      const a = ["22", "30", "40", "5c", "80", "aa"][meta.rank];
      const outer = meta.rank >= 3 ? `, 0 0 ${4 + meta.rank * 3}px ${meta.css}${a}` : "";
      cell.style.borderColor = meta.css;
      cell.style.boxShadow = `inset 0 0 ${10 + meta.rank * 4}px ${meta.css}${a}${outer}, inset 0 1px 0 rgba(255,255,255,.05)`;
      cell.title = `${def.name} (${meta.label})`;
      const img = document.createElement("img");
      img.src = iconDataUrl(it.item);
      cell.append(img);
      if (it.qty > 1) {
        const q = document.createElement("span");
        q.className = "ob-qty";
        q.textContent = "x" + it.qty;
        cell.append(q);
      }
      if (!this.seen.has(it.item)) {
        const b = document.createElement("span");
        b.className = "ob-newb";
        b.textContent = "NEW";
        cell.append(b);
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
    const col = div("ob-slotcol");
    const lab = div("ob-slotlabel");
    lab.textContent = label;
    const txt = document.createElement("div");
    if (name) {
      const def = defOf(name);
      img.src = iconDataUrl(name);
      txt.style.color = RARITY_META[def.rarity].css;
      txt.style.fontSize = "12px";
      txt.textContent = name;
    } else {
      img.src = iconDataUrl("Fists");
      img.style.opacity = "0.4";
      txt.className = "ob-dmeta";
      txt.textContent = ranged ? "(no gun)" : "Fists";
    }
    col.append(lab, txt);
    if (name && ranged && this.state) {
      const rd = equippedRangedDef(this.state);
      if (rd) {
        const sub = div("ob-dmeta");
        sub.textContent = `${this.state.loadedAmmo ?? 0} / ${ammoReserve(this.state, rd.ammoType)}`;
        col.append(sub);
      }
    }
    slot.append(img, col);
    return slot;
  }

  /** A body/head armour equip slot: shows the worn piece + its %, click to remove. */
  private armorSlot(label: string, which: "head" | "body"): HTMLDivElement {
    const el = div("ob-slot ob-slotbtn");
    const img = document.createElement("img");
    const col = div("ob-slotcol");
    const lab = div("ob-slotlabel");
    lab.textContent = label;
    const txt = document.createElement("div");
    const def = this.state ? equippedArmorDef(this.state, which) : undefined;
    if (def) {
      img.src = iconDataUrl(def.name);
      txt.style.color = RARITY_META[def.rarity].css;
      txt.style.fontSize = "12px";
      txt.textContent = def.name;
      const sub = div("ob-dmeta");
      sub.textContent = `+${def.defense}% · remove`;
      col.append(lab, txt, sub);
      el.addEventListener("click", () => {
        if (!this.state) return;
        unequipArmor(this.state, which);
        this.changed();
      });
    } else {
      img.src = iconDataUrl(which === "head" ? "Helmet" : "Leather Jacket");
      img.style.opacity = "0.25";
      txt.className = "ob-dmeta";
      txt.textContent = `(no ${which})`;
      col.append(lab, txt);
    }
    el.append(img, col);
    return el;
  }

  private renderDetail(): void {
    this.detailEl.innerHTML = "";
    if (!this.state || !this.selected) {
      const e = div("ob-empty");
      e.textContent = "Select an item to inspect it.";
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
      stat.textContent = `Defense ${def.defense}%${def.slot ? ` · ${def.slot}` : ""}`;
      this.detailEl.append(stat);
    } else if (def.kind === "readable") {
      const stat = div("ob-dstat");
      stat.textContent = def.flavor === "map" ? "Reading it pins a buried cache on your map" : "Found writing — read it";
      this.detailEl.append(stat);
    }
    if (def.desc) {
      const d = div("ob-dmeta");
      d.textContent = def.desc;
      this.detailEl.append(d);
    }

    const actions = div("ob-actions");
    if (isWeaponDef(def)) actions.append(this.actBtn("Equip", () => this.doEquip(def.name)));
    if (def.kind === "armor") actions.append(this.actBtn("Equip", () => this.doEquipArmor(def.name)));
    if (def.kind === "consumable") actions.append(this.actBtn("Use", () => this.doUse(def.name)));
    if (def.kind === "readable") actions.append(this.actBtn("Read", () => this.doRead(def.name)));
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
  private doEquipArmor(name: string): void {
    if (!this.state) return;
    equipArmor(this.state, name);
    this.changed();
  }
  private doUse(name: string): void {
    if (!this.state) return;
    useConsumable(this.state, name);
    if (!this.state.inventory.some((i) => i.item === name)) this.selected = undefined;
    this.changed();
  }
  private doRead(name: string): void {
    if (!this.state) return;
    this.onRead?.(name);
    if (!this.state.inventory.some((i) => i.item === name)) this.selected = undefined; // maps consume
    this.changed();
  }
  private doDrop(name: string): void {
    if (!this.state) return;
    if (this.state.equippedMelee === name) unequip(this.state, "melee");
    if (this.state.equippedRanged === name) unequip(this.state, "ranged");
    if (this.state.player.equippedArmorBody === name) unequipArmor(this.state, "body");
    if (this.state.player.equippedArmorHead === name) unequipArmor(this.state, "head");
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

function cap(text: string): HTMLDivElement {
  const e = div("ob-bp-cap");
  e.textContent = text;
  return e;
}
