// Babylon entry (3D master plan §3.2): boots the 3D renderer against the SAME
// sim + save as the Phaser build. Reached via /play3d.html or /?renderer=3d.
// M2 tier: atlas-textured terrain with walls/roofs/animated water/lava, props
// with wind sway, the LIGHT_KEYS day/night cycle + fog, minimap + labels,
// blockout actors driven by the full extracted sim (enemies, combat, loot,
// scavenging, survival, clock), DOM HUD readout, and the perf probe.

import { Scene } from "@babylonjs/core/scene";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { createEngine } from "./render3d/bootstrap";
import { FollowRig } from "./render3d/camera/FollowRig";
import { ChunkViewManager } from "./render3d/chunks/ChunkViewManager";
import { PropInstancer } from "./render3d/chunks/PropInstancer";
import { TimeOfDayDirector } from "./render3d/env/TimeOfDayDirector";
import { WorldView } from "./render3d/WorldView";
import { MinimapOverlay } from "./render3d/ui/MinimapOverlay";
import { groundHeightAt, simToWorld, worldToSim } from "./render3d/space";
import { buildHumanoid, poseHumanoid } from "./render3d/actors/Blockout";
import { createGameSim } from "./sim/createGameSim";
import { clearSave, loadGame, newGame } from "./game/GameState";
import { randomSeed } from "./game/rng";
import { getZombie } from "./game/enemies/catalog";
import { equippedMeleeDef, equippedRangedDef } from "./game/inventory";
import { defOf } from "./game/items/catalog";
import { RARITY_META } from "./game/items/rarity";
import { TILE_SIZE } from "./game/constants";
import { DEFAULT_PLAYER_JACKET } from "./engine/textures";
import { LootReveal, type RevealCard } from "./ui/LootReveal";

