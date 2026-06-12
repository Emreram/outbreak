// Animation screenshot set (animation plan, final verification): captures the
// four plan recipes into shots/ — mid-stride, mid-swing, chest-open +200ms,
// and the night aim pose. Dev tool, not a CI gate; run after `npm run build`:
//   node scripts/animShots.mjs
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";

function findChromium() {
  for (const root of ["/opt/pw-browsers", `${process.env.HOME}/.cache/ms-playwright`]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      for (const sub of ["chrome-linux/headless_shell", "chrome-linux/chrome"]) {
        const p = `${root}/${dir}/${sub}`;
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Playwright Chromium found.");
}

mkdirSync("shots", { recursive: true });
const server = spawn("npx", ["vite", "preview", "--port", "4174", "--strictPort"], { stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 2500));
let failed = 0;
try {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const boot = async (qs) => {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    await page.goto(`http://localhost:4174/play3d.html?seed=urban7&${qs}`, { waitUntil: "load" });
    await page.waitForTimeout(9000);
    // wheel the camera to its close stop so the pose reads in the frame
    await page.mouse.move(480, 300);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(400);
    return page;
  };

  // --- day page: stride, swing, chest ------------------------------------------
  const day = await boot("tier=medium");
  await day.keyboard.down("w");
  await day.waitForTimeout(650);
  await day.screenshot({ path: "shots/anim_stride.png" });
  await day.keyboard.up("w");
  console.log("ok  : shots/anim_stride.png (mid-stride)");

  await day.keyboard.down("Space");
  await day.waitForTimeout(150); // inside the 90ms slash sweep window + ramp
  await day.screenshot({ path: "shots/anim_swing.png" });
  await day.keyboard.up("Space");
  console.log("ok  : shots/anim_swing.png (mid-swing)");

  await day.evaluate(() => {
    const { sim } = window.__ob3d;
    const chest = sim.world.activeChests()[0];
    // lid flourish near the camera (the transient places at the event x/y)
    if (chest) sim.events.emit("searchDone", { x: sim.player.x + 56, y: sim.player.y - 10, empty: false, gid: chest.gid });
  });
  await day.waitForTimeout(200);
  await day.screenshot({ path: "shots/anim_chest.png" });
  console.log("ok  : shots/anim_chest.png (chest-open +200ms)");
  await day.close();

  // --- night page: ranged aim pose ----------------------------------------------
  const night = await boot("tier=medium&tod=night");
  await night.evaluate(() => {
    const { sim, drops } = window.__ob3d;
    drops.spawnDrop(sim, sim.player.x, sim.player.y, "9mm Pistol", 1); // magnet → auto-equip
    sim.input.aim = sim.player.facing + 0.7; // torso/head track off-axis
  });
  await night.waitForTimeout(900); // pickup + 200ms HUD swap + stance ramp
  await night.screenshot({ path: "shots/anim_nightaim.png" });
  console.log("ok  : shots/anim_nightaim.png (night aim pose)");
  await night.close();

  await browser.close();
} catch (e) {
  console.error("animShots:", e.message ?? e);
  failed++;
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
}
console.log(failed === 0 ? "SHOT SET DONE" : "SHOT SET FAILED");
process.exit(failed === 0 ? 0 : 1);
