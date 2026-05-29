import { defineConfig } from "vite";

// Vite is the dev server + bundler (CLAUDE.md §4). Zero-config is enough for
// the MVP; we only expose the host so it's reachable in remote/dev environments.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
