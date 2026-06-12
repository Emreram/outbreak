// render3d/quality.ts + devParams.ts (graphics plan WS1): the tier probe
// matrix and the view-side dev-param parsing. Both are pure modules so the
// headless runner covers them without Babylon.

import { capsFor, resolveTier } from "../src/render3d/quality";
import { parseBloodMoon, parseTod, parseWeather } from "../src/render3d/devParams";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- tier probe matrix --------------------------------------------------------------
{
  // Arrange/Act/Assert per probe case.
  ok(resolveTier({ override: "low", backend: "webgpu", rendererString: "NVIDIA RTX", isMobile: false }) === "low", "?tier= override wins over everything");
  ok(resolveTier({ override: "HIGH", backend: "webgl2", rendererString: "Intel Iris", isMobile: false }) === "high", "override is case-insensitive");
  ok(resolveTier({ override: "ultra", backend: "webgl2", rendererString: "Intel", isMobile: false }) === "medium", "bad override falls through to the probe");
  ok(resolveTier({ backend: "webgl2", rendererString: "Google SwiftShader", isMobile: false }) === "low", "SwiftShader probes low (CI path)");
  ok(resolveTier({ backend: "webgl2", rendererString: "llvmpipe (LLVM 15)", isMobile: false }) === "low", "llvmpipe probes low");
  ok(resolveTier({ backend: "webgl2", rendererString: "Adreno 640", isMobile: true }) === "low", "coarse-pointer mobile probes low");
  ok(resolveTier({ backend: "webgpu", rendererString: "", isMobile: false }) === "high", "WebGPU probes high");
  ok(resolveTier({ backend: "webgl2", rendererString: "Intel(R) Iris(R) Xe", isMobile: false }) === "medium", "unknown WebGL2 defaults medium");
}

// --- caps shape ----------------------------------------------------------------------
{
  const high = capsFor("high");
  const med = capsFor("medium");
  const low = capsFor("low");
  ok(high.shadows === "csm" && high.shadowMapSize === 2048 && high.msaaSamples === 4, "high: CSM 2048 + MSAA4");
  ok(med.shadows === "csm" && med.shadowMapSize === 1024 && med.fxaa && !med.csmAutoDepthBounds, "medium: CSM 1024, FXAA, manual depth bounds");
  ok(low.shadows === "blob" && !low.postHdr && !low.ssao && low.lightPool === 2, "low: blob shadows, no HDR/SSAO, 2 lights");
  ok(high.lightPool === 8 && med.lightPool === 6, "light pool 8/6 by tier");
  ok(low.ambientDensity < med.ambientDensity && med.ambientDensity < high.ambientDensity, "ambient density scales with tier");
}

// --- dev param parsing ------------------------------------------------------------------
{
  ok(parseTod("night") === 0.875 && parseTod("noon") === 0.375 && parseTod("sunrise") === 0.17, "named tod stops map to LIGHT_KEYS fractions");
  ok(parseTod("0.87") === 0.87, "numeric tod passes through");
  ok(parseTod("1.5") === null && parseTod("junk") === null && parseTod(null) === null, "bad tod values are rejected");
  ok(parseWeather("storm") === "storm" && parseWeather("STORM") === "storm", "weather parses case-insensitively");
  ok(parseWeather("hail") === null && parseWeather(null) === null, "unknown weather is rejected");
  ok(parseBloodMoon("1") && parseBloodMoon("true") && !parseBloodMoon("0") && !parseBloodMoon(null), "bloodmoon flag parses");
}

console.log(fail === 0 ? "ALL QUALITY3D CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
