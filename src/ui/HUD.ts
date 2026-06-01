import Phaser from "phaser";
import type { GameState } from "../shared/contracts";
import { clampStat } from "../game/GameState";
import { equippedArmorDef } from "../game/inventory";
import { rarityCss, RARITY_META } from "../game/items/rarity";
import { getBackground } from "../game/backgrounds";
import { weatherName } from "../game/weather";
import { defOf } from "../game/items/catalog";
import { iconKey } from "../engine/icons";

// On-screen HUD (CLAUDE.md §13 Phase 3), decluttered to essentials only: the
// day/name/time/weather line, the 5 survival stat bars, a compact armour readout,
// and a tiny dim debug string. The inventory list, equipped-weapon line, event log,
// always-on controls hint and skills line were moved out (hotbar + bag + one-time
// controls toast carry them now). A top-right panel shows the ACTIVE weapon.
// UI layer — it only READS GameState and never mutates mechanics.

type StatKey = "hp" | "stamina" | "hunger" | "thirst" | "infection";
interface BarDef {
  key: StatKey;
  label: string;
  color: number;
}

const BARS: BarDef[] = [
  { key: "hp", label: "HP", color: 0xff5555 },
  { key: "stamina", label: "STA", color: 0xffd23f },
  { key: "hunger", label: "FOOD", color: 0xff9f43 },
  { key: "thirst", label: "WATER", color: 0x4ec3ff },
  { key: "infection", label: "INF", color: 0x9b5cff },
];

const PANEL_X = 10;
const PANEL_Y = 10;
const PANEL_W = 252;
const BAR_X = 78;
const BAR_W = 120;
const BAR_H = 12;
const BAR_GAP = 6;
const BARS_TOP = 52;
const DEPTH = 1000;

// Top-right active-item panel.
const AP_W = 186;
const AP_H = 40;

export class HUD {
  private readonly scene: Phaser.Scene;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly valueTexts: Phaser.GameObjects.Text[] = [];
  private readonly armorText: Phaser.GameObjects.Text;
  private readonly debugText: Phaser.GameObjects.Text;
  // Active-weapon panel (top-right).
  private readonly apBg: Phaser.GameObjects.Graphics;
  private readonly apIcon: Phaser.GameObjects.Image;
  private readonly apTag: Phaser.GameObjects.Text;
  private readonly apName: Phaser.GameObjects.Text;
  private deathText?: Phaser.GameObjects.Text;
  private readonly layer?: Phaser.GameObjects.Layer;

  constructor(scene: Phaser.Scene, layer?: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
    this.bg = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.bars = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1);
    layer?.add([this.bg, this.bars]);

    const mk = (x: number, y: number, size: string, color: string) => {
      const t = scene.add
        .text(x, y, "", { fontFamily: "monospace", fontSize: size, color })
        .setScrollFactor(0)
        .setDepth(DEPTH + 2);
      layer?.add(t);
      return t;
    };

    this.dayText = mk(PANEL_X + 8, PANEL_Y + 8, "14px", "#f4efe2");
    BARS.forEach((b, i) => {
      const y = BARS_TOP + i * (BAR_H + BAR_GAP);
      mk(PANEL_X + 8, y - 1, "11px", "#c8d2dc").setText(b.label); // static label
      this.valueTexts.push(mk(BAR_X + BAR_W + 8, y - 1, "11px", "#f4efe2"));
    });
    this.armorText = mk(PANEL_X + 8, 0, "11px", "#9fb3c8");
    this.debugText = mk(PANEL_X + 8, 0, "10px", "#5f7488");

    // Active-weapon panel (top-right), rendered each frame from the active selection.
    this.apBg = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.apIcon = scene.add.image(0, 0, iconKey("Fists")).setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
    this.apTag = scene.add
      .text(0, 0, "ACTIVE", { fontFamily: "monospace", fontSize: "9px", color: "#7f93a8" })
      .setScrollFactor(0)
      .setDepth(DEPTH + 2);
    this.apName = scene.add
      .text(0, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#e8eef4" })
      .setScrollFactor(0)
      .setDepth(DEPTH + 2);
    layer?.add([this.apBg, this.apIcon, this.apTag, this.apName]);
  }

