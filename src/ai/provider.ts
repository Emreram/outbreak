// The swappable GM "brain" interface (CLAUDE.md §8.1).
// Everything downstream (GM prompt, schema, outcomes.ts) is identical regardless
// of which provider is active — only the adapter changes.

export interface LLMProvider {
  /**
   * Returns RAW JSON text matching the requested schema.
   * @param systemPrompt the GM system prompt (§8.2)
   * @param payload      the per-turn input payload (§8.3) or scenario request (§8.6)
   * @param schema       JSON schema the output must conform to (§8.4)
   */
  generate(systemPrompt: string, payload: object, schema: object): Promise<string>;
}

export type ProviderName = "ollama" | "claude" | "mock" | "auto";

/**
 * Which provider the player CONFIGURED. Unset → "auto": the engine probes for a
 * local Ollama and uses it if present, otherwise the offline procedural GM — so
 * real AI "just works" in `npm run dev` with zero config, and the static site
 * still runs anywhere. Force a choice with VITE_AI_PROVIDER=ollama|claude|mock.
 */
export function configuredProvider(): ProviderName {
  const v = import.meta.env?.VITE_AI_PROVIDER;
  if (v === "ollama" || v === "claude" || v === "mock") return v;
  return "auto";
}

/** Pure decision: given the configured intent and whether Ollama answered, pick the brain. */
export function resolveBrain(want: ProviderName, ollamaUp: boolean): "ollama" | "claude" | "offline" {
  if (want === "mock") return "offline";
  if (want === "claude") return "claude";
  if (want === "ollama") return "ollama"; // try it even if the probe missed, so errors surface
  return ollamaUp ? "ollama" : "offline"; // auto
}