async function boot(): Promise<void> {
  const host = document.getElementById("game") ?? document.body;
  const canvas = document.createElement("canvas");
  canvas.id = "game3d";
  canvas.style.cssText = "width:100vw;height:100vh;display:block;outline:none;";
  host.appendChild(canvas);

  const { engine, backend } = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // the space.ts orientation contract

  const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.55), scene);
  const tod = new TimeOfDayDirector();

  // --- state + sim (same save key, same flags as the Phaser build) ----------
  const params = new URLSearchParams(location.search);
  const urlSeed = params.get("seed");
  const state = urlSeed ? newGame(urlSeed) : (loadGame() ?? newGame(randomSeed()));
  const { sim, clock, hostiles, combat, drops, scavenge, chests } = createGameSim(state);

  const chunkView = new ChunkViewManager(scene, sim.world, sim.events);
  const props = new PropInstancer(scene, sim.world, sim.events);
  const view = new WorldView(scene, sim, hostiles, combat, drops);
  const minimap = new MinimapOverlay(document.body);

  // --- player rig (blockout survivor: jacket body, skin head, pack accent) ---
  const jacket = state.appearance?.color ?? DEFAULT_PLAYER_JACKET;
  const playerRig = buildHumanoid(scene, "player", {
    skin: jacket,
    headColor: 0xc89a6a,
    accent: 0x6e5a3a, // backpack strap band
    scale: 1.05,
  });
  const player = playerRig.root;

  // --- loot ceremony (the DOM LootReveal survives untouched — plan §6.3) -----
  const reveal = new LootReveal(() => {
    sim.paused = false;
  });
  const rarityIcon = (rarity: keyof typeof RARITY_META, label: string): string => {
    const c = document.createElement("canvas");
    c.width = 56;
    c.height = 56;
    const g = c.getContext("2d")!;
    g.fillStyle = "#10151b";
    g.fillRect(0, 0, 56, 56);
    g.strokeStyle = RARITY_META[rarity].css;
    g.lineWidth = 3;
    g.strokeRect(3, 3, 50, 50);
    g.fillStyle = RARITY_META[rarity].css;
    g.font = "700 20px ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label.slice(0, 2).toUpperCase(), 28, 30);
    return c.toDataURL();
  };
  chests.onOpened = (e) => {
    if (!e.ceremony || reveal.isOpen()) return;
    const cards: RevealCard[] = e.rolls
      .map((s) => {
        const def = defOf(s.item);
        return { img: rarityIcon(def.rarity, s.item), name: s.item, qty: s.qty, rarity: def.rarity };
      })
      .sort((a, b) => RARITY_META[a.rarity].rank - RARITY_META[b.rarity].rank);
    sim.paused = true;
    combat.firing = false;
    reveal.open({ title: `${e.kind.replace(/_/g, " ")} · tier ${e.tier}`.toUpperCase(), icon: rarityIcon("rare", "SC"), cards, egg: false });
  };

  const tmp = { x: 0, y: 0, z: 0 };
  const vec3 = (xPx: number, yPx: number, h: number): [number, number, number] => {
    simToWorld(xPx, yPx, h + groundHeightAt(xPx, yPx), tmp);
    return [tmp.x, tmp.y, tmp.z];
  };

  const rig = new FollowRig(scene, canvas);
  rig.snapTo(new Vector3(...vec3(sim.player.x, sim.player.y, 0.85)));
  const camTarget = new Vector3();
  sim.events.on("impulse", ({ kind, amount }) => {
    if (kind === "shake") rig.shake(amount);
    else if (kind === "zoomPunch") rig.zoomPunch(amount);
  });

  // --- input → sim intents ----------------------------------------------------
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "Space" || e.code === "KeyF") combat.meleeAttack(sim);
    if (e.code === "KeyR") {
      if (sim.dead) restart();
      else combat.tryReload(sim);
    }
    if (e.code === "KeyM") minimap.toggle();
    if (e.code === "KeyE") {
      sim.input.interact = true;
      // Interact priority (WorldScene parity, trimmed to live systems):
      // chest first, then hold-to-search the nearest searchable prop/body.
      const chest = chests.nearestChest(sim, 56);
      if (chest) {
        chests.openChest(sim, chest);
      } else if (!scavenge.search) {
        const t = scavenge.nearestSearchable(sim, 64);
        if (t) scavenge.startSearch(sim, t);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    if (e.code === "KeyE") sim.input.interact = false;
  });
  window.addEventListener("blur", () => {
    keys.clear();
    sim.input.interact = false;
    combat.firing = false;
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 0) {
      combat.firing = true;
      combat.fire(sim, sim.input.aim ?? sim.player.facing);
    }
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 0) combat.firing = false;
  });

  // Mouse aim: ray ∩ ground plane → sim pixels → exact aimAngle semantics (§6.1).
  scene.onPointerObservable.add((pi) => {
    if (pi.type !== 4 /* POINTERMOVE */) return;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), rig.camera);
    if (Math.abs(ray.direction.y) < 1e-5) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return;
    const wx = ray.origin.x + ray.direction.x * t;
    const wz = ray.origin.z + ray.direction.z * t;
    const sp = worldToSim(wx, wz);
    sim.input.aim = Math.atan2(sp.y - sim.player.y, sp.x - sim.player.x);
  });

  function pollMove(): void {
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

  // --- perf probe (?probe=1): 60 real zombies on real AI ----------------------
  if (params.get("probe") === "1") {
    const def = getZombie("shambler");
    if (def) {
      const tx = Math.floor(sim.player.x / TILE_SIZE);
      const ty = Math.floor(sim.player.y / TILE_SIZE);
      for (let i = 0; i < 60; i++) {
        const spot = sim.world.walkableNear(tx, ty, 4, 40);
        if (spot) hostiles.spawnEnemy(sim, def, spot.x, spot.y);
      }
    }
  }

  // --- HUD (DOM, display-only) -------------------------------------------------
  const hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;top:10px;left:10px;color:#cfe6ff;font:12px ui-monospace,monospace;" +
    "background:rgba(10,15,20,.72);padding:8px 10px;border-radius:8px;pointer-events:none;z-index:20;min-width:210px";
  document.body.appendChild(hud);
  const BARS: [keyof typeof state.player & string, string, string][] = [
    ["hp", "HP", "#ff5555"],
    ["stamina", "STA", "#ffd23f"],
    ["hunger", "HUN", "#ff9f43"],
    ["thirst", "THI", "#4ec3ff"],
    ["infection", "INF", "#9b5cff"],
  ];
  function hudRender(): void {
    const p = state.player;
    const rows = BARS.map(([k, label, color]) => {
      const v = Math.round(p[k] as number);
      return (
        `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">` +
        `<span style="width:28px;color:#9fb4c0">${label}</span>` +
        `<span style="flex:1;height:9px;background:#1a222c;border-radius:3px;overflow:hidden">` +
        `<span style="display:block;width:${v}%;height:100%;background:${color}"></span></span>` +
        `<span style="width:24px;text-align:right">${v}</span></div>`
      );
    }).join("");
    const melee = equippedMeleeDef(state);
    const gun = equippedRangedDef(state);
    const weapon = gun
      ? `${gun.name} ${state.loadedAmmo ?? 0}/${gun.magSize ?? 0}${combat.reloading ? " (reloading)" : ""}`
      : melee.name;
    const search = scavenge.search ? ` · searching ${(scavenge.progress() * 100).toFixed(0)}%` : "";
    hud.innerHTML =
      rows +
      `<div style="margin-top:4px;color:#9fb4c0">Day ${state.day} · ${state.timeOfDay}${state.bloodMoon ? ' · <span style="color:#ff5a6e">BLOOD MOON</span>' : ""}</div>` +
      `<div style="color:#e8e2d0">${weapon} · kills ${hostiles.kills}${search}</div>`;
  }

  // --- death overlay -------------------------------------------------------------
  const deathEl = document.createElement("div");
  deathEl.style.cssText =
    "position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;" +
    "background:rgba(5,2,2,.72);color:#ff6b6b;font:700 26px ui-monospace,monospace;z-index:50;text-align:center;gap:10px";
  document.body.appendChild(deathEl);
  sim.events.on("death", ({ reason }) => {
    deathEl.style.display = "flex";
    deathEl.innerHTML =
      `YOU DIED<div style="font-size:14px;color:#e8e2d0;font-weight:400">${reason}</div>` +
      `<div style="font-size:13px;color:#9fb4c0;font-weight:400">${state.player.name} · day ${state.day} · ${hostiles.kills} kills</div>` +
      `<div style="font-size:13px;color:#7fd3ff;font-weight:400">Press R for a new run (a new city and a new story await)</div>`;
  });
  function restart(): void {
    clearSave();
    const u = new URL(location.href);
    u.searchParams.delete("seed");
    location.href = u.toString();
  }

  // --- dev overlay ----------------------------------------------------------------
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;bottom:8px;left:8px;color:#9fb4c0;font:11px ui-monospace,monospace;" +
    "background:rgba(10,15,20,.6);padding:4px 8px;border-radius:6px;pointer-events:none;z-index:20";
  document.body.appendChild(overlay);

  let uiAcc = 0;
  engine.runRenderLoop(() => {
    const dtMs = engine.getDeltaTime();
    pollMove();
    sim.frame(dtMs);
    chunkView.update();

    const a = sim.alpha();
    const ix = sim.player.prevX + (sim.player.x - sim.player.prevX) * a;
    const iy = sim.player.prevY + (sim.player.y - sim.player.prevY) * a;
    player.position.set(...vec3(ix, iy, 0));
    // Player.update visual parity: walk sway ±0.07 (±0.1 sprint) on the
    // walkT·0.35 phase; idle micro-breathe 1+sin(t·0.0045)·0.015.
    const moving = sim.player.moving;
    const phase = sim.now * (sim.player.sprinting ? 0.042 : 0.021);
    const sway = moving ? Math.sin(phase) * (sim.player.sprinting ? 0.1 : 0.07) : 0;
    const breathe = moving ? 0 : Math.sin(sim.now * 0.0045) * 0.015;
    poseHumanoid(playerRig, sim.player.facing, phase, moving, sway, breathe, 0.7);
    camTarget.set(player.position.x, player.position.y + 0.9, player.position.z);
    rig.update(camTarget, dtMs);

    // lighting + fog from the world clock; fluid/roof uniforms follow
    tod.apply(scene, sun, hemi, clock.dayFraction(sim), !!state.bloodMoon, state.weather);
    const indoor = sim.world.buildingAt(Math.floor(ix / TILE_SIZE), Math.floor(iy / TILE_SIZE)) !== null;
    chunkView.materials.update({
      timeS: performance.now() / 1000,
      camera: rig.camera.position,
      fogColor: tod.state.fogColor,
      fogDensity: tod.state.fogDensity,
      nightDim: tod.state.nightDim,
      sunDir: tod.state.sunDir,
      sunColor: tod.state.sunColor,
      ambient: tod.state.ambient,
      player: { x: player.position.x, y: player.position.y, z: player.position.z },
      indoor,
    });

    props.update(performance.now(), ix, iy);
    view.update(a, performance.now(), ix, iy);
    minimap.render(state.seed, state);

    uiAcc += dtMs;
    if (uiAcc > 200) {
      uiAcc = 0;
      hudRender();
      overlay.textContent =
        `${engine.getFps().toFixed(0)} fps · ${backend} · ${Math.round(ix)},${Math.round(iy)}px · ` +
        `${sim.world.biomeAtPx(ix, iy)} · enemies ${hostiles.enemies.length}`;
    }

    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());

  // Diagnostics hook for the headless smoke harness (read-only).
  (window as unknown as Record<string, unknown>).__ob3d = { scene, engine, sim, state };
}

void boot();
