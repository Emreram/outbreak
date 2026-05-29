import Phaser from "phaser";
import { Tile, type Building, type WorldData } from "../game/worldgen";
import { TILESET_KEY } from "./textures";

// Draws the procedural city: a Phaser tilemap layer from the WorldData grid,
// plus placeholder building labels. Exposes the collision layer so the scene
// can collide the player against walls. Story-agnostic (CLAUDE.md §5).

export class WorldRenderer {
  readonly layer: Phaser.Tilemaps.TilemapLayer;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, world: WorldData) {
    const map = scene.make.tilemap({
      data: world.grid as number[][],
      tileWidth: world.tileSize,
      tileHeight: world.tileSize,
    });

    const tileset = map.addTilesetImage(TILESET_KEY);
    if (!tileset) {
      throw new Error(`Failed to add tileset "${TILESET_KEY}" — was the texture generated?`);
    }

    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) {
      throw new Error("Failed to create tilemap layer.");
    }
    this.layer = layer;

    // Only walls block movement; roads/sidewalks/floors/doors/grass are walkable.
    this.layer.setCollision(Tile.Wall);

    this.addBuildingLabels(scene, world);
  }

  // Light placeholder "signage" so the procedural variety is legible and you can
  // see building types. TODO: replace with real props/signs in Phase 2.
  private addBuildingLabels(scene: Phaser.Scene, world: WorldData): void {
    for (const b of world.buildings) {
      // Only label buildings big enough to read a tag without clutter.
      if (b.tw < 4 || b.th < 4) continue;
      const text = scene.add
        .text(b.center.x, b.center.y, labelFor(b), {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#e8e2d0",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5)
        .setResolution(2);
      text.setAlpha(0.85);
      this.labels.push(text);
    }
  }

  destroy(): void {
    this.labels.forEach((t) => t.destroy());
    this.layer.destroy();
  }
}

function labelFor(b: Building): string {
  return b.type.replace(/_/g, " ");
}
