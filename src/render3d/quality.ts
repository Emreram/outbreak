// Quality tiers (3D master plan §3.11): one QualityCaps struct gates every
// graphics feature — High (WebGPU/discrete: MSAA4, SSAO, CSM 2048, GPU
// particles), Medium (WebGL2 iGPU: FXAA, SSAO on, CSM 1024×2), Low/mobile/
// software (blob shadows, bloom-only post, thinned particles). Auto-probed at
// boot, overridable with ?tier=. Pure module — headless tests cover the probe.

export type Tier = "high" | "medium" | "low";

export interface QualityCaps {
  tier: Tier;
  shadows: "csm" | "blob";
  shadowMapSize: 0 | 1024 | 2048;
  csmAutoDepthBounds: boolean;
  postHdr: boolean;
  ssao: boolean;
  fxaa: boolean;
  msaaSamples: 1 | 4;
  grain: boolean;
  chromatic: boolean;
  sharpen: boolean;
  dofBeat: boolean;
  bloomKernel: 32 | 64;
  lightPool: number;
  maxSimultaneousLights: number;
  ambientDensity: number;
  gpuParticles: boolean;
}

export interface TierProbe {
  override?: string | null;
  backend: "webgpu" | "webgl2";
  rendererString: string;
  isMobile: boolean;
}

/** ?tier= wins; software rasterizers and mobile drop to low; WebGPU earns high. */
export function resolveTier(p: TierProbe): Tier {
  const o = p.override?.toLowerCase();
  if (o === "high" || o === "medium" || o === "low") return o;
  if (/swiftshader|llvmpipe|software|basic render/i.test(p.rendererString)) return "low";
  if (p.isMobile) return "low";
  if (p.backend === "webgpu") return "high";
  return "medium";
}

export function capsFor(tier: Tier): QualityCaps {
  switch (tier) {
    case "high":
      return {
        tier,
        shadows: "csm",
        shadowMapSize: 2048,
        csmAutoDepthBounds: true,
        postHdr: true,
        ssao: true,
        fxaa: false, // MSAA covers it on WebGPU
        msaaSamples: 4,
        grain: true,
        chromatic: true,
        sharpen: true,
        dofBeat: true,
        bloomKernel: 64,
        lightPool: 8,
        maxSimultaneousLights: 8,
        ambientDensity: 1,
        gpuParticles: true,
      };
    case "medium":
      return {
        tier,
        shadows: "csm",
        shadowMapSize: 1024,
        csmAutoDepthBounds: false, // the depth reducer is the most driver-divergent piece
        postHdr: true,
        ssao: true,
        fxaa: true,
        msaaSamples: 1,
        grain: true,
        chromatic: true,
        sharpen: true,
        dofBeat: true,
        bloomKernel: 64,
        lightPool: 6,
        maxSimultaneousLights: 6,
        ambientDensity: 0.6,
        gpuParticles: false,
      };
    case "low":
      return {
        tier,
        shadows: "blob",
        shadowMapSize: 0,
        csmAutoDepthBounds: false,
        postHdr: false,
        ssao: false,
        fxaa: false,
        msaaSamples: 1,
        grain: false,
        chromatic: false,
        sharpen: false,
        dofBeat: false,
        bloomKernel: 32,
        lightPool: 2,
        maxSimultaneousLights: 4,
        ambientDensity: 0.3,
        gpuParticles: false,
      };
  }
}
