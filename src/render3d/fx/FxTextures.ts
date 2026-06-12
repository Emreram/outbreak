// FX texture library (graphics plan WS8): Canvas2D re-implementations of the
// engine/fx.ts paintings — the irregular SPLAT (centre pool + satellites +
// drip tongues + flung specks), the concentric soft GLOW, the tapered SMEAR,
// the vertical BEAM, and a plain SOFT radial — baked once into white-on-alpha
// DynamicTextures. Tinted material variants are cached per (shape, colour):
// additive emissive quads for glows/beams, alpha-blended diffuse for decals.

import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";

export type FxShape = "splat" | "glow" | "smear" | "beam" | "soft";

function paint(scene: Scene, name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): DynamicTexture {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  draw(g);
  tex.update(false);
  tex.hasAlpha = true;
  return tex;
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, a = 1): void {
  g.globalAlpha = a;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
  g.globalAlpha = 1;
}

export class FxTextures {
  private readonly tex = new Map<FxShape, DynamicTexture>();
  private readonly mats = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {
    // FX_SPLAT (fx.ts 36px → 64px): centre pool + 4 satellites + 4 tongues + specks
    this.tex.set("splat", paint(scene, "fxSplat", 64, 64, (g) => {
      const c = 32;
      const k = 64 / 36;
      circle(g, c, c, 8 * k);
      const sats: [number, number, number][] = [[-6, 3, 4.4], [7, -3, 4], [3, 7, 5], [-4, -6, 3.4]];
      for (const [dx, dy, r] of sats) circle(g, c + dx * k, c + dy * k, r * k, 0.95);
      for (const ang of [0.4, 2.3, 4.1, 5.4]) {
        const len = (10 + (ang * 13) % 5) * k;
        const tipX = c + Math.cos(ang) * len;
        const tipY = c + Math.sin(ang) * len;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(c + Math.cos(ang + 1.7) * 3 * k, c + Math.sin(ang + 1.7) * 3 * k);
        g.lineTo(tipX, tipY);
        g.lineTo(c + Math.cos(ang - 1.7) * 3 * k, c + Math.sin(ang - 1.7) * 3 * k);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
        circle(g, tipX, tipY, 2 * k, 0.9);
      }
      const specks: [number, number][] = [[-13, -8], [12, 9], [0, -14], [-9, 12], [14, -2]];
      for (const [dx, dy] of specks) circle(g, c + dx * k, c + dy * k, 1.4 * k, 0.8);
    }));

    // FX_GLOW: concentric low-alpha circles accumulate into a soft halo
    this.tex.set("glow", paint(scene, "fxGlow", 128, 128, (g) => {
      for (let r = 62; r > 2; r -= 2) circle(g, 64, 64, r, 0.05);
    }));

    // FX_SMEAR: tapered comet (descending circles along +x)
    this.tex.set("smear", paint(scene, "fxSmear", 64, 24, (g) => {
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        circle(g, 8 + t * 50, 12, 7.5 * (1 - t * 0.8), 0.85 - t * 0.5);
      }
    }));

    // FX_BEAM: bright core column fading toward the top
    this.tex.set("beam", paint(scene, "fxBeam", 32, 96, (g) => {
      const grad = g.createLinearGradient(0, 96, 0, 0);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.6, "rgba(255,255,255,0.35)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(10, 0, 12, 96);
      g.fillRect(4, 0, 24, 30);
    }));

    // soft radial (mist/blob/muzzle base)
    this.tex.set("soft", paint(scene, "fxSoft", 64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }));
  }

  texture(shape: FxShape): DynamicTexture {
    return this.tex.get(shape)!;
  }

  /** Additive emissive material (glows, beams, muzzle) — cached per colour. */
  additive(shape: FxShape, cssOrHex: string | number, alpha = 0.5): StandardMaterial {
    const key = `a|${shape}|${cssOrHex}|${alpha}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`fx_${key}`, this.scene);
      m.emissiveColor = typeof cssOrHex === "string" ? Color3.FromHexString(cssOrHex) : Color3.FromHexString(`#${(cssOrHex & 0xffffff).toString(16).padStart(6, "0")}`);
      m.opacityTexture = this.texture(shape);
      m.disableLighting = true;
      m.alpha = alpha;
      m.alphaMode = Constants.ALPHA_ADD;
      m.specularColor = Color3.Black();
      m.backFaceCulling = false;
      this.mats.set(key, m);
    }
    return m;
  }

  /** Alpha-blended dark material (blood decals, blob shadows) per colour. */
  decal(shape: FxShape, hexColor: number, alpha = 0.78): StandardMaterial {
    const key = `d|${shape}|${hexColor}|${alpha}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`fx_${key}`, this.scene);
      m.diffuseColor = Color3.Black();
      m.emissiveColor = Color3.FromHexString(`#${(hexColor & 0xffffff).toString(16).padStart(6, "0")}`);
      m.opacityTexture = this.texture(shape);
      m.disableLighting = true;
      m.alpha = alpha;
      m.specularColor = Color3.Black();
      m.backFaceCulling = false;
      m.zOffset = -1; // against z-fighting on shallow depth (SwiftShader too)
      this.mats.set(key, m);
    }
    return m;
  }
}
