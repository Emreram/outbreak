// World labels (3D master plan §3.5 step 7): landmark + notable-building
// signage as pooled GUI TextBlocks projected to world anchors, distance-faded.
// Same filters as the Phaser ChunkRenderer: landmarks always, buildings only
// when ≥5×4 tiles and not a filler type. Pool capped at 40.

import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { SimChunkStore } from "../sim/world";
import { landmarkStyle } from "../game/world/landmarks";
import { CHUNK_TILES, TILE_SIZE } from "../game/constants";
import { simToWorld } from "./space";

const FILLER_LABELS = new Set<string>(["house", "office", "cabin", "motel"]);
const POOL = 40;
const CHUNK_PX = CHUNK_TILES * TILE_SIZE;

interface LabelSpot {
  x: number; // sim px
  y: number;
  text: string;
  color: string;
}

export class Labels {
  private readonly blocks: TextBlock[] = [];
  private spots: LabelSpot[] = [];
  private lastCx = NaN;
  private lastCy = NaN;
  private readonly tmp = new Vector3();

  constructor(
    ui: AdvancedDynamicTexture,
    private readonly store: SimChunkStore,
    private readonly scene: Scene,
  ) {
    for (let i = 0; i < POOL; i++) {
      const t = new TextBlock(`label${i}`, "");
      t.fontFamily = "ui-monospace, Menlo, monospace";
      t.fontSize = 13;
      t.color = "#f4efe2";
      t.outlineColor = "#0b0d0e";
      t.outlineWidth = 4;
      t.isVisible = false;
      ui.addControl(t);
      this.blocks.push(t);
    }
  }

  /** Re-collect label spots when the player crosses a chunk boundary. */
  private collect(px: number, py: number): void {
    const ccx = Math.floor(px / CHUNK_PX);
    const ccy = Math.floor(py / CHUNK_PX);
    if (ccx === this.lastCx && ccy === this.lastCy) return;
    this.lastCx = ccx;
    this.lastCy = ccy;
    const out: LabelSpot[] = [];
    for (const lc of this.store.loadedChunks()) {
      for (const lm of lc.data.landmarks) {
        const st = landmarkStyle(lm.kind);
        out.push({ x: lm.x, y: lm.y, text: `${st.glyph} ${lm.label}`, color: st.color });
      }
      for (const b of lc.data.buildings) {
        if (b.tw < 5 || b.th < 4 || FILLER_LABELS.has(b.type)) continue;
        out.push({ x: b.center.x, y: b.center.y, text: b.type.replace(/_/g, " "), color: "#f4efe2" });
      }
    }
    this.spots = out;
  }

  update(px: number, py: number): void {
    this.collect(px, py);
    // nearest-first within ~38m
    const near = this.spots
      .map((s) => ({ s, d: Math.hypot(s.x - px, s.y - py) }))
      .filter((e) => e.d < 1200)
      .sort((a, b) => a.d - b.d)
      .slice(0, POOL);
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const cam = this.scene.activeCamera;
    for (let i = 0; i < POOL; i++) {
      const block = this.blocks[i];
      const e = near[i];
      if (!e || !cam) {
        block.isVisible = false;
        continue;
      }
      const wp = simToWorld(e.s.x, e.s.y, 2.2);
      this.tmp.set(wp.x, wp.y, wp.z);
      const p = Vector3.Project(
        this.tmp,
        // identity world matrix: positions are world-space
        IDENTITY,
        this.scene.getTransformMatrix(),
        cam.viewport.toGlobal(w, h),
      );
      if (p.z < 0 || p.z > 1) {
        block.isVisible = false;
        continue;
      }
      block.isVisible = true;
      block.text = e.s.text;
      block.color = e.s.color;
      block.alpha = Math.max(0, Math.min(0.9, 1.4 - e.d / 900));
      block.leftInPixels = p.x - w / 2;
      block.topInPixels = p.y - h / 2;
    }
  }
}

import { Matrix } from "@babylonjs/core/Maths/math.vector";
const IDENTITY = Matrix.Identity();
