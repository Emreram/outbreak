import Phaser from "phaser";
import type { GameState } from "../shared/contracts";
import { clampStat } from "../game/GameState";
import { ammoReserve, equippedMeleeDef, equippedRangedDef } from "../game/inventory";
import { rarityCss } from "../game/items/rarity";

// On-screen HUD (CLAUDE.md §13 Phase 3): HP / stamina / hunger / thirst /
// infection bars + inventory + day/time, fixed to the camera. UI layer — it
// only READS GameState and never mutates mechanics.

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

export class HUD {
  private readonly scene: Phaser.Scene;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly valueTexts: Phaser.GameObjects.Text[] = [];
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly invText: Phaser.GameObjects.Text;
  private readonly logText: Phaser.GameObjects.Text;
  private readonly controlsText: Phaser.GameObjects.Text;
  private readonly debugText: Phaser.GameObjects.Text;
  private deathText?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.bg = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH);
    this.bars = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1);

    const mk = (x: number, y: number, size: string, color: string) =>
      scene.add
        .text(x, y, "", { fontFamily: "monospace", fontSize: size, color })
        .setScrollFactor(0)
        .setDepth(DEPTH + 2);

    this.dayText = mk(PANEL_X + 8, PANEL_Y + 8, "14px", "#f4efe2");
    BARS.forEach((b, i) => {
      const y = BARS_TOP + i * (BAR_H + BAR_GAP);
      mk(PANEL_X + 8, y - 1, "11px", "#c8d2dc").setText(b.label); // static label
      this.valueTexts.push(mk(BAR_X + BAR_W + 8, y - 1, "11px", "#f4efe2"));
    });
    this.weaponText = mk(PANEL_X + 8, 0, "12px", "#cdd9e5");
    this.invText = mk(PANEL_X + 8, 0, "12px", "#e8e2d0");
    this.logText = scene.add
      .text(PANEL_X + 8, 0, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#cdb89a",
        wordWrap: { width: PANEL_W - 20 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH + 2);
    this.controlsText = mk(PANEL_X + 8, 0, "11px", "#8fa3b8");
    this.debugText = mk(PANEL_X + 8, 0, "11px", "#7f93a8");
  }

  update(s: GameState, debug: { fps: number; tx: number; ty: number; brain: string }): void {
    this.dayText.setText(`${s.player.name}  ·  Day ${s.day}  ·  ${s.timeOfDay}`);

    this.bars.clear();
    BARS.forEach((b, i) => {
      const y = BARS_TOP + i * (BAR_H + BAR_GAP);
      const v = clampStat(s.player[b.key]);
      this.bars.fillStyle(0x10151b, 0.85).fillRect(BAR_X, y, BAR_W, BAR_H);
      this.bars.fillStyle(b.color, 1).fillRect(BAR_X, y, (BAR_W * v) / 100, BAR_H);
      this.bars.lineStyle(1, 0x000000, 0.6).strokeRect(BAR_X, y, BAR_W, BAR_H);
      this.valueTexts[i].setText(String(Math.round(v)));
    });

    // Equipped weapons + ammo (rarity-coloured).
    const weaponY = BARS_TOP + BARS.length * (BAR_H + BAR_GAP) + 6;
    const md = equippedMeleeDef(s);
    const rd = equippedRangedDef(s);
    let wline = `MELEE  ${md.name}`;
    if (rd) wline += `\nGUN    ${rd.name}  ${s.loadedAmmo ?? 0}/${ammoReserve(s, rd.ammoType)}`;
    this.weaponText.setPosition(PANEL_X + 8, weaponY).setText(wline).setColor(rarityCss((rd ?? md).rarity));

    const invY = weaponY + this.weaponText.height + 8;
    const list = s.inventory.length
      ? s.inventory.map((it) => `· ${it.item} x${it.qty}`).join("\n")
      : "· (empty)";
    this.invText.setPosition(PANEL_X + 8, invY).setText("Inventory:\n" + list);

    // Latest event — narrative continuity / shows the AI's last impact.
    const logY = invY + this.invText.height + 8;
    const last = s.recentEvents[s.recentEvents.length - 1] ?? "";
    this.logText.setPosition(PANEL_X + 8, logY).setText(last ? `» ${last}` : "");
    const cY = logY + (last ? this.logText.height + 8 : 0);

    this.controlsText
      .setPosition(PANEL_X + 8, cY)
      .setText("WASD move · MOUSE aim/fire · SPACE/F melee · E act\nShift run · R reload · I bag · ESC menu · [1-4] use");

    const dY = cY + this.controlsText.height + 6;
    this.debugText
      .setPosition(PANEL_X + 8, dY)
      .setText(`seed ${s.seed} · ${debug.fps} fps · GM:${debug.brain}`);

    const bottom = dY + this.debugText.height + 8;
    this.bg.clear();
    this.bg.fillStyle(0x07090c, 0.62).fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, bottom - PANEL_Y, 8);
    this.bg
      .lineStyle(1, 0x223040, 0.8)
      .strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, bottom - PANEL_Y, 8);
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
  }
}
