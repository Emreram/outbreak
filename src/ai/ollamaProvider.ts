import type { LLMProvider } from "./provider";

// DEFAULT provider (CLAUDE.md §8.1, §8.4): talks to a local Ollama instance.
// No API key, no internet. The `format` parameter (a JSON schema) forces the
// model to return schema-valid JSON, which is the key trick for running the GM
// locally.
//
// NOTE: This is a functional skeleton wired in Phase 0 but NOT yet called by
// gameplay — the Game Master loop that uses it is Phase 4. Streaming is also a
// Phase 4 concern; this baseline does a single (non-streamed) request.

export interface OllamaConfig {
  host: string; // e.g. http://localhost:11434
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
        stream: false, // Phase 4 switches to streaming for the "world reacts…" feel
        keep_alive: this.cfg.keepAlive ?? "30m",
        options: { temperature: this.cfg.temperature ?? 0.8 },
        format: schema, // structured outputs — makes invalid JSON essentially impossible
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return data.message?.content ?? "";
  }
}

/** Build the default Ollama provider from Vite env (see .env.example). */
export function createOllamaProvider(): OllamaProvider {
  return new OllamaProvider({
    host: import.meta.env?.VITE_OLLAMA_HOST ?? "http://localhost:11434",
    model: import.meta.env?.VITE_OLLAMA_MODEL ?? "llama3.1",
  });
}
