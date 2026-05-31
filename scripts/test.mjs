// Minimal headless test runner: bundle each tests/*.test.ts with esbuild and run
// it under Node. Test files exit non-zero on failure. No framework needed — the
// game-logic modules are Phaser-free, so they run straight in Node.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testFiles = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
if (testFiles.length === 0) {
  console.log("no tests found");
  process.exit(0);
}

const outDir = mkdtempSync(join(tmpdir(), "outbreak-tests-"));
let failed = 0;

for (const file of testFiles) {
  console.log(`\n=== ${file} ===`);
  const outfile = join(outDir, file.replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [join("tests", file)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    // Browser-only LLM lib (dynamically imported at runtime, never in tests).
    external: ["@mlc-ai/web-llm"],
  });
  try {
    execFileSync(process.execPath, [outfile], { stdio: "inherit" });
  } catch {
    failed++;
  }
}

console.log(failed === 0 ? "\n✓ all test files passed" : `\n✗ ${failed} test file(s) failed`);
process.exit(failed === 0 ? 0 : 1);
