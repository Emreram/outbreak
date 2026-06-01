import Phaser from "phaser";
import type { GameState } from "../shared/contracts";
import { ammoReserve, equippedMeleeDef, equippedRangedDef, quickUseItems } from "../game/inventory";
import { iconKey } from "../engine/icons";
import { RARITY_META } from "../game/items/rarity";

// Bottom-center hotbar: at-a-glance gear + quick-use items. Two gear slots (the
// equipped MELEE + GUN you're holding, gun shows ammo) and four quick-use slots
// (food / drink / heal / cure on number keys 1–4). Lives on the dedicated UI
// layer/camera like the HUD so it renders un-clipped, and only READS GameState.

const SLOT = 46;
const GAP = 7;
const GROUP_GAP = 18; // visual break between the gear pair and the quick-use four
const MARGIN_BOTTOM = 12;
const DEPTH = 1000;
const N = 6; // 2 gear + 4 quick

interface SlotView {
  name?: string;
  rarity?: keyof typeof RARITY_META;
  tag: string; // corner label: "MEL" / "GUN" / "1".."4"
  meta: string; // bottom-right: ammo "12/48" or "x3"
  filled: boolean;
  held?: boolean; // the weapon actually in hand (gun if equipped, else melee)
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
    for (let i = 0; i < N; i++) {
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

  /** Reposition + repaint each frame. `visible=false` hides it (encounter/death/loot). */
  update(s: GameState, visible: boolean): void {
    if (!visible) {
      this.bg.setVisible(false);
      for (let i = 0; i < N; i++) {
        this.icons[i].setVisible(false);
        this.tags[i].setVisible(false);
        this.metas[i].setVisible(false);
      }
      return;
    }
    this.bg.setVisible(true);

    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const rowW = N * SLOT + (N - 1) * GAP + GROUP_GAP;
    const x0 = Math.round((w - rowW) / 2);
    const top = h - SLOT - MARGIN_BOTTOM;
    const left = (i: number): number => x0 + i * (SLOT + GAP) + (i >= 2 ? GROUP_GAP : 0);

    const slots = this.slotViews(s);
    this.bg.clear();
    for (let i = 0; i < N; i++) {
      const lx = left(i);
      const cx = lx + SLOT / 2;
      const v = slots[i];

      this.bg.fillStyle(0x0a0f14, 0.82).fillRoundedRect(lx, top, SLOT, SLOT, 8);
      const border = v.filled && v.rarity ? RARITY_META[v.rarity].color : 0x2a3a4a;
      this.bg.lineStyle(v.held ? 2.5 : 2, border, v.filled ? 0.95 : 0.55).strokeRoundedRect(lx, top, SLOT, SLOT, 8);
      if (v.held) this.bg.lineStyle(1, 0x7fd3ff, 0.9).strokeRoundedRect(lx - 2, top - 2, SLOT + 4, SLOT + 4, 9);

      const img = this.icons[i];
      if (v.filled && v.name) {
        const key = iconKey(v.name);
        if (this.scene.textures.exists(key) && img.texture.key !== key) img.setTexture(key);
        img.setPosition(cx, top + SLOT / 2).setDisplaySize(SLOT - 10, SLOT - 10).setVisible(true);
      } else {
        img.setVisible(false);
      }

      this.tags[i].setPosition(lx + 4, top + 3).setText(v.tag).setColor(v.filled ? "#cfe6ff" : "#6f8296").setVisible(true);
      this.metas[i].setPosition(lx + SLOT - 4, top + SLOT - 3).setText(v.meta).setVisible(!!v.meta);
    }
  }

  private slotViews(s: GameState): SlotView[] {
    const melee = equippedMeleeDef(s);
    const gun = equippedRangedDef(s);
    const heldRanged = !!gun;
    const quick = quickUseItems(s);

    const views: SlotView[] = [
      { name: melee.name, rarity: melee.rarity, tag: "MEL", meta: "", filled: true, held: !heldRanged },
      gun
        ? { name: gun.name, rarity: gun.rarity, tag: "GUN", meta: `${s.loadedAmmo ?? 0}/${ammoReserve(s, gun.ammoType)}`, filled: true, held: true }
        : { tag: "GUN", meta: "", filled: false },
    ];
    for (let i = 0; i < 4; i++) {
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
