// Player combat (extracted from WorldScene: meleeAttack / fire / projectiles /
// reload) — identical resolution: meleeOutcome/shotOutcome from game/combat.ts,
// stamina 6 per swing (gate < 4), cleave = 1 + cleave extra targets, execute
// threshold on hp%, default 90 knockback stagger, pellets jitter ±spread (or
// ±0.025 single), projectile life = min(2s, range/speed), pierce decrements,
// explosive AoE at ×0.7 damage, reload from calibre reserves. Projectiles are
// swept against the solid grid (master plan §3.4) — in the Phaser build walls
// stop shots via colliders; here traceSegment does it bit-stably.

import { clampStat } from "../../game/GameState";
import { BALLISTIC_CLASSES, meleeOutcome, shotOutcome, type MeleeHit, type ShotPlan } from "../../game/combat";
import { ammoReserve, equippedRangedDef, reloadEquipped } from "../../game/inventory";
import { meleeStyleFor } from "../../engine/anim";
import { liveRng } from "../../game/rng";
import { traceSegment } from "../physics";
import type { EnemySim } from "../entities/EnemySim";
import type { Sim, SimSystem } from "../Sim";
import type { HostilesSystem } from "./hostiles";

export interface PlayerProj {
  id: number;
  kind: "bullet" | "pellet" | "arrow" | "rocket";
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  angle: number;
  speed: number;
  diesAt: number;
  damage: number;
  pierce: number;
  knockback: number;
  bleed: number;
  bleedMs: number;
  stunMs: number;
  burn: number;
  explosive: number;
  executePct: number;
  crit: boolean;
  dirX: number;
  dirY: number;
  hits: Set<number>; // enemy ids already struck (pierce bookkeeping)
}

let seq = 1;

function projKind(wclass: string): PlayerProj["kind"] {
  if (wclass === "shotgun") return "pellet";
  if (wclass === "bow" || wclass === "crossbow") return "arrow";
  if (wclass === "launcher") return "rocket";
  return "bullet";
}

export class CombatSystem implements SimSystem {
  readonly id = "combat";
  readonly projectiles: PlayerProj[] = [];
  firing = false;
  reloading = false;
  private lastMelee = -99999;
  private lastShot = -99999;
  private reloadDoneAt = -1;

  // --- melee --------------------------------------------------------------------

  meleeAttack(sim: Sim): void {
    if (sim.dead || sim.paused || sim.driving || sim.riding) return;
    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    const hit = meleeOutcome(sim.state, liveRng);
    if (sim.now - this.lastMelee < hit.cooldownMs || sim.state.player.stamina < 4) return;
    this.lastMelee = sim.now;
    sim.state.player.stamina = clampStat(sim.state.player.stamina - 6);
    sim.events.emit("sound", { id: "swing" });
    const px = sim.player.x;
    const py = sim.player.y;
    sim.events.emit("impulse", { kind: "shake", amount: 0.1 });
    sim.events.emit("swing", { x: px, y: py, facing: sim.player.facing, style: meleeStyleFor(hit.wclass) });
    hostiles.huntNearbyAnimal(sim, hit.range + 16, hit.damage);

    const targets = hostiles.enemies
      .map((e) => ({ e, d: Math.hypot(e.x - px, e.y - py) }))
      .filter((t) => t.d <= hit.range + 16)
      .sort((a, b) => a.d - b.d);
    if (targets.length === 0) return;

    const maxTargets = 1 + Math.max(0, hit.cleave);
    let healed = 0;
    for (let i = 0; i < targets.length && i < maxTargets; i++) {
      this.applyMeleeHit(sim, hostiles, targets[i].e, hit, px, py);
      healed += hit.lifestealHp;
    }
    if (healed > 0) sim.state.player.hp = clampStat(sim.state.player.hp + healed);
  }

  private applyMeleeHit(sim: Sim, hostiles: HostilesSystem, e: EnemySim, hit: MeleeHit, px: number, py: number): void {
    const execute = hit.executePct > 0 && e.hpFrac() * 100 <= hit.executePct;
    const dmg = execute ? e.hp : hit.damage;
    const dead = e.takeDamage(dmg, sim.now);
    const len = Math.hypot(e.x - px, e.y - py) || 1;
    const ndir = { x: (e.x - px) / len, y: (e.y - py) / len };
    sim.events.emit("splat", {
      x: e.x, y: e.y, dirX: ndir.x, dirY: ndir.y,
      power: hit.crit ? 1.6 : execute ? 1.5 : dead ? 1.3 : 1,
      enemyId: e.id,
    });
    sim.events.emit("decal", { x: e.x, y: e.y, scale: hit.crit ? 1.2 : 0.85, enemyId: e.id });
    sim.events.emit("floatText", {
      x: e.x, y: e.y,
      text: execute ? "EXECUTE" : String(Math.round(dmg)),
      color: hit.crit ? "#ffd23f" : execute ? "#ff5a6e" : "#ffffff",
    });
    if (hit.crit && !execute) sim.events.emit("floatText", { x: e.x, y: e.y - 13, text: "CRIT!", color: "#ffd23f" });
    if (hit.bleed > 0) e.applyDot(hit.bleed, hit.bleedMs, sim.now);
    if (hit.stunMs > 0) e.applyStun(hit.stunMs, sim.now);
    e.knockback(ndir.x, ndir.y, hit.knockback > 0 ? hit.knockback : 90, sim.now);
    if (hit.crit || execute) {
      sim.events.emit("impulse", { kind: "shake", amount: 0.2 });
      sim.events.emit("impulse", { kind: "zoomPunch", amount: 0.5 });
    }
    if (dead) {
      sim.hitstop(hit.crit || execute ? 95 : 60);
      hostiles.onEnemyKilled(sim, e, { dir: ndir, crit: hit.crit || execute });
    }
  }

