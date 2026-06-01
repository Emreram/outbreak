import Phaser from "phaser";
import type { GameState } from "../shared/contracts";
import { biomeAt } from "../game/world/biomes";
import { TILE_COLORS } from "../engine/textures";
import { CHUNK_TILES, TILE_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "../game/constants";

// Minimap & map discovery (Feature 10): a screen-fixed, fog-of-war minimap drawn
// straight from the deterministic generator (each chunk coloured by its biome's base
// tile) with markers for the player, base, vehicles, and discovered landmarks. Toggle
// with M. Only DISCOVERED chunks (visited, tracked on GameState.discovered) are lit;
// the rest stay dark, so the map fills in as you explore.

const CELL = 8; // px per chunk on the map
const HALF = 9; // chunks shown each side of the player (window = 2*HALF+1)
const PAD = 8;

const CHUNK_PX = CHUNK_TILES * TILE_SIZE;

export class Minimap {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private open = false;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(1200).setVisible(false);
    this.title = scene.add
      .text(0, 0, "MAP", { fontFamily: "monospace", fontSize: "11px", color: "#cfe6ff" })
      .setScrollFactor(0)
      .setDepth(1201)
      .setVisible(false);
    layer.add([this.g, this.title]);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.g.setVisible(this.open);
    this.title.setVisible(this.open);
  }

  setVisible(v: boolean): void {
    this.open = v;
    this.g.setVisible(v);
    this.title.setVisible(v);
  }

  /** Redraw around the player (call each frame while open). */
  render(seed: string, state: GameState, screenW: number): void {
    if (!this.open) return;
    const span = 2 * HALF + 1;
    const w = span * CELL;
    const ox = screenW - w - PAD - 4;
    const oy = 40;
    const pcx = Math.floor(state.player.x / CHUNK_PX);
    const pcy = Math.floor(state.player.y / CHUNK_PX);
    const seen = new Set(state.discovered ?? []);

    this.g.clear();
    this.g.fillStyle(0x05080c, 0.82).fillRoundedRect(ox - PAD, oy - PAD, w + PAD * 2, w + PAD * 2, 6);
    this.g.lineStyle(1, 0x2a3a4a, 1).strokeRoundedRect(ox - PAD, oy - PAD, w + PAD * 2, w + PAD * 2, 6);

    for (let dy = -HALF; dy <= HALF; dy++) {
      for (let dx = -HALF; dx <= HALF; dx++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        if (cx < 0 || cy < 0 || cx >= WORLD_CHUNKS_X || cy >= WORLD_CHUNKS_Y) continue;
        const sx = ox + (dx + HALF) * CELL;
        const sy = oy + (dy + HALF) * CELL;
        if (seen.has(`${cx},${cy}`)) {
          this.g.fillStyle(TILE_COLORS[biomeAt(seed, cx, cy).base].fill, 1);
        } else {
          this.g.fillStyle(0x0c1118, 1); // fog
        }
        this.g.fillRect(sx, sy, CELL - 1, CELL - 1);
      }
    }

    const mark = (px: number, py: number, color: number, size = 3) => {
      const dx = px / CHUNK_PX - pcx;
      const dy = py / CHUNK_PX - pcy;
      if (Math.abs(dx) > HALF + 0.5 || Math.abs(dy) > HALF + 0.5) return; // off-window
      const sx = ox + (dx + HALF) * CELL + CELL / 2;
      const sy = oy + (dy + HALF) * CELL + CELL / 2;
      this.g.fillStyle(color, 1).fillRect(sx - size / 2, sy - size / 2, size, size);
    };

    for (const k of state.knownLocations ?? []) mark(k.x, k.y, 0xffd23f, 3); // landmarks
    for (const v of state.vehicles ?? []) mark(v.x, v.y, 0x4aa3ff, 3); // cars
    if (state.base) mark(state.base.x, state.base.y, 0x5ed66e, 4); // home base
    mark(state.player.x, state.player.y, 0xffffff, 4); // you

    this.title.setPosition(ox - PAD, oy - PAD - 14).setText(`MAP  ·  chunk ${pcx},${pcy}  (M)`);
  }
}
