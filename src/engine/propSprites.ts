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

  // --- interior furniture (placed inside buildings, themed per type) ---
  shelf: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(4, 4, 22, 22);
    g.fillStyle(0x3a2c18, 1).fillRect(4, 11, 22, 2).fillRect(4, 19, 22, 2);
    g.fillStyle(0xb7a23f, 1).fillRect(6, 6, 5, 4).fillRect(15, 6, 5, 4).fillRect(6, 14, 5, 4);
  },
  bed: (g) => {
    g.fillStyle(0x5a6470, 1).fillRect(6, 4, 18, 22);
    g.fillStyle(0x8a98a8, 1).fillRect(7, 11, 16, 14);
    g.fillStyle(0xcdd9e5, 1).fillRect(8, 5, 14, 6);
  },
  counter: (g) => {
    g.fillStyle(0x5b616a, 1).fillRect(3, 10, 24, 12);
    g.fillStyle(0x8a8f98, 1).fillRect(3, 10, 24, 3);
  },
  desk: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(4, 9, 22, 12);
    g.fillStyle(0x3a2c18, 1).fillRect(5, 21, 3, 5).fillRect(22, 21, 3, 5);
    g.fillStyle(0x2ec4ff, 1).fillRect(8, 5, 8, 4);
  },
  toolrack: (g) => {
    g.fillStyle(0x4a3c2d, 1).fillRect(4, 5, 22, 5);
    g.fillStyle(0x9aa3ad, 1).fillRect(7, 10, 2, 12).fillRect(13, 10, 2, 9).fillRect(19, 10, 2, 13);
  },
  pew: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(3, 13, 24, 5);
    g.fillStyle(0x55401f, 1).fillRect(3, 8, 24, 4);
  },
  fridge_prop: (g) => {
    g.fillStyle(0xdfe6ec, 1).fillRect(8, 4, 14, 22);
    g.fillStyle(0xb8c0c8, 1).fillRect(8, 14, 14, 1);
    g.fillStyle(0x8a8f98, 1).fillRect(19, 8, 2, 4).fillRect(19, 17, 2, 4);
  },
  bookshelf: (g) => {
    g.fillStyle(0x4a3c2d, 1).fillRect(5, 4, 20, 22);
    const cols = [0xd1483a, 0x2f8f3c, 0x2ec4ff, 0xffd23f];
    for (let i = 0; i < 4; i++) g.fillStyle(cols[i], 1).fillRect(7 + i * 4, 6, 3, 7);
    g.fillStyle(0x2c2218, 1).fillRect(5, 15, 20, 2);
  },
  locker_prop: (g) => {
    g.fillStyle(0x5f86a8, 1).fillRect(8, 3, 14, 24);
    g.fillStyle(0x3f5f78, 1).fillRect(14, 3, 1, 24);
    g.fillStyle(0x2b2e33, 1).fillRect(11, 13, 1, 3).fillRect(17, 13, 1, 3);
  },
  table: (g) => {
    g.fillStyle(0x8a6a3a, 1).fillRect(5, 9, 20, 12);
    g.fillStyle(0x5a4326, 1).fillRect(6, 21, 3, 5).fillRect(21, 21, 3, 5);
  },
  sofa: (g) => {
    g.fillStyle(0x556b5a, 1).fillRoundedRect(4, 8, 22, 16, 3);
    g.fillStyle(0x6e8a72, 1).fillRect(7, 11, 16, 7);
  },

  // --- farming (Feature 5): tilled soil + 3 crop growth stages ---
  farm_tilled: (g) => {
    g.fillStyle(0x5a3f24, 1).fillRect(1, 1, 28, 28);
    g.lineStyle(1, 0x3e2c18, 1);
    for (let i = 0; i < 4; i++) g.lineBetween(2, 5 + i * 7, 28, 5 + i * 7);
  },
  farm_sprout: (g) => {
    g.fillStyle(0x3f8a45, 1).fillRect(14, 16, 2, 8);
    g.fillStyle(0x5ed66e, 1).fillCircle(12, 15, 2).fillCircle(18, 15, 2);
  },
  farm_growing: (g) => {
    g.fillStyle(0x2f6b34, 1).fillRect(14, 10, 2, 14);
    g.fillStyle(0x3f8a45, 1).fillTriangle(15, 4, 9, 16, 21, 16);
  },
  // ripe: white "fruit" so the scene can tint the whole sprite to the crop colour.
  farm_ripe: (g) => {
    g.fillStyle(0x2f6b34, 1).fillRect(14, 9, 2, 15);
    g.fillStyle(0xffffff, 1).fillCircle(11, 10, 3).fillCircle(19, 10, 3).fillCircle(15, 6, 3);
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
