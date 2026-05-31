import Phaser from "phaser";

// Procedural prop textures — the small non-blocking decorations the chunk
// renderer scatters per biome (trees, cars, rocks, crates, corpses…). CLAUDE.md
// §9: programmatic placeholders so dev is never blocked on art. Keyed `prop:<kind>`.

export function propKey(kind: string): string {
  return `prop:${kind}`;
}

const SIZE = 30;

type Draw = (g: Phaser.GameObjects.Graphics) => void;

const DRAWERS: Record<string, Draw> = {
  tree: (g) => {
    g.fillStyle(0x5a4326, 1).fillRect(13, 16, 4, 10); // trunk
    g.fillStyle(0x2f6b34, 1).fillCircle(15, 12, 11);
    g.fillStyle(0x3f8a45, 1).fillCircle(12, 10, 6);
  },
  pine: (g) => {
    g.fillStyle(0x5a4326, 1).fillRect(13, 20, 4, 8);
    g.fillStyle(0x1f5a2a, 1).fillTriangle(15, 2, 4, 22, 26, 22);
    g.fillStyle(0x2c7236, 1).fillTriangle(15, 7, 7, 18, 23, 18);
  },
  bush: (g) => {
    g.fillStyle(0x34622f, 1).fillCircle(11, 18, 7);
    g.fillStyle(0x3f7a39, 1).fillCircle(18, 16, 8);
  },
  rock: (g) => {
    g.fillStyle(0x6b6f76, 1).fillCircle(14, 17, 8);
    g.fillStyle(0x868b92, 1).fillCircle(12, 15, 4);
  },
  boulder: (g) => {
    g.fillStyle(0x5b5f66, 1).fillCircle(15, 16, 12);
    g.fillStyle(0x787d84, 1).fillCircle(11, 12, 5);
  },
  car: (g) => {
    g.fillStyle(0x9c3f3f, 1).fillRoundedRect(4, 8, 22, 14, 4);
    g.fillStyle(0x1b2530, 1).fillRoundedRect(8, 10, 14, 6, 2); // windows
    g.fillStyle(0x121417, 1).fillCircle(9, 23, 2.5).fillCircle(21, 23, 2.5);
  },
  wreck: (g) => {
    g.fillStyle(0x2f3033, 1).fillRoundedRect(4, 8, 22, 14, 4);
    g.fillStyle(0x15161a, 1).fillRoundedRect(8, 10, 14, 6, 2);
    g.fillStyle(0x55585d, 1).fillRect(6, 9, 4, 12);
  },
  crate: (g) => {
    g.fillStyle(0x7a5a30, 1).fillRect(7, 9, 16, 16);
    g.lineStyle(2, 0x4f3a1f, 1).strokeRect(7, 9, 16, 16);
    g.lineBetween(7, 9, 23, 25).lineBetween(23, 9, 7, 25);
  },
  barrel: (g) => {
    g.fillStyle(0x3f7a4a, 1).fillRoundedRect(9, 6, 12, 18, 4);
    g.lineStyle(1, 0x1f3a26, 1).strokeRect(9, 11, 12, 1).strokeRect(9, 17, 12, 1);
  },
  corpse: (g) => {
    g.fillStyle(0x5a1414, 0.85).fillEllipse(15, 17, 20, 12);
    g.fillStyle(0x7a2222, 1).fillEllipse(13, 16, 10, 6);
  },
  sign: (g) => {
    g.fillStyle(0x4f4a40, 1).fillRect(13, 8, 3, 18); // post
    g.fillStyle(0xb7a23f, 1).fillRect(6, 6, 18, 8);
  },
  streetlight: (g) => {
    g.fillStyle(0x4a4d52, 1).fillRect(13, 4, 3, 22);
    g.fillStyle(0x4a4d52, 1).fillRect(13, 4, 9, 3);
    g.fillStyle(0xffe08a, 1).fillCircle(22, 6, 3);
  },
  bench: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(5, 13, 20, 4);
    g.fillStyle(0x55401f, 1).fillRect(6, 17, 3, 6).fillRect(21, 17, 3, 6);
  },
  tent: (g) => {
    g.fillStyle(0x9c6b3f, 1).fillTriangle(15, 5, 4, 24, 26, 24);
    g.fillStyle(0x1b1410, 1).fillTriangle(15, 11, 11, 24, 19, 24);
  },
  grave: (g) => {
    g.fillStyle(0x7c8087, 1).fillRoundedRect(9, 8, 12, 18, 4);
    g.fillStyle(0x55585d, 1).fillRect(13, 12, 4, 10).fillRect(10, 15, 10, 4);
  },
  hay: (g) => {
    g.fillStyle(0xc9a94a, 1).fillCircle(15, 17, 10);
    g.lineStyle(1, 0x9c7f2f, 1).strokeCircle(15, 17, 6).strokeCircle(15, 17, 3);
  },
};

export function generatePropTextures(scene: Phaser.Scene): void {
  for (const [kind, draw] of Object.entries(DRAWERS)) {
    const key = propKey(kind);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, SIZE, SIZE);
    g.destroy();
  }
}
