// Babylon entry (3D master plan §3.2): boots the 3D renderer against the SAME
// sim + save as the Phaser build. Reached via /play3d.html or /?renderer=3d.
// M0 scope: real generated world meshed as blockout, capsule player on the
// ported tile collision, follow camera, fixed-step sim with interpolation, and
// the ?probe=1 perf scene (25 chunks + 60 wandering capsule actors).

import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createEngine } from "./render3d/bootstrap";
import { FollowRig } from "./render3d/camera/FollowRig";
import { ChunkViewManager } from "./render3d/chunks/ChunkViewManager";
import { groundHeightAt, simToWorld } from "./render3d/space";
import { Sim } from "./sim/Sim";
import { moveAndSlide } from "./sim/physics";
import { isPropSearched } from "./game/scavenge";
import { loadGame, newGame } from "./game/GameState";
import { randomSeed } from "./game/rng";
import { PLAYER_SPEED } from "./game/constants";

async function boot(): Promise<void> {
  const host = document.getElementById("game") ?? document.body;
  const canvas = document.createElement("canvas");
  canvas.id = "game3d";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.display = "block";
  canvas.style.outline = "none";
  host.appendChild(canvas);

  const { engine, backend } = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // the space.ts orientation contract
  scene.clearColor = new Color4(0.043, 0.051, 0.055, 1); // #0b0d0e

  // M0 lighting — TimeOfDayDirector replaces this at M2.
  const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.18, 0.2, 0.24);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.55), scene);
  sun.intensity = 0.9;

  // --- state + sim (same save key, same flags as the Phaser build) ----------
  const params = new URLSearchParams(location.search);
  const urlSeed = params.get("seed");
  const state = urlSeed ? newGame(urlSeed) : (loadGame() ?? newGame(randomSeed()));
  const sim = new Sim(state, {
    isChestLooted: (gid) => state.worldFlags.includes(`chest_${gid}`),
    isPropSearched: (gid) => isPropSearched(state, gid),
    disasters: () => state.disasters ?? [],
    currentDay: () => state.day,
  });

  const chunkView = new ChunkViewManager(scene, sim.world, sim.events);

  // --- player capsule (blockout; ActorFactory replaces at M3) ----------------
  const player = CreateCapsule("player", { height: 1.7, radius: 0.32 }, scene);
  const pmat = new StandardMaterial("playerMat", scene);
  pmat.diffuseColor = Color3.FromHexString("#5b6b52"); // default jacket olive
  pmat.specularColor = Color3.Black();
  player.material = pmat;

  const tmp = { x: 0, y: 0, z: 0 };
  const vec3 = (xPx: number, yPx: number, h: number): [number, number, number] => {
    simToWorld(xPx, yPx, h + groundHeightAt(xPx, yPx), tmp);
    return [tmp.x, tmp.y, tmp.z];
  };

  const rig = new FollowRig(scene, canvas);
  rig.snapTo(new Vector3(...vec3(sim.player.x, sim.player.y, 0.85)));

  // --- input → sim intents ----------------------------------------------------
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  function pollInput(): void {
    let mx = 0;
    let my = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
    sim.input.moveX = mx;
    sim.input.moveY = my;
    sim.input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  }

  // --- perf probe (?probe=1): 60 wandering capsule actors ---------------------
  interface ProbeActor {
    x: number;
    y: number;
    px: number;
    py: number;
    angle: number;
    retarget: number;
    mesh: ReturnType<typeof CreateCapsule>;
  }
  const probes: ProbeActor[] = [];
  if (params.get("probe") === "1") {
    const zmat = new StandardMaterial("probeMat", scene);
    zmat.diffuseColor = Color3.FromHexString("#6a7d5a");
    zmat.specularColor = Color3.Black();
    for (let i = 0; i < 60; i++) {
      const spot = sim.world.walkableNear(
        Math.floor(sim.player.x / 32),
        Math.floor(sim.player.y / 32),
        4,
        40,
      ) ?? { x: sim.player.x + 64 + i * 8, y: sim.player.y };
      const mesh = CreateCapsule(`probe${i}`, { height: 1.6, radius: 0.3 }, scene);
      mesh.material = zmat;
      probes.push({ x: spot.x, y: spot.y, px: spot.x, py: spot.y, angle: Math.random() * Math.PI * 2, retarget: 0, mesh });
    }
    sim.addSystem({
      id: "probeWander",
      tick(s, dt) {
        for (const a of probes) {
          a.px = a.x;
          a.py = a.y;
          a.retarget -= dt;
          if (a.retarget <= 0) {
            a.angle = Math.random() * Math.PI * 2;
            a.retarget = 0.7 + Math.random() * 1.6;
          }
          const v = PLAYER_SPEED * 0.35;
          const r = moveAndSlide(s.world, a.x, a.y, Math.cos(a.angle) * v, Math.sin(a.angle) * v, dt, 20, {
            bounds: s.world.worldPxBounds(),
          });
          if (r.hitX || r.hitY) a.retarget = 0;
          a.x = r.x;
          a.y = r.y;
        }
      },
    });
  }

  // --- HUD overlay (dev): fps / backend / position ----------------------------
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;top:8px;left:8px;color:#9fb4c0;font:12px ui-monospace,monospace;" +
    "background:rgba(10,15,20,.7);padding:6px 9px;border-radius:6px;pointer-events:none;z-index:10";
  document.body.appendChild(overlay);

  let fpsAcc = 0;
  engine.runRenderLoop(() => {
    const dtMs = engine.getDeltaTime();
    pollInput();
    sim.frame(dtMs);
    chunkView.update();

    // Interpolated player visual position (capsule origin at its centre).
    const a = sim.alpha();
    const ix = sim.player.prevX + (sim.player.x - sim.player.prevX) * a;
    const iy = sim.player.prevY + (sim.player.y - sim.player.prevY) * a;
    player.position.set(...vec3(ix, iy, 0.85));
    rig.update(player.position, dtMs);

    for (const p of probes) {
      const px = p.px + (p.x - p.px) * a;
      const py = p.py + (p.y - p.py) * a;
      p.mesh.position.set(...vec3(px, py, 0.8));
    }

    fpsAcc += dtMs;
    if (fpsAcc > 250) {
      fpsAcc = 0;
      overlay.textContent =
        `${engine.getFps().toFixed(0)} fps · ${backend} · ` +
        `${Math.round(ix)},${Math.round(iy)} px · ${sim.world.biomeAtPx(ix, iy)}` +
        (probes.length ? ` · probe ×${probes.length}` : "");
    }

    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

void boot();
