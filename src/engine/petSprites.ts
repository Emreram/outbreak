// Procedural pet sprites (Companions & Spectacle PR-A) — a 64px canvas composer
// in the zombieSprites mold: each PetDef's look (archetype + palette + features)
// is drawn facing +x so the engine's rotation-facing just works. ALL colours are
// BAKED into the canvas (canvas-tint parity: the CANVAS renderer ignores live
// tints on generated textures). Wings render as a SEPARATE overlay texture so
// flight can flap them independently. Generated PNGs (AssetManifest) override any
// key that already exists.

import Phaser from "phaser";
import { PETS, isRideable, type PetDef, type PetFeature } from "../game/pets";
import { isGeneratedTexture } from "./generatedKeys";
import { RARITY_META } from "../game/items/rarity";

const SIZE = 64;
const C = SIZE / 2;

export const PET_SHADOW = "pet_shadow";

export function petTexKey(id: string): string {
  return `pet_${id}`;
}
export function petWingKey(id: string): string {
  return `petwing_${id}`;
}
export function mountedTexKey(id: string): string {
  return `mounted_${id}`;
}
/** The alternate stride frame (Animation Pass): pet_<id>_b. Generated i2i
 *  variants override it through the AssetManifest exactly like the base. */
export function petFrameBKey(id: string): string {
  return `pet_${id}_b`;
}

/** Every species id a drawer exists for (mirrors propKinds for the tests). */
export function petSpriteIds(): string[] {
  return Object.keys(PETS);
}

/** Every rideable species id a mounted composite is generated for (PR-B). */
export function mountableSpriteIds(): string[] {
  return Object.values(PETS).filter((d) => isRideable(d)).map((d) => d.id);
}

function shade(hex: number, f: number): string {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * f)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * f)));
  return `rgb(${r},${g},${b})`;
}
const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

function has(def: PetDef, f: PetFeature): boolean {
  return def.look.features?.includes(f) ?? false;
}

/** Body canvas (no wings — those live on the overlay), facing +x.
 *  pose 1 = the alternate stride frame: legs swapped, tail swung, serpents
 *  S-mirrored, shells mid-shuffle (Animation Pass). */
