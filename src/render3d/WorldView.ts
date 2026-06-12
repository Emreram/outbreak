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
import { bloodProfileFor } from "../game/enemies/blood";
import { groundHeightAt, simToWorld, worldToSim } from "./space";
import { Labels } from "./Labels";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { FxTextures } from "./fx/FxTextures";
import { applyPose, applyQuadPose, buildHumanoid, buildQuadruped, lookOfZombie, poseCorpse, type HumanoidRig, type QuadRig } from "./actors/Blockout";
import { AnimController, newLocoInput, type Pose } from "./anim/AnimController";
import { HUMANOID_REGISTRY, QUAD_REGISTRY } from "./anim/actions";
import { footPlants, phaseFor } from "./anim/locomotion";
import { quadStrideRate } from "./anim/quadGait";
import { DEATH_DURATION, finalYawSpin, pickDeathVariant, sampleDeath, type DeathSample, type DeathVariant } from "./anim/deathTweens";
import { clamp01, easeInQuad, easeOutBack } from "./anim/easing";
import { CombatFx } from "./fx/CombatFx";

const FLOAT_POOL = 18;
const DECAL_POOL = 48;

/** Per-enemy view: rig + its animation controller (animation plan WS3). */
interface EnemyView {
  rig: HumanoidRig;
  ctrl: AnimController;
  /** The controller's reused pose object (re-applied on skipped LOD ticks). */
  pose: Readonly<Pose>;
  prevPhase: number;
}

/** Per-animal view (WS7): the stride phase accumulates per the engine/anim.ts
 *  idiom (dt · strideHz · speedFrac · 2π) so feet track ground speed. */
interface AnimalView {
  rig: QuadRig;
  ctrl: AnimController;
  phase: number;
}

/** A rig mid-death-tween (animation plan WS6) — ends exactly on poseCorpse. */
interface DyingRig {
  rig: HumanoidRig;
  recId: number;
  variant: DeathVariant;
  side: 1 | -1;
  startYaw: number;
  /** Start position (world m) → slides toward the corpse record position. */
  sx: number;
  sy: number;
  sz: number;
  /** Kill direction (unit, world X/Z plane) — the launch arc travels along it. */
  dirX: number;
  dirY: number;
  corpse: { x: number; y: number; z: number; simX: number; simY: number };
  t0: number;
  dusted: boolean;
}

const ANIMAL_POP_MS = 200;
const ANIMAL_DIE_MS = 400;

export class WorldView {
  readonly ui: AdvancedDynamicTexture;
  readonly fx: CombatFx;
  readonly fxTex: FxTextures;
  /** Optional shadow hookup (WS4): actor body meshes cast. */
  shadows: import("./env/ShadowDirector").ShadowDirector | null = null;
  private readonly labels: Labels;
  private readonly enemies = new Map<number, EnemyView>();
  private readonly animals = new Map<number, AnimalView>();
  private readonly locoInp = newLocoInput();
  private lastSimNow = 0;
  private lodFlip = false;
  /** Fallen rigs reposed in place (WS7) — keyed by corpse record id. */
  private readonly corpses = new Map<number, HumanoidRig>();
  /** Rigs mid-death-tween (WS6). */
  private readonly dying: DyingRig[] = [];
  private readonly deathScratch: DeathSample = { rotZFrac: 0, slide: 1, lift: 0, scaleY: 1, yawSpin: 0 };
  /** Animal pop-in / tip-over micro-tweens (WS6). yEnd settles a mid-hop
   *  kill back onto the ground while it keels. */
  private readonly animalFx: { rig: QuadRig; t0: number; kind: "pop" | "die"; yEnd?: number }[] = [];
  /** Hit-flash expiry per enemy id (WS7). */
  private readonly flashes = new Map<number, number>();
  private readonly drops = new Map<number, { mesh: Mesh; born: number; glow: Mesh; beam: Mesh | null; rank: number }>();
  private readonly projectiles = new Map<number, Mesh>();
  private readonly floats: { block: TextBlock; x: number; y: number; born: number; live: boolean }[] = [];
  private readonly decals: { mesh: Mesh; born: number }[] = [];
  private decalIdx = 0;
  private readonly toastHost: HTMLDivElement;
  private readonly tmp = new Vector3();
  private projMat: StandardMaterial;
  private acidMat: StandardMaterial;

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

