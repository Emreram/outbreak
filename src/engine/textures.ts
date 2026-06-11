import Phaser from "phaser";
import { Tile, TILE_ORDER } from "../game/worldgen";
import { createRng } from "../game/rng";

// Terrain is rendered from a PROCEDURALLY-generated tileset (one flat-coloured
// frame per Tile value, frame index === enum value) so every biome terrain is
// guaranteed a frame without hand-aligning a CC0 PNG to ~19 tiles. CC0 character
// art still loads from /public (ASSET_PATHS); props use propSprites.ts.

export const TILESET_KEY = "tiles";
export const PLAYER_KEY = "player";
export const ZOMBIE_KEY = "zombie";
export const SURVIVOR_NPC_KEY = "survivor_npc";
// Player walk cycle (PR-E, upgraded to a 4-step contact–pass–contact–pass in
// the Animation Pass): arms swing alternately through a tucked pass frame; a
// sprint pair doubles the swing with a forward lean. The Player entity swaps
// frames off its walk phase (idle returns to PLAYER_KEY).
export const PLAYER_WALK_A = "player_wa";
export const PLAYER_WALK_B = "player_wb";
export const PLAYER_WALK_PASS = "player_wp";
export const PLAYER_SPRINT_A = "player_sa";
export const PLAYER_SPRINT_B = "player_sb";
// NPC walk pair (Animation Pass) — survivors/companions stop gliding too.
export const SURVIVOR_NPC_WALK_A = "survivor_npc_wa";
export const SURVIVOR_NPC_WALK_B = "survivor_npc_wb";

// CC0 character assets served from /public (loaded in BootScene). If a load
// fails, the generators below provide a placeholder for that key. The terrain
// tileset is intentionally NOT here — it is always generated (see above). The
// player + survivor NPC are now drawn procedurally (detailed top-down sprites),
// so they're generated rather than loaded; only the zombie keeps a CC0 fallback.
export const ASSET_PATHS: Readonly<Record<string, string>> = {
  [ZOMBIE_KEY]: "assets/characters/zombie.png",
};

// One colour per Tile enum value. Order in TILE_ORDER below must match the enum
// so the generated tileset's frame index === the grid value used by the tilemap.
// Exported so the minimap (Feature 10) can colour chunks by their biome's base tile.
export const TILE_COLORS: Record<Tile, { fill: number; line: number }> = {
  [Tile.Road]: { fill: 0x33373d, line: 0x2a2e33 },
  [Tile.Sidewalk]: { fill: 0x6c727a, line: 0x5b616a },
  [Tile.Floor]: { fill: 0x5a4a38, line: 0x4a3c2d },
  [Tile.Wall]: { fill: 0x23262b, line: 0x3a3f47 },
  [Tile.Door]: { fill: 0xb5651d, line: 0x854a14 },
  [Tile.Grass]: { fill: 0x3a5236, line: 0x32482f },
  [Tile.Water]: { fill: 0x274b6d, line: 0x1d3a55 },
  [Tile.ShallowWater]: { fill: 0x4d7fa3, line: 0x40688a }, // lighter — the depth ramp reads under the (subtler) shader
  [Tile.Sand]: { fill: 0xd8c08c, line: 0xc0a875 }, // brighter beach

  [Tile.Dirt]: { fill: 0x6b5638, line: 0x5a472e },
  [Tile.Trail]: { fill: 0x8a7350, line: 0x6f5c40 },
  // Tree/Bush tiles sit on visible ground (the canopy is drawn raised on top in
  // drawTileMotif) so a blocking tree reads as an object, not as patterned grass.
  [Tile.Tree]: { fill: 0x35492c, line: 0x243318 },
  [Tile.Bush]: { fill: 0x3a5236, line: 0x2c3f25 },
  [Tile.TallGrass]: { fill: 0x44603a, line: 0x38522e },
  [Tile.Rubble]: { fill: 0x4a4640, line: 0x3a3732 },
  [Tile.Pavement]: { fill: 0x44484e, line: 0x383b40 },
  [Tile.Rail]: { fill: 0x55504a, line: 0x3f3b36 },
  [Tile.Crop]: { fill: 0x7e8a3a, line: 0x69742f },
  [Tile.Bridge]: { fill: 0x6e5640, line: 0x5a4634 },
  // Living-world terrain. Water/Lava are the STATIC underlay beneath the animated
  // overlay (AnimatedTerrain) — kept readable but quiet so the animation reads.
  [Tile.DeepWater]: { fill: 0x183349, line: 0x102434 },
  [Tile.Mud]: { fill: 0x423624, line: 0x322817 }, // darker wet earth — clearly not grass
  [Tile.Foam]: { fill: 0xc9bd9a, line: 0xb0a584 }, // WET SAND w/ a surf line (was pale cyan — read as ocean speckle)
  [Tile.Scorched]: { fill: 0x2a241f, line: 0x1d1814 },
  [Tile.Ash]: { fill: 0x4a463f, line: 0x35322c },
  [Tile.Basalt]: { fill: 0x2b2622, line: 0x18140f },
  [Tile.Lava]: { fill: 0x8a3010, line: 0x551c08 },
  [Tile.Stump]: { fill: 0x3a2c1e, line: 0x281d12 },
};

