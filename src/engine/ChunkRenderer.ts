import Phaser from "phaser";
import { SOLID_TILES, Tile, type Building, type ChunkData, type Prop } from "../game/worldgen";
import { landmarkStyle } from "../game/world/landmarks";
import { DECOR_CRACK, DECOR_PEBBLE, DECOR_TUFT, TILESET_KEY } from "./textures";
import { posPhase, SWAY_SPECS } from "./anim";
import { propKey } from "./propSprites";

/** A wind-swayed prop image (Anim PR 4) — collected per chunk, animated by the
 *  scene's budgeted sway pass. */
export interface Swayable {
  img: Phaser.GameObjects.Image;
  phase: number;
  kind: string;
}

// Renders ONE streamed chunk: a Phaser tilemap layer at the chunk's world
// origin, its wall/water/tree colliders, building labels, and decorative props.
// Owns those Phaser objects and tears them all down on unload. Story-agnostic.

export interface ColliderSpec {
  target: Phaser.Types.Physics.Arcade.ArcadeColliderType;
  callback?: (obj: Phaser.GameObjects.GameObject) => void;
  /** Optional per-contact gate (Phaser processCallback): return false to pass
   *  through. Receives the colliding object + the tilemap TILE, so a mount can
   *  fly over everything or swim across water tiles only (PR-B). */
  process?: (obj: Phaser.GameObjects.GameObject, tile: Phaser.Tilemaps.Tile) => boolean;
}

export class ChunkView {
  readonly layer: Phaser.Tilemaps.TilemapLayer;
  readonly swayables: Swayable[] = []; // wind-animated dressing (Anim PR 4)
  private readonly map: Phaser.Tilemaps.Tilemap;
  private readonly extras: Phaser.GameObjects.GameObject[] = [];
  private readonly colliders: Phaser.Physics.Arcade.Collider[] = [];

  constructor(scene: Phaser.Scene, chunk: ChunkData, specs: ColliderSpec[], skipProp?: (p: Prop) => boolean) {
    const px = chunk.cx * chunk.size * chunk.tileSize;
    const py = chunk.cy * chunk.size * chunk.tileSize;

    this.map = scene.make.tilemap({
      data: chunk.grid as number[][],
      tileWidth: chunk.tileSize,
      tileHeight: chunk.tileSize,
    });
    const tileset = this.map.addTilesetImage(TILESET_KEY);
    if (!tileset) throw new Error(`Failed to add tileset "${TILESET_KEY}".`);
    const layer = this.map.createLayer(0, tileset, px, py);
    if (!layer) throw new Error("Failed to create chunk tilemap layer.");
    this.layer = layer;
    this.layer.setCollision([...(SOLID_TILES as number[])]);
    this.layer.setDepth(0);

    for (const s of specs) {
      this.colliders.push(
        scene.physics.add.collider(
          s.target,
          this.layer,
          s.callback ? (a) => s.callback!(a as Phaser.GameObjects.GameObject) : undefined,
          s.process ? (a, b) => s.process!(a as Phaser.GameObjects.GameObject, b as unknown as Phaser.Tilemaps.Tile) : undefined,
        ),
      );
    }

    // Decorative props (below the player/enemies, above terrain). Searchable props
    // are skipped here — ChunkManager owns those as interactive sprites. Kinds in
    // SWAY_SPECS pivot at their ROOT (origin shifted + y compensated so nothing
    // moves on screen) and register for the scene's wind pass (Anim PR 4).
    for (const p of chunk.props) {
      if (skipProp?.(p)) continue;
      const key = propKey(p.kind);
      if (!scene.textures.exists(key)) continue;
      const spec = SWAY_SPECS[p.kind];
      if (spec) {
        const img = scene.add.image(p.x, p.y, key).setDepth(4).setOrigin(0.5, spec.originY);
        img.y = p.y + img.height * (spec.originY - 0.5);
        this.extras.push(img);
        this.swayables.push({ img, phase: posPhase(p.x, p.y), kind: p.kind });
      } else {
        this.extras.push(scene.add.image(p.x, p.y, key).setDepth(4));
      }
    }

    // Ground micro-decor (PR-E): hash-scattered pebbles / grass tufts / pavement
    // cracks so plain fields stop reading as flat colour. Pure function of the
    // GLOBAL tile coords (deterministic, seam-free) and never persisted/collided.
    if (scene.textures.exists(DECOR_TUFT)) {
      for (let ly = 0; ly < chunk.size; ly++) {
        for (let lx = 0; lx < chunk.size; lx++) {
          const gx = chunk.cx * chunk.size + lx;
          const gy = chunk.cy * chunk.size + ly;
          const h = (((gx * 73856093) ^ (gy * 19349663)) >>> 0) % 1000;
          if (h >= 6) continue; // ~14 per 48×48 chunk
          const t = chunk.grid[ly][lx];
          const key =
            t === Tile.Grass || t === Tile.TallGrass ? DECOR_TUFT
            : t === Tile.Dirt || t === Tile.Sand || t === Tile.Trail || t === Tile.Scorched ? DECOR_PEBBLE
            : t === Tile.Road || t === Tile.Pavement || t === Tile.Sidewalk ? DECOR_CRACK
            : null;
          if (!key) continue;
          const jx = ((gx * 2654435761) >>> 16) % chunk.tileSize;
          const jy = ((gy * 2246822519) >>> 16) % chunk.tileSize;
          this.extras.push(scene.add.image(px + lx * chunk.tileSize + jx, py + ly * chunk.tileSize + jy, key).setDepth(1));
        }
      }
    }

    // Landmark set-pieces — a visible anchor prop + a labelled marker so the
    // curated points of interest read on the map (no minimap by design).
    for (const lm of chunk.landmarks) {
      const st = landmarkStyle(lm.kind);
      if (st.prop) {
        const k = propKey(st.prop);
        if (scene.textures.exists(k)) this.extras.push(scene.add.image(lm.x, lm.y, k).setDepth(4).setScale(1.3));
      }
      const t = scene.add
        .text(lm.x, lm.y - 22, `${st.glyph} ${lm.label}`, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: st.color,
          align: "center",
          stroke: "#0b0d0e",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(6)
        .setResolution(2);
      this.extras.push(t);
    }

    // Light building "signage" for NOTABLE structures only (skip filler houses/
    // offices) — keeps the map legible and avoids creating a label texture per
    // building on every chunk load.
    for (const b of chunk.buildings) {
      if (b.tw < 5 || b.th < 4 || FILLER_LABELS.has(b.type)) continue;
      const t = scene.add
        .text(b.center.x, b.center.y, labelFor(b), {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#f4efe2",
          align: "center",
          stroke: "#0b0d0e",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(5)
        .setResolution(2)
        .setAlpha(0.85);
      this.extras.push(t);
    }
  }

  destroy(): void {
    for (const c of this.colliders) c.destroy();
    for (const e of this.extras) e.destroy();
    // map.destroy() also destroys the layer GameObject (via removeAllLayers),
    // removing it from the scene's display/update lists. Colliders are torn
    // down first so nothing references the layer afterwards.
    this.map.destroy();
  }
}

// Common filler structures aren't labelled (too many, low information).
const FILLER_LABELS = new Set<string>(["house", "office", "cabin", "motel"]);

function labelFor(b: Building): string {
  return b.type.replace(/_/g, " ");
}
