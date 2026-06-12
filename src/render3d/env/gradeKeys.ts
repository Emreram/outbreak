// Grading keyframes (graphics plan WS2 / master plan §3.9 + §6.5) — pure,
// Babylon-free data + evaluator so the headless runner covers it. The stops
// align with LIGHT_KEYS' day fractions; values follow the §6.5 doctrine:
// saturation lives in LIGHT (warm sunrise/sunset highlights, cool night
// shadows), noon stays honest/neutral, night crushes in with vignette.

export interface GradeCurveState {
  globalSaturation: number; // -100..100
  shadowsHue: number; // 0..360
  shadowsDensity: number; // -100..100
  shadowsSaturation: number;
  shadowsExposure: number;
  highlightsHue: number;
  highlightsDensity: number;
  midtonesSaturation: number;
}

export interface GradeState {
  exposure: number;
  contrast: number;
  vignette: number;
  bloomWeight: number;
  curves: GradeCurveState;
}

interface GradeKey {
  t: number;
  exposure: number;
  contrast: number;
  vignette: number;
  bloom: number;
  gSat: number;
  shHue: number;
  shDen: number;
  hiHue: number;
  hiDen: number;
}

/** Aligned to the LIGHT_KEYS stops (0=pre-dawn … wraps at 1). */
const GRADE_KEYS: GradeKey[] = [
  { t: 0.0, exposure: 0.88, contrast: 1.14, vignette: 2.4, bloom: 0.38, gSat: -10, shHue: 225, shDen: 20, hiHue: 210, hiDen: 6 },
  { t: 0.1, exposure: 0.94, contrast: 1.08, vignette: 1.9, bloom: 0.3, gSat: -4, shHue: 265, shDen: 15, hiHue: 270, hiDen: 6 },
  { t: 0.17, exposure: 1.08, contrast: 1.06, vignette: 1.5, bloom: 0.22, gSat: 5, shHue: 250, shDen: 8, hiHue: 35, hiDen: 20 },
  { t: 0.25, exposure: 1.04, contrast: 1.04, vignette: 1.3, bloom: 0.17, gSat: 2, shHue: 230, shDen: 4, hiHue: 45, hiDen: 8 },
  { t: 0.375, exposure: 1.0, contrast: 1.05, vignette: 1.2, bloom: 0.15, gSat: 0, shHue: 220, shDen: 2, hiHue: 60, hiDen: 2 },
  { t: 0.5, exposure: 1.02, contrast: 1.04, vignette: 1.25, bloom: 0.16, gSat: 2, shHue: 220, shDen: 3, hiHue: 45, hiDen: 8 },
  { t: 0.6, exposure: 1.08, contrast: 1.07, vignette: 1.6, bloom: 0.25, gSat: 6, shHue: 240, shDen: 10, hiHue: 30, hiDen: 28 },
  { t: 0.68, exposure: 0.96, contrast: 1.1, vignette: 2.0, bloom: 0.32, gSat: 0, shHue: 320, shDen: 18, hiHue: 20, hiDen: 14 },
  { t: 0.78, exposure: 0.9, contrast: 1.15, vignette: 2.5, bloom: 0.4, gSat: -12, shHue: 225, shDen: 22, hiHue: 215, hiDen: 8 },
  { t: 0.875, exposure: 0.85, contrast: 1.18, vignette: 2.8, bloom: 0.45, gSat: -15, shHue: 225, shDen: 25, hiHue: 215, hiDen: 10 },
  { t: 1.0, exposure: 0.88, contrast: 1.14, vignette: 2.4, bloom: 0.38, gSat: -10, shHue: 225, shDen: 20, hiHue: 210, hiDen: 6 },
];

/** Per-biome grade nudges (§6.5), applied as deltas over the keyframed base. */
interface BiomeNudge {
  gSat?: number;
  shHue?: number;
  shDen?: number;
  hiHue?: number;
  hiDen?: number;
  /** 0 = always; 1 = only in darkness; -1 = only in daylight. */
  gate?: 0 | 1 | -1;
}

