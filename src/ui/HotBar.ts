import Phaser from "phaser";
import type { GameState } from "../shared/contracts";
import { ammoReserve, quickUseItems, weaponsInBag } from "../game/inventory";
import { iconKey } from "../engine/icons";
import { RARITY_META } from "../game/items/rarity";

// Bottom-center hotbar: a dynamic WEAPON STRIP (all carried weapons, melee-first,
// capped at 6 — cycled by the scroll-wheel or number keys 5–0, the active one
// highlighted) followed by four CONSUMABLE quick-slots (food / drink / heal / cure
// on 1–4 / Q). Lives on the dedicated UI layer/camera like the HUD so it renders
// un-clipped, and only READS GameState.

const SLOT = 44;
const GAP = 6;
const GROUP_GAP = 18; // visual break between the weapon strip and the quick four
const MARGIN_BOTTOM = 12;
const DEPTH = 1000;
const MAX_WEAPONS = 6;
const QUICK = 4;
const MAXN = MAX_WEAPONS + QUICK; // pool size for the slot game objects
const WKEYS = ["5", "6", "7", "8", "9", "0"]; // number keys that select weapon slots

interface SlotView {
  name?: string;
  rarity?: keyof typeof RARITY_META;
  tag: string; // corner label: weapon key "5".."0" or quick "1".."4"
  meta: string; // bottom-right: ammo "12/48" or "x3"
  filled: boolean;
  held?: boolean; // the ACTIVE in-hand weapon
  weapon?: boolean; // a weapon-strip slot (vs a consumable quick slot)
}

export class HotBar {
  private readonly scene: Phaser.Scene;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly icons: Phaser.GameObjects.Image[] = [];
  private readonly tags: Phaser.GameObjects.Text[] = [];
  private readonly metas: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, layer?: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.bg = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    layer?.add(this.bg);

    const placeholder = iconKey("Fists");
    for (let i = 0; i < MAXN; i++) {
      const img = scene.add.image(0, 0, placeholder).setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
      const tag = scene.add
        .text(0, 0, "", { fontFamily: "monospace", fontSize: "9px", color: "#9fb3c8" })
        .setScrollFactor(0)
        .setDepth(DEPTH + 2);
      const meta = scene.add
        .text(0, 0, "", { fontFamily: "monospace", fontSize: "10px", color: "#e8eef4", stroke: "#000000", strokeThickness: 3 })
        .setOrigin(1, 1)
        .setScrollFactor(0)
        .setDepth(DEPTH + 2);
      this.icons.push(img);
      this.tags.push(tag);
      this.metas.push(meta);
      layer?.add([img, tag, meta]);
    }
  }

  /** Reposition + repaint each frame. `visible=false` hides it (encounter/death/loot).
   *  `selectedQuick` is the quick-use slot (0–3) Q/middle-click uses; `activeWeapon`
   *  is the index of the in-hand weapon in the strip. */
  update(s: GameState, visible: boolean, selectedQuick = -1, activeWeapon = 0): void {
    const slots = visible ? this.slotViews(s, activeWeapon) : [];
    const count = slots.length;
    if (!visible || count === 0) {
      this.bg.setVisible(false);
      for (let i = 0; i < MAXN; i++) {
        this.icons[i].setVisible(false);
        this.tags[i].setVisible(false);
        this.metas[i].setVisible(false);
      }
      return;
    }
    this.bg.setVisible(true);

    const weaponCount = slots.filter((v) => v.weapon).length;
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const rowW = count * SLOT + (count - 1) * GAP + (weaponCount > 0 && weaponCount < count ? GROUP_GAP : 0);
    const x0 = Math.round((w - rowW) / 2);
    const top = h - SLOT - MARGIN_BOTTOM;
    // The quick group is shoved right by GROUP_GAP (only when a weapon strip precedes it).
    const left = (i: number): number => x0 + i * (SLOT + GAP) + (weaponCount > 0 && i >= weaponCount ? GROUP_GAP : 0);
    const selQuickSlot = selectedQuick >= 0 ? weaponCount + selectedQuick : -1;

    this.bg.clear();
    for (let i = 0; i < MAXN; i++) {
      if (i >= count) {
        this.icons[i].setVisible(false);
        this.tags[i].setVisible(false);
        this.metas[i].setVisible(false);
        continue;
      }
      const lx = left(i);
      const cx = lx + SLOT / 2;
      const v = slots[i];

      this.bg.fillStyle(0x0a0f14, 0.82).fillRoundedRect(lx, top, SLOT, SLOT, 8);
      const border = v.filled && v.rarity ? RARITY_META[v.rarity].color : 0x2a3a4a;
      this.bg.lineStyle(v.held ? 2.5 : 2, border, v.filled ? 0.95 : 0.55).strokeRoundedRect(lx, top, SLOT, SLOT, 8);
      // Cyan held-glow on the ACTIVE in-hand weapon.
      if (v.held) this.bg.lineStyle(1, 0x7fd3ff, 0.9).strokeRoundedRect(lx - 2, top - 2, SLOT + 4, SLOT + 4, 9);
      // Yellow cursor on the selected quick-use slot.
      if (i === selQuickSlot && v.filled) this.bg.lineStyle(2.5, 0xffd23f, 1).strokeRoundedRect(lx - 3, top - 3, SLOT + 6, SLOT + 6, 10);

      const img = this.icons[i];
      if (v.filled && v.name) {
        const key = iconKey(v.name);
        if (this.scene.textures.exists(key) && img.texture.key !== key) img.setTexture(key);
        img.setPosition(cx, top + SLOT / 2).setDisplaySize(SLOT - 10, SLOT - 10).setVisible(true);
      } else {
        img.setVisible(false);
      }

      const tagColor = v.held ? "#7fd3ff" : i === selQuickSlot && v.filled ? "#ffd23f" : v.filled ? "#cfe6ff" : "#6f8296";
      this.tags[i].setPosition(lx + 4, top + 3).setText(v.tag).setColor(tagColor).setVisible(true);
      this.metas[i].setPosition(lx + SLOT - 4, top + SLOT - 3).setText(v.meta).setVisible(!!v.meta);
    }
  }

  private slotViews(s: GameState, activeWeapon: number): SlotView[] {
    const views: SlotView[] = [];

    const weapons = weaponsInBag(s).slice(0, MAX_WEAPONS);
    weapons.forEach((wdef, i) => {
      let meta = "";
      if (wdef.hand === "ranged") {
        const reserve = ammoReserve(s, wdef.ammoType);
        meta = wdef.name === s.equippedRanged ? `${s.loadedAmmo ?? 0}/${reserve}` : `${reserve}`;
      }
      views.push({ name: wdef.name, rarity: wdef.rarity, tag: WKEYS[i], meta, filled: true, held: i === activeWeapon, weapon: true });
    });

    const quick = quickUseItems(s);
    for (let i = 0; i < QUICK; i++) {
      const q = quick[i];
      views.push(
        q
          ? { name: q.item, rarity: q.def.rarity, tag: String(i + 1), meta: q.qty > 1 ? `x${q.qty}` : "", filled: true }
          : { tag: String(i + 1), meta: "", filled: false },
      );
    }
    return views;
  }
}
