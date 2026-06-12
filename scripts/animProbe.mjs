// Dev motion probe (animation plan): boots the 3D build headless, holds W,
// and samples joint rotations at two timestamps — asserting they MOVE and
// stay BOUNDED. Not a CI gate (timing-sensitive); run after `npm run build`:
//   node scripts/animProbe.mjs
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

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

const server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 2500));
let failed = 0;
try {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 560 } });
  await page.goto("http://localhost:4173/play3d.html?seed=urban7&tier=low&probe=1", { waitUntil: "load" });
  await page.waitForTimeout(7000);
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  const sample = () =>
    page.evaluate(() => {
      const sc = window.__ob3d.scene;
      const z = (n) => sc.getTransformNodeByName(n)?.rotation?.z ?? null;
      const enemy = sc.transformNodes.find((t) => /enemy\d+_hip1/.test(t.name))?.rotation?.z ?? null;
      return { playerHip: z("player_hip1"), playerKnee: z("player_knee1"), enemyHip: enemy };
    });
  const s1 = await sample();
  await page.waitForTimeout(380);
  const s2 = await sample();
  await page.keyboard.up("w");
  for (const k of ["playerHip", "playerKnee", "enemyHip"]) {
    const a = s1[k];
    const b = s2[k];
    const okMove = a !== null && b !== null && Math.abs(a - b) > 0.02 && Math.abs(a) < 1 && Math.abs(b) < 1;
    console.log(`${okMove ? "ok  " : "FAIL"}: ${k} ${a?.toFixed(3)} -> ${b?.toFixed(3)} (moving + bounded)`);
    if (!okMove && k !== "enemyHip") failed++; // enemies may be idle — informative only
  }

  // Death tween (anim WS6): force a crit kill (⇒ launch variant) and watch the
  // SAME rig roll to side·π/2, bake the 1.5-turn tumble into its yaw, and
  // survive as the corpse node (the corpses-map handover).
  const death = await page.evaluate(async () => {
    const { sim, scene, hostiles } = window.__ob3d;
    const e = hostiles.enemies.find(
      (q) => !q.hasTrait("exploder") && !q.hasTrait("splitter") && !q.hasTrait("bloated") && q.family !== "survivor_friendly",
    );
    if (!e) return { err: "no plain enemy up" };
    const root = scene.getTransformNodeByName("enemy" + e.id);
    if (!root) return { err: "rig missing" };
    const yaw0 = root.rotation.y;
    hostiles.onEnemyKilled(sim, e, { dir: { x: 1, y: 0 }, crit: true });
    const frames = [];
    await new Promise((done) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        frames.push({ t: performance.now() - t0, rz: root.rotation.z, ry: root.rotation.y, y: root.position.y });
        if (performance.now() - t0 > 600) {
          clearInterval(iv);
          done();
        }
      }, 25);
    });
    return { yaw0, frames, disposed: root.isDisposed() };
  });
  // Quadruped gait (anim WS7): force a wild-animal spawn beside the player
  // (the urban probe seed never rolls one ambiently — bypass the biome gate
  // for the dev scenario only) and watch a leg pivot swing through frames.
  const quad = await page.evaluate(async () => {
    const { sim, scene, hostiles } = window.__ob3d;
    const origBiome = sim.world.biomeAtPx.bind(sim.world);
    sim.world.biomeAtPx = () => "grassland";
    try {
      hostiles.spawnWildAnimals(sim);
    } finally {
      sim.world.biomeAtPx = origBiome;
    }
    const a = hostiles.animals[0];
    if (!a) return { err: "spawn rolled zero animals" };
    // park it near the player so it flees (full-speed gait, stays loaded)
    a.x = sim.player.x + 80;
    a.y = sim.player.y;
    const leg = scene.getTransformNodeByName("animal" + a.id + "_legp0");
    const root = scene.getTransformNodeByName("animal" + a.id);
    if (!leg || !root) return { err: "animal rig missing" };
    const frames = [];
    const s0 = performance.now();
    await new Promise((done) => {
      const iv = setInterval(() => {
        frames.push({ leg: leg.rotation.z, sy: root.scaling.y });
        if (performance.now() - s0 > 900) {
          clearInterval(iv);
          done();
        }
      }, 40);
    });
    return { kind: a.def.kind, fleeing: a.fleeing, frames };
  });
  if (quad.err) {
    console.log(`ok  : quad gait probe skipped (${quad.err}) — informative only`);
  } else {
    const legs = quad.frames.map((f) => f.leg);
    const swings = Math.max(...legs) - Math.min(...legs);
    const popped = quad.frames.some((f) => f.sy > 0.5);
    const legOk = swings > 0.05 && Math.max(...legs.map(Math.abs)) < 2;
    console.log(`${legOk ? "ok  " : "FAIL"}: ${quad.kind} leg pivot swings (range ${swings.toFixed(3)}, fleeing=${quad.fleeing})`);
    console.log(`${popped ? "ok  " : "FAIL"}: spawn pop-in scaled the rig up`);
    if (!legOk) failed++;
    if (!popped) failed++;
  }

  if (death.err) {
    console.log(`ok  : death tween skipped (${death.err}) — informative only`);
  } else {
    const HALF_PI = Math.PI / 2;
    const last = death.frames[death.frames.length - 1];
    const mid = death.frames.some((f) => Math.abs(f.rz) > 0.05 && Math.abs(f.rz) < HALF_PI - 0.05);
    const settled = Math.abs(Math.abs(last.rz) - HALF_PI) < 1e-6;
    const tumbled = Math.abs(Math.abs(last.ry - death.yaw0) - Math.PI * 1.5) < 1e-6;
    const lifted = death.frames.some((f) => f.y > last.y + 0.05); // arc peak clears the corpse rest height
    const checks = [
      [mid, "death roll animates through mid angles (not snapped)"],
      [settled, `corpse settles at exactly ±π/2 (rz ${last.rz.toFixed(4)})`],
      [tumbled, "launch bakes the 1.5-turn tumble into the corpse yaw"],
      [lifted, "launch arc lifts the body"],
      [!death.disposed, "the rig survives the handover as the corpse node"],
    ];
    for (const [okC, msg] of checks) {
      console.log(`${okC ? "ok  " : "FAIL"}: ${msg}`);
      if (!okC) failed++;
    }
  }
  await browser.close();
} catch (e) {
  console.error("animProbe:", e.message ?? e);
  failed++;
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
}
console.log(failed === 0 ? "MOTION PROBE PASS" : "MOTION PROBE FAIL");
process.exit(failed === 0 ? 0 : 1);
