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

export type ProviderName = "ollama" | "claude";

/** Which provider is configured via env (defaults to local Ollama). */
export function configuredProvider(): ProviderName {
  return import.meta.env.VITE_AI_PROVIDER === "claude" ? "claude" : "ollama";
}
