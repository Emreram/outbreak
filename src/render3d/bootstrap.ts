// Engine bootstrap (3D master plan §3.2): WebGPU when genuinely available,
// WebGL2 otherwise. WebGL2 is the primary TESTED path; WebGPU is enhancement
// (MSAA, snapshot rendering) — risk register row 6. ES-module subpath imports
// only, so tree-shaking keeps the bundle inside the payload budget (§9).

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";

export interface BootResult {
  engine: AbstractEngine;
  backend: "webgpu" | "webgl2";
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<BootResult> {
  // WebGPU first — dynamic import so the WebGL2 path never pays for it.
  try {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
        await engine.initAsync();
        return { engine, backend: "webgpu" };
      }
    }
  } catch {
    // fall through to WebGL2
  }
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true, powerPreference: "high-performance" }, false);
  return { engine, backend: "webgl2" };
}
