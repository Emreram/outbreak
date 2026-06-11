import Phaser from "phaser";
import type { ItemDef } from "../game/items/types";
import { allItems } from "../game/items/catalog";
import { RARITY_META } from "../game/items/rarity";

// Procedural item icons (Phase 2). One canvas per catalog item, framed by rarity
// and drawn as a class silhouette tinted by material. Each canvas is registered as
// a Phaser texture (world drops / in-hand) AND cached as a dataURL (the DOM loot UI).
// Guaranteed to produce a visible icon for every item — no art dependency.

const SIZE = 48;
const HELD_SIZE = 64;
const dataUrlCache = new Map<string, string>();

export function iconKey(name: string): string {
  return "icon_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/** Texture key for the in-hand (plateless, outlined) version of a weapon. */
export function heldKey(name: string): string {
  return "held_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function cssHex(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}

function baseColor(def: ItemDef): number {
  if (def.tint !== undefined) return def.tint;
  if (def.kind === "weapon") {
    if (def.hand === "ranged") return def.wclass === "bow" || def.wclass === "crossbow" ? 0x8a6a3a : 0x3b4250;
    return 0xc2c9d2;
  }
  switch (def.icon) {
    case "bandage": return 0xf2f2f2;
    case "pills": return 0xff6b6b;
    case "syringe": return 0xbfe9ff;
    case "food": return 0xd9a441;
    case "drink": return 0x6fc3ff;
    case "ammo": return 0xd9b54a;
    case "armor": return 0x5b616a;
    case "grenade": return 0x3a5236;
    case "note": return 0xe8dfc8;
    case "map": return 0xd8c89a;
    case "cache": return 0xb98a4a;
    case "egg": return 0xe8e2d0;
    default: return 0x9aa3ad;
  }
}

type P2D = CanvasRenderingContext2D;

function poly(ctx: P2D, pts: number[][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
function rrect(ctx: P2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw a silhouette centred at (0,0), roughly within [-17,17].
function silhouette(ctx: P2D, def: ItemDef): void {
  const key = def.icon;
  const fill = cssHex(baseColor(def));
  ctx.fillStyle = fill;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  const handle = "#6b4a2a";

  const blade = (len: number, w: number) => {
    ctx.fillStyle = handle;
    ctx.fillRect(-2, 6, 4, 9); // grip
    ctx.fillStyle = fill;
    poly(ctx, [[-w, 6], [w, 6], [0, -len]]); // blade
  };

  switch (key) {
    case "knife": blade(16, 4); break;
    case "machete": blade(18, 5); break;
    case "sword": ctx.fillStyle = handle; ctx.fillRect(-2, 8, 4, 8); ctx.fillStyle = fill; ctx.fillRect(-6, 6, 12, 3); poly(ctx, [[-3, 6], [3, 6], [0, -17]]); break;
    case "katana": ctx.fillStyle = handle; ctx.fillRect(-2, 8, 4, 8); ctx.fillStyle = fill; ctx.save(); ctx.rotate(0.12); poly(ctx, [[-3, 7], [2, 7], [3, -16], [-1, -16]]); ctx.restore(); break;
    case "axe": case "hatchet": ctx.fillStyle = handle; ctx.fillRect(-2, -14, 4, 28); ctx.fillStyle = fill; poly(ctx, [[2, -14], [13, -10], [13, -2], [2, -4]]); break;
    case "bat": ctx.fillStyle = handle; poly(ctx, [[-4, 15], [4, 15], [3, -14], [-3, -14]]); ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(0, -10, 6, 8, 0, 0, 7); ctx.fill(); ctx.stroke(); break;
    case "club": ctx.fillStyle = handle; ctx.fillRect(-3, 0, 6, 15); ctx.fillStyle = fill; rrect(ctx, -6, -15, 12, 16, 5); ctx.fill(); ctx.stroke(); break;
    case "hammer": case "mace": case "sledge": ctx.fillStyle = handle; ctx.fillRect(-2, -10, 4, 26); ctx.fillStyle = fill; ctx.fillRect(-11, -16, 22, 9); ctx.strokeRect(-11, -16, 22, 9); break;
    case "pipe": ctx.fillStyle = fill; rrect(ctx, -3, -16, 6, 32, 3); ctx.fill(); ctx.stroke(); break;
    case "spear": case "polearm": ctx.fillStyle = handle; ctx.fillRect(-1.5, -6, 3, 22); ctx.fillStyle = fill; poly(ctx, [[-4, -6], [4, -6], [0, -17]]); break;
    case "whip": ctx.strokeStyle = fill; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, 14); ctx.bezierCurveTo(-2, 6, -10, -6, 0, -10); ctx.bezierCurveTo(8, -13, 6, 2, 13, -4); ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,0.5)"; break;
    case "fist": ctx.fillStyle = fill; rrect(ctx, -11, -6, 22, 14, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = "rgba(0,0,0,0.45)"; for (let i = -1; i <= 2; i++) ctx.fillRect(-9 + (i + 1) * 5, -6, 2, 5); break;
    case "star": ctx.fillStyle = fill; poly(ctx, [[0, -14], [4, -4], [14, 0], [4, 4], [0, 14], [-4, 4], [-14, 0], [-4, -4]]); ctx.fillStyle = "#10151b"; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); break;

    case "pistol": gun(ctx, fill, { barrel: 13, body: 8, grip: true }); break;
    case "revolver": gun(ctx, fill, { barrel: 12, body: 8, grip: true, cyl: true }); break;
    case "smg": gun(ctx, fill, { barrel: 9, body: 11, grip: true, mag: true }); break;
    case "shotgun": gun(ctx, fill, { barrel: 18, body: 7, stock: true }); break;
    case "rifle": gun(ctx, fill, { barrel: 16, body: 9, stock: true, mag: true }); break;
    case "sniper": gun(ctx, fill, { barrel: 20, body: 7, stock: true, scope: true }); break;
    case "lmg": gun(ctx, fill, { barrel: 15, body: 12, stock: true, mag: true, box: true }); break;
    case "nailgun": gun(ctx, fill, { barrel: 7, body: 9, grip: true }); break;
    case "energy": gun(ctx, fill, { barrel: 12, body: 10, grip: true, glow: true }); break;
    case "launcher": ctx.fillStyle = fill; rrect(ctx, -16, -6, 32, 12, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#10151b"; ctx.beginPath(); ctx.arc(-14, 0, 4, 0, 7); ctx.fill(); break;
    case "flame": ctx.fillStyle = fill; rrect(ctx, -14, -2, 20, 6, 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#d13a2a"; rrect(ctx, 4, -7, 8, 14, 3); ctx.fill(); ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.moveTo(12, -3); ctx.lineTo(18, 0); ctx.lineTo(12, 3); ctx.fill(); break;
    case "bow": ctx.strokeStyle = fill; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(4, 0, 15, 2.2, -2.2, true); ctx.stroke(); ctx.strokeStyle = "rgba(220,220,220,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7, -13); ctx.lineTo(-7, 13); ctx.stroke(); break;
    case "crossbow": ctx.fillStyle = handle; ctx.fillRect(-2, -3, 22, 5); ctx.strokeStyle = fill; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(8, 0, 12, 1.4, -1.4, true); ctx.stroke(); ctx.lineWidth = 1.5; break;

    case "bandage": ctx.fillStyle = "#eef2f5"; rrect(ctx, -13, -7, 26, 14, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#e23b3b"; ctx.fillRect(-2, -5, 4, 10); ctx.fillRect(-5, -2, 10, 4); break;
    case "pills": ctx.fillStyle = "#ff6b6b"; rrect(ctx, -12, -4, 16, 8, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#ffe08a"; rrect(ctx, -2, -4, 16, 8, 4); ctx.fill(); ctx.stroke(); break;
    case "syringe": ctx.strokeStyle = "#9fb3c8"; ctx.fillStyle = "#cfe6ff"; rrect(ctx, -10, -4, 16, 8, 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#9fb3c8"; ctx.fillRect(6, -1.5, 10, 3); break;
    case "food": ctx.fillStyle = fill; rrect(ctx, -8, -13, 16, 26, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(-8, -4, 16, 6); break;
    case "drink": ctx.fillStyle = fill; rrect(ctx, -6, -8, 12, 22, 3); ctx.fill(); ctx.stroke(); ctx.fillRect(-3, -15, 6, 7); ctx.strokeRect(-3, -15, 6, 7); break;
    case "ammo": ctx.fillStyle = fill; for (const dx of [-7, 0, 7]) { rrect(ctx, dx - 3, -8, 6, 14, 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#a8772a"; ctx.fillRect(dx - 3, 2, 6, 4); ctx.fillStyle = fill; } break;
    case "armor": ctx.fillStyle = fill; poly(ctx, [[-12, -10], [-4, -12], [4, -12], [12, -10], [10, 12], [-10, 12]]); ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-1, -10, 2, 22); break;
    case "grenade": ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 3, 10, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#9aa3ad"; ctx.fillRect(-3, -12, 6, 6); break;
    case "note": { // a creased paper scrap with faded writing
      ctx.fillStyle = fill;
      poly(ctx, [[-10, -13], [9, -11], [11, 12], [-12, 11]]);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      for (let i = -7; i <= 7; i += 4) { ctx.beginPath(); ctx.moveTo(-8, i); ctx.lineTo(7, i + 0.5); ctx.stroke(); }
      break;
    }
    case "map": { // a folded map with a route + an X
      ctx.fillStyle = fill;
      poly(ctx, [[-13, -10], [13, -12], [12, 11], [-12, 12]]);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(-4, 12); ctx.stroke(); // fold
      ctx.strokeStyle = "#7a3a2a";
      ctx.beginPath(); ctx.moveTo(-10, 7); ctx.bezierCurveTo(-4, 2, 2, 8, 7, -3); ctx.stroke(); // route
      ctx.strokeStyle = "#b03030";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(5, -6); ctx.lineTo(10, -1); ctx.moveTo(10, -6); ctx.lineTo(5, -1); ctx.stroke(); // X
      break;
    }
    case "cache": { // a strapped supply crate with a stencil band
      ctx.fillStyle = fill;
      rrect(ctx, -13, -9, 26, 19, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(-13, -3, 26, 3); // lid seam
      ctx.fillStyle = "#2a2620";
      ctx.fillRect(-7, -9, 4, 19); // straps
      ctx.fillRect(3, -9, 4, 19);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-2, 2, 8, 2); // stencil mark
      break;
    }
    case "egg": { // a speckled egg, lit from above
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(0, 2, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(-3, -4, 3, 4.5, -0.4, 0, Math.PI * 2);
      ctx.fill(); // sheen
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (const [sx, sy, r] of [[4, -2, 1.4], [-4, 5, 1.2], [2, 7, 1.5], [-1, 0, 1]] as const) {
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill(); // speckles
      }
      break;
    }
    default: ctx.fillStyle = fill; poly(ctx, [[-10, -6], [2, -12], [12, -2], [6, 10], [-8, 8]]); break; // scrap / material
  }
}

interface GunOpts {
  barrel: number;
  body: number;
  grip?: boolean;
  stock?: boolean;
  mag?: boolean;
  cyl?: boolean;
  scope?: boolean;
  box?: boolean;
  glow?: boolean;
}
function gun(ctx: P2D, fill: string, o: GunOpts): void {
  const left = -o.barrel - 4;
  ctx.fillStyle = fill;
  if (o.stock) ctx.fillRect(left - 6, -3, 8, o.body - 1);
  ctx.fillRect(left, -o.body / 2, o.barrel + 8, o.body); // body
  ctx.strokeRect(left, -o.body / 2, o.barrel + 8, o.body);
  ctx.fillRect(left + o.barrel + 6, -2, 8, 4); // muzzle
  if (o.grip) { ctx.fillStyle = "#2a2f38"; ctx.fillRect(left + 2, o.body / 2 - 1, 5, 9); }
  if (o.mag) { ctx.fillStyle = "#2a2f38"; ctx.fillRect(left + o.barrel - 2, o.body / 2 - 1, 5, 9); }
  if (o.box) { ctx.fillStyle = "#2a2f38"; ctx.fillRect(left + 4, o.body / 2 - 1, 9, 7); }
  if (o.cyl) { ctx.fillStyle = "#555c66"; ctx.beginPath(); ctx.arc(left + 6, 1, 4, 0, 7); ctx.fill(); ctx.stroke(); }
  if (o.scope) { ctx.fillStyle = "#2a2f38"; ctx.fillRect(left + 4, -o.body / 2 - 4, 10, 3); }
  if (o.glow) { ctx.fillStyle = "#9be7ff"; ctx.beginPath(); ctx.arc(left + o.barrel + 10, 0, 3, 0, 7); ctx.fill(); }
}

function drawIconCanvas(def: ItemDef): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const meta = RARITY_META[def.rarity];
  // plate + rarity frame
  rrect(ctx, 2, 2, SIZE - 4, SIZE - 4, 8);
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, "#1a222c");
  g.addColorStop(1, "#0c1117");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = cssHex(meta.color);
  ctx.stroke();
  // rarity corner glow
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = cssHex(meta.color);
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, 7);
  ctx.fill();
  ctx.restore();
  // silhouette
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2 + 1);
  silhouette(ctx, def);
  ctx.restore();
  return c;
}

// In-hand weapon sprite: ONLY the silhouette (no dark plate/border), drawn bigger
// and under a bright halo so the held weapon reads clearly against any ground / at
// night — the full plate icon reads as a dark nub on the player. Transparent bg.
function drawHeldCanvas(def: ItemDef): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = HELD_SIZE;
  c.height = HELD_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.translate(HELD_SIZE / 2, HELD_SIZE / 2 + 1);
  ctx.scale(1.5, 1.5); // the silhouette lives in ~[-17,17]; fill more of the canvas
  // Pass 1: a light halo (outline) cast by the shape, so it pops on dark backgrounds.
  ctx.save();
  ctx.shadowColor = "rgba(245,247,250,0.95)";
  ctx.shadowBlur = 5;
  silhouette(ctx, def);
  silhouette(ctx, def); // double the shadow pass for a stronger rim
  ctx.restore();
  silhouette(ctx, def); // crisp shape over the halo
  return c;
}

/** Generate every item icon as a Phaser texture + cached dataURL (and a plateless
 *  in-hand texture for weapons). Idempotent. */
export function generateAllIcons(scene: Phaser.Scene): void {
  for (const def of allItems()) {
    const key = iconKey(def.name);
    if (!scene.textures.exists(key)) {
      const canvas = drawIconCanvas(def);
      scene.textures.addCanvas(key, canvas);
      dataUrlCache.set(def.name, canvas.toDataURL());
    } else if (!dataUrlCache.has(def.name)) {
      dataUrlCache.set(def.name, drawIconCanvas(def).toDataURL());
    }
    if (def.kind === "weapon") {
      const hk = heldKey(def.name);
      if (!scene.textures.exists(hk)) scene.textures.addCanvas(hk, drawHeldCanvas(def));
    }
  }
}

/** DOM dataURL for an item icon (loot UI). Falls back to a generic scrap icon. */
export function iconDataUrl(name: string): string {
  const cached = dataUrlCache.get(name);
  if (cached) return cached;
  const def = allItems().find((d) => d.name === name);
  const url = drawIconCanvas(
    def ?? { id: "x", name, kind: "material", rarity: "common", icon: "scrap" },
  ).toDataURL();
  dataUrlCache.set(name, url);
  return url;
}

export const CHEST_CLOSED = "chest_closed";
export const CHEST_OPEN = "chest_open";
export const PADLOCK = "padlock";
export const PROJ_BULLET = "proj_bullet";
export const PROJ_PELLET = "proj_pellet";
export const PROJ_ARROW = "proj_arrow";
export const PROJ_ROCKET = "proj_rocket";

/** Chest + projectile world textures (Graphics-baked, like textures.ts/fx.ts). */
export function generateLootWorldTextures(scene: Phaser.Scene): void {
  const mk = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };

  mk(CHEST_CLOSED, 28, 24, (g) => {
    g.fillStyle(0x6b4a2a, 1).fillRoundedRect(1, 8, 26, 15, 3);
    g.fillStyle(0x8a6a3a, 1).fillRoundedRect(1, 4, 26, 8, 3);
    g.fillStyle(0xd9b54a, 1).fillRect(12, 9, 4, 8);
    g.lineStyle(1, 0x3a2a17, 1).strokeRoundedRect(1, 4, 26, 19, 3);
  });
  mk(CHEST_OPEN, 28, 28, (g) => {
    g.fillStyle(0x6b4a2a, 1).fillRoundedRect(1, 12, 26, 15, 3);
    g.fillStyle(0x4a3a22, 1).fillRect(3, 13, 22, 4);
    g.fillStyle(0x8a6a3a, 1).fillRoundedRect(1, 1, 26, 7, 3);
    g.fillStyle(0xffe08a, 1).fillRect(5, 14, 18, 2);
    g.lineStyle(1, 0x3a2a17, 1).strokeRoundedRect(1, 12, 26, 15, 3);
  });
  mk(PADLOCK, 12, 13, (g) => {
    g.lineStyle(2, 0xc8d0d8, 1).beginPath();
    g.arc(6, 5, 3, Math.PI, 2 * Math.PI).strokePath(); // shackle
    g.fillStyle(0x2b2e33, 1).fillRoundedRect(2, 5, 8, 7, 2); // body
    g.fillStyle(0xffd23f, 1).fillCircle(6, 8, 1.4); // keyhole
  });
  mk(PROJ_BULLET, 8, 3, (g) => g.fillStyle(0xfff2a8, 1).fillRoundedRect(0, 0, 8, 3, 1.5));
  mk(PROJ_PELLET, 4, 4, (g) => g.fillStyle(0xffe08a, 1).fillCircle(2, 2, 2));
  mk(PROJ_ARROW, 12, 3, (g) => {
    g.fillStyle(0x8a6a3a, 1).fillRect(0, 1, 9, 1);
    g.fillStyle(0xc2c9d2, 1).fillTriangle(9, -1, 12, 1.5, 9, 4);
  });
  mk(PROJ_ROCKET, 12, 6, (g) => {
    g.fillStyle(0x3a3a3a, 1).fillRoundedRect(0, 1, 9, 4, 1);
    g.fillStyle(0xd13a2a, 1).fillTriangle(9, 0, 12, 3, 9, 6);
  });
}
