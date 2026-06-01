// Animated lava fragment shader (Living World, WebGL path). Same masking contract
// as water (iChannel0.a = lava membership). Domain-warped molten flow with pulsing
// emissive cracks over a dark cooling crust. Near-opaque; the burning glow + rising
// embers are added by particles in AnimatedTerrain.

export const LAVA_FRAG = `
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

  vec2 p = fragCoord / 38.0;
  float t = time * 0.35;
  // domain warp for a slow, viscous flow
  float w1 = vnoise(p + vec2(0.0, t));
  float n = vnoise(p * 1.4 + vec2(w1, -t));
  n += 0.5 * vnoise(p * 2.6 + vec2(t * 0.5, w1 * 1.5));
  n /= 1.5;

  vec3 crust = vec3(0.16, 0.05, 0.03);
  vec3 hot   = vec3(1.0, 0.50, 0.10);
  vec3 white = vec3(1.0, 0.92, 0.55);
  float heat = smoothstep(0.42, 0.86, n + 0.12 * sin(time * 1.5 + p.x));
  vec3 col = mix(crust, hot, heat);
  col = mix(col, white, smoothstep(0.82, 0.99, heat));   // white-hot cracks

  float pulse = 0.85 + 0.15 * sin(time * 2.0 + uv.x * 6.0);
  gl_FragColor = vec4(col * pulse, 0.96);
}
`;
