// Minimap as a 2D canvas overlay (3D master plan §6.3) — identical data and
// palette to ui/Minimap.ts: chunk cells coloured by biome base tile (mapColor
// override for water-identity biomes), fog-of-war from GameState.discovered,
// landmark/vehicle/base/player marks, blood-moon red wash. Display-only: it
// reads state, never mutates it. Toggle with M.

import type { GameState } from "../../shared/contracts";
import { biomeAt } from "../../game/world/biomes";
import { TILE_COLORS } from "../../shared/tilePalette";
import { CHUNK_TILES, TILE_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Y } from "../../game/constants";
import { Tile } from "../../game/world/tiles";

const CELL = 8;
const HALF = 9;
const PAD = 8;
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;

function css(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`;
}

export class MinimapOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLDivElement;
  private open = false;

  constructor(parent: HTMLElement) {
    const span = 2 * HALF + 1;
    const w = span * CELL + PAD * 2;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = w;
    this.canvas.style.cssText = `position:fixed;top:40px;right:12px;width:${w}px;height:${w}px;border-radius:6px;display:none;z-index:20;pointer-events:none;`;
    this.title = document.createElement("div");
    this.title.style.cssText =
      "position:fixed;top:24px;right:12px;color:#cfe6ff;font:11px ui-monospace,monospace;display:none;z-index:20;pointer-events:none;";
    parent.appendChild(this.canvas);
    parent.appendChild(this.title);
    this.ctx = this.canvas.getContext("2d")!;
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.canvas.style.display = this.open ? "block" : "none";
    this.title.style.display = this.open ? "block" : "none";
  }

  render(seed: string, state: GameState): void {
    if (!this.open) return;
    const ctx = this.ctx;
    const span = 2 * HALF + 1;
    const w = span * CELL;
    const pcx = Math.floor(state.player.x / CHUNK_PX);
    const pcy = Math.floor(state.player.y / CHUNK_PX);
    const seen = new Set(state.discovered ?? []);

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "rgba(5,8,12,0.82)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = state.bloodMoon ? "#ff3a3a" : "#2a3a4a";
    ctx.strokeRect(0.5, 0.5, this.canvas.width - 1, this.canvas.height - 1);

    for (let dy = -HALF; dy <= HALF; dy++) {
      for (let dx = -HALF; dx <= HALF; dx++) {
        const cx = pcx + dx;
        const cy = pcy + dy;
        if (cx < 0 || cy < 0 || cx >= WORLD_CHUNKS_X || cy >= WORLD_CHUNKS_Y) continue;
        const sx = PAD + (dx + HALF) * CELL;
        const sy = PAD + (dy + HALF) * CELL;
        if (seen.has(`${cx},${cy}`)) {
          const b = biomeAt(seed, cx, cy);
          ctx.fillStyle = css(b.mapColor ?? TILE_COLORS[b.base as Tile].fill);
        } else {
          ctx.fillStyle = "#0c1118"; // fog
        }
        ctx.fillRect(sx, sy, CELL - 1, CELL - 1);
      }
    }

    if (state.bloodMoon) {
      ctx.fillStyle = "rgba(255,0,0,0.16)";
      ctx.fillRect(PAD, PAD, w, w);
    }

    const mark = (px: number, py: number, color: string, size = 3): void => {
      const dx = px / CHUNK_PX - pcx;
      const dy = py / CHUNK_PX - pcy;
      if (Math.abs(dx) > HALF + 0.5 || Math.abs(dy) > HALF + 0.5) return;
      const sx = PAD + (dx + HALF) * CELL + CELL / 2;
      const sy = PAD + (dy + HALF) * CELL + CELL / 2;
      ctx.fillStyle = color;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    };

    for (const k of state.knownLocations ?? []) mark(k.x, k.y, "#ffd23f", 3);
    for (const v of state.vehicles ?? []) mark(v.x, v.y, "#4aa3ff", 3);
    if (state.base) mark(state.base.x, state.base.y, "#5ed66e", 4);
    mark(state.player.x, state.player.y, "#ffffff", 4);

    this.title.textContent = `MAP · chunk ${pcx},${pcy} (M)`;
    this.title.style.color = state.bloodMoon ? "#ff6b6b" : "#cfe6ff";
  }
}
