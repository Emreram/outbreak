// Post-FX stack (graphics plan WS2 / master plan §3.9): DefaultRenderingPipeline
// in HDR with bloom / per-phase exposure+contrast / vignette / ColorCurves /
// grain / chromatic aberration / sharpen / FXAA-or-MSAA, plus SSAO2 on
// Medium+. All keyframed off the same day fraction as LIGHT_KEYS via the pure
// gradeKeys evaluator; hurt impulses pulse chromatic+vignette; storm `flash`
// impulses pop exposure (lightning); death pulls saturation out; the
// encounter modal earns the cinematic DOF beat. Construction is try/caught —
// on any failure the game renders unprocessed rather than black.

import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { DepthOfFieldEffectBlurLevel } from "@babylonjs/core/PostProcesses/depthOfFieldEffect";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import type { EventBus } from "../../sim/events";
import type { QualityCaps } from "../quality";
import { evalGrade, type GradeState } from "./gradeKeys";

const BIOME_BLEND_MS = 2000;
const HURT_DECAY_MS = 350;
const FLASH_MS = 90;
const DEATH_PULL_MS = 1500;

export class PostFxDirector {
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private readonly curves = new ColorCurves();
  private hurt = 0;
  private flashAt = -9999;
  private deathAt = -1;
  private biome = "";
  private biomeBlend = 1;
  private prevGrade: GradeState | null = null;
  private nowMs = 0;

  constructor(
    scene: Scene,
    camera: Camera,
    private readonly caps: QualityCaps,
    events: EventBus,
  ) {
    try {
      const p = new DefaultRenderingPipeline("obPost", caps.postHdr, scene, [camera]);
      p.bloomEnabled = true;
      p.bloomThreshold = 0.8;
      p.bloomKernel = caps.bloomKernel;
      p.bloomScale = 0.3;
      p.bloomWeight = 0.15;
      p.fxaaEnabled = caps.fxaa;
      if (caps.msaaSamples > 1) p.samples = caps.msaaSamples;
      p.grainEnabled = caps.grain;
      if (caps.grain) {
        p.grain.intensity = 8;
        p.grain.animated = true;
      }
      p.chromaticAberrationEnabled = caps.chromatic;
      if (caps.chromatic) p.chromaticAberration.aberrationAmount = 1.5;
      p.sharpenEnabled = caps.sharpen;
      if (caps.sharpen) p.sharpen.edgeAmount = 0.2;
      p.imageProcessingEnabled = true;
      p.imageProcessing.vignetteEnabled = true;
      p.imageProcessing.vignetteWeight = 1.2;
      p.imageProcessing.colorCurvesEnabled = true;
      p.imageProcessing.colorCurves = this.curves;
      if (caps.dofBeat) {
        p.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Low;
        p.depthOfField.fStop = 1.6;
        p.depthOfField.focalLength = 50;
      }
      this.pipeline = p;
    } catch (e) {
      console.warn("PostFx pipeline unavailable — rendering unprocessed:", e);
      this.pipeline = null;
    }

    if (caps.ssao) {
      try {
        const s = new SSAO2RenderingPipeline("obSsao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], true);
        s.radius = 0.6;
        s.totalStrength = 0.9;
        s.samples = caps.tier === "high" ? 16 : 12;
        s.expensiveBlur = caps.tier === "high";
        this.ssao = s;
      } catch (e) {
        console.warn("SSAO2 unavailable:", e);
        this.ssao = null;
      }
    }

    events.on("impulse", ({ kind, amount }) => {
      if (kind === "hurtPulse") this.hurt = Math.min(1, Math.max(this.hurt, amount));
      else if (kind === "flash") this.flashAt = this.nowMs;
    });
    events.on("death", () => (this.deathAt = this.nowMs));
  }

  /** The encounter-modal cinematic beat (plan §6.1): shallow focus on the rig. */
  setEncounterDof(on: boolean): void {
    if (!this.pipeline || !this.caps.dofBeat) return;
    this.pipeline.depthOfFieldEnabled = on;
  }

  update(t: number, biome: string, bloodMoon: boolean, weather: string | undefined, dtMs: number, cameraRadius: number): void {
    this.nowMs += dtMs;
    const p = this.pipeline;
    if (!p) return;

    // Smooth biome transitions (~2s) so grade nudges never snap.
    if (biome !== this.biome) {
      this.biome = biome;
      this.biomeBlend = 0;
    }
    this.biomeBlend = Math.min(1, this.biomeBlend + dtMs / BIOME_BLEND_MS);

    const target = evalGrade(t, biome, bloodMoon, weather);
    const g = this.prevGrade && this.biomeBlend < 1 ? blendGrade(this.prevGrade, target, this.biomeBlend) : target;
    if (this.biomeBlend >= 1) this.prevGrade = target;
    else this.prevGrade ??= target;

    // transient modifiers
    this.hurt = Math.max(0, this.hurt - dtMs / HURT_DECAY_MS);
    const flash = this.nowMs - this.flashAt < FLASH_MS ? 1 : 0;
    const death = this.deathAt >= 0 ? Math.min(1, (this.nowMs - this.deathAt) / DEATH_PULL_MS) : 0;
    const bloodPulse = bloodMoon ? 1 + 0.05 * Math.sin((this.nowMs / 3200) * Math.PI * 2) : 1;

    const ip = p.imageProcessing;
    ip.exposure = g.exposure * bloodPulse * (1 + flash * 0.5);
    ip.contrast = g.contrast;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = g.vignette + this.hurt * 0.6;
    p.bloomWeight = g.bloomWeight;
    if (this.caps.chromatic) p.chromaticAberration.aberrationAmount = 1.5 + this.hurt * 10;

    const c = this.curves;
    c.globalSaturation = g.curves.globalSaturation - death * 80;
    c.shadowsHue = g.curves.shadowsHue;
    c.shadowsDensity = g.curves.shadowsDensity;
    c.shadowsSaturation = g.curves.shadowsSaturation;
    c.shadowsExposure = g.curves.shadowsExposure;
    c.highlightsHue = g.curves.highlightsHue;
    c.highlightsDensity = g.curves.highlightsDensity;
    c.midtonesSaturation = g.curves.midtonesSaturation;

    if (p.depthOfFieldEnabled) {
      p.depthOfField.focusDistance = cameraRadius * 1000; // meters → mm
    }
    void this.ssao; // owned for disposal; no per-frame work
  }
}

function blendGrade(a: GradeState, b: GradeState, f: number): GradeState {
  const l = (x: number, y: number): number => x + (y - x) * f;
  return {
    exposure: l(a.exposure, b.exposure),
    contrast: l(a.contrast, b.contrast),
    vignette: l(a.vignette, b.vignette),
    bloomWeight: l(a.bloomWeight, b.bloomWeight),
    curves: {
      globalSaturation: l(a.curves.globalSaturation, b.curves.globalSaturation),
      shadowsHue: l(a.curves.shadowsHue, b.curves.shadowsHue),
      shadowsDensity: l(a.curves.shadowsDensity, b.curves.shadowsDensity),
      shadowsSaturation: l(a.curves.shadowsSaturation, b.curves.shadowsSaturation),
      shadowsExposure: l(a.curves.shadowsExposure, b.curves.shadowsExposure),
      highlightsHue: l(a.curves.highlightsHue, b.curves.highlightsHue),
      highlightsDensity: l(a.curves.highlightsDensity, b.curves.highlightsDensity),
      midtonesSaturation: l(a.curves.midtonesSaturation, b.curves.midtonesSaturation),
    },
  };
}