/** Scale a packed RGB colour's brightness by `amt` (e.g. -0.2 darker, +0.15 lighter). */
function shade(hex: number, amt: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * Generate the terrain tileset: N tiles laid out horizontally, one per Tile
 * value (frame index === enum value, from TILE_ORDER), each `size`x`size`.
 * Always runs (procedural, authoritative). Each frame is TEXTURED — a dithered
 * noise field, a soft bevel, and a per-type motif (lane lines, brick courses,
 * water ripples, grass blades…) — so large areas read with depth instead of as
 * flat colour, while the frame layout (index === Tile) is unchanged.
 */
export function generateTileTexture(scene: Phaser.Scene, size: number): void {
  if (scene.textures.exists(TILESET_KEY)) return;

  const order = TILE_ORDER;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  order.forEach((tile, i) => {
    const { fill, line } = TILE_COLORS[tile];
    const ox = i * size;
    // deterministic per-TYPE texture (every instance of a tile looks identical,
    // but richly textured rather than flat).
    const rng = createRng(`tile:${tile}`);

    g.fillStyle(fill, 1).fillRect(ox, 0, size, size);

    // dither: scattered lighter/darker specks for a grain/noise feel.
    const specks = Math.round(size * size * 0.28);
    for (let s = 0; s < specks; s++) {
      const x = ox + rng.int(0, size - 1);
      const y = rng.int(0, size - 1);
      const amt = rng.range(-0.16, 0.16);
      g.fillStyle(shade(fill, amt), rng.range(0.35, 0.7)).fillRect(x, y, 1, 1);
    }

    drawTileMotif(g, tile, ox, size, fill, rng);

    // soft bevel: lit top/left edge, shaded bottom/right edge → subtle relief.
    g.fillStyle(shade(fill, 0.16), 0.5).fillRect(ox, 0, size, 1).fillRect(ox, 0, 1, size);
    g.fillStyle(shade(fill, -0.22), 0.5).fillRect(ox, size - 1, size, 1).fillRect(ox + size - 1, 0, 1, size);
    // thin inner border keeps the grid legible.
    g.lineStyle(1, line, 0.8).strokeRect(ox + 0.5, 0.5, size - 1, size - 1);
  });

  g.generateTexture(TILESET_KEY, size * order.length, size);
  g.destroy();
}

/** Per-Tile decorative overlay drawn on top of the base fill + dither. */
function drawTileMotif(
  g: Phaser.GameObjects.Graphics,
  tile: Tile,
  ox: number,
  size: number,
  fill: number,
  rng: { int(a: number, b: number): number; range(a: number, b: number): number },
): void {
  const light = shade(fill, 0.22);
  const dark = shade(fill, -0.26);
  const mid = size / 2;
  switch (tile) {
    case Tile.Road:
      g.fillStyle(0xb7a23f, 0.5).fillRect(ox + mid - 1, 4, 2, 6).fillRect(ox + mid - 1, size - 10, 2, 6); // dashed centre line
      break;
    case Tile.Sidewalk:
    case Tile.Pavement:
      g.fillStyle(dark, 0.5).fillRect(ox, mid, size, 1).fillRect(ox + mid, 0, 1, size); // expansion-joint slabs
      break;
    case Tile.Wall:
      g.fillStyle(dark, 0.7);
      for (let y = 4; y < size; y += 8) g.fillRect(ox, y, size, 1); // brick courses
      for (let y = 0; y < size; y += 8) g.fillRect(ox + ((y / 8) % 2 ? mid : size - 4), y, 1, 8);
      break;
    case Tile.Floor:
    case Tile.Bridge:
      g.fillStyle(dark, 0.55);
      for (let x = 4; x < size; x += 7) g.fillRect(ox + x, 0, 1, size); // floorboards
      break;
    case Tile.Door:
      g.lineStyle(2, dark, 0.8).strokeRect(ox + 5, 4, size - 10, size - 8); // panel

      g.fillStyle(0xffe08a, 0.9).fillCircle(ox + size - 9, mid, 1.6); // knob
      break;
    case Tile.Water:
    case Tile.ShallowWater:
    case Tile.DeepWater:
      // Quiet static ripple lines — the animated overlay (AnimatedTerrain) is the
      // star, so keep the underlay subtle.
      g.lineStyle(1, light, 0.35);
      for (let k = 0; k < 3; k++) {
        const y = 6 + k * 9;
        g.beginPath();
        g.moveTo(ox + 3, y);
        g.lineTo(ox + mid, y + 3);
        g.lineTo(ox + size - 3, y);
        g.strokePath();
      }
      break;
    case Tile.Lava: {
      // Dark cooling crust with a few bright molten cracks (the GPU/overlay layer
      // adds the live glow + flow on top).
      g.fillStyle(0x1c1410, 0.55);
      for (let s = 0; s < 7; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(2, 4));
      g.lineStyle(1.5, 0xff7a2a, 0.85);
      for (let k = 0; k < 3; k++) {
        const y = 5 + k * 9;
        g.beginPath();
        g.moveTo(ox + rng.int(2, 6), y);
        g.lineTo(ox + mid + rng.int(-3, 3), y + rng.int(2, 5));
        g.lineTo(ox + size - rng.int(2, 6), y + rng.int(-2, 2));
        g.strokePath();
      }
      g.fillStyle(0xffd27a, 0.7).fillCircle(ox + mid + rng.int(-6, 6), mid + rng.int(-6, 6), 1.6);
      break;
    }
    case Tile.Mud: {
      // Wet, dark earth with a couple of glossy puddles + speckle.
      g.fillStyle(dark, 0.5);
      for (let s = 0; s < 5; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2));
      g.fillStyle(0x2a3038, 0.4).fillEllipse(ox + rng.int(8, size - 8), rng.int(8, size - 8), 9, 5);
      g.fillStyle(0x2a3038, 0.35).fillEllipse(ox + rng.int(8, size - 8), rng.int(8, size - 8), 7, 4);
      break;
    }
    case Tile.Foam: {
      // Wet sand at the surf line: a single thin foam arc + a couple of bubbles —
      // it only ever appears where a beach meets the water (shoreline pass), so it
      // reads as surf, not as scattered ocean speckle.
      const fy = 6 + rng.int(0, 4);
      g.lineStyle(2, 0xffffff, 0.55);
      g.beginPath();
      g.moveTo(ox + 2, fy);
      g.lineTo(ox + mid, fy + rng.int(2, 4));
      g.lineTo(ox + size - 2, fy + rng.int(-1, 1));
      g.strokePath();
      g.fillStyle(0xffffff, 0.4).fillCircle(ox + rng.int(6, size - 6), fy + rng.int(3, 6), 1.4);
      g.fillStyle(0xffffff, 0.3).fillCircle(ox + rng.int(6, size - 6), fy + rng.int(4, 8), 1);
      g.fillStyle(0x8a7a58, 0.3); // darker wet-sand mottling below the surf
      for (let s = 0; s < 3; s++) g.fillCircle(ox + rng.int(4, size - 4), rng.int(mid, size - 3), rng.int(1, 2));
      break;
    }
    case Tile.Stump: {
      // Burned tree remnant: charred ground + a low ringed trunk cross-section.
      g.fillStyle(0x140f0a, 0.5);
      for (let s = 0; s < 5; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2));
      g.fillStyle(0x3a2c1e, 1).fillCircle(ox + mid, mid, size * 0.22);
      g.lineStyle(1, 0x1c130c, 0.8);
      g.strokeCircle(ox + mid, mid, size * 0.13);
      g.fillStyle(0x5a4632, 0.8).fillCircle(ox + mid, mid, size * 0.06);
      break;
    }
    case Tile.Scorched:
    case Tile.Ash:
    case Tile.Basalt:
    case Tile.Grass:
      g.lineStyle(1, light, 0.6);
      for (let b = 0; b < 7; b++) {
        const x = ox + rng.int(3, size - 3);
        const y = rng.int(8, size - 2);
        g.lineBetween(x, y, x + rng.int(-1, 1), y - rng.int(2, 4));
      }
      break;
    case Tile.TallGrass: {
      // A raised, brighter tuft so tall grass reads as cover, not flat ground.
      g.fillStyle(0x0e1c0e, 0.28).fillEllipse(ox + mid + 1, size - 4, size * 0.55, size * 0.2); // base shadow
      const blade = (col: number, a: number, n: number, hi: number) => {
        g.lineStyle(1.4, col, a);
        for (let b = 0; b < n; b++) {
          const x = ox + rng.int(3, size - 3);
          const y = rng.int(size - 6, size - 2);
          g.lineBetween(x, y, x + rng.int(-2, 2), y - rng.int(hi - 3, hi));
        }
      };
      blade(0x2f4a26, 0.8, 9, 10); // dark backs
      blade(0x6fa64a, 0.85, 9, 12); // bright fronts
      break;
    }
    case Tile.Tree: {
      // Raised tree: cast shadow ring + dark trunk + layered bright canopy + rim light.
      g.fillStyle(0x0c170d, 0.4).fillEllipse(ox + mid + 2, mid + 7, size * 0.66, size * 0.34); // cast shadow
      g.fillStyle(0x3f2c19, 1).fillRect(ox + mid - 2, mid + 1, 4, size * 0.34); // trunk
      g.fillStyle(0x2c1d10, 0.7).fillRect(ox + mid + 1, mid + 1, 2, size * 0.34); // trunk shade
      g.fillStyle(0x274c24, 1).fillCircle(ox + mid, mid - 1, size * 0.36); // canopy base
      g.fillStyle(0x1d3a1c, 0.6).fillCircle(ox + mid + 5, mid + 2, size * 0.2); // shaded lobe (down-right)
      g.fillStyle(0x3c7a37, 1).fillCircle(ox + mid - 3, mid - 4, size * 0.24); // lit lobe
      g.fillStyle(0x5fb04c, 0.95).fillCircle(ox + mid - 5, mid - 6, size * 0.14); // bright highlight
      g.lineStyle(1.5, 0x86d06a, 0.85); // rim light on the top-left
      g.beginPath();
      g.arc(ox + mid, mid - 1, size * 0.36, Math.PI * 1.05, Math.PI * 1.55);
      g.strokePath();
      break;
    }
    case Tile.Bush: {
      // Low rounded shrub: small shadow + a couple of bright lobes (no trunk).
      g.fillStyle(0x0e1c0e, 0.32).fillEllipse(ox + mid + 1, mid + 6, size * 0.56, size * 0.26); // shadow
      g.fillStyle(0x2f5a2b, 1).fillCircle(ox + mid - 3, mid + 1, size * 0.22); // body
      g.fillStyle(0x418a39, 1).fillCircle(ox + mid + 3, mid, size * 0.19); // lit lobe
      g.fillStyle(0x60ab4d, 0.9).fillCircle(ox + mid - 1, mid - 3, size * 0.12); // highlight
      g.fillStyle(0x1f3d1f, 0.5).fillCircle(ox + mid + 5, mid + 4, size * 0.12); // shade
      break;
    }
    case Tile.Crop:
      g.fillStyle(dark, 0.5);
      for (let x = 5; x < size; x += 7) g.fillRect(ox + x, 2, 2, size - 4); // planted rows
      break;
    case Tile.Rail:
      g.fillStyle(dark, 0.8).fillRect(ox + 8, 0, 2, size).fillRect(ox + size - 10, 0, 2, size); // rails
      g.fillStyle(light, 0.6);
      for (let y = 2; y < size; y += 7) g.fillRect(ox + 4, y, size - 8, 2); // ties
      break;
    case Tile.Rubble:
    case Tile.Sand:
    case Tile.Dirt:
    case Tile.Trail:
      g.fillStyle(dark, 0.5);
      for (let s = 0; s < 6; s++) g.fillCircle(ox + rng.int(3, size - 3), rng.int(3, size - 3), rng.int(1, 2)); // pebbles/grain
      break;
    default:
      break;
  }
}

