import type { LLMProvider } from "./provider";

// OPTIONAL cloud path (CLAUDE.md §8.1). Calls the Anthropic Claude API through
// the thin /server proxy so the API key NEVER reaches the browser bundle
// (CLAUDE.md §14, §15). Ollama is the default; this exists only so the brain
// stays swappable behind LLMProvider.
//
// Stubbed until the cloud path is explicitly enabled (it requires the /server
// proxy, which is intentionally omitted for local-only play).

export class ClaudeProvider implements LLMProvider {
  async generate(_systemPrompt: string, _payload: object, _schema: object): Promise<string> {
    // TODO (optional, post-MVP): POST to the /server proxy which calls Anthropic
    // with tool/JSON mode + prompt caching, then returns the raw JSON string.
    throw new Error(
      "ClaudeProvider is not enabled. Use the default OllamaProvider, or stand up the /server proxy first (CLAUDE.md §8.1).",
    );
  }
}
