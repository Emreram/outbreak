// Time-of-day lighting (3D master plan §3.8) — a port of WorldScene's
// LIGHT_KEYS keyframe table onto sun direction/colour/intensity, hemispheric
// ambient, fog colour/density, and the clear colour. The keyframes are the
// EXACT Phaser values (colour = overlay tint, a = darkness, glow = flashlight
// strength → repurposed as night point-light/vignette weight). Blood moon
// overrides to the red program. Weather modulates fog density on top.

import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { Scene } from "@babylonjs/core/scene";

interface LightKey {
  t: number;
  color: number;
  a: number;
  glow: number;
}

/** WorldScene LIGHT_KEYS, verbatim. */
const LIGHT_KEYS: LightKey[] = [
  { t: 0.0, color: 0x121a33, a: 0.5, glow: 0.55 }, // ~05:00 pre-dawn — deep cold blue
  { t: 0.1, color: 0x46365e, a: 0.33, glow: 0.3 }, // dawn twilight — violet
  { t: 0.17, color: 0xff9e5e, a: 0.16, glow: 0.06 }, // sunrise — warm golden hour
  { t: 0.25, color: 0xfff2d8, a: 0.04, glow: 0.0 }, // early morning — faint warm wash
  { t: 0.375, color: 0x000000, a: 0.0, glow: 0.0 }, // noon — neutral, brightest
  { t: 0.5, color: 0xfff0d0, a: 0.05, glow: 0.0 }, // late afternoon — warm
  { t: 0.6, color: 0xff8a3c, a: 0.18, glow: 0.1 }, // sunset — warm orange golden hour
  { t: 0.68, color: 0x7a3550, a: 0.34, glow: 0.34 }, // dusk afterglow — magenta fading
  { t: 0.78, color: 0x16203f, a: 0.52, glow: 0.6 }, // nightfall — cold blue
  { t: 0.875, color: 0x070c1e, a: 0.66, glow: 0.78 }, // ~02:00 deep night — darkest
  { t: 1.0, color: 0x121a33, a: 0.5, glow: 0.55 }, // wraps back to pre-dawn
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}

export interface LightState {
  sunDir: { x: number; y: number; z: number };
  sunColor: { r: number; g: number; b: number };
  sunIntensity: number;
  ambient: { r: number; g: number; b: number };
  ambientIntensity: number;
  fogColor: { r: number; g: number; b: number };
  fogDensity: number;
  clearColor: { r: number; g: number; b: number };
  /** 0 day → ~0.78 deep night; drives vignette/glow layers. */
  glow: number;
  nightDim: number;
}

const DAY_FOG = { r: 0.62, g: 0.68, b: 0.72 };

export class TimeOfDayDirector {
  readonly state: LightState = {
    sunDir: { x: -0.4, y: -1, z: 0.55 },
    sunColor: { r: 1, g: 1, b: 1 },
    sunIntensity: 1,
    ambient: { r: 0.5, g: 0.55, b: 0.6 },
    ambientIntensity: 0.55,
    fogColor: DAY_FOG,
    fogDensity: 0.014,
    clearColor: { r: 0.04, g: 0.05, b: 0.06 },
    glow: 0,
    nightDim: 1,
  };

