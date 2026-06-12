// Dev/screenshot URL params (graphics plan WS1) — VIEW-side overrides only:
// they feed the lighting/grade/weather directors, never the sim clock or the
// save, so determinism and the schema are untouched. Pure module (headless
// tests cover the parsing).

/** Named time-of-day stops on the LIGHT_KEYS day fraction. */
const TOD_NAMES: Record<string, number> = {
  predawn: 0.02,
  dawn: 0.1,
  sunrise: 0.17,
  morning: 0.25,
  noon: 0.375,
  day: 0.375,
  afternoon: 0.5,
  sunset: 0.6,
  dusk: 0.68,
  nightfall: 0.78,
  night: 0.875,
};

/** "?tod=night" or "?tod=0.87" → day fraction 0..1, or null when absent/bad. */
export function parseTod(v: string | null | undefined): number | null {
  if (!v) return null;
  const named = TOD_NAMES[v.toLowerCase()];
  if (named !== undefined) return named;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return null;
}

const WEATHERS = new Set(["clear", "cloudy", "rain", "fog", "storm"]);

export function parseWeather(v: string | null | undefined): string | null {
  if (!v) return null;
  const w = v.toLowerCase();
  return WEATHERS.has(w) ? w : null;
}

export function parseBloodMoon(v: string | null | undefined): boolean {
  return v === "1" || v === "true";
}