  update(
    s: GameState,
    debug: { fps: number; tx: number; ty: number; brain: string },
    activeWeapon?: string,
    clock?: string,
  ): void {
    const bgName = s.background ? getBackground(s.background)?.name : undefined;
    const moon = s.bloodMoon ? "  ·  🔴 BLOOD MOON" : "";
    const time = clock ? `${s.timeOfDay} ${clock}` : s.timeOfDay;
    this.dayText
      .setText(`${s.player.name}${bgName ? ` · ${bgName}` : ""}  ·  Day ${s.day}  ·  ${time}  ·  ${weatherName(s.weather)}${moon}`)
      .setColor(s.bloodMoon ? "#ff6b6b" : "#f4efe2");

    this.bars.clear();
    BARS.forEach((b, i) => {
      const y = BARS_TOP + i * (BAR_H + BAR_GAP);
      const v = clampStat(s.player[b.key]);
      this.bars.fillStyle(0x10151b, 0.85).fillRect(BAR_X, y, BAR_W, BAR_H);
      this.bars.fillStyle(b.color, 1).fillRect(BAR_X, y, (BAR_W * v) / 100, BAR_H);
      this.bars.lineStyle(1, 0x000000, 0.6).strokeRect(BAR_X, y, BAR_W, BAR_H);
      this.valueTexts[i].setText(String(Math.round(v)));
    });

    // Compact armour readout (equipped body + head pieces and their stacked %).
    const armorY = BARS_TOP + BARS.length * (BAR_H + BAR_GAP) + 4;
    const body = equippedArmorDef(s, "body");
    const head = equippedArmorDef(s, "head");
    const total = Math.max(0, Math.min(85, (body?.defense ?? 0) + (head?.defense ?? 0)));
    const armorParts = [body ? `B:${body.defense}` : "B:—", head ? `H:${head.defense}` : "H:—"].join(" ");
    this.armorText.setPosition(PANEL_X + 8, armorY).setText(`ARMOR ${total}%  (${armorParts})`);

    const dY = armorY + this.armorText.height + 6;
    this.debugText
      .setPosition(PANEL_X + 8, dY)
      .setText(`${debug.fps} fps · ${debug.tx},${debug.ty} · GM:${debug.brain}`);

    const bottom = dY + this.debugText.height + 8;
    this.bg.clear();
    this.bg.fillStyle(0x07090c, 0.62).fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, bottom - PANEL_Y, 8);
    this.bg
      .lineStyle(1, 0x223040, 0.8)
      .strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, bottom - PANEL_Y, 8);

    this.renderActivePanel(activeWeapon);
  }

  /** Top-right ACTIVE-weapon panel: icon + rarity-coloured name of the in-hand weapon. */
  private renderActivePanel(name?: string): void {
    this.apBg.clear();
    if (!name) {
      this.apIcon.setVisible(false);
      this.apTag.setVisible(false);
      this.apName.setVisible(false);
      return;
    }
    const def = defOf(name);
    const ax = this.scene.scale.width - AP_W - 10;
    const ay = 10;
    this.apBg.fillStyle(0x07090c, 0.7).fillRoundedRect(ax, ay, AP_W, AP_H, 8);
    this.apBg.lineStyle(1.5, RARITY_META[def.rarity].color, 0.9).strokeRoundedRect(ax, ay, AP_W, AP_H, 8);

    const key = iconKey(name);
    if (this.scene.textures.exists(key) && this.apIcon.texture.key !== key) this.apIcon.setTexture(key);
    this.apIcon.setPosition(ax + AP_W - 22, ay + AP_H / 2).setDisplaySize(30, 30).setVisible(true);
    this.apTag.setPosition(ax + 12, ay + 6).setVisible(true);
    this.apName
      .setPosition(ax + 12, ay + 19)
      .setText(name.length > 18 ? name.slice(0, 17) + "…" : name)
      .setColor(rarityCss(def.rarity))
      .setVisible(true);
  }

  /** Minimal death banner (Phase 6 replaces this with a full GameOver summary). */
  showDeath(reason: string): void {
    if (this.deathText) return;
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    this.deathText = this.scene.add
      .text(w / 2, h / 2, `YOU DIED\n${reason}\n\nPress R for a new run`, {
        fontFamily: "monospace",
        fontSize: "26px",
        color: "#ff6b6b",
        align: "center",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 10);
    this.layer?.add(this.deathText);
  }
}