  // --- ranged --------------------------------------------------------------------

  /** One trigger pull toward `angle` (auto-fire calls this while held). */
  fire(sim: Sim, angle: number): void {
    if (sim.dead || sim.paused || this.reloading || sim.driving || sim.riding) return;
    const plan = shotOutcome(sim.state, liveRng);
    if (!plan) return; // no gun equipped
    if (sim.now - this.lastShot < plan.cooldownMs) return;
    if ((sim.state.loadedAmmo ?? 0) <= 0) {
      this.tryReload(sim);
      return;
    }
    this.lastShot = sim.now;
    sim.state.loadedAmmo = (sim.state.loadedAmmo ?? 0) - 1;
    sim.events.emit("sound", { id: "shot" });
    const px = sim.player.x;
    const py = sim.player.y;
    sim.events.emit("muzzle", { x: px, y: py, angle });
    sim.events.emit("impulse", { kind: "shake", amount: 0.07 });
    if (BALLISTIC_CLASSES.has(plan.weapon.wclass)) sim.events.emit("casing", { x: px, y: py, angle });
    const pellets = Math.max(1, plan.pellets);
    for (let i = 0; i < pellets; i++) {
      const jitter = pellets > 1 ? (Math.random() - 0.5) * plan.spread * 2 : (Math.random() - 0.5) * 0.05;
      this.spawnProjectile(sim, px, py, angle + jitter, plan);
    }
    if ((sim.state.loadedAmmo ?? 0) <= 0) this.tryReload(sim);
  }

  /** Mobile auto-aim fire: shoot toward the nearest enemy. */
  fireAuto(sim: Sim): void {
    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    const e = hostiles.nearestEnemy(sim, 620);
    const angle = e ? Math.atan2(e.y - sim.player.y, e.x - sim.player.x) : sim.player.facing;
    this.fire(sim, angle);
  }

  private spawnProjectile(sim: Sim, px: number, py: number, angle: number, plan: ShotPlan): void {
    const p: PlayerProj = {
      id: seq++,
      kind: projKind(plan.weapon.wclass),
      x: px + Math.cos(angle) * 16,
      y: py + Math.sin(angle) * 16,
      prevX: px,
      prevY: py,
      angle,
      speed: plan.speed,
      diesAt: sim.now + Math.min(2000, (plan.range / plan.speed) * 1000),
      damage: plan.damage,
      pierce: plan.pierce,
      knockback: plan.knockback,
      bleed: plan.bleed,
      bleedMs: plan.bleedMs,
      stunMs: plan.stunMs,
      burn: plan.burn,
      explosive: plan.explosive,
      executePct: plan.executePct,
      crit: plan.crit,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      hits: new Set(),
    };
    this.projectiles.push(p);
    sim.events.emit("projectileSpawned", { id: p.id, kind: p.kind });
  }