// --- top-down survivor characters (hand-drawn, canvas) ----------------------
// A detailed overhead survivor — shoulders + jacket, backpack, arms reaching
// forward, a head with hair, and a soft shadow — facing +x so the engine's
// movement-rotation lines up. Used for the PLAYER and survivor NPCs (different
// palettes) in place of the old flat placeholder discs / crude CC0 blobs.

const CHAR_SIZE = 40;

interface SurvivorPalette {
  jacket: number;
  skin: number;
  hair: number;
  pack: number;
  armed?: boolean; // draw a slung rifle (NPCs); the player has a live weapon overlay
}

function hx(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}
function rgbf(c: number, f: number): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return `rgb(${r},${g},${b})`;
}
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 7);
  ctx.fill();
}

/** pose: 0 = idle (arms even), ±1 = walk contact frames, ±2 = sprint contact
 *  frames (double swing). opts.tuck draws the mid-stride PASS frame (arms pulled
 *  in, slight forward gather); opts.lean shifts the whole figure toward +x
 *  (sprint drive). All variants bake their colours — canvas-tint parity. */
function drawSurvivorCanvas(p: SurvivorPalette, pose = 0, opts?: { tuck?: boolean; lean?: number }): HTMLCanvasElement {
  const S = CHAR_SIZE;
  const C = S / 2;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // soft drop shadow (never leans — it's the ground)
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  oval(ctx, C, C + 9, 13, 6);

  const lean = opts?.lean ?? 0;
  if (lean !== 0) ctx.translate(lean, 0);

  // backpack behind (−x); sprinting presses it tighter to the back
  ctx.fillStyle = hx(p.pack);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(C - 13 + (lean !== 0 ? 1 : 0), C - 7, 9 - (lean !== 0 ? 1 : 0), 14);
  ctx.fill();
  ctx.stroke();

  // arms reaching forward (+x); walk frames swing them alternately, the pass
  // frame tucks both in mid-stride
  ctx.strokeStyle = rgbf(p.jacket, 0.82);
  ctx.lineWidth = 5;
  const reach = (s: number): number => (opts?.tuck ? 7 : 9) + pose * (s === -1 ? 1 : -1) * 3;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(C - 2, C + s * 7);
    ctx.lineTo(C + reach(s), C + s * 5);
    ctx.stroke();
  }
  // hands
  ctx.fillStyle = hx(p.skin);
  for (const s of [-1, 1]) disc(ctx, C + reach(s), C + s * 5, 2.2);

  // torso / jacket (broad shoulders perpendicular to facing)
  ctx.fillStyle = hx(p.jacket);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  oval(ctx, C - 1, C, 9, 11);
  ctx.stroke();
  // zipper seam + shoulder highlight
  ctx.strokeStyle = rgbf(p.jacket, 1.2);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(C - 1, C - 9);
  ctx.lineTo(C - 1, C + 9);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  oval(ctx, C - 2, C - 4, 6, 3.5);

  // slung rifle (armed survivors)
  if (p.armed) {
    ctx.strokeStyle = "#23262b";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(C - 6, C + 9);
    ctx.lineTo(C + 12, C - 4);
    ctx.stroke();
  }

  // head (front, +x): hair cap from above, then face
  ctx.fillStyle = hx(p.hair);
  disc(ctx, C + 7, C, 6.4);
  ctx.fillStyle = hx(p.skin);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.2;
  disc(ctx, C + 8.6, C, 4.8);
  ctx.stroke();

  return cv;
}

