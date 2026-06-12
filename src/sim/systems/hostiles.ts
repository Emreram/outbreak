// Enemies + animals + the kill pipeline (extracted from WorldScene per the
// master plan M1) — spawn cadences, the noise model, terrain effects on the
// dead, contact damage, special attacks (spitter/electric/screamer), death
// traits (exploder/splitter/bloated), toxic clouds, enemy projectiles, loot
// drops, corpse records, and player damage with armor/perk mitigation.
// Every constant is the Phaser oracle's: noise 45 move / 70 sprint / 80 night
// / 35 dusk / 240 engine / SEARCH_NOISE rummage; enemy cap 40 (80 blood moon);
// ambient cadence 26–56s scaled by day/night/storm/blood-moon; bite 28% at
// +8..16 infection; exploder r=84; clouds 42px r ticking 600ms.

import { clampStat, isDead, pushRecentEvent } from "../../game/GameState";
import { liveRng } from "../../game/rng";
import { Tile } from "../../game/world/tiles";
import { TILE_SIZE } from "../../game/constants";
import { armorDefensePct } from "../../game/inventory";
import { damageTakenMult, lootLuck, type DamageKind } from "../../game/perks";
import { addXp } from "../../game/skills";
import { SKILL_NAMES, type SkillId } from "../../game/skills";
import { getZombie } from "../../game/enemies/catalog";
import { rollZombie, resetSpawnVariety } from "../../game/enemies/spawnTable";
import type { ZombieDef } from "../../game/enemies/types";
import { rollLoot } from "../../game/items/lootTables";
import { rollReadable } from "../../game/notes";
import { nextAmbientDelayMs } from "../../game/encounters";
import { ANIMALS, AnimalSim, type AnimalKind } from "../entities/AnimalSim";
import { EnemySim } from "../entities/EnemySim";
import type { Sim, SimSystem } from "../Sim";
import type { ClockSystem } from "./clock";
import type { DropsSystem } from "./drops";
import type { ScavengeSystem } from "./scavenge";

export interface SpawnReq {
  type: "zombie" | "zombie_runner" | "survivor_hostile" | "survivor_friendly";
  count: number;
}

export interface CorpseRec {
  id: number;
  x: number;
  y: number;
  defId: string;
  searched: boolean;
  diesAt: number;
}

export interface EnemyProj {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  poison: boolean;
  diesAt: number;
}

interface Cloud {
  x: number;
  y: number;
  r: number;
  until: number;
  last: number;
}

export interface DeathCtx {
  dir?: { x: number; y: number };
  crit?: boolean;
  explosive?: boolean;
  vehicle?: boolean;
}

const ANIMAL_BIOMES = new Set(["forest", "dense_woods", "grassland", "farmland", "parkland", "riverbank", "marsh", "coast"]);

let projSeq = 1;
let corpseSeq = 1;

export class HostilesSystem implements SimSystem {
  readonly id = "hostiles";
  readonly enemies: EnemySim[] = [];
  readonly animals: AnimalSim[] = [];
  readonly corpses: CorpseRec[] = [];
  readonly enemyProjectiles: EnemyProj[] = [];
  private readonly clouds: Cloud[] = [];
  kills = 0;

  /** Cadence state — public so headless tests can pin the schedule. */
  ambientAcc = 0;
  ambientDelay = 8000; // first wave comes fairly soon, like a fresh scene
  animalAcc = 0;
  animalDelay = 9000;
  private corpseAcc = 0;

  constructor() {
    resetSpawnVariety();
  }

  // --- shared damage / XP ------------------------------------------------------

  grantXp(sim: Sim, id: SkillId, amount: number): void {
    if (addXp(sim.state, id, amount) > 0) {
      sim.events.emit("banner", { text: `${SKILL_NAMES[id]} level up!` });
      sim.events.emit("sound", { id: "ui" });
    }
  }

