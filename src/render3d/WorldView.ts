// WorldView (3D master plan §3.2): subscribes to sim events and owns the
// entity sub-views. M2/M3 blockout tier — enemies/animals as tinted capsules
// (LookSpec skin colours so the catalog variety reads), drops as rarity-lit
// cubes, corpses as flattened slabs, projectiles as tracers, pooled ground
// decals, GUI float text, DOM banner toasts, and the synthesized-audio bridge
// (engine/audio.ts is renderer-free and carries the sonic identity verbatim).
// Continuous positions are polled from sim arrays + interpolated; events only
// mark discrete moments. The view never mutates sim state.

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Sim } from "../sim/Sim";
import type { HostilesSystem } from "../sim/systems/hostiles";
import type { CombatSystem } from "../sim/systems/combat";
import type { DropsSystem } from "../sim/systems/drops";
import { sfx } from "../engine/audio";
import { defOf } from "../game/items/catalog";
import { RARITY_META } from "../game/items/rarity";
import { groundHeightAt, simToWorld } from "./space";
import { Labels } from "./Labels";
import { buildHumanoid, buildQuadruped, lookOfZombie, poseHumanoid, type HumanoidRig, type QuadRig } from "./actors/Blockout";
import { CombatFx } from "./fx/CombatFx";

const FLOAT_POOL = 18;
const DECAL_POOL = 48;

