import type { LLMProvider } from "./provider";

// DEFAULT real-AI provider (CLAUDE.md §8.1, §8.4): talks to a local Ollama
// instance. No API key, no internet. The `format` parameter (a JSON schema)
// forces the model to return schema-valid JSON — the key trick for running the
// GM locally.
//
// By default we call the SAME-ORIGIN path "/ollama/*", which the Vite dev/preview
// server proxies to http://127.0.0.1:11434 — so there's no browser CORS to set up.
// Set VITE_OLLAMA_HOST to an absolute URL to bypass the proxy (then you must set
// OLLAMA_ORIGINS so Ollama allows the page origin).

export interface OllamaConfig {
  host: string; // e.g. "/ollama" (proxied) or "http://localhost:11434" (direct)
  model: string; // e.g. llama3.1
  temperature?: number;
  keepAlive?: string; // keep the model warm in VRAM between turns
}

interface OllamaChatResponse {
  message?: { content?: string };
}

export class OllamaProvider implements LLMProvider {
  constructor(private readonly cfg: OllamaConfig) {}

  async generate(systemPrompt: string, payload: object, schema: object): Promise<string> {
    const res = await fetch(`${this.cfg.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
        stream: false,
        keep_alive: this.cfg.keepAlive ?? "30m",
        options: { temperature: this.cfg.temperature ?? 0.8 },
        format: schema, // structured outputs — makes invalid JSON essentially impossible
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content ?? "";
    if (!content) throw new Error("Ollama returned empty content");
    return content;
  }
}

/** Same-origin proxied path by default; absolute URL if VITE_OLLAMA_HOST is set. */
export function ollamaHost(): string {
  const h = import.meta.env?.VITE_OLLAMA_HOST;
  return typeof h === "string" && h.trim() ? h.trim() : "/ollama";
}

/** Explicit model override, if the player set one. */
export function ollamaModelEnv(): string | undefined {
  const m = import.meta.env?.VITE_OLLAMA_MODEL;
  return typeof m === "string" && m.trim() ? m.trim() : undefined;
}

export interface OllamaDetect {
  up: boolean;
  models: string[];
}

let detectCache: OllamaDetect | null = null;

/**
 * Probe whether a local Ollama is reachable and which models are installed.
 * Cached for the session (one request). Treats a non-JSON / shapeless reply
 * (e.g. an SPA HTML 404 on the static site) as "down".
 */
export async function detectOllama(host = ollamaHost(), timeoutMs = 1500): Promise<OllamaDetect> {
  if (detectCache) return detectCache;
  const down: OllamaDetect = { up: false, models: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/tags`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return (detectCache = down);
    if (!(res.headers.get("content-type") ?? "").includes("json")) return (detectCache = down);
    const data = (await res.json()) as { models?: { name?: string }[] };
    if (!Array.isArray(data.models)) return (detectCache = down);
    const models = data.models.map((m) => m?.name).filter((n): n is string => typeof n === "string");
    return (detectCache = { up: true, models });
  } catch {
    return (detectCache = down);
  } finally {
    clearTimeout(timer);
  }
}

/** For tests: clear the cached probe result. */
export function resetOllamaDetectCache(): void {
  detectCache = null;
}

/**
 * Choose which model to run: explicit env override wins; otherwise prefer a
 * known-good instruction-following family, else the first installed model.
 */
export function pickOllamaModel(installed: string[]): string {
  const env = ollamaModelEnv();
  if (env) return env;
  const prefer = ["llama3.1", "llama3.2", "llama3", "qwen2.5", "qwen3", "gemma2", "gemma3", "mistral-nemo", "mistral"];
  for (const p of prefer) {
    const hit = installed.find((m) => m.toLowerCase().startsWith(p));
    if (hit) return hit;
  }
  return installed[0] ?? "llama3.1";
}

/** Build the Ollama provider for the resolved model. */
export function createOllamaProvider(model?: string): OllamaProvider {
  return new OllamaProvider({
    host: ollamaHost(),
    model: model ?? ollamaModelEnv() ?? "llama3.1",
  });
}