  /** Apply damage to the player (contact, acid, explosions, clouds) with the
   *  armor + perk mitigation and all the feel events. */
  damagePlayer(sim: Sim, rawDmg: number, bite: boolean, msg: string, kind: DamageKind = "physical"): void {
    if (sim.dead) return;
    sim.getSystem<ScavengeSystem>("scavenge")?.cancelSearch(sim); // a hit interrupts rummaging
    const p = sim.state.player;
    const dmg = Math.max(1, Math.round(rawDmg * (1 - armorDefensePct(sim.state) / 100) * damageTakenMult(sim.state, kind)));
    p.hp = clampStat(p.hp - dmg);
    if (bite) p.infection = clampStat(p.infection + liveRng.int(8, 16));
    pushRecentEvent(sim.state, msg);
    sim.events.emit("sound", { id: "hurt" });
    sim.events.emit("splat", { x: sim.player.x, y: sim.player.y, power: 0.8 });
    sim.events.emit("decal", { x: sim.player.x, y: sim.player.y, scale: 0.7 });
    sim.events.emit("floatText", { x: sim.player.x, y: sim.player.y, text: `-${dmg}`, color: "#ff6b6b" });
    sim.events.emit("impulse", { kind: "hurtPulse", amount: Math.min(0.82, 0.32 + dmg / 55) });
    sim.events.emit("impulse", { kind: "shake", amount: 0.25 });
    if (isDead(sim.state)) sim.enterDeath(p.infection >= 100 ? "The infection took hold." : msg);
  }

  // --- spawning -----------------------------------------------------------------

  enemyCap(sim: Sim): number {
    return sim.state.bloodMoon ? 80 : 40;
  }

  /** Effective danger driver: day + local distance/biome tier (+2 blood moon). */
  effDay(sim: Sim): number {
    return sim.state.day + sim.world.dangerTier(sim.player.x, sim.player.y) + (sim.state.bloodMoon ? 2 : 0);
  }

  spawnEnemy(sim: Sim, def: ZombieDef, x: number, y: number): EnemySim | null {
    if (this.enemies.length >= this.enemyCap(sim)) return null;
    const e = new EnemySim(x, y, def);
    this.enemies.push(e);
    sim.events.emit("enemySpawned", { id: e.id });
    return e;
  }

  spawnNear(sim: Sim, spawns: SpawnReq[]): void {
    const ptx = Math.floor(sim.player.x / TILE_SIZE);
    const pty = Math.floor(sim.player.y / TILE_SIZE);
    const day = this.effDay(sim);
    for (const s of spawns) {
      for (let i = 0; i < s.count; i++) {
        const tile = sim.world.walkableNear(ptx, pty, 3, 8);
        if (tile) this.spawnEnemy(sim, rollZombie(s.type, liveRng, day, sim.world.biomeAtPx(tile.x, tile.y)), tile.x, tile.y);
      }
    }
  }

  /** Time to the next ambient threat — rare early, relentless on a blood moon. */
  private scheduleAmbientMs(sim: Sim, clock: ClockSystem): number {
    const base = nextAmbientDelayMs();
    const day = this.effDay(sim);
    const dayFactor = day === 0 ? 1.5 : 1 / (1 + day * 0.12);
    const bloodFactor = sim.state.bloodMoon ? 0.35 : 1;
    return base * dayFactor * (clock.isNight(sim) ? 0.6 : 1) * (sim.state.weather === "storm" ? 0.7 : 1) * bloodFactor;
  }

  private ambientEvent(sim: Sim, clock: ClockSystem): void {
    const day = this.effDay(sim);
    const bloodMoon = !!sim.state.bloodMoon;
    const extra = sim.state.difficultyModifier > 1.15 ? 1 : 0;
    const dayBonus = Math.floor(day / 3);
    const surge = bloodMoon ? liveRng.int(4, 6) : 0;
    const n = Math.min(liveRng.int(1, 2) + extra + dayBonus + surge, bloodMoon ? 14 : 6);
    const runnerChance = bloodMoon ? 0.7 : clock.isNight(sim) ? 0.32 : 0.12 + day * 0.02;
    const kind: SpawnReq["type"] = Math.random() < runnerChance ? "zombie_runner" : "zombie";
    this.spawnNear(sim, [{ type: kind, count: n }]);
    if (!bloodMoon) sim.events.emit("banner", { text: "You hear shuffling nearby…" });
  }