export function drawPetCanvas(def: PetDef, pose: 0 | 1 = 0): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const x = cv.getContext("2d");
  if (!x) return cv;
  const b = pose === 1 ? 1 : 0; // stride factor for the B-frame offsets
  const body = def.look.body;
  const accent = def.look.accent ?? body;

  // soft ground shadow (baked — fliers get a separate detached shadow sprite)
  if (def.move !== "fly") {
    x.fillStyle = "rgba(8,12,10,0.30)";
    x.beginPath();
    x.ellipse(C, C + 11, 15, 6, 0, 0, Math.PI * 2);
    x.fill();
  }

  switch (def.look.archetype) {
    case "quadruped": {
      leg(x, C - 8 + b * 3, C + 7 - b, body); leg(x, C + 6 - b * 3, C + 7 + b, body);
      x.fillStyle = shade(body, 1);
      ellipse(x, C - 1, C, 14, 8); // torso
      x.fillStyle = shade(body, 0.82);
      ellipse(x, C - 6, C + 2, 8, 5); // haunch shading
      // tail
      x.strokeStyle = shade(accent, 0.9); x.lineWidth = 3; x.lineCap = "round";
      x.beginPath(); x.moveTo(C - 14, C - 1); x.quadraticCurveTo(C - 20, C - 7 + b * 6, C - 18, C - 12 + b * 4); x.stroke();
      // head + ears/snout
      x.fillStyle = shade(body, 1.12);
      ellipse(x, C + 12, C - 1, 7, 6);
      x.fillStyle = shade(accent, 1.05);
      ellipse(x, C + 18, C, 4, 3); // snout
      tri(x, C + 9, C - 6, 4, shade(accent, 0.85)); tri(x, C + 13, C - 7, 4, shade(accent, 0.85)); // ears
      break;
    }
    case "equine": {
      leg(x, C - 10 + b * 2.5, C + 8 - b, body); leg(x, C - 3 - b * 2.5, C + 8 + b, body);
      leg(x, C + 4 + b * 2.5, C + 8 - b, body); leg(x, C + 10 - b * 2.5, C + 8 + b, body);
      x.fillStyle = shade(body, 1);
      ellipse(x, C - 1, C, 16, 7); // long torso
      x.fillStyle = shade(body, 0.85);
      ellipse(x, C - 8, C + 1, 8, 5);
      // neck + head forward
      x.fillStyle = shade(body, 1.08);
      x.beginPath(); x.moveTo(C + 8, C - 2); x.lineTo(C + 16, C - 8); x.lineTo(C + 21, C - 6); x.lineTo(C + 14, C + 3); x.closePath(); x.fill();
      ellipse(x, C + 20, C - 7, 5, 3.4); // head
      // mane strip along the neck/back
      x.strokeStyle = has(def, "flameMane") ? css(0xff7a2a) : shade(accent, 0.8);
      x.lineWidth = 3.4; x.lineCap = "round";
      x.beginPath(); x.moveTo(C - 12, C - 5); x.quadraticCurveTo(C + 4, C - 9, C + 15, C - 9); x.stroke();
      if (has(def, "flameMane")) { // additive-looking flame tips
        x.fillStyle = "rgba(255,210,63,0.85)";
        for (let i = 0; i < 5; i++) { const fx = C - 10 + i * 6; tri(x, fx, C - 10, 3.4, "rgba(255,122,42,0.9)"); x.fillRect(fx - 0.8, C - 12, 1.6, 2.4); }
      }
      // tail
      x.strokeStyle = shade(accent, 0.7); x.lineWidth = 3;
      x.beginPath(); x.moveTo(C - 16, C - 2); x.quadraticCurveTo(C - 22, C + 2 + b * 3, C - 21 - b * 2, C + 8 - b * 3); x.stroke();
      if (has(def, "horn")) { // unicorn spiral
        x.strokeStyle = css(0xf4e9c8); x.lineWidth = 2.4;
        x.beginPath(); x.moveTo(C + 21, C - 9); x.lineTo(C + 27, C - 14); x.stroke();
        x.strokeStyle = "rgba(255,255,255,0.7)"; x.lineWidth = 0.8;
        x.beginPath(); x.moveTo(C + 22, C - 10); x.lineTo(C + 26, C - 13); x.stroke();
      }
      if (has(def, "antlers")) {
        x.strokeStyle = shade(0x8a6a3a, 1); x.lineWidth = 2;
        x.beginPath(); x.moveTo(C + 17, C - 9); x.lineTo(C + 14, C - 15); x.moveTo(C + 15, C - 12); x.lineTo(C + 11, C - 14); x.stroke();
        x.beginPath(); x.moveTo(C + 21, C - 9); x.lineTo(C + 24, C - 15); x.moveTo(C + 23, C - 12); x.lineTo(C + 27, C - 14); x.stroke();
      }
      break;
    }
    case "avian": {
      x.fillStyle = shade(body, 1);
      ellipse(x, C, C, 10, 7); // body
      x.fillStyle = shade(body, 0.85);
      // tail fan
      x.beginPath(); x.moveTo(C - 8, C); x.lineTo(C - 18, C - 5 + b * 2); x.lineTo(C - 18, C + 5 + b * 2); x.closePath(); x.fill();
      x.fillStyle = shade(body, 1.12);
      ellipse(x, C + 9 + b, C - 2 + b * 0.6, 5, 4.4); // head
      tri(x, C + 14, C - 2, 4, shade(0xffd23f, 1)); // beak
      x.fillStyle = shade(accent, 1);
      ellipse(x, C - 1, C - 2, 6, 3); // back feathers
      break;
    }
    case "drake": {
      leg(x, C - 7 + b * 3, C + 8 - b, body); leg(x, C + 5 - b * 3, C + 8 + b, body);
      x.fillStyle = shade(body, 1);
      ellipse(x, C - 1, C, 15, 8); // ridged torso
      // tail spade
      const ty = b ? -1 : 1; // tail spade swings to the other flank on the B frame
      x.beginPath(); x.moveTo(C - 14, C); x.quadraticCurveTo(C - 22, C + 2 * ty, C - 24, C - 3 * ty); x.lineTo(C - 27, C - 5 * ty); x.lineTo(C - 23, C - 7 * ty); x.closePath();
      x.fillStyle = shade(body, 0.9); x.fill();
      // back ridges
      x.fillStyle = shade(accent, 0.95);
      for (let i = 0; i < 4; i++) tri(x, C - 9 + i * 6, C - 7, 3.4, shade(accent, 0.95));
      // neck + head
      x.fillStyle = shade(body, 1.08);
      x.beginPath(); x.moveTo(C + 9, C - 2); x.lineTo(C + 15, C - 7); x.lineTo(C + 20, C - 5); x.lineTo(C + 13, C + 2); x.closePath(); x.fill();
      ellipse(x, C + 19, C - 6, 5.4, 3.6);
      tri(x, C + 24, C - 6, 3.4, shade(body, 1.2)); // snout
      if (has(def, "crest")) { tri(x, C + 16, C - 10, 3.6, shade(accent, 1.05)); tri(x, C + 20, C - 10, 3, shade(accent, 1.05)); }
      break;
    }
    case "serpent": {
      // S-curve segments
      const sy = b ? -1 : 1; // B frame mirrors the S-curve — the slither phase
      const pts: Array<[number, number]> = [
        [C - 18, C + 5 * sy], [C - 10, C - 3 * sy], [C - 2, C + 5 * sy], [C + 6, C - 3 * sy], [C + 13, C + 2 * sy],
      ];
      for (let i = 0; i < pts.length; i++) {
        x.fillStyle = shade(body, 0.9 + (i / pts.length) * 0.25);
        ellipse(x, pts[i][0], pts[i][1], 7.4 - i * 0.4, 5.4 - i * 0.3);
      }
      x.fillStyle = shade(body, 1.18);
      ellipse(x, C + 19, C, 6, 4.4); // head
      if (has(def, "crest")) {
        x.fillStyle = shade(accent, 1);
        tri(x, C + 16, C - 5, 4, shade(accent, 1)); tri(x, C + 20, C - 6, 3.4, shade(accent, 1));
      }
      // fin tail (follows the S phase)
      tri(x, C - 21, C + (b ? -4 : 4), 5, shade(accent, 0.85));
      break;
    }
    case "shelled": {
      leg(x, C - 9 + b * 2, C + 7, body); leg(x, C + 7 - b * 2, C + 7, body);
      x.fillStyle = shade(accent, 1);
      ellipse(x, C - 1, C, 13, 9); // shell
      x.strokeStyle = shade(accent, 0.7); x.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.ellipse(C - 1, C, 13 - i * 4, 9 - i * 3, 0, 0, Math.PI * 2); x.stroke(); }
      x.fillStyle = shade(body, 1.1);
      ellipse(x, C + 13 + b * 1.5, C, 5 + b * 0.5, 3.6); // head reaches further mid-shuffle
      break;
    }
  }

  // shared features
  if (has(def, "scales")) {
    x.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 12; i++) {
      const sx = C - 12 + ((i * 7) % 24);
      const sy = C - 4 + ((i * 5) % 9);
      x.beginPath(); x.arc(sx, sy, 1.1, 0, Math.PI * 2); x.fill();
    }
  }
  if (has(def, "tusks")) {
    x.strokeStyle = css(0xf4e9c8); x.lineWidth = 2.2; x.lineCap = "round";
    x.beginPath(); x.moveTo(C + 16, C + 2); x.quadraticCurveTo(C + 20, C + 4, C + 21, C); x.stroke();
  }
  if (has(def, "glowEyes")) {
    x.fillStyle = css(def.rarity === "mythic" ? 0xffd23f : 0x9bff6a);
    x.beginPath(); x.arc(C + (def.look.archetype === "avian" ? 10 : 19), C - 5, 1.4, 0, Math.PI * 2); x.fill();
  } else {
    x.fillStyle = "rgba(12,12,14,0.9)";
    x.beginPath(); x.arc(C + (def.look.archetype === "avian" ? 10 : 18), C - 4, 1.1, 0, Math.PI * 2); x.fill();
  }
  // rarity rim-light: epic+ pets carry their tier on their silhouette
  if (RARITY_META[def.rarity].rank >= 3) {
    x.strokeStyle = RARITY_META[def.rarity].css;
    x.globalAlpha = 0.5;
    x.lineWidth = 1;
    x.beginPath(); x.ellipse(C, C, 17, 10, 0, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 1;
  }
  return cv;
}

