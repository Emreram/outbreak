// Weather (Feature 9 slice): a simple cycling weather state that adds atmosphere
// and light gameplay effects (rain waters crops, storms draw more dead, fog/overcast
// dim the world). Pure data + rolls; the scene owns the visual overlay.

import type { Rng } from "./rng";

export type WeatherKind = "clear" | "cloudy" | "rain" | "fog" | "storm";

export const WEATHERS: readonly WeatherKind[] = ["clear", "cloudy", "rain", "fog", "storm"];

const WEIGHT: Record<WeatherKind, number> = { clear: 42, cloudy: 26, rain: 18, fog: 9, storm: 5 };

/** Pick a weather (clear-dominant). Called occasionally to shift conditions. */
export function rollWeather(rng: Rng): WeatherKind {
  const total = WEATHERS.reduce((a, k) => a + WEIGHT[k], 0);
  let x = rng.next() * total;
  for (const k of WEATHERS) {
    x -= WEIGHT[k];
    if (x <= 0) return k;
  }
  return "clear";
}

/** Wet weather waters crops + slicks movement. */
export function isWet(w?: string): boolean {
  return w === "rain" || w === "storm";
}

export function weatherName(w?: string): string {
  const m: Record<string, string> = { clear: "clear", cloudy: "overcast", rain: "rain", fog: "fog", storm: "storm" };
  return m[w ?? "clear"] ?? "clear";
}
