// Headless boot smoke for the Babylon build (3D master plan M7 gate, usable
// from M2 on): serves the built bundle, opens /play3d.html in headless
// Chromium (SwiftShader WebGL2), fails on any page error, and asserts the
// world actually renders (canvas pixels are not the bare clear colour) and
// the sim is alive (HUD present). Also boots the Phaser page as a regression
// canary. Usage: node scripts/smoke3d.mjs [--screenshot out.png]
//
// Run `npm run build` first (vite preview serves ./dist).

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const PORT = 4173;

function findChromium() {
  const roots = ["/opt/pw-browsers", `${process.env.HOME}/.cache/ms-playwright`];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      for (const sub of ["chrome-linux/headless_shell", "chrome-linux/chrome"]) {
        const p = `${root}/${dir}/${sub}`;
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Playwright Chromium found (looked in /opt/pw-browsers).");
}

async function waitForServer(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("vite preview did not come up");
}

const screenshotIdx = process.argv.indexOf("--screenshot");
const screenshotPath = screenshotIdx > 0 ? process.argv[screenshotIdx + 1] : null;

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  detached: true,
});
let failed = 0;

try {
  await waitForServer(`http://localhost:${PORT}/`);
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  /** Boot a page, collect console/page errors for `settleMs`. */
  async function bootCheck(name, url, settleMs) {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const url = m.location()?.url ?? "";
      // Expected offline noise: favicon, and the Ollama proxy probe (the GM
      // falls back to the in-process mock provider by design, airplane-mode).
      if (url.includes("favicon") || url.includes("/ollama")) return;
      errors.push(`console.error: ${m.text()} (${url})`);
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(settleMs);
    return { page, errors };
  }

  // --- 3D page -------------------------------------------------------------
  {
    const { page, errors } = await bootCheck("3d", `http://localhost:${PORT}/play3d.html?seed=smoke3d`, 9000);
    const hasCanvas = await page.evaluate(() => {
      const c = document.querySelector("canvas#game3d");
      return !!c && c.width > 0;
    });
    // The world must not be a uniform clear colour: screenshot → centre crop →
    // count quantised colour clusters (readPixels is invalid without
    // preserveDrawingBuffer, so analyse the composited page instead).
    const shot = await page.screenshot();
    const { default: sharp } = await import("sharp");
    const crop = await sharp(shot).extract({ left: 330, top: 190, width: 300, height: 260 }).raw().toBuffer();
    const seen = new Set();
    for (let i = 0; i + 2 < crop.length; i += 3) seen.add(`${crop[i] >> 4},${crop[i + 1] >> 4},${crop[i + 2] >> 4}`);
    const variance = seen.size;
    const hudUp = await page.evaluate(() => document.body.textContent?.includes("Day") ?? false);
    const fatal = errors.filter((e) => !e.includes("favicon"));
    console.log(`3d: canvas=${hasCanvas} colourClusters=${variance} hud=${hudUp} errors=${fatal.length}`);
    for (const e of fatal.slice(0, 6)) console.log("  ", e);
    if (!hasCanvas || variance < 4 || !hudUp || fatal.length > 0) failed++;
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    await page.close();
  }

  // --- Phaser page (oracle regression canary) --------------------------------
  {
    const { page, errors } = await bootCheck("2d", `http://localhost:${PORT}/?seed=smoke2d`, 7000);
    const hasCanvas = await page.evaluate(() => !!document.querySelector("#game canvas"));
    const fatal = errors.filter((e) => !e.includes("favicon") && !e.includes("WebGL") && !e.includes("AudioContext"));
    console.log(`2d: canvas=${hasCanvas} errors=${fatal.length}`);
    for (const e of fatal.slice(0, 6)) console.log("  ", e);
    if (!hasCanvas || fatal.length > 0) failed++;
    await page.close();
  }

  await browser.close();
} catch (e) {
  console.error("smoke3d:", e.message ?? e);
  failed++;
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

console.log(failed === 0 ? "SMOKE PASS (both renderers boot)" : `SMOKE FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
