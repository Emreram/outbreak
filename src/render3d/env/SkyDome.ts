// Sky dome (graphics plan WS3 / master plan §3.3): an inverted gradient
// sphere driven by the same day fraction as LIGHT_KEYS — zenith/horizon
// stops per phase, a haze band that dissolves the terrain fog into the sky,
// a sun/moon glow spot, hash-twinkled stars after dusk, and an ember wash
// for blood moons / volcanic skies. One draw call, trivial fragment — runs
// on every tier including Low. Replaces the flat clearColor backdrop.

import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { LightState } from "./TimeOfDayDirector";

Effect.ShadersStore["obSkyVertexShader"] = `
  precision highp float;
  attribute vec3 position;
  uniform mat4 worldViewProjection;
  varying vec3 vDir;
  void main(void) {
    vDir = position; // unit-ish sphere centred on the camera → view direction
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

Effect.ShadersStore["obSkyFragmentShader"] = `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uFogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uStars;
  uniform float uEmber;
  uniform float uTime;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(void) {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
    // haze band: the world's EXP2 fog dissolves into the sky at the horizon
    col = mix(uFogColor, col, smoothstep(0.0, 0.18, up));
    // sun / moon glow spot + wide bloom skirt
    float s = max(dot(dir, -normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 240.0) * 1.2 + pow(s, 8.0) * 0.12);
    // stars: stable cells over the dome, twinkling, gated to darkness + altitude
    if (uStars > 0.02 && dir.y > 0.08) {
      vec2 cell = floor(dir.xz / max(dir.y, 0.12) * 28.0);
      float h = hash(cell);
      if (h > 0.997) {
        float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 173.1);
        col += vec3(0.9, 0.93, 1.0) * uStars * tw * (1.0 - uEmber * 0.8);
      }
    }
    // ember wash (blood moon / volcanic): red-orange horizon glow
    col = mix(col, vec3(0.32, 0.07, 0.04) + uHorizon * 0.4, uEmber * (1.0 - up) * 0.75);
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface SkyKey {
  t: number;
  zen: number;
  hor: number;
}

/** Aligned to the LIGHT_KEYS stops. */
const SKY_KEYS: SkyKey[] = [
  { t: 0.0, zen: 0x060a18, hor: 0x18243f }, // pre-dawn
  { t: 0.1, zen: 0x141228, hor: 0x46365e }, // dawn violet
  { t: 0.17, zen: 0x3a4a6a, hor: 0xff9e5e }, // sunrise peach
  { t: 0.25, zen: 0x5f7d9e, hor: 0xc8d2cf }, // pale morning
  { t: 0.375, zen: 0x6f8aa6, hor: 0xb8c4cc }, // honest noon
  { t: 0.5, zen: 0x6a86a0, hor: 0xc2c4b8 }, // warm afternoon
  { t: 0.6, zen: 0x4a5a7a, hor: 0xff8a3c }, // sunset orange
  { t: 0.68, zen: 0x2c2240, hor: 0x7a3550 }, // dusk magenta
  { t: 0.78, zen: 0x0c1224, hor: 0x16203f }, // nightfall
  { t: 0.875, zen: 0x05070f, hor: 0x0d1426 }, // deep night
  { t: 1.0, zen: 0x060a18, hor: 0x18243f },
];

const VOLCANIC_EMBER = new Set(["volcanic"]);

function hexToC3(hex: number, out: Color3): Color3 {
  out.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  return out;
}

export class SkyDome {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly zen = new Color3();
  private readonly hor = new Color3();
  private readonly fog = new Color3();
  private readonly sunC = new Color3();
  private readonly sunD = new Vector3();

  constructor(
    scene: Scene,
    private readonly camera: Camera,
  ) {
    this.mesh = CreateSphere("skyDome", { diameter: 96, segments: 10, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mat = new ShaderMaterial("obSky", scene, { vertex: "obSky", fragment: "obSky" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "uZenith", "uHorizon", "uFogColor", "uSunDir", "uSunColor", "uStars", "uEmber", "uTime"],
    });
    this.mat.disableDepthWrite = true;
    this.mat.backFaceCulling = false;
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.infiniteDistance = true;
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true;
  }

  update(t: number, tod: LightState, bloodMoon: boolean, biome: string, timeS: number): void {
    // dome follows the camera (robust on both backends regardless of
    // infiniteDistance handling)
    this.mesh.position.copyFrom(this.camera.position);

    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t < t) i++;
    const k0 = SKY_KEYS[i];
    const k1 = SKY_KEYS[i + 1];
    const f = Math.max(0, Math.min(1, (t - k0.t) / (k1.t - k0.t || 1)));
    const z0 = hexToC3(k0.zen, this.zen);
    const z1 = hexToC3(k1.zen, new Color3());
    const h0 = hexToC3(k0.hor, this.hor);
    const h1 = hexToC3(k1.hor, new Color3());
    let zr = z0.r + (z1.r - z0.r) * f;
    let zg = z0.g + (z1.g - z0.g) * f;
    let zb = z0.b + (z1.b - z0.b) * f;
    let hr = h0.r + (h1.r - h0.r) * f;
    let hg = h0.g + (h1.g - h0.g) * f;
    let hb = h0.b + (h1.b - h0.b) * f;

    let ember = VOLCANIC_EMBER.has(biome) ? 0.35 : 0;
    if (bloodMoon) {
      zr = 0.1;
      zg = 0.016;
      zb = 0.023;
      hr = 0.37;
      hg = 0.04;
      hb = 0.06;
      ember = 1;
    }

    this.zen.set(zr, zg, zb);
    this.hor.set(hr, hg, hb);
    this.fog.set(tod.fogColor.r, tod.fogColor.g, tod.fogColor.b);
    this.sunC.set(tod.sunColor.r, tod.sunColor.g, tod.sunColor.b);
    this.sunD.set(tod.sunDir.x, tod.sunDir.y, tod.sunDir.z);

    this.mat.setColor3("uZenith", this.zen);
    this.mat.setColor3("uHorizon", this.hor);
    this.mat.setColor3("uFogColor", this.fog);
    this.mat.setColor3("uSunColor", this.sunC);
    this.mat.setVector3("uSunDir", this.sunD);
    this.mat.setFloat("uStars", tod.glow);
    this.mat.setFloat("uEmber", ember);
    this.mat.setFloat("uTime", timeS);
  }
}
