import Phaser from "phaser";
import { isGeneratedTexture } from "./generatedKeys";

// Procedural prop textures — the small non-blocking decorations the chunk
// renderer scatters per biome (trees, cars, rocks, crates, corpses…). CLAUDE.md
// §9: programmatic placeholders so dev is never blocked on art. Keyed `prop:<kind>`.

export function propKey(kind: string): string {
  return `prop:${kind}`;
}

/** Every prop kind a drawer exists for — lets data-integrity tests verify that
 *  worldgen/biomes/set-pieces never reference a sprite that can't render. */
export function propKinds(): string[] {
  return Object.keys(DRAWERS);
}

const SIZE = 30;

type Draw = (g: Phaser.GameObjects.Graphics, pose?: number) => void;

/** Prop kinds that get a second stride frame `prop:<kind>_b` (Animation Pass) —
 *  the wild animals. Their drawers read `pose`; everything else ignores it. */
export const TWO_FRAME_PROP_KINDS = ["animal_rabbit", "animal_deer", "animal_boar"] as const;

const DRAWERS: Record<string, Draw> = {
  tree: (g) => {
    g.fillStyle(0x0c170d, 0.35).fillEllipse(16, 26, 21, 8); // ground drop shadow
    g.fillStyle(0x4a3420, 1).fillRect(13, 15, 4, 11); // trunk
    g.fillStyle(0x2c1d10, 0.7).fillRect(15, 15, 2, 11); // trunk shade
    g.fillStyle(0x244a22, 1).fillCircle(15, 12, 12); // canopy base (dark)
    g.fillStyle(0x16301a, 0.55).fillCircle(20, 15, 5); // shaded lobe (down-right)
    g.fillStyle(0x357a33, 1).fillCircle(13, 10, 8); // mid lobe
    g.fillStyle(0x4f9e45, 1).fillCircle(11, 8, 5); // bright lobe
    g.fillStyle(0x7cc85e, 0.9).fillCircle(10, 7, 2.6); // highlight glint
  },
  pine: (g) => {
    g.fillStyle(0x0c170d, 0.35).fillEllipse(15, 27, 16, 7); // ground drop shadow
    g.fillStyle(0x4a3420, 1).fillRect(13, 19, 4, 9); // trunk
    g.fillStyle(0x163d1c, 1).fillTriangle(15, 1, 3, 22, 27, 22); // dark base skirt
    g.fillStyle(0x257032, 1).fillTriangle(15, 5, 6, 19, 24, 19); // mid tier
    g.fillStyle(0x3f9a45, 1).fillTriangle(15, 9, 9, 16, 21, 16); // bright top tier
    g.fillStyle(0x7cc85e, 0.85).fillTriangle(15, 6, 12, 11, 18, 11); // rim highlight
  },
  bush: (g) => {
    g.fillStyle(0x0e1c0e, 0.3).fillEllipse(15, 24, 18, 7); // drop shadow
    g.fillStyle(0x2c5a2a, 1).fillCircle(11, 17, 8);
    g.fillStyle(0x357a33, 1).fillCircle(19, 16, 8);
    g.fillStyle(0x4f9e45, 1).fillCircle(14, 14, 5); // bright crown
    g.fillStyle(0x7cc85e, 0.85).fillCircle(13, 13, 2.4); // highlight glint
  },
  rock: (g) => {
    g.fillStyle(0x6b6f76, 1).fillCircle(14, 17, 8);
    g.fillStyle(0x868b92, 1).fillCircle(12, 15, 4);
  },
  boulder: (g) => {
    g.fillStyle(0x5b5f66, 1).fillCircle(15, 16, 12);
    g.fillStyle(0x787d84, 1).fillCircle(11, 12, 5);
  },
  // top-down parked car (front at +x): 4 tyres, roof + windshield, hood, lights.
  car: (g) => {
    g.fillStyle(0x121417, 1).fillRect(7, 4, 4, 3).fillRect(7, 23, 4, 3).fillRect(19, 4, 4, 3).fillRect(19, 23, 4, 3); // tyres
    g.fillStyle(0x2a527d, 1).fillRoundedRect(4, 7, 23, 16, 5); // body
    g.fillStyle(0x3a6ea5, 1).fillRoundedRect(5, 8, 20, 14, 4); // body top tone
    g.fillStyle(0x12202e, 1).fillRoundedRect(9, 9, 8, 12, 3); // cabin glass
    g.fillStyle(0x274a6e, 1).fillRect(18, 10, 5, 10); // hood
    g.fillStyle(0xffe9a8, 1).fillRect(25, 9, 2, 3).fillRect(25, 18, 2, 3); // headlights
    g.fillStyle(0xffffff, 0.12).fillRect(6, 9, 2, 12); // sheen
  },
  // burnt-out wreck: rusted, crumpled, scorched.
  wreck: (g) => {
    g.fillStyle(0x0e0f12, 1).fillRect(7, 4, 4, 3).fillRect(19, 23, 4, 3); // charred tyres
    g.fillStyle(0x33352f, 1).fillRoundedRect(4, 7, 23, 16, 5); // rusted shell
    g.fillStyle(0x24221b, 1).fillRoundedRect(8, 9, 13, 12, 3); // burnt-out cabin
    g.fillStyle(0x55585d, 1).fillRect(5, 8, 3, 14); // crumpled door
    g.fillStyle(0x7a3a1a, 1).fillCircle(15, 14, 4); // scorch / rust
    g.fillStyle(0x121417, 1).fillCircle(15, 14, 1.6);
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
  // a fallen soldier: fatigues + dropped helmet in a dark pool (military scav)
  corpse_soldier: (g) => {
    g.fillStyle(0x3a1010, 0.8).fillEllipse(15, 18, 22, 11); // blood pool
    g.fillStyle(0x4b553a, 1).fillEllipse(14, 16, 14, 6); // fatigues torso
    g.fillStyle(0x39422c, 1).fillRect(6, 15, 5, 3).fillRect(20, 16, 5, 3); // arms
    g.fillStyle(0x2e3524, 1).fillCircle(24, 12, 3.4); // dropped helmet
    g.fillStyle(0x556044, 1).fillCircle(23, 11, 1.6); // helmet glint
  },
  // nailed-up boards over a doorway (U5 boarded buildings)
  boards: (g) => {
    g.fillStyle(0x7a5f33, 1).fillRect(2, 5, 26, 5);
    g.fillStyle(0x66512c, 1).fillRect(2, 12, 26, 5);
    g.fillStyle(0x59462a, 1).fillRect(2, 19, 26, 5);
    g.fillStyle(0x4a3a20, 0.9).fillTriangle(4, 26, 28, 3, 26, 1).fillTriangle(2, 24, 26, 1, 28, 3); // cross plank
    g.fillStyle(0x2e2517, 1); // nail heads
    g.fillCircle(4, 7, 1.2).fillCircle(26, 7, 1.2).fillCircle(4, 21, 1.2).fillCircle(26, 21, 1.2);
  },
  // street dumpster (front at +x): lidded steel bin, grime + shadow
  dumpster: (g) => {
    g.fillStyle(0x0c0f12, 0.35).fillEllipse(15, 25, 22, 7); // drop shadow
    g.fillStyle(0x2c5040, 1).fillRoundedRect(4, 9, 22, 15, 3); // body
    g.fillStyle(0x3a6a54, 1).fillRect(5, 10, 20, 5); // lid
    g.fillStyle(0x1d3a2d, 1).fillRect(5, 15, 20, 2); // lid lip shadow
    g.fillStyle(0x16271f, 1).fillRect(7, 24, 4, 2).fillRect(19, 24, 4, 2); // wheels
    g.fillStyle(0xffffff, 0.08).fillRect(6, 11, 2, 11); // sheen
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

  // --- drivable vehicles (Feature 4), top-down, facing east (+x) ---
  // Bodies drawn near-white so the scene's per-type tint colours each vehicle; dark
  // glass/wheels read through the tint. Front of the car points right (+x).
  veh_sedan: (g) => {
    g.fillStyle(0xe8ebee, 1).fillRoundedRect(2, 8, 26, 14, 5); // body
    g.fillStyle(0x1b2733, 1).fillRoundedRect(7, 10, 12, 10, 2); // cabin glass
    g.fillStyle(0xc2c8cf, 1).fillRect(24, 11, 4, 8); // hood
    g.fillStyle(0x0c0f13, 1).fillCircle(9, 7, 2.6).fillCircle(9, 23, 2.6).fillCircle(22, 7, 2.6).fillCircle(22, 23, 2.6);
    g.fillStyle(0xffe9a8, 1).fillRect(27, 9, 2, 3).fillRect(27, 18, 2, 3); // headlights
  },
  veh_pickup: (g) => {
    g.fillStyle(0xe2e5e9, 1).fillRoundedRect(2, 7, 13, 16, 3); // cab (rear)
    g.fillStyle(0x1b2733, 1).fillRoundedRect(4, 9, 8, 12, 2); // cab glass
    g.fillStyle(0xb7bdc4, 1).fillRect(15, 9, 13, 12); // open bed (front)
    g.lineStyle(1, 0x7d838b, 1).strokeRect(15, 9, 13, 12);
    g.fillStyle(0x0c0f13, 1).fillCircle(8, 6, 2.8).fillCircle(8, 24, 2.8).fillCircle(22, 6, 2.8).fillCircle(22, 24, 2.8);
  },
  veh_van: (g) => {
    g.fillStyle(0xeceef1, 1).fillRoundedRect(1, 6, 28, 18, 4); // big boxy body
    g.fillStyle(0x1b2733, 1).fillRect(22, 8, 6, 14); // windshield (front)
    g.fillStyle(0xcfd4da, 1).fillRect(3, 9, 14, 1).fillRect(3, 15, 14, 1); // side panels
    g.fillStyle(0x0c0f13, 1).fillCircle(8, 5, 2.8).fillCircle(8, 25, 2.8).fillCircle(23, 5, 2.8).fillCircle(23, 25, 2.8);
    g.fillStyle(0xffe9a8, 1).fillRect(28, 8, 1, 3).fillRect(28, 19, 1, 3); // headlights
  },

  // --- base building (Feature 7): player-built structures, top-down ---
  base_barricade: (g) => {
    g.fillStyle(0x8a6a3a, 1).fillRect(2, 7, 26, 6).fillRect(2, 17, 26, 6); // two plank bands
    g.fillStyle(0x6e5230, 1).fillRect(2, 7, 26, 1).fillRect(2, 22, 26, 1);
    g.lineStyle(2, 0x5a4326, 1).lineBetween(4, 6, 26, 24); // diagonal brace
    g.fillStyle(0x3a2c18, 1).fillRect(7, 7, 1, 16).fillRect(15, 7, 1, 16).fillRect(22, 7, 1, 16); // nails/seams
  },
  base_wall: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(1, 1, 28, 28);
    g.fillStyle(0x5a4326, 1).fillRect(1, 10, 28, 1).fillRect(1, 20, 28, 1);
    g.fillStyle(0x7c5e36, 1).fillRect(3, 3, 10, 6).fillRect(16, 3, 10, 6).fillRect(9, 12, 10, 6).fillRect(3, 22, 10, 5);
  },
  base_gate: (g) => {
    g.fillStyle(0x5b616a, 1).fillRect(1, 2, 28, 26);
    g.fillStyle(0x868b92, 1).fillRect(4, 4, 3, 22).fillRect(12, 4, 3, 22).fillRect(20, 4, 3, 22);
    g.fillStyle(0x3a3f45, 1).fillRect(1, 13, 28, 4); // cross-brace
    g.fillStyle(0xb7bdc4, 1).fillRect(24, 12, 3, 6); // bolt plate
  },
  base_spikes: (g) => {
    g.fillStyle(0x6e5230, 1).fillRect(2, 22, 26, 4); // base rail
    g.fillStyle(0xc9b89a, 1);
    for (let i = 0; i < 4; i++) g.fillTriangle(5 + i * 7, 22, 2 + i * 7, 6, 8 + i * 7, 22);
    g.fillStyle(0x9c8a6a, 1);
    for (let i = 0; i < 4; i++) g.fillTriangle(5 + i * 7, 22, 5 + i * 7, 9, 8 + i * 7, 22);
  },
  base_storage: (g) => {
    g.fillStyle(0xb5853f, 1).fillRect(3, 6, 24, 20);
    g.fillStyle(0x7a5a30, 1).fillRect(3, 6, 24, 4).fillRect(3, 14, 24, 2); // lid + band
    g.fillStyle(0x4f3a1f, 1).fillRect(13, 14, 4, 4); // latch
    g.lineStyle(1, 0x4f3a1f, 1).strokeRect(3, 6, 24, 20);
  },
  base_campfire: (g) => {
    g.fillStyle(0x5b616a, 1); // stone ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.fillCircle(15 + Math.cos(a) * 11, 16 + Math.sin(a) * 9, 3);
    }
    g.fillStyle(0x6e5230, 1).fillRect(9, 15, 12, 3).fillRect(13, 11, 3, 11); // logs
    g.fillStyle(0xff7a2a, 1).fillTriangle(15, 6, 10, 17, 20, 17); // flame
    g.fillStyle(0xffd23f, 1).fillTriangle(15, 10, 12, 17, 18, 17);
  },
  base_workbench: (g) => {
    g.fillStyle(0x8a6a3a, 1).fillRect(2, 8, 26, 14);
    g.fillStyle(0x5a4326, 1).fillRect(3, 22, 3, 5).fillRect(24, 22, 3, 5).fillRect(2, 8, 26, 2);
    g.fillStyle(0x9aa3ad, 1).fillRect(6, 11, 8, 2); // saw
    g.fillStyle(0xd1483a, 1).fillRect(18, 10, 5, 4); // toolbox
    g.fillStyle(0x2b2e33, 1).fillRect(15, 14, 7, 2); // wrench
  },

  // --- wild animals (Feature 6), top-down; pose 1 = mid-bound stride frame ---
  animal_rabbit: (g, pose = 0) => {
    const b = pose === 1 ? 1 : 0;
    g.fillStyle(0xd8c8b0, 1).fillEllipse(15 + b, 17, 11 + b * 2, 8 - b); // bunched mid-hop
    g.fillStyle(0xcabfa8, 1).fillRect(18 + b, 8 + b * 2, 2, 7 - b * 2).fillRect(21 + b, 8 + b * 2, 2, 7 - b * 2); // ears swept back
    g.fillStyle(0xffffff, 1).fillCircle(10 - b, 18, 2);
  },
  animal_deer: (g, pose = 0) => {
    const b = pose === 1 ? 1 : 0;
    g.fillStyle(0xa97a4a, 1).fillEllipse(14, 16, 15 + b, 9 - b * 0.5);
    g.fillStyle(0x8a5f38, 1).fillCircle(23 + b, 14 + b, 3); // head dips mid-stride
    g.fillStyle(0xe8d8c0, 1).fillEllipse(9 - b, 18, 5, 3);
    g.lineStyle(1, 0x6b4a2a, 1).lineBetween(25 + b, 12 + b, 27 + b, 8 + b).lineBetween(25 + b, 12 + b, 23 + b, 8 + b);
    if (b) g.lineStyle(2, 0x8a5f38, 1).lineBetween(9, 20, 6, 22).lineBetween(20, 20, 23, 22); // legs reaching
  },
  animal_boar: (g, pose = 0) => {
    const b = pose === 1 ? 1 : 0;
    g.fillStyle(0x6b5236, 1).fillEllipse(15, 16 + b * 0.5, 16, 10 - b);
    g.fillStyle(0x4a3826, 1).fillCircle(24 + b, 15 + b * 1.5, 4); // head drops into the charge
    g.fillStyle(0xe8e8e8, 1).fillRect(27 + b, 13 + b, 2, 1).fillRect(27 + b, 16 + b, 2, 1);
  },

  // --- shoreline & clearing dressing (Terrain Overhaul PR3) ------------------
  reeds: (g) => {
    g.fillStyle(0x12200f, 0.3).fillEllipse(15, 25, 16, 5); // wet-ground shadow
    g.lineStyle(2, 0x4f7a36, 1);
    g.lineBetween(9, 25, 7, 8).lineBetween(13, 25, 12, 5).lineBetween(17, 25, 18, 7).lineBetween(21, 25, 24, 10);
    g.lineStyle(2, 0x6f9e4a, 1).lineBetween(15, 25, 15, 4).lineBetween(11, 25, 10, 9);
    g.lineStyle(1, 0x8fbf5e, 0.9).lineBetween(19, 25, 21, 8);
  },
  cattail: (g) => {
    g.fillStyle(0x12200f, 0.3).fillEllipse(15, 25, 14, 5);
    g.lineStyle(2, 0x57803a, 1).lineBetween(11, 25, 9, 6).lineBetween(19, 25, 21, 5).lineBetween(15, 25, 15, 8);
    g.fillStyle(0x6b4a2a, 1).fillRoundedRect(7, 4, 4, 9, 2).fillRoundedRect(19, 3, 4, 9, 2); // sausage heads
    g.fillStyle(0x8a5f38, 1).fillRoundedRect(8, 5, 2, 7, 1).fillRoundedRect(20, 4, 2, 7, 1);
  },
  lilypad: (g) => {
    // Drawn for ON-water placement: flat pads, no drop shadow.
    g.fillStyle(0x2f6e33, 1).fillEllipse(11, 16, 13, 9);
    g.fillStyle(0x3f8a3f, 1).fillEllipse(11, 15, 10, 7);
    g.fillStyle(0x16301a, 1).fillTriangle(11, 15, 18, 12, 18, 18); // pad notch
    g.fillStyle(0x2f6e33, 1).fillEllipse(22, 22, 9, 6);
    g.fillStyle(0xe88ab0, 1).fillCircle(9, 12, 2.4); // blossom
    g.fillStyle(0xffd9e8, 1).fillCircle(9, 12, 1.2);
  },
  driftwood: (g) => {
    g.fillStyle(0x1a1a12, 0.3).fillEllipse(15, 22, 22, 6);
    g.fillStyle(0x9a8f7a, 1).fillRoundedRect(3, 14, 24, 6, 3); // bleached log
    g.fillStyle(0xb5ab96, 1).fillRoundedRect(4, 15, 22, 2, 1);
    g.fillStyle(0x7a7060, 1).fillRect(20, 9, 3, 6); // branch stub
    g.lineStyle(1, 0x6b6253, 0.8).lineBetween(6, 17, 24, 17);
  },
  rowboat: (g) => {
    g.fillStyle(0x10141a, 0.35).fillEllipse(15, 23, 24, 7);
    g.fillStyle(0x6e5230, 1).fillEllipse(15, 15, 24, 12); // hull
    g.fillStyle(0x8a6a3a, 1).fillEllipse(15, 15, 20, 9); // inner
    g.fillStyle(0x5a4326, 1).fillRect(8, 12, 2, 7).fillRect(15, 12, 2, 7).fillRect(21, 12, 2, 7); // benches
    g.lineStyle(1, 0x4f3a1f, 1).strokeEllipse(15, 15, 24, 12);
  },
  dock: (g) => {
    g.fillStyle(0x10141a, 0.3).fillEllipse(15, 26, 20, 5);
    g.fillStyle(0x6e5230, 1).fillRect(6, 2, 18, 24); // pier run
    g.lineStyle(1, 0x4f3a1f, 1);
    for (let y = 5; y < 26; y += 4) g.lineBetween(6, y, 24, y); // planks
    g.fillStyle(0x4a3a22, 1).fillRect(5, 4, 3, 4).fillRect(22, 4, 3, 4).fillRect(5, 20, 3, 4).fillRect(22, 20, 3, 4); // posts
  },
  fishing_spot: (g) => {
    // Drawn for ON-water placement: ripple rings + a bobber, reads as "fish here".
    g.lineStyle(2, 0xcfe8f4, 0.5).strokeCircle(15, 16, 9);
    g.lineStyle(1, 0xcfe8f4, 0.35).strokeCircle(15, 16, 5).strokeCircle(15, 16, 13);
    g.fillStyle(0x1d3a55, 0.5).fillEllipse(18, 19, 8, 3); // fish shadow
    g.fillStyle(0xd13a2a, 1).fillCircle(12, 13, 2.2); // bobber
    g.fillStyle(0xe8eef4, 1).fillCircle(12, 12.2, 1);
  },
  // A great creature's nest (PR-A pet dens): ringed branches/bones + warm hollow.
  pet_den: (g) => {
    g.fillStyle(0x14100c, 0.4).fillEllipse(15, 18, 26, 12); // packed-earth ring shadow
    g.fillStyle(0x5a4326, 1);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = 15 + Math.cos(a) * 10;
      const y = 16 + Math.sin(a) * 7;
      g.fillRoundedRect(x - 3, y - 1.2, 6, 2.4, 1); // woven branches
    }
    g.fillStyle(0xe8e2d0, 1).fillRoundedRect(7, 11, 5, 1.8, 1).fillRoundedRect(19, 19, 5, 1.8, 1); // old bones
    g.fillStyle(0x2a2018, 1).fillEllipse(15, 16, 12, 7); // the hollow
    g.fillStyle(0x3a2c1e, 1).fillEllipse(15, 16, 8, 4.6);
    g.fillStyle(0xffd23f, 0.5).fillCircle(13, 15, 1.2).fillCircle(18, 17, 1); // a glint of... something
  },
  flowers: (g) => {
    g.fillStyle(0x2c5a2a, 0.8).fillEllipse(15, 20, 20, 9); // grass tuft
    const bloom = (x: number, y: number, c: number): void => {
      g.fillStyle(c, 1);
      g.fillCircle(x - 2, y, 1.6).fillCircle(x + 2, y, 1.6).fillCircle(x, y - 2, 1.6).fillCircle(x, y + 2, 1.6);
      g.fillStyle(0xffd23f, 1).fillCircle(x, y, 1.4);
    };
    bloom(9, 15, 0xe8eef4);
    bloom(17, 12, 0xe88ab0);
    bloom(22, 18, 0xb368ff);
    bloom(13, 21, 0xe8eef4);
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
  // Stride B-frames for the animals (Animation Pass) — same fallback chain as
  // pets: a generated base (e.g. the deer PNG) never pairs with a procedural _b.
  for (const kind of TWO_FRAME_PROP_KINDS) {
    const base = propKey(kind);
    const key = base + "_b";
    if (scene.textures.exists(key) || isGeneratedTexture(base)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    DRAWERS[kind](g, 1);
    g.generateTexture(key, SIZE, SIZE);
    g.destroy();
  }
}