  tick(sim: Sim, dt: number): void {
    // Held trigger auto-fire (desktop pointer) / touch auto-aim handled by view calls.
    if (this.firing && !sim.paused) this.fire(sim, sim.input.aim ?? sim.player.facing);

    // Reload completion timer.
    if (this.reloading && sim.now >= this.reloadDoneAt) {
      this.reloading = false;
      if (!sim.dead) {
        reloadEquipped(sim.state);
        sim.events.emit("sound", { id: "reload" });
      }
    }

    const hostiles = sim.getSystem<HostilesSystem>("hostiles")!;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.prevX = p.x;
      p.prevY = p.y;
      if (sim.now >= p.diesAt) {
        this.kill(sim, i, p);
        continue;
      }
      const step = p.speed * dt;
      // Walls stop shots (swept, so fast rounds can't skip a wall tile).
      const wall = traceSegment(sim.world, p.x, p.y, p.angle, step);
      if (wall.hit) {
        p.x = wall.x;
        p.y = wall.y;
        if (p.explosive > 0) this.explode(sim, hostiles, p.x, p.y, p);
        this.kill(sim, i, p);
        continue;
      }
      p.x += p.dirX * step;
      p.y += p.dirY * step;

      // Enemy sweep: nearest body within this step's segment.
      let died = false;
      for (const e of hostiles.enemies) {
        if (p.hits.has(e.id)) continue;
        if (segmentNear(p.prevX, p.prevY, p.x, p.y, e.x, e.y, e.body / 2 + 4)) {
          p.hits.add(e.id);
          this.applyShotHit(sim, hostiles, e, p);
          if (p.explosive > 0) {
            this.explode(sim, hostiles, p.x, p.y, p);
            this.kill(sim, i, p);
            died = true;
            break;
          }
          p.pierce -= 1;
          if (p.pierce < 0) {
            this.kill(sim, i, p);
            died = true;
            break;
          }
        }
      }
      if (died) continue;
      // Ranged hunting: animals stop arrows/bullets too.
      for (const a of [...hostiles.animals]) {
        if (segmentNear(p.prevX, p.prevY, p.x, p.y, a.x, a.y, a.body / 2 + 4)) {
          sim.events.emit("splat", { x: a.x, y: a.y, power: 0.8 });
          if (a.takeDamage(p.damage)) hostiles.killAnimal(sim, a);
          this.kill(sim, i, p);
          break;
        }
      }
    }
  }

  private applyShotHit(sim: Sim, hostiles: HostilesSystem, e: EnemySim, p: PlayerProj): void {
    const execute = p.executePct > 0 && e.hpFrac() * 100 <= p.executePct;
    const dmg = execute ? e.hp : p.damage;
    const dead = e.takeDamage(dmg, sim.now);
    sim.events.emit("splat", {
      x: e.x, y: e.y, dirX: p.dirX, dirY: p.dirY,
      power: p.crit ? 1.5 : execute ? 1.4 : dead ? 1.3 : 1,
      enemyId: e.id,
    });
    sim.events.emit("decal", { x: e.x, y: e.y, scale: p.crit ? 1.0 : 0.7, enemyId: e.id });
    sim.events.emit("floatText", {
      x: e.x, y: e.y,
      text: execute ? "EXECUTE" : String(Math.round(dmg)),
      color: p.crit ? "#ffd23f" : execute ? "#ff5a6e" : "#ffffff",
    });
    if (p.crit && !execute) sim.events.emit("floatText", { x: e.x, y: e.y - 13, text: "CRIT!", color: "#ffd23f" });
    if (p.bleed > 0) e.applyDot(p.bleed, p.bleedMs, sim.now);
    if (p.burn > 0) e.applyDot(p.burn, 3000, sim.now);
    if (p.stunMs > 0) e.applyStun(p.stunMs, sim.now);
    if (p.knockback > 0) e.knockback(p.dirX, p.dirY, p.knockback, sim.now);
    if (dead) hostiles.onEnemyKilled(sim, e, { dir: { x: p.dirX, y: p.dirY }, crit: p.crit });
  }

  private explode(sim: Sim, hostiles: HostilesSystem, x: number, y: number, p: PlayerProj): void {
    sim.events.emit("sound", { id: "boom" });
    sim.events.emit("impulse", { kind: "shake", amount: 0.4 });
    sim.events.emit("explosion", { x, y, radius: p.explosive });
    for (const e of [...hostiles.enemies]) {
      if (p.hits.has(e.id)) continue;
      if (Math.hypot(e.x - x, e.y - y) <= p.explosive) {
        const dead = e.takeDamage(Math.round(p.damage * 0.7), sim.now);
        if (p.burn > 0) e.applyDot(p.burn, 3000, sim.now);
        const bdir = { x: e.x - x, y: e.y - y };
        if (dead) hostiles.onEnemyKilled(sim, e, { dir: bdir, explosive: true });
        else {
          sim.events.emit("splat", { x: e.x, y: e.y, dirX: bdir.x, dirY: bdir.y, power: 1.2, enemyId: e.id });
          sim.events.emit("decal", { x: e.x, y: e.y, scale: 0.7, enemyId: e.id });
        }
      }
    }
  }

  private kill(sim: Sim, index: number, p: PlayerProj): void {
    this.projectiles.splice(index, 1);
    sim.events.emit("projectileKilled", { id: p.id, x: p.x, y: p.y });
  }

  tryReload(sim: Sim): void {
    if (this.reloading) return;
    const w = equippedRangedDef(sim.state);
    if (!w) return;
    if ((sim.state.loadedAmmo ?? 0) >= (w.magSize ?? 0)) return;
    if (ammoReserve(sim.state, w.ammoType) <= 0) {
      sim.events.emit("banner", { text: "No ammo in reserve" });
      return;
    }
    this.reloading = true;
    this.reloadDoneAt = sim.now + (w.reloadMs ?? 1800);
    sim.events.emit("sound", { id: "reload" });
    sim.events.emit("banner", { text: "Reloading…" });
  }
}

/** Distance from point C to segment AB ≤ r? (projectile sweep vs round body) */
function segmentNear(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((cx - ax) * abx + (cy - ay) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = ax + abx * t - cx;
  const dy = ay + aby * t - cy;
  return dx * dx + dy * dy <= r * r;
}
