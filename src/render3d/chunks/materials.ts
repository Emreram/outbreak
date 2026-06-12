// Custom chunk materials (3D master plan §3.5): NodeMaterial-class ports of
// the Phaser water/lava fragment shaders (same value-noise, same palettes,
// same depth tint — the domain switches from screen fragCoord to world XZ so
// the pattern is stable in the world), plus the roof dither-cutaway material
// (one shader, zero per-building state: fades roofs within ~8m of the player
// while they're indoors). All three implement EXP2 fog manually so they sit
// in the same atmosphere as the StandardMaterial terrain.

import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const FOG_CHUNK = `
  float fogOf(vec3 wp, vec3 cam, float density) {
    float d = length(wp - cam);
    float f = exp(-density * density * d * d);
    return clamp(1.0 - f, 0.0, 1.0);
  }
`;

const NOISE_CHUNK = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

Effect.ShadersStore["obFluidVertexShader"] = `
  precision highp float;
  attribute vec3 position;
  attribute float depth;
  uniform mat4 worldViewProjection;
  varying vec3 vWorld;
  varying float vDepth;
  void main(void) {
    vWorld = position; // chunk meshes are world-space (no parent transform)
    vDepth = depth;
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

// Water: same caustic field + shallow/deep palette as engine/shaders/water.ts.
Effect.ShadersStore["obWaterFragmentShader"] = `
  precision highp float;
  varying vec3 vWorld;
  varying float vDepth;
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uNightDim;
  ${NOISE_CHUNK}
  ${FOG_CHUNK}
  void main(void) {
    vec2 p = vWorld.xz * (32.0 / 34.0);   // ~tile-scale caustics (34px in meters)
    float t = uTime * 0.6;
    float n = vnoise(p + vec2(t * 0.6, t * 0.3));
    n += 0.5 * vnoise(p * 2.1 - vec2(t * 0.4, t * 0.7));
    n /= 1.5;

    vec3 shallow = vec3(0.32, 0.58, 0.68);
    vec3 deep    = vec3(0.07, 0.19, 0.33);
    vec3 col = mix(shallow, deep, vDepth);

    float caustic = smoothstep(0.78, 0.97, n) * 0.55;
    col += caustic * vec3(0.45, 0.65, 0.75);
    col *= uNightDim;

    float alpha = mix(0.55, 0.92, vDepth); // shallow shows the painted bed
    float fog = fogOf(vWorld, uCamera, uFogDensity);
    gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
  }
`;

// Lava: same domain-warped flow + pulsing white-hot cracks as shaders/lava.ts.
Effect.ShadersStore["obLavaFragmentShader"] = `
  precision highp float;
  varying vec3 vWorld;
  varying float vDepth;
  uniform float uTime;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  ${NOISE_CHUNK}
  ${FOG_CHUNK}
  void main(void) {
    vec2 p = vWorld.xz * (32.0 / 38.0);
    float t = uTime * 0.35;
    float w1 = vnoise(p + vec2(0.0, t));
    float n = vnoise(p * 1.4 + vec2(w1, -t));
    n += 0.5 * vnoise(p * 2.6 + vec2(t * 0.5, w1 * 1.5));
    n /= 1.5;

    vec3 crust = vec3(0.16, 0.05, 0.03);
    vec3 hot   = vec3(1.0, 0.50, 0.10);
    vec3 white = vec3(1.0, 0.92, 0.55);
    float heat = smoothstep(0.42, 0.86, n + 0.12 * sin(uTime * 1.5 + p.x));
    vec3 col = mix(crust, hot, heat);
    col = mix(col, white, smoothstep(0.82, 0.99, heat));

    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + vWorld.x * 0.19);
    float fog = fogOf(vWorld, uCamera, uFogDensity);
    gl_FragColor = vec4(mix(col * pulse, uFogColor, fog), 1.0);
  }