  private spawnWildAnimals(sim: Sim): void {
    if (this.animals.length >= 8) return;
    if (!ANIMAL_BIOMES.has(sim.world.biomeAtPx(sim.player.x, sim.player.y))) return;
    const tx = Math.floor(sim.player.x / TILE_SIZE);
    const ty = Math.floor(sim.player.y / TILE_SIZE);
    const n = liveRng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const t = sim.world.walkableNear(tx, ty, 6, 12);
      if (!t) continue;
      const kind = liveRng.pick(["rabbit", "deer", "deer", "boar"]) as AnimalKind;
      const a = new AnimalSim(t.x, t.y, ANIMALS[kind]);
      this.animals.push(a);
      sim.events.emit("animalSpawned", { id: a.id });
    }
  }

  // --- per-tick -------------------------------------------------------------------

  tick(sim: Sim, dt: number): void {
    const clock = sim.getSystem<ClockSystem>("clock")!;
    const dtMs = dt * 1000;

    this.updateEnemies(sim, clock, dt);
    this.updateAnimals(sim, dt);
    this.stepEnemyProjectiles(sim, dt);
    this.tickClouds(sim);

    this.ambientAcc += dtMs;
    if (this.ambientAcc >= this.ambientDelay) {
      this.ambientAcc = 0;
      this.ambientDelay = this.scheduleAmbientMs(sim, clock);
      this.ambientEvent(sim, clock);
    }
    this.animalAcc += dtMs;
    if (this.animalAcc >= this.animalDelay) {
      this.animalAcc = 0;
      this.animalDelay = 18000 + Math.random() * 22000;
      this.spawnWildAnimals(sim);
    }
    this.corpseAcc += dtMs;
    if (this.corpseAcc >= 2000) {
      this.corpseAcc = 0;
      this.sweepCorpses(sim);
    }
  }

  private updateEnemies(sim: Sim, clock: ClockSystem, dt: number): void {
    const px = sim.player.x;
    const py = sim.player.y;
    const engine = sim.driving && sim.player.moving ? 240 : 0; // a running car is LOUD
    const noise =
      (sim.player.moving ? 45 : 0) +
      (sim.player.sprinting ? 70 : 0) +
      sim.searchNoise +
      clock.nightNoise(sim) +
      engine;
    const bounds = sim.world.worldPxBounds();
    for (const e of this.enemies) {
      e.update(px, py, noise, sim.now, dt, sim.world, bounds);
      // The dead don't fear terrain: lava sears + bogs them, water/mud slows.
      const et = sim.world.tileAt(Math.floor(e.x / TILE_SIZE), Math.floor(e.y / TILE_SIZE));
      if (et === Tile.Lava) {
        e.applyDot(14, 600, sim.now);
        e.scaleVelocity(0.3);
      } else if (et === Tile.ShallowWater || et === Tile.Mud) {
        e.scaleVelocity(0.6);
      }
      if (e.tryAttack(px, py, sim.now) && !sim.driving && !sim.airborne) this.takeHit(sim, e);
      this.enemySpecials(sim, e, px, py);
      if (e.tryBleedTrail(sim.now)) sim.events.emit("decal", { x: e.x, y: e.y, scale: 0.3, enemyId: e.id });
    }
    // reap enemies finished off by bleed/burn damage-over-time
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) {
        sim.events.emit("splat", { x: e.x, y: e.y, power: 1.1, enemyId: e.id });
        this.onEnemyKilled(sim, e);
      }
    }
  }

  private takeHit(sim: Sim, e: EnemySim): void {
    const bite = e.bite && Math.random() < 0.28;
    if (e.hasTrait("grabber")) sim.grabbedUntil = sim.now + 700; // held in place
    if (e.hasTrait("acidic")) sim.state.player.infection = clampStat(sim.state.player.infection + 4); // burns
    if (e.hasTrait("brute")) {
      // knocked back — a velocity impulse the player sim consumes next tick
      const a = Math.atan2(sim.player.y - e.y, sim.player.x - e.x);
      sim.player.impulseX = Math.cos(a) * 260;
      sim.player.impulseY = Math.sin(a) * 260;
      sim.player.impulseUntil = sim.now + 160;
    }
    this.damagePlayer(
      sim,
      Math.round(e.damage * sim.state.difficultyModifier),
      bite,
      bite ? "Bitten — the wound burns hot." : "Claws and teeth find you.",
    );
  }

  private enemySpecials(sim: Sim, e: EnemySim, px: number, py: number): void {
    if (sim.paused || sim.dead) return;
    const dist = Math.hypot(px - e.x, py - e.y);
    if (e.hasTrait("spitter") && dist > 40 && dist < 380 && e.trySpecial(sim.now, 2200)) {
      const a = Math.atan2(py - e.y, px - e.x);
      this.spawnAcid(sim, e.x, e.y, a, Math.max(4, Math.round(e.damage * 0.8)), e.hasTrait("acidic") || e.hasTrait("toxic"));
    } else if (e.hasTrait("electric") && dist < 120 && e.trySpecial(sim.now, 1600)) {
      sim.events.emit("sound", { id: "shot" });
      sim.events.emit("zap", { x0: e.x, y0: e.y, x1: px, y1: py });
      sim.grabbedUntil = Math.max(sim.grabbedUntil, sim.now + 250); // brief jolt-stun
      this.damagePlayer(sim, 5, false, "A jolt of current arcs through you.", "shock");
    } else if (e.hasTrait("screamer") && dist < e.def.aggro + 60 && e.trySpecial(sim.now, 5200)) {
      sim.events.emit("sound", { id: "ui" });
      sim.events.emit("screamRing", { x: e.x, y: e.y });
      const base = getZombie("shambler");
      if (base) {
        const tx = Math.floor(e.x / TILE_SIZE);
        const ty = Math.floor(e.y / TILE_SIZE);
        const k = liveRng.int(1, 2);
        for (let i = 0; i < k; i++) {
          const tile = sim.world.walkableNear(tx, ty, 2, 5);
          if (tile) this.spawnEnemy(sim, base, tile.x, tile.y);
        }
      }
    }
  }

  private spawnAcid(sim: Sim, x: number, y: number, angle: number, dmg: number, poison: boolean): void {
    const p: EnemyProj = {
      id: projSeq++,
      x: x + Math.cos(angle) * 16,
      y: y + Math.sin(angle) * 16,
      vx: Math.cos(angle) * 320,
      vy: Math.sin(angle) * 320,
      dmg,
      poison,
      diesAt: sim.now + 1700,
    };
    this.enemyProjectiles.push(p);
    sim.events.emit("projectileSpawned", { id: p.id, kind: "acid" });
  }

  private stepEnemyProjectiles(sim: Sim, dt: number): void {
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const p = this.enemyProjectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (sim.now >= p.diesAt) {
        this.enemyProjectiles.splice(i, 1);
        sim.events.emit("projectileKilled", { id: p.id, x: p.x, y: p.y });
        continue;
      }
      if (!sim.dead && !sim.driving && !sim.airborne && Math.hypot(p.x - sim.player.x, p.y - sim.player.y) < 18) {
        this.enemyProjectiles.splice(i, 1);
        sim.events.emit("projectileKilled", { id: p.id, x: p.x, y: p.y });
        sim.events.emit("splat", { x: p.x, y: p.y, power: 0.6 });
        if (p.poison) sim.state.player.infection = clampStat(sim.state.player.infection + 4);
        this.damagePlayer(sim, p.dmg, false, "Acid spatters across you.", "toxic");
      }
    }
  }

  spawnToxicCloud(sim: Sim, x: number, y: number): void {
    this.clouds.push({ x, y, r: 42, until: sim.now + 4000, last: 0 });
    sim.events.emit("toxicCloud", { x, y });
  }

  private tickClouds(sim: Sim): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (sim.now > c.until) {
        this.clouds.splice(i, 1);
        continue;
      }
      if (sim.now - c.last > 600 && Math.hypot(sim.player.x - c.x, sim.player.y - c.y) < c.r) {
        c.last = sim.now;
        sim.state.player.infection = clampStat(sim.state.player.infection + 2);
        this.damagePlayer(sim, 3, false, "The toxic air sears your lungs.", "toxic");
      }
    }
  }

  // --- animals ----------------------------------------------------------------------

  private updateAnimals(sim: Sim, dt: number): void {
    const px = sim.player.x;
    const py = sim.player.y;
    const bounds = sim.world.worldPxBounds();
    for (const a of this.animals) a.update(px, py, sim.now, dt, sim.world, bounds);
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (Math.hypot(a.x - px, a.y - py) > 2200) {
        this.animals.splice(i, 1);
        sim.events.emit("animalRemoved", { id: a.id, killed: false });
      }
    }
  }

  /** A melee swing also strikes the nearest animal in reach (hunting). */
  huntNearbyAnimal(sim: Sim, range: number, damage: number): void {
    const px = sim.player.x;
    const py = sim.player.y;
    let best: AnimalSim | null = null;
    let bestD = range;
    for (const a of this.animals) {
      const d = Math.hypot(a.x - px, a.y - py);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) return;
    sim.events.emit("splat", { x: best.x, y: best.y, power: 0.8 });
    if (best.takeDamage(damage)) this.killAnimal(sim, best);
  }

  killAnimal(sim: Sim, a: AnimalSim): void {
    const i = this.animals.indexOf(a);
    if (i < 0) return;
    this.animals.splice(i, 1);
    sim.events.emit("sound", { id: "kill" });
    const drops = sim.getSystem<DropsSystem>("drops")!;
    for (const d of a.def.drops) drops.spawnDrop(sim, a.x, a.y, d.item, d.qty);
    pushRecentEvent(sim.state, `Hunted a ${a.def.name}.`);
    this.grantXp(sim, "combat", 3);
    sim.events.emit("animalRemoved", { id: a.id, killed: true });
  }

  // --- the kill pipeline ----------------------------------------------------------

  onEnemyKilled(sim: Sim, e: EnemySim, ctx?: DeathCtx): void {
    if (this.enemies.indexOf(e) < 0) return; // already reaped this frame
    this.kills += 1;
    this.grantXp(sim, "combat", 4);
    sim.events.emit("sound", { id: "kill" });
    sim.events.emit("gibs", { x: e.x, y: e.y, enemyId: e.id });
    sim.events.emit("decal", { x: e.x, y: e.y, scale: 1.5, enemyId: e.id });
    pushRecentEvent(sim.state, `Put down a ${e.def.name}.`);
    this.onDeathTraits(sim, e);
    this.dropLoot(sim, e);
    const corpse = this.leavesCorpse(e);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (corpse) {
      this.corpses.push({ id: corpseSeq++, x: e.x, y: e.y, defId: e.def.id, searched: false, diesAt: sim.now + 90000 });
      while (this.corpses.length > 24) {
        const old = this.corpses.shift()!;
        sim.events.emit("corpseFaded", { id: old.id });
      }
    }
    sim.events.emit("enemyRemoved", { id: e.id, corpse });
    void ctx; // direction/crit feed the view's corpse fling via the events above
  }

  /** Bursting deaths (exploder/splitter/bloated) and friendlies leave no body. */
  private leavesCorpse(e: EnemySim): boolean {
    if (e.family === "survivor_friendly") return false;
    return !e.hasTrait("exploder") && !e.hasTrait("splitter") && !e.hasTrait("bloated");
  }

  private onDeathTraits(sim: Sim, e: EnemySim): void {
    const x = e.x;
    const y = e.y;
    if (e.hasTrait("exploder")) {
      sim.events.emit("sound", { id: "boom" });
      sim.events.emit("impulse", { kind: "shake", amount: 0.35 });
      sim.events.emit("splat", { x, y, power: 2.0, enemyId: e.id });
      sim.events.emit("decal", { x, y, scale: 1.6, enemyId: e.id });
      const radius = 84;
      if (Math.hypot(sim.player.x - x, sim.player.y - y) < radius) {
        this.damagePlayer(sim, Math.round(8 + e.damage * 0.5), true, "Caught in the burst.", "toxic");
      }
      for (const o of [...this.enemies]) {
        if (o === e || Math.hypot(o.x - x, o.y - y) >= radius) continue;
        const od = { x: o.x - x, y: o.y - y };
        if (o.takeDamage(12, sim.now)) this.onEnemyKilled(sim, o);
        else sim.events.emit("splat", { x: o.x, y: o.y, dirX: od.x, dirY: od.y, power: 0.9, enemyId: o.id });
      }
    }
    if (e.hasTrait("bloated") || e.hasTrait("toxic")) this.spawnToxicCloud(sim, x, y);
    if (e.hasTrait("splitter")) {
      const base = getZombie("crawler") ?? getZombie("shambler");
      if (base) {
        const tx = Math.floor(x / TILE_SIZE);
        const ty = Math.floor(y / TILE_SIZE);
        const k = liveRng.int(2, 3);
        for (let i = 0; i < k; i++) {
          const tile = sim.world.walkableNear(tx, ty, 1, 4);
          if (tile) this.spawnEnemy(sim, base, tile.x, tile.y);
        }
      }
    }
  }

  private dropLoot(sim: Sim, e: EnemySim): void {
    if (e.family === "survivor_friendly") return;
    const chance = e.family === "boss" ? 1 : 0.5;
    if (!liveRng.chance(chance)) return;
    const n = e.family === "boss" ? 3 : 1;
    const bias = lootLuck(sim.state) + sim.world.lootBias(e.x, e.y);
    const drops = sim.getSystem<DropsSystem>("drops")!;
    for (const s of rollLoot("enemy:" + e.lootFamily, liveRng, n, bias)) {
      drops.spawnDrop(sim, e.x, e.y, s.item, s.qty);
    }
    if (liveRng.chance(0.012)) drops.spawnDrop(sim, e.x, e.y, rollReadable(liveRng), 1);
  }

  private sweepCorpses(sim: Sim): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (sim.now >= c.diesAt) {
        this.corpses.splice(i, 1);
        sim.events.emit("corpseFaded", { id: c.id });
      }
    }
  }

  nearestEnemy(sim: Sim, maxDist: number): EnemySim | null {
    let best: EnemySim | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - sim.player.x, e.y - sim.player.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
}
