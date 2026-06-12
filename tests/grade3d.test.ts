// render3d/env/gradeKeys.ts (graphics plan WS2): the pure grading evaluator —
// per-phase keyframes, biome nudges with day/night gating, weather desat, and
// the blood-moon program. Headless, Babylon-free.

import { darknessAt, evalGrade } from "../src/render3d/env/gradeKeys";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- phase keyframes ---------------------------------------------------------------
{
  // Arrange/Act.
  const noon = evalGrade(0.375, "grassland", false, "clear");
  const night = evalGrade(0.875, "grassland", false, "clear");
  const sunset = evalGrade(0.6, "grassland", false, "clear");
  // Assert: §3.9 ramps — vignette 1.2→2.8, bloom .15→.45, night darker + cooler.
  ok(Math.abs(noon.vignette - 1.2) < 0.05, `noon vignette ≈1.2 (${noon.vignette.toFixed(2)})`);
  ok(Math.abs(night.vignette - 2.8) < 0.05, `night vignette ≈2.8 (${night.vignette.toFixed(2)})`);
  ok(noon.bloomWeight < 0.2 && night.bloomWeight > 0.4, "bloom weight ramps day→night");
  ok(night.exposure < noon.exposure && night.contrast > noon.contrast, "night is darker and contrastier");
  ok(sunset.curves.highlightsDensity > noon.curves.highlightsDensity, "sunset pushes warm highlights");
  ok(night.curves.shadowsHue > 180 && night.curves.shadowsHue < 270, "night shadows are cool blue");
}

// --- darkness proxy -----------------------------------------------------------------
{
  ok(darknessAt(0.375) < 0.1, "noon darkness ≈0");
  ok(darknessAt(0.875) > 0.6, "deep night darkness high");
  ok(darknessAt(0.17) < darknessAt(0.1), "darkness falls through sunrise");
}

// --- biome nudges + gates --------------------------------------------------------------
{
  const volcNoon = evalGrade(0.375, "volcanic", false, "clear");
  const grassNoon = evalGrade(0.375, "grassland", false, "clear");
  ok(volcNoon.curves.shadowsHue < 60, "volcanic shadows go ember-warm");
  ok(grassNoon.curves.globalSaturation > 0, "rural day gets the green-gold lift");
  const urbanNoon = evalGrade(0.375, "downtown", false, "clear");
  const urbanNight = evalGrade(0.875, "downtown", false, "clear");
  ok(urbanNight.curves.highlightsDensity > urbanNoon.curves.highlightsDensity + 5, "urban sodium highlights gate to darkness");
  const coast = evalGrade(0.375, "coast", false, "clear");
  ok(coast.curves.shadowsDensity < grassNoon.curves.shadowsDensity, "coast lifts the shadows");
}

// --- weather + blood moon ----------------------------------------------------------------
{
  const clear = evalGrade(0.375, "grassland", false, "clear");
  const storm = evalGrade(0.375, "grassland", false, "storm");
  ok(storm.curves.globalSaturation < clear.curves.globalSaturation - 15, "storm desaturates ~20");
  const blood = evalGrade(0.875, "grassland", true, "clear");
  ok(blood.bloomWeight >= 0.45 && blood.curves.highlightsHue <= 10, "blood moon: bloom up, red highlights");
  ok(blood.curves.shadowsExposure < -20, "blood moon crushes the shadows");
  ok(blood.contrast > evalGrade(0.875, "grassland", false, "clear").contrast, "blood moon adds contrast");
}

console.log(fail === 0 ? "ALL GRADE3D CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