// Default survivor body palette (natural skin/hair/pack). The appearance/faction
// colour recolours the JACKET ONLY — baked at draw time so the character keeps
// its face, hair and pack instead of flattening under a whole-sprite tint.
const PLAYER_BODY = { skin: 0xc89a6a, hair: 0x3a2c1e, pack: 0x6e5a3a };
const NPC_BODY = { skin: 0xd0a878, hair: 0x2e2722, pack: 0x4a4f57 };
export const DEFAULT_PLAYER_JACKET = 0x5b6b52; // olive

/** The player survivor — olive jacket, no slung rifle (a live weapon overlays it).
 *  Generates the idle frame, the 4-step walk cycle (contact A · pass · contact B),
 *  and the sprint contact pair (Animation Pass). The DEFAULT-jacket textures;
 *  a chosen appearance colour rebuilds them via playerJacketFrames. */
export function generatePlayerTexture(scene: Phaser.Scene, _size: number): void {
  const pal = { jacket: DEFAULT_PLAYER_JACKET, ...PLAYER_BODY };
  const add = (key: string, pose: number, opts?: { tuck?: boolean; lean?: number }) => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawSurvivorCanvas(pal, pose, opts));
  };
  add(PLAYER_KEY, 0);
  add(PLAYER_WALK_A, 1);
  add(PLAYER_WALK_B, -1);
  add(PLAYER_WALK_PASS, 0, { tuck: true, lean: 0.8 });
  add(PLAYER_SPRINT_A, 2, { lean: 1.5 });
  add(PLAYER_SPRINT_B, -2, { lean: 1.5 });
}