`;

Effect.ShadersStore["obRoofVertexShader"] = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec4 color;
  uniform mat4 worldViewProjection;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vColor;
  void main(void) {
    vWorld = position;
    vNormal = normal;
    vColor = color;
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

// Roofs: lambert over vertex colour + the indoor dither-cutaway (plan §3.5.4).
Effect.ShadersStore["obRoofFragmentShader"] = `
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vColor;
  uniform vec3 uCamera;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uPlayer;     // player world position
  uniform float uIndoor;    // 1 while buildingAt(player) != null
  ${FOG_CHUNK}
  float bayer4(vec2 fc) {
    int x = int(mod(fc.x, 4.0));
    int y = int(mod(fc.y, 4.0));
    int i = y * 4 + x;
    // 4x4 Bayer matrix, normalised
    float m[16];
    m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
    m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
    m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
    for (int k = 0; k < 16; k++) { if (k == i) return (m[k] + 0.5) / 16.0; }
    return 0.5;
  }
  void main(void) {
    float d = distance(vWorld.xz, uPlayer.xz);
    float fade = uIndoor * (1.0 - smoothstep(5.0, 9.0, d));
    if (fade > bayer4(gl_FragCoord.xy)) discard;

    float lambert = max(dot(normalize(vNormal), -normalize(uSunDir)), 0.0);
    vec3 lit = vColor.rgb * (uAmbient + uSunColor * lambert);
    float fog = fogOf(vWorld, uCamera, uFogDensity);
    gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
  }
`;

export interface FluidMaterials {
  water: ShaderMaterial;
  lava: ShaderMaterial;
  roof: ShaderMaterial;
  /** Per-frame uniform sync (time, camera, fog, lighting, player/indoor). */
  update(u: {
    timeS: number;
    camera: { x: number; y: number; z: number };
    fogColor: { r: number; g: number; b: number };
    fogDensity: number;
    nightDim: number;
    sunDir: { x: number; y: number; z: number };
    sunColor: { r: number; g: number; b: number };
    ambient: { r: number; g: number; b: number };
    player: { x: number; y: number; z: number };
    indoor: boolean;
  }): void;
}

export function createChunkMaterials(scene: Scene): FluidMaterials {
  const water = new ShaderMaterial("obWater", scene, { vertex: "obFluid", fragment: "obWater" }, {
    attributes: ["position", "depth"],
    uniforms: ["worldViewProjection", "uTime", "uCamera", "uFogColor", "uFogDensity", "uNightDim"],
    needAlphaBlending: true,
  });
  water.backFaceCulling = false;

  const lava = new ShaderMaterial("obLava", scene, { vertex: "obFluid", fragment: "obLava" }, {
    attributes: ["position", "depth"],
    uniforms: ["worldViewProjection", "uTime", "uCamera", "uFogColor", "uFogDensity"],
  });
  lava.backFaceCulling = false;

  const roof = new ShaderMaterial("obRoof", scene, { vertex: "obRoof", fragment: "obRoof" }, {
    attributes: ["position", "normal", "color"],
    uniforms: [
      "worldViewProjection", "uCamera", "uFogColor", "uFogDensity",
      "uSunDir", "uSunColor", "uAmbient", "uPlayer", "uIndoor",
    ],
  });

  // Preallocated uniform carriers (no per-frame GC churn).
  const vCam = new Vector3();
  const vSun = new Vector3();
  const vPlayer = new Vector3();
  const cFog = new Color3();
  const cSun = new Color3();
  const cAmb = new Color3();

  return {
    water,
    lava,
    roof,
    update(u) {
      vCam.set(u.camera.x, u.camera.y, u.camera.z);
      vSun.set(u.sunDir.x, u.sunDir.y, u.sunDir.z);
      vPlayer.set(u.player.x, u.player.y, u.player.z);
      cFog.set(u.fogColor.r, u.fogColor.g, u.fogColor.b);
      cSun.set(u.sunColor.r, u.sunColor.g, u.sunColor.b);
      cAmb.set(u.ambient.r, u.ambient.g, u.ambient.b);
      for (const m of [water, lava, roof]) {
        m.setFloat("uTime", u.timeS);
        m.setVector3("uCamera", vCam);
        m.setColor3("uFogColor", cFog);
        m.setFloat("uFogDensity", u.fogDensity);
      }
      water.setFloat("uNightDim", u.nightDim);
      roof.setVector3("uSunDir", vSun);
      roof.setColor3("uSunColor", cSun);
      roof.setColor3("uAmbient", cAmb);
      roof.setVector3("uPlayer", vPlayer);
      roof.setFloat("uIndoor", u.indoor ? 1 : 0);
    },
  };
}