    this.fxTex = new FxTextures(scene);
    this.fx = new CombatFx(scene, sim, hostiles, this.fxTex);
    this.bind();
  }

  private bind(): void {
    const ev = this.sim.events;

    ev.on("enemySpawned", ({ id }) => {
      const e = this.hostiles.enemies.find((x) => x.id === id);
      if (!e) return;
      const rig = buildHumanoid(this.scene, `enemy${id}`, lookOfZombie(e.def));
      this.shadows?.addActorCaster(rig.body);
      const ctrl = new AnimController(
        {
          kind: "humanoid",
          archetype: e.def.look.body,
          movement: e.def.movement,
          fast: e.family === "zombie_runner" || e.hasTrait("fast"),
          scale: e.def.scale,
          hash: e.phase / (Math.PI * 2),
        },
        HUMANOID_REGISTRY,
      );
      const view: EnemyView = { rig, ctrl, pose: ctrl.tick(0, this.locoInp), prevPhase: 0 };
      ctrl.play("spawn"); // claw-up out of the ground (WS6)
      this.enemies.set(id, view);
    });
    ev.on("enemyRemoved", ({ id, corpse, dirX, dirY, crit, explosive }) => {
      const v = this.enemies.get(id);
      this.enemies.delete(id);
      this.flashes.delete(id);
      if (!v) return;
      const rig = v.rig;
      this.shadows?.removeActorCaster(rig.body);
      if (corpse) {
        // The matching record is the newest one (kill-pipeline order): the
        // SAME rig animates its fall (WS6) and then becomes the corpse.
        const rec = this.hostiles.corpses[this.hostiles.corpses.length - 1];
        if (rec) {
          const wp = simToWorld(rec.x, rec.y, groundHeightAt(rec.x, rec.y), this.tmp);
          const hash = ((rec.id * 2654435761) >>> 16) % 1000 / 1000;
          const dl = Math.hypot(dirX ?? 0, dirY ?? 0);
          this.dying.push({
            rig,
            recId: rec.id,
            variant: pickDeathVariant({ crit, explosive, hash }),
            side: hash > 0.5 ? 1 : -1,
            startYaw: rig.root.rotation.y,
            sx: rig.root.position.x,
            sy: rig.root.position.y,
            sz: rig.root.position.z,
            dirX: dl > 0 ? (dirX as number) / dl : 0,
            dirY: dl > 0 ? (dirY as number) / dl : 0,
            corpse: { x: wp.x, y: wp.y, z: wp.z, simX: rec.x, simY: rec.y },
            t0: this.sim.now,
            dusted: false,
          });
          return;
        }
      }
      rig.dispose();
    });

    ev.on("animalSpawned", ({ id }) => {
      const a = this.hostiles.animals.find((x) => x.id === id);
      if (!a) return;
      const body = a.def.kind === "rabbit" ? 0xd8c8b0 : a.def.kind === "deer" ? 0xa97a4a : 0x6b5236;
      const head = a.def.kind === "deer" ? 0x8a5f38 : undefined;
      const rig = buildQuadruped(this.scene, `animal${id}`, body, a.def.scale, head);
      this.shadows?.addActorCaster(rig.body);
      rig.root.scaling.setAll(0.01);
      this.animalFx.push({ rig, t0: this.sim.now, kind: "pop" }); // pop-in (WS6)
      const ctrl = new AnimController(
        { kind: "quad", archetype: a.def.kind, scale: a.def.scale, hash: a.phase / (Math.PI * 2) },
        QUAD_REGISTRY,
      );
      this.animals.set(id, { rig, ctrl, phase: a.phase });
    });
    ev.on("animalRemoved", ({ id, killed }) => {
      const v = this.animals.get(id);
      this.animals.delete(id);
      if (!v) return;
      this.shadows?.removeActorCaster(v.rig.body);
      const popping = this.animalFx.findIndex((f) => f.rig === v.rig);
      if (popping >= 0) this.animalFx.splice(popping, 1); // died mid-pop
      if (killed) {
        // tip-over then dispose; a mid-hop kill settles back to the ground
        const sp = worldToSim(v.rig.root.position.x, v.rig.root.position.z);
        this.animalFx.push({ rig: v.rig, t0: this.sim.now, kind: "die", yEnd: groundHeightAt(sp.x, sp.y) });
      } else v.rig.dispose();
    });

    ev.on("corpseFaded", ({ id }) => {
      const mid = this.dying.findIndex((d) => d.recId === id);
      if (mid >= 0) {
        this.dying[mid].rig.dispose(); // raced the tween — finish instantly
        this.dying.splice(mid, 1);
        return;
      }
      this.corpses.get(id)?.dispose();
      this.corpses.delete(id);
    });

    // Hit-flash (WS7) + stagger (WS5): the struck rig pulses and recoils
    // along the impact direction.
    ev.on("splat", ({ enemyId, dirX, dirY, power }) => {
      if (enemyId !== undefined && this.enemies.has(enemyId)) {
        this.flashes.set(enemyId, performance.now() + 90);
        this.enemies.get(enemyId)!.ctrl.play("stagger", { dirX, dirY, power });
      }
    });
    // Enemy reaction one-shots (WS5) on the additive sim telegraphs.
    ev.on("enemyAttack", ({ id }) => this.enemies.get(id)?.ctrl.play("enemy_lunge"));
    ev.on("enemySpit", ({ id }) => this.enemies.get(id)?.ctrl.play("spit"));
    ev.on("screamRing", ({ id }) => {
      if (id !== undefined) this.enemies.get(id)?.ctrl.play("scream");
    });

    ev.on("dropSpawned", ({ id }) => {
      const d = this.dropsSys.drops.find((x) => x.id === id);
      if (!d) return;
      const meta = RARITY_META[defOf(d.item).rarity];
      const mesh = CreateBox(`drop${id}`, { size: 0.22 }, this.scene);
      const mat = new StandardMaterial(`drop${id}m`, this.scene);
      mat.diffuseColor = Color3.FromHexString("#d8d2c4");
      mat.emissiveColor = Color3.FromHexString(meta.css).scale(0.55);
      mat.specularColor = Color3.Black();
      mesh.material = mat;
      mesh.isPickable = false;
      // rarity glow pool under the drop (WS8) — bloom carries it at night
      const glow = CreatePlane(`drop${id}g`, { size: 1 }, this.scene);
      glow.rotation.x = Math.PI / 2;
      glow.material = this.fxTex.additive("glow", meta.css, 0.4 + meta.rank * 0.06);
      glow.isPickable = false;
      // epic+ earns the vertical beacon beam
      let beam: Mesh | null = null;
      if (meta.rank >= 3) {
        beam = CreatePlane(`drop${id}b`, { width: 0.5, height: 2.2 }, this.scene);
        beam.material = this.fxTex.additive("beam", meta.css, 0.4);
        beam.billboardMode = Mesh.BILLBOARDMODE_Y;
        beam.isPickable = false;
      }
      this.drops.set(id, { mesh, born: performance.now(), glow, beam, rank: meta.rank });
    });
    ev.on("dropRemoved", ({ id }) => {
      const d = this.drops.get(id);
      if (d) {
        d.mesh.material?.dispose();
        d.mesh.dispose();
        d.glow.dispose();
        d.beam?.dispose();
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

    ev.on("decal", ({ x, y, scale, enemyId }) => {
      let d = this.decals[this.decalIdx % DECAL_POOL];
      if (!d) {
        const mesh = CreatePlane(`decal${this.decalIdx}`, { size: 1 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.isPickable = false;
        d = { mesh, born: 0 };
        this.decals.push(d);
      }
      this.decalIdx++;
      d.born = performance.now();
      // the SPLAT texture in the striker's blood colour (gore identity, WS8)
      const e = enemyId !== undefined ? this.hostiles.enemies.find((q) => q.id === enemyId) : undefined;
      const pool = e ? bloodProfileFor(e.def).pool : 0x4a1114;
      d.mesh.material = this.fxTex.decal("splat", pool, 0.82);
      const wp = simToWorld(x, y, 0.02 + groundHeightAt(x, y));
      d.mesh.position.set(wp.x, wp.y, wp.z);
      d.mesh.scaling.setAll(Math.max(0.5, scale) * (0.85 + Math.random() * 0.5));
      d.mesh.rotation.y = Math.random() * Math.PI * 2;
      d.mesh.visibility = 1;
      d.mesh.setEnabled(true);
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
    const simDt = this.sim.now - this.lastSimNow;
    this.lastSimNow = this.sim.now;
    this.lodFlip = !this.lodFlip;
    for (const e of this.hostiles.enemies) {
      const v = this.enemies.get(e.id);
      if (!v) continue;
      const ix = e.prevX + (e.x - e.prevX) * a;
      const iy = e.prevY + (e.y - e.prevY) * a;
      const wp = simToWorld(ix, iy, groundHeightAt(ix, iy), this.tmp);
      // Locomotion inputs from the public sim surface (parity table lives in
      // anim/locomotion.ts). Far rigs tick at half rate and reuse their pose.
      const inp = this.locoInp;
      inp.timeMs = this.sim.now;
      inp.phaseRad = phaseFor(v.ctrl.spec, this.sim.now);
      inp.moving = e.speed() > 4;
      inp.speedFrac = Math.min(1.2, e.speed() / Math.max(1, e.def.speed));
      inp.sprintFrac = 0;
      inp.stunned = e.isStunned(this.sim.now);
      inp.creep = e.def.movement === "stalker" && e.lastDist < 170;
      inp.pauseGather = e.def.movement === "lurcher" && this.sim.now % 850 >= 450;
      // stance priority: stun > leap > knockback tumble > none (WS5)
      const leaping = e.isLeaping(this.sim.now);
      const fwdX = Math.cos(e.facing);
      const fwdY = Math.sin(e.facing);
      const tumbling =
        !leaping && e.speed() > e.def.speed * 1.8 && e.vx * fwdX + e.vy * fwdY < 0;
      v.ctrl.setStance(inp.stunned ? "dizzy" : leaping ? "leap_stretch" : tumbling ? "tumble" : null);
      const far = Math.hypot(ix - px, iy - py) > 900;
      if (!far || this.lodFlip) v.pose = v.ctrl.tick(far ? simDt * 2 : simDt, inp);
      v.rig.root.position.set(wp.x, wp.y, wp.z);
      applyPose(v.rig, v.pose, e.facing);
      // footstep dust at plant moments (near, actually striding)
      const plant = footPlants(v.prevPhase, inp.phaseRad);
      v.prevPhase = inp.phaseRad;
      if (plant !== 0 && inp.moving && inp.speedFrac > 0.5 && !far) this.fx.dust(ix, iy, 1);
    }
    // hit-flash decay (WS7)
    if (this.flashes.size > 0) {
      for (const [id, until] of this.flashes) {
        const v = this.enemies.get(id);
        if (!v) {
          this.flashes.delete(id);
          continue;
        }
        const left = until - nowMs;
        if (left <= 0) {
          v.rig.bodyMat.emissiveColor.set(0, 0, 0);
          this.flashes.delete(id);
        } else {
          const k = (left / 90) * 0.85;
          v.rig.bodyMat.emissiveColor.set(k, k, k);
        }
      }
    }
    for (const an of this.hostiles.animals) {
      const v = this.animals.get(an.id);
      if (!v) continue;
      const ix = an.prevX + (an.x - an.prevX) * a;
      const iy = an.prevY + (an.y - an.prevY) * a;
      const wp = simToWorld(ix, iy, groundHeightAt(ix, iy), this.tmp);
      // Real gaits (WS7): bound/gallop/trot off the accumulated stride phase
      // (dt · strideHz · speedFrac · 2π — the engine/anim.ts idiom). The 2D
      // yaw-sway parity (±0.14 flee / ±0.12 calm) lives in sampleQuadGait.
      const speedFrac = Math.min(1.2, an.speed() / Math.max(1, an.def.speed));
      v.phase += (simDt / 1000) * quadStrideRate(an.def.kind, an.fleeing) * Math.PI * 2 * speedFrac;
      const inp = this.locoInp;
      inp.timeMs = this.sim.now;
      inp.phaseRad = v.phase;
      inp.moving = an.speed() > 4;
      inp.speedFrac = speedFrac;
      inp.sprintFrac = an.fleeing ? 1 : 0;
      const pose = v.ctrl.tick(simDt, inp);
      v.rig.root.position.set(wp.x, wp.y, wp.z);
      applyQuadPose(v.rig, pose, an.facing);
    }
    this.tickDying();
    this.tickAnimalFx();
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
      const g = groundHeightAt(rec.x, rec.y);
      const bob = Math.sin((nowMs - d.born) * 0.004) * 0.06;
      const wp = simToWorld(rec.x, rec.y, 0.28 + bob + g, this.tmp);
      d.mesh.position.set(wp.x, wp.y, wp.z);
      d.mesh.rotation.y = (nowMs - d.born) * 0.0012;
      d.glow.position.set(wp.x, g + 0.03, wp.z);
      const pulse = (0.55 + d.rank * 0.22) * (1 + Math.sin((nowMs - d.born) * 0.003) * 0.12);
      d.glow.scaling.setAll(pulse);
      if (d.beam) d.beam.position.set(wp.x, g + 1.1, wp.z);
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

    // decals: hold 9s, fade to nothing by 26s (Phaser decal-pool timings)
    for (const d of this.decals) {
      const age = nowMs - d.born;
      if (age > 26000) d.mesh.setEnabled(false);
      else if (age > 9000) d.mesh.visibility = 1 - (age - 9000) / 17000;
    }

    this.labels.update(px, py);
  }

  /** Death tweens (WS6) on sim time — hitstop/pause freeze the fall. Each
   *  tween's t=1 channels equal poseCorpse exactly (asserted via DEATH_END in
   *  tests), so the corpses-map handover below is seamless. */
  private tickDying(): void {
    if (this.dying.length === 0) return;
    const s = this.deathScratch;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      const t = (this.sim.now - d.t0) / DEATH_DURATION[d.variant];
      if (t >= 1) {
        // hand over to the corpse pool at the EXACT record position (search
        // targeting stays honest); launch bakes its tumble into the final yaw
        poseCorpse(d.rig, d.corpse.x, d.corpse.y, d.corpse.z, d.side, d.startYaw + finalYawSpin(d.variant));
        this.corpses.set(d.recId, d.rig);
        this.dying.splice(i, 1);
        continue;
      }
      sampleDeath(d.variant, t, s);
      const r = d.rig.root;
      r.rotation.y = d.startYaw + s.yawSpin;
      r.rotation.z = d.side * (Math.PI / 2) * s.rotZFrac;
      r.scaling.y = s.scaleY;
      // the launch arc travels along the kill direction in step with its lift
      const fling = s.lift * 1.6;
      r.position.x = d.sx + (d.corpse.x - d.sx) * s.slide + d.dirX * fling;
      r.position.z = d.sz + (d.corpse.z - d.sz) * s.slide + d.dirY * fling;
      // the corpse root rides 0.16 above ground (poseCorpse) — raise it as the
      // body rolls flat so there's no pop at either end
      r.position.y = d.sy + (d.corpse.y + 0.16 - d.sy) * s.rotZFrac + s.lift;
      if (!d.dusted && t >= 0.78) {
        d.dusted = true;
        this.fx.dust(d.corpse.simX, d.corpse.simY, 3); // ground-contact puff
      }
    }
  }

  /** Animal micro-tweens (WS6): spawn pop-in scale and tip-over death. */
  private tickAnimalFx(): void {
    if (this.animalFx.length === 0) return;
    for (let i = this.animalFx.length - 1; i >= 0; i--) {
      const f = this.animalFx[i];
      const t = (this.sim.now - f.t0) / (f.kind === "pop" ? ANIMAL_POP_MS : ANIMAL_DIE_MS);
      if (t >= 1) {
        if (f.kind === "pop") f.rig.root.scaling.setAll(1);
        else f.rig.dispose(); // loot pop + blood carry the beat past this
        this.animalFx.splice(i, 1);
        continue;
      }
      if (f.kind === "pop") {
        const k = 0.01 + 0.99 * easeOutBack(clamp01(t));
        f.rig.root.scaling.set(k, k, k);
      } else {
        // keel onto the side (roll about the body's forward axis), settling
        // any mid-hop height back onto the ground
        const e = easeInQuad(clamp01(t));
        f.rig.root.rotation.x = (Math.PI / 2) * e;
        if (f.yEnd !== undefined) f.rig.root.position.y += (f.yEnd - f.rig.root.position.y) * e;
      }
    }
  }
}

const IDENTITY = Matrix.Identity();