/** The six player frame keys for a chosen JACKET colour — drawn once and cached
 *  per colour (the default olive reuses the boot textures). Natural skin/hair/
 *  pack survive, so the survivor reads as a character in a coloured jacket
 *  rather than a flat tinted blob. */
export function playerJacketFrames(
  scene: Phaser.Scene,
  jacket: number,
): { idle: string; a: string; b: string; pass: string; sa: string; sb: string } {
  if (jacket === DEFAULT_PLAYER_JACKET) {
    return { idle: PLAYER_KEY, a: PLAYER_WALK_A, b: PLAYER_WALK_B, pass: PLAYER_WALK_PASS, sa: PLAYER_SPRINT_A, sb: PLAYER_SPRINT_B };
  }
  const tag = (jacket & 0xffffff).toString(16).padStart(6, "0");
  const pal = { jacket, ...PLAYER_BODY };
  const make = (suffix: string, pose: number, opts?: { tuck?: boolean; lean?: number }) => {
    const key = `player_j${tag}_${suffix}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawSurvivorCanvas(pal, pose, opts));
    return key;
  };
  return {
    idle: make("i", 0),
    a: make("wa", 1),
    b: make("wb", -1),
    pass: make("wp", 0, { tuck: true, lean: 0.8 }),
    sa: make("sa", 2, { lean: 1.5 }),
    sb: make("sb", -2, { lean: 1.5 }),
  };
}

/** Survivor NPC — light neutral so the scene's faction tint (cyan/green) reads;
 *  armed so they look like fighters. Walk pair added in the Animation Pass. */
export function generateSurvivorNpcTexture(scene: Phaser.Scene): void {
  const pal = { jacket: 0x9aa0a8, ...NPC_BODY, armed: true };
  if (!scene.textures.exists(SURVIVOR_NPC_KEY)) scene.textures.addCanvas(SURVIVOR_NPC_KEY, drawSurvivorCanvas(pal));
  if (!scene.textures.exists(SURVIVOR_NPC_WALK_A)) scene.textures.addCanvas(SURVIVOR_NPC_WALK_A, drawSurvivorCanvas(pal, 1));
  if (!scene.textures.exists(SURVIVOR_NPC_WALK_B)) scene.textures.addCanvas(SURVIVOR_NPC_WALK_B, drawSurvivorCanvas(pal, -1));
}

/** The three NPC frame keys for a faction/tier JACKET colour — drawn once and
 *  cached per colour (armed survivor body). The hurt flash is a full-white
 *  setTintFill that clears back to no tint, so the jacket colour stays baked. */
export function npcJacketFrames(scene: Phaser.Scene, jacket: number): { idle: string; a: string; b: string } {
  const tag = (jacket & 0xffffff).toString(16).padStart(6, "0");
  const pal = { jacket, ...NPC_BODY, armed: true };
  const make = (suffix: string, pose: number) => {
    const key = `npc_j${tag}_${suffix}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawSurvivorCanvas(pal, pose));
    return key;
  };
  return { idle: make("i", 0), a: make("wa", 1), b: make("wb", -1) };
}

