import Phaser from "phaser";
import type { BodyArchetype, ZombieDef } from "../game/enemies/types";
import { allZombies } from "../game/enemies/catalog";

// Procedural per-type zombie sprites (Phase 2). One top-down body per ZombieDef,
// composed from its LookSpec (archetype shape + skin/accent palette + features),
// baked to a Phaser texture `zsprite_<id>`. Drawn facing +x so Enemy's rotation
// (which faces movement) lines up. Guarantees a distinct look for every type.

const SIZE = 64;
const C = SIZE / 2;

export function zombieTextureKey(id: string): string {
  return "zsprite_" + id;
}

interface Dims {
  bw: number;
  bh: number;
  headR: number;
  headOff: number;
  armLen: number;
}

function dimsFor(body: BodyArchetype): Dims {
  switch (body) {
    case "bloated": return { bw: 17, bh: 16, headR: 6, headOff: 12, armLen: 7 };
    case "crawler": return { bw: 16, bh: 9, headR: 6, headOff: 12, armLen: 11 };
    case "brute": return { bw: 18, bh: 15, headR: 8, headOff: 13, armLen: 11 };
    case "behemoth": return { bw: 21, bh: 19, headR: 10, headOff: 15, armLen: 13 };
    case "lanky": return { bw: 9, bh: 14, headR: 6, headOff: 12, armLen: 15 };
    case "child": return { bw: 9, bh: 8, headR: 6, headOff: 9, armLen: 6 };
    case "hazmat": return { bw: 14, bh: 13, headR: 8, headOff: 12, armLen: 9 };
    case "spitter": return { bw: 12, bh: 11, headR: 9, headOff: 12, armLen: 8 };
    case "screamer": return { bw: 11, bh: 11, headR: 9, headOff: 12, armLen: 8 };
    case "husk": return { bw: 10, bh: 10, headR: 6, headOff: 11, armLen: 11 };
    case "armored": return { bw: 15, bh: 13, headR: 7, headOff: 12, armLen: 9 };
    case "toxic": return { bw: 13, bh: 12, headR: 7, headOff: 12, armLen: 10 };
    case "runner": return { bw: 11, bh: 10, headR: 6, headOff: 13, armLen: 13 };
    default: return { bw: 13, bh: 11, headR: 7, headOff: 12, armLen: 10 }; // humanoid
  }
}

function hex(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}
function shade(c: number, f: number): string {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 7);
  ctx.fill();
}

function drawZombieCanvas(def: ZombieDef): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  const L = def.look;
  const d = dimsFor(L.body);
  const skin = L.skin;
  const hx = C + d.headOff; // head x (front, +x)

  ctx.lineJoin = "round";

  // soft shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ellipse(ctx, C, C + d.bh * 0.7, d.bw + 2, d.bh * 0.5);

  // arms reaching forward
  ctx.strokeStyle = shade(skin, 0.8);
  ctx.lineWidth = L.body === "behemoth" || L.body === "brute" ? 6 : 4;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(C + d.bw * 0.3, C + s * d.bh * 0.5);
    ctx.lineTo(C + d.bw * 0.3 + d.armLen, C + s * d.bh * 0.25);
    ctx.stroke();
  }

  // body
  ctx.fillStyle = hex(skin);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ellipse(ctx, C, C, d.bw, d.bh);
  ctx.stroke();

  // accent (torn clothing band)
  if (L.accent !== undefined) {
    ctx.fillStyle = hex(L.accent);
    ctx.fillRect(C - d.bw * 0.5, C - d.bh * 0.3, d.bw, d.bh * 0.55);
  }

  // head
  ctx.fillStyle = shade(skin, 1.08);
  ctx.beginPath();
  ctx.arc(hx, C, d.headR, 0, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.stroke();

  // features
  const feat = new Set(L.features ?? []);
  if (feat.has("plates")) {
    ctx.fillStyle = "#3a4250";
    ctx.fillRect(C - d.bw * 0.5, C - d.bh * 0.6, d.bw, d.bh * 0.5);
    ctx.strokeRect(C - d.bw * 0.5, C - d.bh * 0.6, d.bw, d.bh * 0.5);
  }
  if (feat.has("sacs")) {
    ctx.fillStyle = "rgba(150,220,90,0.8)";
    for (const s of [-1, 1]) ellipse(ctx, C - d.bw * 0.2, C + s * d.bh * 0.45, 4, 3);
  }
  if (feat.has("bone")) {
    ctx.strokeStyle = "#d8d0b8";
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(C - 3, C + i * 5);
      ctx.lineTo(C + 5, C + i * 5);
      ctx.stroke();
    }
  }
  if (feat.has("blood")) {
    ctx.fillStyle = "rgba(150,20,20,0.8)";
    for (let i = 0; i < 4; i++) ellipse(ctx, C - 6 + i * 5, C - 4 + (i % 2) * 7, 1.6, 1.6);
  }
  if (feat.has("spikes")) {
    ctx.fillStyle = "#cfc6ad";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(C - d.bw * 0.6, C + s * d.bh * 0.2);
      ctx.lineTo(C - d.bw * 0.6 - 6, C + s * d.bh * 0.2 - 2);
      ctx.lineTo(C - d.bw * 0.6, C + s * d.bh * 0.45);
      ctx.fill();
    }
  }
  if (feat.has("horns")) {
    ctx.fillStyle = "#e8e2d0";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx, C + s * d.headR);
      ctx.lineTo(hx + 4, C + s * (d.headR + 6));
      ctx.lineTo(hx - 2, C + s * d.headR);
      ctx.fill();
    }
  }
  if (feat.has("tatters")) {
    ctx.strokeStyle = hex(L.accent ?? 0x444444);
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(C - d.bw * 0.5, C + i * 3 + d.bh * 0.3);
      ctx.lineTo(C - d.bw * 0.5 - 4, C + i * 3 + d.bh * 0.3 + 3);
      ctx.stroke();
    }
  }

  // eyes (glow)
  const eye = L.eyes;
  if (eye !== undefined) {
    ctx.shadowColor = hex(eye);
    ctx.shadowBlur = 6;
    ctx.fillStyle = hex(eye);
  } else {
    ctx.fillStyle = "#140d0d";
  }
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hx + d.headR * 0.4, C + s * d.headR * 0.45, 1.8, 0, 7);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // open maw for screamers
  if (L.body === "screamer") {
    ctx.fillStyle = "#1a0a0a";
    ctx.beginPath();
    ctx.arc(hx + d.headR * 0.5, C, d.headR * 0.5, 0, 7);
    ctx.fill();
  }
  // drip
  if (feat.has("drip")) {
    ctx.fillStyle = "rgba(120,200,80,0.7)";
    for (let i = -1; i <= 1; i++) ellipse(ctx, C + i * 6, C + d.bh + 2, 1.5, 2.5);
  }

  return cv;
}

/** Generate a texture for every zombie type. Idempotent; run once at boot. */
export function generateZombieTextures(scene: Phaser.Scene): void {
  for (const def of allZombies()) {
    const key = zombieTextureKey(def.id);
    if (scene.textures.exists(key)) continue;
    scene.textures.addCanvas(key, drawZombieCanvas(def));
  }
}