/** Mounted composite (PR-B): the pet canvas with a rider perched on its back —
 *  one baked texture per rideable species, rotated whole by the engine's
 *  rotation-facing exactly like the vehicle sprites. */
export function drawMountedCanvas(def: PetDef): HTMLCanvasElement {
  const cv = drawPetCanvas(def);
  const x = cv.getContext("2d");
  if (!x) return cv;
  // The saddle point: just behind the head works for every archetype at 64px.
  const rx = C - 2;
  const ry = C - 9;
  x.fillStyle = "#39536b"; // jacket
  ellipse(x, rx, ry, 5, 6);
  x.fillStyle = "#2c4254"; // arm forward to the reins
  x.fillRect(rx + 2, ry - 2, 8, 2.6);
  x.fillStyle = "#d9a066"; // head
  x.beginPath();
  x.arc(rx, ry - 8, 3.4, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#4a3826"; // hair
  x.beginPath();
  x.arc(rx - 0.8, ry - 8.8, 3, Math.PI * 0.85, Math.PI * 2.05);
  x.fill();
  return cv;
}

/** Wing overlay (flap-animated by scaling): two spread wings, transparent centre. */
export function drawWingCanvas(def: PetDef): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const x = cv.getContext("2d");
  if (!x) return cv;
  const accent = def.look.accent ?? def.look.body;
  const wing = (side: -1 | 1): void => {
    x.fillStyle = shade(accent, side === -1 ? 0.92 : 1.02);
    x.beginPath();
    x.moveTo(C - 2, C + side * 3);
    x.quadraticCurveTo(C - 6, C + side * 16, C - 20, C + side * 20);
    x.quadraticCurveTo(C - 8, C + side * 12, C + 4, C + side * 7);
    x.closePath();
    x.fill();
    // feather/membrane lines
    x.strokeStyle = shade(accent, 0.7);
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(C - 4, C + side * 6); x.lineTo(C - 14, C + side * 16); x.stroke();
  };
  wing(-1);
  wing(1);
  return cv;
}

