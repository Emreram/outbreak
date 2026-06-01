// Animated water fragment shader (Living World, WebGL path). Rendered on a quad
// covering a water body's bounding box; iChannel0 is a per-tile MASK whose alpha
// marks which texels are water (clipping the effect to the real water shape) and
// whose green channel encodes depth (shallow → deep). The static water tile shows
// through the translucent output. Driven by Phaser's auto-updated `time` uniform,
// so it animates with no per-frame JS. Conventional Phaser BaseShader entry points
// (time, resolution, fragCoord, iChannel0).

export const WATER_FRAG = `
precision mediump float;
uniform float time;
uniform vec2 resolution;
uniform sampler2D iChannel0;
varying vec2 fragCoord;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main(void){
  vec2 uv = fragCoord / resolution.xy;
  vec4 m = texture2D(iChannel0, uv);
  if (m.a < 0.5) { gl_FragColor = vec4(0.0); return; }

  vec2 p = fragCoord / 34.0;          // ~tile-scale caustics
  float t = time * 0.6;
  float n = vnoise(p + vec2(t * 0.6, t * 0.3));
  n += 0.5 * vnoise(p * 2.1 - vec2(t * 0.4, t * 0.7));
  n /= 1.5;

  float depth = m.g;                   // 0 shallow .. 1 deep
  vec3 shallow = vec3(0.32, 0.58, 0.68);
  vec3 deep    = vec3(0.07, 0.19, 0.33);
  vec3 col = mix(shallow, deep, depth);

  float caustic = smoothstep(0.70, 0.96, n);
  col += caustic * vec3(0.45, 0.65, 0.75);            // bright moving glints
  col += 0.05 * sin((uv.x + uv.y) * 38.0 + time * 2.0); // fine surface shimmer

  float alpha = mix(0.5, 0.8, depth);
  gl_FragColor = vec4(col, alpha);
}
`;
