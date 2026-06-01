import type { MLCEngine, InitProgressReport, ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { LLMProvider } from "./provider";

// In-browser Game Master brain (WebLLM / WebGPU). Runs a real LLM entirely on the
// player's GPU — no API key, no server — so it also works on the static deployed
// site for browsers that support WebGPU and choose to opt in. The model (~1-2 GB)
// is downloaded once and cached by the browser. The big library is loaded via a
// DYNAMIC import so it never bloats the main bundle or loads for offline-GM players.

const STORAGE_KEY = "ob_webllm_enabled";
const DEFAULT_MODEL = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

/** WebGPU is required; absent on most phones / Safari today. */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

export function webllmModel(): string {
  const m = import.meta.env?.VITE_WEBLLM_MODEL;
  return typeof m === "string" && m.trim() ? m.trim() : DEFAULT_MODEL;
}

/** Player opted in (persisted) — so it auto-loads (from cache) on the next visit. */
export function webllmEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setWebllmEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / no storage — fine, just non-persistent */
  }
}

export type WebLLMState = "idle" | "loading" | "ready" | "error";
let state: WebLLMState = "idle";
let engine: MLCEngine | null = null;
let loadError = "";
let warmed = false; // a confirmed, time-bounded warm-up succeeded — only then is it usable

export function webllmState(): WebLLMState {
  return state;
}
/** Usable by the Game Master only after the model loaded AND a warm-up inference
 *  actually returned — so we never route turns into a model that hangs/can't run. */
export function webllmReady(): boolean {
  return state === "ready" && engine !== null && warmed;
}
export function webllmError(): string {
  return loadError;
}

/** Reject `p` after `ms` so a stuck WebGPU call can never hang the game. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("webllm timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Download + initialise the in-browser model. Idempotent; reports progress. */
export async function loadWebLLM(onProgress?: (r: InitProgressReport) => void): Promise<void> {
  if (state === "ready" || state === "loading") return;
  if (!hasWebGPU()) {
    state = "error";
    loadError = "WebGPU is not available in this browser.";
    throw new Error(loadError);
  }
  state = "loading";
  loadError = "";
  warmed = false;
  try {
    const webllm = await import("@mlc-ai/web-llm"); // code-split: only fetched when enabled
    engine = await webllm.CreateMLCEngine(webllmModel(), {
      initProgressCallback: (r) => onProgress?.(r),
    });
    state = "ready";
  } catch (e) {
    state = "error";
    loadError = e instanceof Error ? e.message : String(e);
    engine = null;
    throw e;
  }
}

export class WebLLMProvider implements LLMProvider {
  async generate(systemPrompt: string, payload: object, schema: object): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) },
    ];
    try {
      // Constrained JSON decoding — the cloud/Ollama "format" analog (CLAUDE.md §8.4).
      return await complete(messages, { type: "json_object", schema: JSON.stringify(schema) });
    } catch {
      // XGrammar can reject an over-complex schema — fall back to plain JSON mode.
      // The GM prompt already describes the schema and gameMaster validates/repairs.
      return await complete(messages, { type: "json_object" });
    }
  }
}

async function complete(
  messages: ChatCompletionMessageParam[],
  responseFormat: { type: "json_object"; schema?: string },
): Promise<string> {
  if (!engine) throw new Error("WebLLM engine not loaded");
  const reply = await engine.chat.completions.create({
    messages,
    temperature: 0.8,
    max_tokens: 1024, // headroom so the JSON never truncates mid-object
    response_format: responseFormat,
  });
  const content = reply.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("WebLLM returned empty content");
  return content;
}

/**
 * Compile WebGPU shaders with a tiny generation, time-bounded. The model is only
 * marked usable (`warmed`) if this actually returns — so a GPU/model that stalls
 * here leaves the game on the offline GM instead of hanging on the first turn.
 */
export async function warmUpWebLLM(): Promise<void> {
  if (!engine || warmed) return;
  try {
    await withTimeout(
      engine.chat.completions.create({
        messages: [{ role: "user", content: 'Reply with {"ok":true}' }],
        max_tokens: 8,
        response_format: { type: "json_object" },
      }),
      30000,
    );
    warmed = true; // confirmed working
  } catch {
    warmed = false; // stuck/too slow — the GM stays on the offline brain
  }
}

let providerSingleton: WebLLMProvider | null = null;
export function getWebLLMProvider(): WebLLMProvider {
  return (providerSingleton ??= new WebLLMProvider());
}
