/// <reference types="vite/client" />

// Typed access to the project's VITE_ env vars (see .env.example).
interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: string;
  readonly VITE_OLLAMA_HOST?: string;
  readonly VITE_OLLAMA_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