const BIOME_NUDGES: Record<string, BiomeNudge> = {
  volcanic: { shHue: 20, shDen: 18, hiHue: 25, hiDen: 8 },
  badlands: { shHue: 28, shDen: 10, hiHue: 35, hiDen: 6 },
  lake: { shDen: -8, hiHue: 210, hiDen: 8 },
  coast: { shDen: -8, hiHue: 210, hiDen: 8 },
  ocean: { shDen: -10, hiHue: 210, hiDen: 10 },
  riverbank: { shDen: -6, hiHue: 205, hiDen: 6 },
  marsh: { gSat: -4, shHue: 90, shDen: 8 },
  downtown: { hiHue: 38, hiDen: 14, gate: 1 },
  commercial_strip: { hiHue: 38, hiDen: 12, gate: 1 },
  industrial: { hiHue: 38, hiDen: 10, gate: 1 },
  suburb: { hiHue: 40, hiDen: 8, gate: 1 },
  grassland: { gSat: 8, hiHue: 90, hiDen: 6, gate: -1 },
  farmland: { gSat: 8, hiHue: 85, hiDen: 6, gate: -1 },
  forest: { gSat: 6, hiHue: 95, hiDen: 5, gate: -1 },
  parkland: { gSat: 8, hiHue: 90, hiDen: 6, gate: -1 },
};

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Darkness proxy on the same day fraction (mirrors LIGHT_KEYS' a curve). */
export function darknessAt(t: number): number {
  if (t < 0.1) return lerp(0.5, 0.33, t / 0.1);
  if (t < 0.25) return lerp(0.33, 0.04, (t - 0.1) / 0.15);
  if (t < 0.55) return 0.03;
  if (t < 0.68) return lerp(0.05, 0.34, (t - 0.55) / 0.13);
  if (t < 0.875) return lerp(0.34, 0.66, (t - 0.68) / 0.195);
  return lerp(0.66, 0.5, (t - 0.875) / 0.125);
}

/** Evaluate the full grade at day-fraction t (pure; pulses live in the director). */
export function evalGrade(t: number, biome: string, bloodMoon: boolean, weather?: string): GradeState {
  let i = 0;
  while (i < GRADE_KEYS.length - 2 && GRADE_KEYS[i + 1].t < t) i++;
  const k0 = GRADE_KEYS[i];
  const k1 = GRADE_KEYS[i + 1];
  const f = Math.max(0, Math.min(1, (t - k0.t) / (k1.t - k0.t || 1)));

  let exposure = lerp(k0.exposure, k1.exposure, f);
  let contrast = lerp(k0.contrast, k1.contrast, f);
  let vignette = lerp(k0.vignette, k1.vignette, f);
  let bloom = lerp(k0.bloom, k1.bloom, f);
  let gSat = lerp(k0.gSat, k1.gSat, f);
  let shHue = lerp(k0.shHue, k1.shHue, f);
  let shDen = lerp(k0.shDen, k1.shDen, f);
  let hiHue = lerp(k0.hiHue, k1.hiHue, f);
  let hiDen = lerp(k0.hiDen, k1.hiDen, f);
  let shExp = 0;

  // biome nudge, gated by daylight/darkness where flagged
  const nudge = BIOME_NUDGES[biome];
  if (nudge) {
    const dark = darknessAt(t);
    const gate = nudge.gate === 1 ? Math.min(1, dark * 2.2) : nudge.gate === -1 ? Math.max(0, 1 - dark * 3) : 1;
    gSat += (nudge.gSat ?? 0) * gate;
    shDen += (nudge.shDen ?? 0) * gate;
    hiDen += (nudge.hiDen ?? 0) * gate;
    if (nudge.shHue !== undefined && gate > 0.4) shHue = nudge.shHue;
    if (nudge.hiHue !== undefined && gate > 0.4) hiHue = nudge.hiHue;
  }

  if (weather === "storm" || weather === "cloudy") gSat -= weather === "storm" ? 20 : 8;
  if (weather === "fog") {
    contrast = Math.max(1, contrast - 0.06);
    gSat -= 6;
  }

  if (bloodMoon) {
    bloom = Math.max(bloom, 0.45);
    contrast += 0.2;
    gSat -= 20;
    shHue = 350;
    shDen = 30;
    shExp = -30; // crushed shadows
    hiHue = 5;
    hiDen = 35;
    vignette = Math.max(vignette, 2.6);
  }

  return {
    exposure,
    contrast,
    vignette,
    bloomWeight: bloom,
    curves: {
      globalSaturation: gSat,
      shadowsHue: shHue,
      shadowsDensity: shDen,
      shadowsSaturation: Math.min(20, Math.abs(shDen) * 0.5),
      shadowsExposure: shExp,
      highlightsHue: hiHue,
      highlightsDensity: hiDen,
      midtonesSaturation: gSat * 0.3,
    },
  };
}