// --- ground micro-decor (PR-E): pebbles / grass tufts / pavement cracks ---------
// Tiny hash-scattered detail sprites ChunkRenderer lays over plain ground so big
// fields stop reading as flat colour. Pure cosmetics — never collide, never save.

export const DECOR_PEBBLE = "decor_pebble";
export const DECOR_TUFT = "decor_tuft";
export const DECOR_CRACK = "decor_crack";

export function generateDecorTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(DECOR_PEBBLE)) {
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 8;
    const x = cv.getContext("2d");
    if (x) {
      x.fillStyle = "rgba(40,36,30,0.55)";
      x.beginPath(); x.ellipse(3, 5, 2.2, 1.6, 0.3, 0, 7); x.fill();
      x.fillStyle = "rgba(90,82,70,0.6)";
      x.beginPath(); x.ellipse(5.5, 3.5, 1.5, 1.1, -0.2, 0, 7); x.fill();
      x.fillStyle = "rgba(255,255,255,0.14)";
      x.fillRect(5, 3, 1, 1);
    }
    scene.textures.addCanvas(DECOR_PEBBLE, cv);
  }
  if (!scene.textures.exists(DECOR_TUFT)) {
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 8;
    const x = cv.getContext("2d");
    if (x) {
      x.strokeStyle = "rgba(28,44,26,0.7)";
      x.lineWidth = 1;
      for (const [bx, lean] of [[2, -1.4], [4, 0], [6, 1.4]] as const) {
        x.beginPath(); x.moveTo(bx, 7); x.quadraticCurveTo(bx + lean, 4, bx + lean, 2); x.stroke();
      }
      x.strokeStyle = "rgba(70,98,58,0.65)";
      x.beginPath(); x.moveTo(3, 7); x.quadraticCurveTo(3.4, 4.5, 4.4, 3); x.stroke();
    }
    scene.textures.addCanvas(DECOR_TUFT, cv);
  }
  if (!scene.textures.exists(DECOR_CRACK)) {
    const cv = document.createElement("canvas");
    cv.width = 10;
    cv.height = 10;
    const x = cv.getContext("2d");
    if (x) {
      x.strokeStyle = "rgba(10,12,14,0.5)";
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(1, 8); x.lineTo(4, 5); x.lineTo(3, 3); x.moveTo(4, 5); x.lineTo(8, 4); x.lineTo(9, 1);
      x.stroke();
    }
    scene.textures.addCanvas(DECOR_CRACK, cv);
  }
}
