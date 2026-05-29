import { defineConfig } from "vite";

// Vite is the dev server + bundler (CLAUDE.md §4). Zero-config is enough for
// the MVP; we only expose the host so it's reachable in remote/dev environments.
//
// base: served from "/" locally and on Vercel; GitHub Pages serves project sites
// from "/<repo>/", so the Pages CI sets GH_PAGES=true to use "/outbreak/".
const base = process.env.GH_PAGES ? "/outbreak/" : "/";

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
