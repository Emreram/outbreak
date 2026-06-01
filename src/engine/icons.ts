import Phaser from "phaser";
import type { ItemDef } from "../game/items/types";
import { allItems } from "../game/items/catalog";
import { RARITY_META } from "../game/items/rarity";

// Procedural item icons (Phase 2). One canvas per catalog item, framed by rarity
// and drawn as a class silhouette tinted by material. Each canvas is registered as
// a Phaser texture (world drops / in-hand) AND cached as a dataURL (the DOM loot UI).
// Guaranteed to produce a visible icon for every item — no art dependency.

const SIZE = 48;
const dataUrlCache = new Map<string, string>();

export function iconKey(name: string): string {
  return "icon_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
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

/** Generate every item icon as a Phaser texture + cached dataURL. Idempotent. */
export function generateAllIcons(scene: Phaser.Scene): void {
  for (const def of allItems()) {
    const key = iconKey(def.name);
    if (scene.textures.exists(key)) {
      if (!dataUrlCache.has(def.name)) dataUrlCache.set(def.name, drawIconCanvas(def).toDataURL());
      continue;
    }
    const canvas = drawIconCanvas(def);
    scene.textures.addCanvas(key, canvas);
    dataUrlCache.set(def.name, canvas.toDataURL());
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
