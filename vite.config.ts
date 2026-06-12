import { defineConfig } from "vite";

// Vite is the dev server + bundler (CLAUDE.md §4). Zero-config is enough for
// the MVP; we only expose the host so it's reachable in remote/dev environments.
//
// base: served from "/" locally and on Vercel; GitHub Pages serves project sites
// from "/<repo>/", so the Pages CI sets GH_PAGES=true to use "/outbreak/".
const base = process.env.GH_PAGES ? "/outbreak/" : "/";

// Real-AI path: the browser calls the same-origin "/ollama/*" and the dev/preview
// server forwards it to the local Ollama HTTP API — so there's NO browser CORS to
// configure (CLAUDE.md §8.8). Override the target with OLLAMA_HOST if Ollama runs
// elsewhere. (On the static Vercel build there's no proxy; the live site falls
// back to the offline GM, by design.)
const ollamaTarget = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const ollamaProxy = {
  "/ollama": {
    target: ollamaTarget,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, ""),
  },
};

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
    proxy: ollamaProxy,
  },
  preview: {
    proxy: ollamaProxy,
  },
  build: {
    target: "es2020",
    sourcemap: true,
    rollupOptions: {
      // Multi-page: the Phaser build at "/" plus the Babylon build at
      // "/play3d.html" (3D master plan §3.2) until the M8 cutover.
      input: {
        main: "index.html",
        play3d: "play3d.html",
      },
    },
  },
});