  /** Evaluate the keyframes at day-fraction t (0..1) + apply to the scene. */
  apply(scene: Scene, sun: DirectionalLight, hemi: HemisphericLight, t: number, bloodMoon: boolean, weather?: string): void {
    let i = 0;
    while (i < LIGHT_KEYS.length - 2 && LIGHT_KEYS[i + 1].t < t) i++;
    const k0 = LIGHT_KEYS[i];
    const k1 = LIGHT_KEYS[i + 1];
    const f = Math.max(0, Math.min(1, (t - k0.t) / (k1.t - k0.t || 1)));
    let a = lerp(k0.a, k1.a, f);
    const glow = lerp(k0.glow, k1.glow, f);
    const c0 = hexToRgb(k0.color);
    const c1 = hexToRgb(k1.color);
    let tint = { r: lerp(c0.r, c1.r, f), g: lerp(c0.g, c1.g, f), b: lerp(c0.b, c1.b, f) };
    // The noon key is colour 0x000000 at a=0 — "no overlay", not "black light".
    const tintStrength = Math.min(1, a * 1.8 + (k0.color === 0 && k1.color === 0 ? 0 : 0.18));
    if (k0.color === 0 && f < 0.02) tint = { r: 1, g: 1, b: 1 };

    if (bloodMoon) {
      tint = { r: 0.75, g: 0.06, b: 0.08 };
      a = Math.max(a, 0.55);
    }

    const s = this.state;
    // Sun: sweeps east→west across the day window (sunrise .17 → sunset .68).
    const dayT = Math.max(0, Math.min(1, (t - 0.17) / (0.68 - 0.17)));
    const elev = Math.sin(dayT * Math.PI); // 0 horizon → 1 noon
    const az = lerp(-0.9, 0.9, dayT);
    const night = t > 0.7 || t < 0.14;
    if (night) {
      // cool moon from a fixed angle
      s.sunDir = { x: 0.35, y: -0.8, z: -0.45 };
      s.sunColor = bloodMoon ? { r: 0.8, g: 0.1, b: 0.12 } : { r: 0.45, g: 0.55, b: 0.75 };
      s.sunIntensity = bloodMoon ? 0.5 : 0.28;
    } else {
      s.sunDir = { x: az, y: -(0.35 + elev * 0.85), z: 0.5 - dayT * 0.2 };
      const warm = { r: 1, g: 0.92, b: 0.82 };
      s.sunColor = {
        r: lerp(warm.r, tint.r, tintStrength * 0.7),
        g: lerp(warm.g, tint.g, tintStrength * 0.7),
        b: lerp(warm.b, tint.b, tintStrength * 0.7),
      };
      s.sunIntensity = Math.max(0.15, (1 - a) * 1.15) * (weather === "storm" || weather === "cloudy" ? 0.7 : 1);
    }

    s.ambientIntensity = Math.max(0.18, 0.62 * (1 - a * 0.85));
    s.ambient = {
      r: lerp(0.55, tint.r, tintStrength),
      g: lerp(0.58, tint.g, tintStrength),
      b: lerp(0.64, tint.b, tintStrength),
    };
    s.fogColor = {
      r: lerp(DAY_FOG.r, tint.r, Math.max(tintStrength, a)) * (1 - a * 0.55),
      g: lerp(DAY_FOG.g, tint.g, Math.max(tintStrength, a)) * (1 - a * 0.55),
      b: lerp(DAY_FOG.b, tint.b, Math.max(tintStrength, a)) * (1 - a * 0.55),
    };
    const fogBoost = weather === "fog" ? 2.1 : weather === "storm" ? 1.5 : weather === "rain" ? 1.25 : 1;
    s.fogDensity = (0.011 + a * 0.009) * fogBoost; // ~90–120m clear-day visibility
    s.clearColor = { r: s.fogColor.r * 0.85, g: s.fogColor.g * 0.85, b: s.fogColor.b * 0.85 };
    s.glow = glow;
    s.nightDim = Math.max(0.35, 1 - a * 0.9);

    // apply
    sun.direction.set(s.sunDir.x, s.sunDir.y, s.sunDir.z);
    sun.diffuse.set(s.sunColor.r, s.sunColor.g, s.sunColor.b);
    sun.intensity = s.sunIntensity;
    hemi.intensity = s.ambientIntensity;
    hemi.diffuse.set(s.ambient.r, s.ambient.g, s.ambient.b);
    hemi.groundColor.set(s.ambient.r * 0.45, s.ambient.g * 0.45, s.ambient.b * 0.5);
    scene.fogMode = 3; // FOGMODE_EXP2
    scene.fogColor = new Color3(s.fogColor.r, s.fogColor.g, s.fogColor.b);
    scene.fogDensity = s.fogDensity;
    scene.clearColor = new Color4(s.clearColor.r, s.clearColor.g, s.clearColor.b, 1);
  }
}

export const SUN_DIR_DEFAULT = new Vector3(-0.4, -1, 0.55);