export class WorldView {
  readonly ui: AdvancedDynamicTexture;
  readonly fx: CombatFx;
  /** Optional shadow hookup (WS4): actor body meshes cast. */
  shadows: import("./env/ShadowDirector").ShadowDirector | null = null;
  private readonly labels: Labels;
  private readonly enemies = new Map<number, HumanoidRig>();
  private readonly animals = new Map<number, QuadRig>();
  private readonly corpses = new Map<number, Mesh>();
  private readonly drops = new Map<number, { mesh: Mesh; born: number }>();
  private readonly projectiles = new Map<number, Mesh>();
  private readonly floats: { block: TextBlock; x: number; y: number; born: number; live: boolean }[] = [];
  private readonly decals: { mesh: Mesh; born: number }[] = [];
  private decalIdx = 0;
  private readonly toastHost: HTMLDivElement;
  private readonly tmp = new Vector3();
  private projMat: StandardMaterial;
  private acidMat: StandardMaterial;
  private corpseMat: StandardMaterial;
  private decalMat: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly sim: Sim,
    private readonly hostiles: HostilesSystem,
    private readonly combat: CombatSystem,
    private readonly dropsSys: DropsSystem,
  ) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("worldUi", true, scene);
    this.labels = new Labels(this.ui, sim.world, scene);

    for (let i = 0; i < FLOAT_POOL; i++) {
      const block = new TextBlock(`float${i}`, "");
      block.fontFamily = "ui-monospace, Menlo, monospace";
      block.fontSize = 15;
      block.outlineColor = "#000";
      block.outlineWidth = 4;
      block.isVisible = false;
      this.ui.addControl(block);
      this.floats.push({ block, x: 0, y: 0, born: 0, live: false });
    }

    this.toastHost = document.createElement("div");
    this.toastHost.style.cssText =
      "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);display:flex;flex-direction:column;" +
      "align-items:center;gap:4px;z-index:30;pointer-events:none;font:13px ui-monospace,monospace;";
    document.body.appendChild(this.toastHost);

    this.projMat = new StandardMaterial("projMat", scene);
    this.projMat.emissiveColor = Color3.FromHexString("#ffe08a");
    this.projMat.disableLighting = true;
    this.acidMat = new StandardMaterial("acidMat", scene);
    this.acidMat.emissiveColor = Color3.FromHexString("#8fd14a");
    this.acidMat.disableLighting = true;
    this.corpseMat = new StandardMaterial("corpseMat", scene);
    this.corpseMat.diffuseColor = Color3.FromHexString("#5a5a5a");
    this.corpseMat.specularColor = Color3.Black();
    this.decalMat = new StandardMaterial("decalMat", scene);
    this.decalMat.diffuseColor = Color3.FromHexString("#3a0e10");
    this.decalMat.specularColor = Color3.Black();

    this.fx = new CombatFx(scene, sim, hostiles);
    this.bind();
  }

  private bind(): void {
    const ev = this.sim.events;

    ev.on("enemySpawned", ({ id }) => {
      const e = this.hostiles.enemies.find((x) => x.id === id);
      if (!e) return;
      const rig = buildHumanoid(this.scene, `enemy${id}`, lookOfZombie(e.def));
      this.shadows?.addActorCaster(rig.body);
      this.enemies.set(id, rig);
    });
    ev.on("enemyRemoved", ({ id }) => {
      const rig = this.enemies.get(id);
      if (rig) this.shadows?.removeActorCaster(rig.body);
      rig?.dispose();
      this.enemies.delete(id);
    });

    ev.on("animalSpawned", ({ id }) => {
      const a = this.hostiles.animals.find((x) => x.id === id);
      if (!a) return;
      const body = a.def.kind === "rabbit" ? 0xd8c8b0 : a.def.kind === "deer" ? 0xa97a4a : 0x6b5236;
      const head = a.def.kind === "deer" ? 0x8a5f38 : undefined;
      const rig = buildQuadruped(this.scene, `animal${id}`, body, a.def.scale, head);
      this.shadows?.addActorCaster(rig.body);
      this.animals.set(id, rig);
    });
    ev.on("animalRemoved", ({ id }) => {
      const rig = this.animals.get(id);
      if (rig) this.shadows?.removeActorCaster(rig.body);
      rig?.dispose();
      this.animals.delete(id);
    });

    ev.on("enemyRemoved", ({ id, corpse }) => {
      if (!corpse) return;
      // The matching corpse record is the most recent one (kill pipeline order).
      const rec = this.hostiles.corpses[this.hostiles.corpses.length - 1];
      if (!rec) return;
      const slab = CreateBox(`corpse${rec.id}`, { width: 0.9, height: 0.16, depth: 0.5 }, this.scene);
      slab.material = this.corpseMat;
      slab.rotation.y = Math.random() * Math.PI;
      const wp = simToWorld(rec.x, rec.y, 0.08 + groundHeightAt(rec.x, rec.y));
      slab.position.set(wp.x, wp.y, wp.z);
      slab.freezeWorldMatrix();
      slab.isPickable = false;
      this.corpses.set(rec.id, slab);
      void id;
    });
    ev.on("corpseFaded", ({ id }) => {
      this.corpses.get(id)?.dispose();
      this.corpses.delete(id);
    });

    ev.on("dropSpawned", ({ id }) => {
      const d = this.dropsSys.drops.find((x) => x.id === id);
      if (!d) return;
      const mesh = CreateBox(`drop${id}`, { size: 0.22 }, this.scene);
      const rar = defOf(d.item).rarity;
      const mat = new StandardMaterial(`drop${id}m`, this.scene);
      mat.diffuseColor = Color3.FromHexString("#d8d2c4");
      mat.emissiveColor = Color3.FromHexString(RARITY_META[rar].css).scale(0.55);
      mat.specularColor = Color3.Black();
      mesh.material = mat;
      mesh.isPickable = false;
      this.drops.set(id, { mesh, born: performance.now() });
    });
    ev.on("dropRemoved", ({ id }) => {
      const d = this.drops.get(id);
      if (d) {
        d.mesh.material?.dispose();
        d.mesh.dispose();
      }
      this.drops.delete(id);
    });

    ev.on("projectileSpawned", ({ id, kind }) => {
      const mesh = CreateBox(`proj${id}`, { width: 0.3, height: 0.06, depth: 0.06 }, this.scene);
      mesh.material = kind === "acid" ? this.acidMat : this.projMat;
      mesh.isPickable = false;
      this.projectiles.set(id, mesh);
    });
    ev.on("projectileKilled", ({ id }) => {
      this.projectiles.get(id)?.dispose();
      this.projectiles.delete(id);
    });

    ev.on("floatText", ({ x, y, text, color }) => {
      const f = this.floats.find((p) => !p.live) ?? this.floats[0];
      f.live = true;
      f.born = performance.now();
      f.x = x;
      f.y = y;
      f.block.text = text;
      f.block.color = color ?? "#ffffff";
      f.block.isVisible = true;
    });

    ev.on("decal", ({ x, y, scale }) => {
      let d = this.decals[this.decalIdx % DECAL_POOL];
      if (!d) {
        const mesh = CreateDisc(`decal${this.decalIdx}`, { radius: 0.3, tessellation: 10 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.material = this.decalMat;
        mesh.isPickable = false;
        d = { mesh, born: 0 };
        this.decals.push(d);
      }
      this.decalIdx++;
      d.born = performance.now();
      const wp = simToWorld(x, y, 0.015 + groundHeightAt(x, y));
      d.mesh.unfreezeWorldMatrix();
      d.mesh.position.set(wp.x, wp.y, wp.z);
      d.mesh.scaling.setAll(Math.max(0.4, scale));
      d.mesh.rotation.y = Math.random() * Math.PI * 2;
      d.mesh.setEnabled(true);
      d.mesh.freezeWorldMatrix();
    });

    ev.on("banner", ({ text, color }) => this.toast(text, color));

    // Synthesized audio bridge — the sonic identity, unchanged (plan §6.4).
    ev.on("sound", ({ id }) => {
      const bank = sfx as unknown as Record<string, (() => void) | undefined>;
      const fn = bank[id];
      if (typeof fn === "function") fn.call(sfx);
    });
  }

  toast(text: string, color?: string): void {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      `color:${color ?? "#cfe6ff"};background:rgba(7,9,12,.78);padding:5px 12px;border-radius:6px;` +
      "border:1px solid rgba(42,58,74,.8);transition:opacity .6s;opacity:1;";
    this.toastHost.appendChild(el);
    while (this.toastHost.children.length > 4) this.toastHost.firstChild?.remove();
    setTimeout(() => (el.style.opacity = "0"), 2600);
    setTimeout(() => el.remove(), 3300);
  }

  /** Per-render-frame: poll sim arrays, interpolate, animate pools. */
  update(alpha: number, nowMs: number, px: number, py: number): void {
    const a = alpha;
    for (const e of this.hostiles.enemies) {
      const rig = this.enemies.get(e.id);
      if (!rig) continue;
      const ix = e.prevX + (e.x - e.prevX) * a;
      const iy = e.prevY + (e.y - e.prevY) * a;
      const wp = simToWorld(ix, iy, groundHeightAt(ix, iy), this.tmp);
      rig.root.position.set(wp.x, wp.y, wp.z);
      // Enemy.applySway port — per-class motion identity, verbatim numbers.
      const fast = e.family === "zombie_runner" || e.hasTrait("fast");
      const wide = e.def.movement === "crawler";
      let amp = wide ? 0.2 : fast ? 0.22 : 0.12;
      const freq = wide ? 0.006 : fast ? 0.022 : 0.008;
      if (e.def.movement === "stalker" && e.lastDist < 170) amp *= 0.5; // the creep
      const phaseRad = this.sim.now * freq + e.phase;
      const moving = e.speed() > 4;
      const lurchPause = e.def.movement === "lurcher" && this.sim.now % 850 >= 450;
      poseHumanoid(rig, e.facing, lurchPause ? 0 : phaseRad, moving && !lurchPause, Math.sin(phaseRad) * amp, 0, 0.55);
      rig.root.scaling.y = e.isStunned(this.sim.now) ? 0.85 : rig.root.scaling.y;
    }
    for (const an of this.hostiles.animals) {
      const rig = this.animals.get(an.id);
      if (!rig) continue;
      const ix = an.prevX + (an.x - an.prevX) * a;
      const iy = an.prevY + (an.y - an.prevY) * a;
      const wp = simToWorld(ix, iy, groundHeightAt(ix, iy), this.tmp);
      rig.root.position.set(wp.x, wp.y, wp.z);
      // Animal.update sway: ±0.14 fleeing / ±0.12 calm at now·0.02.
      const sway = Math.sin(nowMs * 0.02 + an.phase) * (an.fleeing ? 0.14 : 0.12);
      rig.root.rotation.y = -(an.facing + sway);
      rig.root.scaling.y = 1 + (an.speed() > 4 ? Math.sin(nowMs * 0.028 + an.phase) * 0.04 : 0);
    }
    this.fx.update();
    for (const p of this.combat.projectiles) {
      const m = this.projectiles.get(p.id);
      if (!m) continue;
      const wp = simToWorld(p.x, p.y, 0.9, this.tmp);
      m.position.set(wp.x, wp.y, wp.z);
      m.rotation.y = -p.angle;
    }
    for (const p of this.hostiles.enemyProjectiles) {
      const m = this.projectiles.get(p.id);
      if (!m) continue;
      const wp = simToWorld(p.x, p.y, 0.8, this.tmp);
      m.position.set(wp.x, wp.y, wp.z);
    }
    for (const [id, d] of this.drops) {
      const rec = this.dropsSys.drops.find((x) => x.id === id);
      if (!rec) continue;
      const bob = Math.sin((nowMs - d.born) * 0.004) * 0.06;
      const wp = simToWorld(rec.x, rec.y, 0.28 + bob + groundHeightAt(rec.x, rec.y), this.tmp);
      d.mesh.position.set(wp.x, wp.y, wp.z);
      d.mesh.rotation.y = (nowMs - d.born) * 0.0012;
    }

    // float text rise + fade (800ms)
    const cam = this.scene.activeCamera;
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    for (const f of this.floats) {
      if (!f.live || !cam) continue;
      const t = (nowMs - f.born) / 800;
      if (t >= 1) {
        f.live = false;
        f.block.isVisible = false;
        continue;
      }
      const wp = simToWorld(f.x, f.y, 1.6 + t * 0.9);
      this.tmp.set(wp.x, wp.y, wp.z);
      const p = Vector3.Project(this.tmp, IDENTITY, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      f.block.leftInPixels = p.x - w / 2;
      f.block.topInPixels = p.y - h / 2;
      f.block.alpha = 1 - t * t;
    }

    // decals fade out over 26s (cap recycles oldest)
    for (const d of this.decals) {
      const age = nowMs - d.born;
      if (age > 26000) d.mesh.setEnabled(false);
    }

    this.labels.update(px, py);
  }
}

const IDENTITY = Matrix.Identity();