/** Boot-time generation. Generated PNGs (AssetManifest) win — skip existing keys.
 *  Stride B-frames (Animation Pass) follow the fallback chain: a generated BODY
 *  only ever cycles against a generated _b (manifest), NEVER a procedural one
 *  (style flicker) — single-frame generated pets ride the gait layer instead. */
export function generatePetTextures(scene: Phaser.Scene): void {
  for (const def of Object.values(PETS)) {
    const key = petTexKey(def.id);
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawPetCanvas(def));
    const bk = petFrameBKey(def.id);
    if (!isGeneratedTexture(key) && !scene.textures.exists(bk)) {
      scene.textures.addCanvas(bk, drawPetCanvas(def, 1));
    }
    if (def.look.features?.includes("wings")) {
      const wk = petWingKey(def.id);
      if (!scene.textures.exists(wk)) scene.textures.addCanvas(wk, drawWingCanvas(def));
    }
    if (isRideable(def)) {
      const mk = mountedTexKey(def.id);
      if (!scene.textures.exists(mk)) scene.textures.addCanvas(mk, drawMountedCanvas(def));
    }
  }
  if (!scene.textures.exists(PET_SHADOW)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x06080a, 0.34).fillEllipse(16, 8, 30, 12);
    g.generateTexture(PET_SHADOW, 32, 16);
    g.destroy();
  }
}

/** DOM portrait for the Pet modal / HUD chip (cached). */
const portraitCache = new Map<string, string>();
export function petPortraitUrl(speciesId: string): string {
  const hit = portraitCache.get(speciesId);
  if (hit) return hit;
  const def = PETS[speciesId] ?? PETS.stray_dog;
  const url = drawPetCanvas(def).toDataURL();
  portraitCache.set(speciesId, url);
  return url;
}

// --- tiny draw helpers -------------------------------------------------------
function ellipse(x: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  x.fill();
}
function leg(x: CanvasRenderingContext2D, cx: number, cy: number, color: number): void {
  x.fillStyle = shade(color, 0.7);
  x.fillRect(cx - 1.6, cy - 2, 3.2, 6);
}
function tri(x: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string): void {
  x.fillStyle = fill;
  x.beginPath();
  x.moveTo(cx, cy - s);
  x.lineTo(cx - s * 0.7, cy + s * 0.6);
  x.lineTo(cx + s * 0.7, cy + s * 0.6);
  x.closePath();
  x.fill();
}
