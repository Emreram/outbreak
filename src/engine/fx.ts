import Phaser from "phaser";
import type { BloodProfile } from "../game/enemies/blood";

// Procedural visual FX (CLAUDE.md §9 keeps art CC0/placeholder). The character
// sprites are single-frame, so "animation" here is motion + particles + lighting
// built at runtime — no new art. All textures are generated once at boot.

export const FX_BLOOD = "fx_blood";
export const FX_DUST = "fx_dust";
export const FX_GLOW = "fx_glow";
export const FX_VIGNETTE = "fx_vignette";
export const FX_SPLAT = "fx_splat";
export const FX_GIB = "fx_gib";
export const FX_DROP = "fx_drop"; // elongated arterial droplet
export const FX_MIST = "fx_mist"; // soft atomised spray haze
export const FX_SMEAR = "fx_smear"; // directional spatter streak (decal)
export const FX_BEAM = "fx_beam"; // vertical light shaft (rare loot marker)

// --- colour helpers ------------------------------------------------------------
function scaleColor(c: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
/** A cone of emission angles (degrees) pointed along `dir`, away from the blow. */
function coneFrom(dir: { x: number; y: number }, spreadDeg: number): { min: number; max: number } {
  const a = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  return { min: a - spreadDeg, max: a + spreadDeg };
}
/** Build a quick profile from a single tint (back-compat path for non-typed blood). */
function quickProfile(color: number): BloodProfile {
  return { spray: color, mist: scaleColor(color, 1.6), pool: scaleColor(color, 0.5), gib: scaleColor(color, 0.7), amount: 1, fluid: "blood" };
}

/** Generate the small textures the FX below draw with. Idempotent. */
export function generateFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_BLOOD)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture(FX_BLOOD, 8, 8);
    g.destroy();
  }
  // An elongated droplet (head + tail) for arterial spray and ground drips. Drawn
  // pointing "up"; particles rotate it randomly so it reads as flung blood.
  if (!scene.textures.exists(FX_DROP)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(5, 8, 4); // fat head
    g.fillTriangle(1.4, 8, 8.6, 8, 5, 0); // tapering tail
    g.generateTexture(FX_DROP, 10, 12);
    g.destroy();
  }
  // Soft atomised mist — a radial gradient so the spray hangs as a fine haze.
  if (!scene.textures.exists(FX_MIST)) {
    const S = 24;
    const canvas = scene.textures.createCanvas(FX_MIST, S, S);
    const ctx = canvas?.getContext();
    if (ctx) {
      const grd = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.35)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
      canvas?.refresh();
    }
  }
  // A persistent ground splat (drawn white → tinted dark at stamp time): a messy
  // central pool, satellite blobs, flung droplets, and a few drip "tongues".
  if (!scene.textures.exists(FX_SPLAT)) {
    const S = 36;
    const c = S / 2;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(c, c, 8);
    g.fillCircle(c - 6, c + 3, 5);
    g.fillCircle(c + 7, c - 3, 4.5);
    g.fillCircle(c + 3, c + 7, 3.5);
    g.fillCircle(c - 4, c - 6, 3);
    // irregular drip tongues licking out from the pool
    for (const [ang, len, w] of [[0.4, 14, 4], [2.3, 12, 3.2], [4.1, 15, 3.8], [5.4, 11, 2.8]]) {
      const ex = c + Math.cos(ang) * len;
      const ey = c + Math.sin(ang) * len;
      const nx = Math.cos(ang + Math.PI / 2) * w;
      const ny = Math.sin(ang + Math.PI / 2) * w;
      g.fillTriangle(c + nx, c + ny, c - nx, c - ny, ex, ey);
      g.fillCircle(ex, ey, w * 0.9);
    }
    // far-flung specks
    for (const [dx, dy, r] of [[-13, -8, 1.8], [12, 9, 2.2], [14, -9, 1.5], [-11, 10, 1.6], [0, -14, 1.5]]) {
      g.fillCircle(c + dx, c + dy, r);
    }
    g.generateTexture(FX_SPLAT, S, S);
    g.destroy();
  }
  // A directional smear streak — comet of tapering blobs, for spatter that flies
  // off in the direction of the blow. White → tinted + rotated at stamp time.
  if (!scene.textures.exists(FX_SMEAR)) {
    const W = 52;
    const H = 18;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const cx = 6 + t * 42;
      const r = 7 * (1 - t) + 1;
      g.fillCircle(cx, H / 2 + Math.sin(t * 7) * 2.5 * t, r);
    }
    for (const [dx, dy, r] of [[46, 4, 1.6], [42, 14, 1.3], [34, 3, 1.1], [50, 9, 1]]) g.fillCircle(dx, dy, r);
    g.generateTexture(FX_SMEAR, W, H);
    g.destroy();
  }
  // A small irregular gore chunk flung on kills.
  if (!scene.textures.exists(FX_GIB)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(3, 3, 3);
    g.fillCircle(5.5, 4.5, 2.4);
    g.fillCircle(4, 6.5, 1.9);
    g.generateTexture(FX_GIB, 9, 9);
    g.destroy();
  }
  if (!scene.textures.exists(FX_DUST)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(3, 3, 3);
    g.generateTexture(FX_DUST, 6, 6);
    g.destroy();
  }
  if (!scene.textures.exists(FX_GLOW)) {
    const R = 160;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let r = R; r > 0; r -= 4) g.fillStyle(0xfff0c4, 0.05).fillCircle(R, R, r); // soft radial buildup
    g.generateTexture(FX_GLOW, R * 2, R * 2);
    g.destroy();
  }
  // A soft vertical light shaft — a column brightest at its base, fanning out and
  // fading toward the top. Drawn white; tinted per rarity + blended additive when
  // it marks an exceptional drop.
  if (!scene.textures.exists(FX_BEAM)) {
    const W = 34;
    const H = 104;
    const canvas = scene.textures.createCanvas(FX_BEAM, W, H);
    const ctx = canvas?.getContext();
    if (ctx) {
      // soft-edged column across its width
      const col = ctx.createLinearGradient(0, 0, W, 0);
      col.addColorStop(0, "rgba(255,255,255,0)");
      col.addColorStop(0.5, "rgba(255,255,255,0.92)");
      col.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, W, H);
      // fade it out toward the top (bright at the base, gone at the tip)
      const fade = ctx.createLinearGradient(0, H, 0, 0);
      fade.addColorStop(0, "rgba(255,255,255,1)");
      fade.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      canvas?.refresh();
    }
  }
  if (!scene.textures.exists(FX_VIGNETTE)) {
    const S = 256;
    const canvas = scene.textures.createCanvas(FX_VIGNETTE, S, S);
    const ctx = canvas?.getContext();
    if (ctx) {
      const grd = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.62);
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
      canvas?.refresh();
    }
  }
}

/** A one-shot blood spray at a world point: heavy droplets + a fine atomised mist.
 *  Directional when `dir` is given (spray flies away from the blow). Back-compat
 *  signature — pass a single tint; splatHit() is the richer per-type entry point. */
export function bloodBurst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  count = 8,
  color = 0x9c1414,
  dir?: { x: number; y: number },
): void {
  splatHit(scene, x, y, quickProfile(color), dir, count / 8);
}

/** The premium per-type impact: arterial droplet spray, a brighter mist haze, an
 *  optional additive accent (toxic sheen / electric arc / ember), and fluid-specific
 *  quirks. `power` scales volume + reach (>1 for crits, kills, vehicle hits). */
export function splatHit(
  scene: Phaser.Scene,
  x: number,
  y: number,
  p: BloodProfile,
  dir?: { x: number; y: number },
  power = 1,
): void {
  const amt = p.amount * power;
  // sparks radiate wide like arcs; ice chips & tar stay tight; blood/bile in between
  const wide = p.fluid === "spark" ? 70 : p.fluid === "frozen" ? 26 : p.fluid === "ash" ? 30 : p.fluid === "oil" ? 34 : 40;
  const angle = dir ? coneFrom(dir, wide) : { min: 0, max: 360 };
  const reach = (dir ? 230 : 170) * (0.85 + power * 0.35);

  // heavy arterial droplets — the wet, flung blood
  const drops = scene.add.particles(x, y, FX_DROP, {
    speed: { min: 50, max: reach },
    angle,
    lifespan: { min: 260, max: 700 },
    scale: { start: 1.15 * (p.fluid === "ash" ? 0.8 : 1), end: 0.15 },
    rotate: { min: 0, max: 360 },
    // ash soot drifts up like smoke; ice chips drift; tar is heavy; blood falls
    gravityY: p.fluid === "frozen" ? 120 : p.fluid === "ash" ? -10 : p.fluid === "oil" ? 420 : 340,
    tint: p.spray,
    emitting: false,
  });
  drops.setDepth(9);
  drops.explode(Math.max(3, Math.round(7 * amt)), x, y);

  // atomised mist — brighter, expands, hangs a beat
  const mist = scene.add.particles(x, y, FX_MIST, {
    speed: { min: 8, max: 60 * power },
    angle,
    lifespan: { min: 200, max: 460 },
    scale: { start: 0.45, end: 1.5 },
    alpha: { start: p.fluid === "ash" ? 0.6 : 0.5, end: 0 },
    tint: p.mist,
    blendMode: p.fluid === "spark" ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
    emitting: false,
  });
  mist.setDepth(9);
  mist.explode(Math.max(2, Math.round(5 * amt)), x, y);

  const emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [drops, mist];

  // additive accent — glowing toxic sheen, electric ticks, drifting embers
  if (p.glow !== undefined) {
    const isSpark = p.fluid === "spark";
    const isEmber = p.fluid === "ash";
    const accent = scene.add.particles(x, y, FX_BLOOD, {
      speed: { min: isSpark ? 120 : 20, max: (isSpark ? 320 : 90) * power },
      angle,
      lifespan: { min: 180, max: isEmber ? 900 : 480 },
      scale: { start: isSpark ? 0.7 : 0.5, end: 0 },
      gravityY: isEmber ? -40 : 0, // embers float up
      alpha: { start: 0.9, end: 0 },
      tint: p.glow,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    accent.setDepth(10);
    accent.explode(Math.max(2, Math.round((isSpark ? 5 : 4) * amt)), x, y);
    emitters.push(accent);
  }

  scene.time.delayedCall(950, () => emitters.forEach((e) => e.destroy()));

  // a directional smear decal trailing the spray (only on real blows, not ambient)
  if (dir && power >= 1) {
    bloodSmear(scene, x + dir.x * 10, y + dir.y * 10, p.pool, dir, 0.7 + power * 0.3);
  }
}

// --- persistent gore: pooled ground decals (perf-bounded) ---------------------

const decalPool = new Map<Phaser.Scene, Phaser.GameObjects.Image[]>();
const trailPool = new Map<Phaser.Scene, Phaser.GameObjects.Image[]>();
const DECAL_CAP = 80; // pools, splats + smears
const TRAIL_CAP = 110; // small drips left by wounded enemies (cheaper, faster fade)

/** Reset the decal pools — call from the scene's create() so a fresh run starts
 *  clean and stale (destroyed) references from the previous run are dropped. */
export function resetFx(scene: Phaser.Scene): void {
  for (const map of [decalPool, trailPool]) {
    const pool = map.get(scene);
    if (pool) for (const im of pool) im.destroy();
    map.set(scene, []);
  }
}

function pushDecal(scene: Phaser.Scene, img: Phaser.GameObjects.Image, fadeMs: number, delayMs: number): void {
  let pool = decalPool.get(scene);
  if (!pool) {
    pool = [];
    decalPool.set(scene, pool);
  }
  pool.push(img);
  scene.tweens.add({
    targets: img,
    alpha: 0,
    duration: fadeMs,
    delay: delayMs,
    onComplete: () => {
      const p = decalPool.get(scene);
      const i = p ? p.indexOf(img) : -1;
      if (i >= 0) p!.splice(i, 1);
      img.destroy();
    },
  });
  while (pool.length > DECAL_CAP) {
    const old = pool.shift();
    if (old) {
      scene.tweens.killTweensOf(old);
      old.destroy();
    }
  }
}

/** Stamp a lingering blood pool on the ground (depth ~3). Pooled + capped so the
 *  battlefield gets gory without unbounded sprite growth; old splats fade out.
 *  When `dir` is given a spatter streak is flung alongside the pool. */
export function bloodDecal(scene: Phaser.Scene, x: number, y: number, scale = 1, color = 0x6e0d0d, dir?: { x: number; y: number }): void {
  const img = scene.add
    .image(x, y, FX_SPLAT)
    .setDepth(3)
    .setRotation(Math.random() * Math.PI * 2)
    .setScale(scale * (0.7 + Math.random() * 0.6))
    .setAlpha(0.78)
    .setTint(color);
  pushDecal(scene, img, 26000, 9000);
  if (dir) bloodSmear(scene, x + dir.x * 9, y + dir.y * 9, color, dir, scale);
}

/** A directional spatter streak on the ground, flung along `dir`. */
export function bloodSmear(scene: Phaser.Scene, x: number, y: number, color: number, dir: { x: number; y: number }, scale = 1): void {
  const img = scene.add
    .image(x, y, FX_SMEAR)
    .setDepth(3)
    .setOrigin(0.2, 0.5)
    .setRotation(Math.atan2(dir.y, dir.x))
    .setScale(scale * (0.7 + Math.random() * 0.5), scale * (0.55 + Math.random() * 0.35))
    .setAlpha(0.62)
    .setTint(color);
  pushDecal(scene, img, 18000, 6000);
}

/** A small drip left under a wounded/bleeding enemy as it moves. Cheap, capped,
 *  fast-fading — a separate pool so it never evicts the big kill pools. */
export function bloodTrail(scene: Phaser.Scene, x: number, y: number, p: BloodProfile, dir?: { x: number; y: number }): void {
  let pool = trailPool.get(scene);
  if (!pool) {
    pool = [];
    trailPool.set(scene, pool);
  }
  const rot = dir ? Math.atan2(dir.y, dir.x) + Math.PI : Math.random() * Math.PI * 2;
  const drip = scene.add
    .image(x + (Math.random() - 0.5) * 6, y + 4 + (Math.random() - 0.5) * 6, FX_DROP)
    .setDepth(3)
    .setRotation(rot)
    .setScale(0.4 + Math.random() * 0.45)
    .setAlpha(0.7)
    .setTint(p.pool);
  pool.push(drip);
  scene.tweens.add({
    targets: drip,
    alpha: 0,
    duration: 5500,
    delay: 3500,
    onComplete: () => {
      const pl = trailPool.get(scene);
      const i = pl ? pl.indexOf(drip) : -1;
      if (i >= 0) pl!.splice(i, 1);
      drip.destroy();
    },
  });
  while (pool.length > TRAIL_CAP) {
    const old = pool.shift();
    if (old) {
      scene.tweens.killTweensOf(old);
      old.destroy();
    }
  }
}

/** A burst of gore chunks flung on a kill (tumbling, gravity, quick fade), plus a
 *  scatter of small lasting decals where they land. Fluid-aware via the profile. */
export function gibs(scene: Phaser.Scene, x: number, y: number, p?: BloodProfile): void {
  const prof = p ?? quickProfile(0x7a1010);
  const count = Math.max(5, Math.round(8 * prof.amount));
  const e = scene.add.particles(x, y, FX_GIB, {
    speed: { min: 70, max: 260 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 380, max: 820 },
    scale: { start: 1.5 * (0.8 + prof.amount * 0.2), end: 0.1 }, // shrink as they tumble & settle
    alpha: { start: 1, end: 0 }, // fade out on landing (no hard pop)
    rotate: { start: 0, end: 360 },
    gravityY: prof.fluid === "frozen" ? 220 : 480,
    tint: prof.gib,
    emitting: false,
  });
  e.setDepth(9);
  e.explode(count, x, y);
  scene.time.delayedCall(880, () => e.destroy());
  // a few chunks settle into small lasting stains around the kill spot
  const stains = Math.min(5, Math.round(3 * prof.amount));
  for (let i = 0; i < stains; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 18;
    bloodDecal(scene, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.45 + Math.random() * 0.3, prof.pool);
  }
}

/** A small footstep / impact dust puff. */
export function dustPuff(scene: Phaser.Scene, x: number, y: number, count = 4): void {
  const e = scene.add.particles(x, y, FX_DUST, {
    speed: { min: 8, max: 30 },
    angle: { min: 200, max: 340 },
    lifespan: { min: 300, max: 600 },
    scale: { start: 0.9, end: 0 },
    alpha: { start: 0.5, end: 0 },
    tint: 0x8a7f6a,
    emitting: false,
  });
  e.setDepth(7);
  e.explode(count, x, y);
  scene.time.delayedCall(700, () => e.destroy());
}

/** Fade + spin + shrink a dead body out, then destroy the sprite. */
export function deathFade(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite): void {
  scene.tweens.add({
    targets: sprite,
    alpha: 0,
    angle: sprite.angle + 150,
    scaleX: sprite.scaleX * 0.4,
    scaleY: sprite.scaleY * 0.4,
    duration: 420,
    ease: "Quad.easeIn",
    onComplete: () => sprite.destroy(),
  });
}

/** Pop a freshly spawned entity in (scale + alpha). */
export function spawnPopIn(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite): void {
  const fx = sprite.scaleX;
  const fy = sprite.scaleY;
  sprite.setScale(fx * 0.1, fy * 0.1);
  sprite.setAlpha(0.25);
  scene.tweens.add({ targets: sprite, scaleX: fx, scaleY: fy, alpha: 1, duration: 240, ease: "Back.easeOut" });
}

/** A quick swing arc + trailing blade streak in front of the attacker. */
export function meleeArc(scene: Phaser.Scene, x: number, y: number, facing: number): void {
  const g = scene.add.graphics({ x, y });
  g.setDepth(11);
  // bright leading edge
  g.lineStyle(4, 0xffffff, 0.95);
  g.beginPath();
  g.arc(0, 0, 32, facing - 0.85, facing + 0.85, false);
  g.strokePath();
  // softer wide trail behind it
  g.lineStyle(8, 0xbfe9ff, 0.35);
  g.beginPath();
  g.arc(0, 0, 30, facing - 1.0, facing + 1.0, false);
  g.strokePath();
  scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.35, scaleY: 1.35, duration: 220, ease: "Quad.easeOut", onComplete: () => g.destroy() });
}

/** An additive radial light that follows the player and brightens at night. */
export function makeGlow(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, FX_GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(520).setAlpha(0);
}

// --- dropped-item rarity glow -------------------------------------------------

/** The visual recipe for a dropped item's glow. Caller (game layer) translates a
 *  rarity into this; the engine never sees the rarity model itself. */
export interface RarityGlowSpec {
  color: number; // tint of the halo / beam / twinkles
  scale: number; // base radius of the halo (bigger = rarer)
  pulseMs: number; // pulse period (faster = rarer, more alive)
  beam: boolean; // add a vertical light shaft (exceptional loot)
  sparkle: boolean; // add orbiting twinkle particles (top-tier loot)
}

/** The layered glow attached to a dropped item, plus a one-call teardown. */
export interface DropGlow {
  layers: Phaser.GameObjects.Image[]; // bobbed in sync with the item by the caller
  emitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  destroy(): void;
}

/** Build a tier-driven glow under a dropped item: a tinted pulsing halo for every
 *  rarity, a hotter inner core + drifting twinkles for the good stuff, and a tall
 *  light shaft that turns a legendary into a beacon you can spot across the street. */
export function makeDropGlow(scene: Phaser.Scene, x: number, y: number, spec: RarityGlowSpec): DropGlow {
  const layers: Phaser.GameObjects.Image[] = [];

  // Vertical light shaft (best loot only) — rises from the item with a slow shimmer.
  if (spec.beam) {
    const beam = scene.add
      .image(x, y + 4, FX_BEAM)
      .setOrigin(0.5, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(5)
      .setTint(spec.color)
      .setAlpha(0)
      .setScale(0.7 + spec.scale, 0.9 + spec.scale * 1.4);
    scene.tweens.add({ targets: beam, alpha: 0.5, scaleY: beam.scaleY * 1.12, duration: spec.pulseMs, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    layers.push(beam);
  }

  // Outer halo — every rarity gets one, sized + paced by tier.
  const halo = scene.add.image(x, y, FX_GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(6).setTint(spec.color).setScale(spec.scale).setAlpha(0.5);
  scene.tweens.add({ targets: halo, alpha: 0.28, scaleX: spec.scale * 1.12, scaleY: spec.scale * 1.12, duration: spec.pulseMs, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  layers.push(halo);

  // Hotter inner core for rare+ — a lightened tint so the centre reads white-hot.
  if (spec.scale >= 0.26) {
    const core = scene.add.image(x, y, FX_GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(6).setTint(scaleColor(spec.color, 1.7)).setScale(spec.scale * 0.5).setAlpha(0.6);
    scene.tweens.add({ targets: core, alpha: 0.35, duration: spec.pulseMs * 0.7, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    layers.push(core);
  }

  // Orbiting twinkles for epic+ — tiny additive sparks drifting up off the loot.
  let emitter: Phaser.GameObjects.Particles.ParticleEmitter | undefined;
  if (spec.sparkle) {
    emitter = scene.add.particles(x, y, FX_BLOOD, {
      speed: { min: 5, max: 22 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 500, max: 1150 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.95, end: 0 },
      gravityY: -14,
      tint: scaleColor(spec.color, 1.5),
      blendMode: Phaser.BlendModes.ADD,
      frequency: 170,
      quantity: 1,
    });
    emitter.setDepth(8);
  }

  return {
    layers,
    emitter,
    destroy(): void {
      for (const l of layers) {
        scene.tweens.killTweensOf(l);
        l.destroy();
      }
      emitter?.destroy();
    },
  };
}

/** A looping flame + ember plume that clings to a sprite (an entity on fire). */
export function startBurning(scene: Phaser.Scene, target: Phaser.GameObjects.Sprite): Phaser.GameObjects.Particles.ParticleEmitter {
  const e = scene.add.particles(target.x, target.y, FX_MIST, {
    speed: { min: 12, max: 46 },
    angle: { min: 250, max: 290 }, // up-ish
    lifespan: { min: 280, max: 620 },
    scale: { start: 0.55, end: 0 },
    alpha: { start: 0.85, end: 0 },
    tint: [0xffe27a, 0xff8a2a, 0xff3a1a],
    blendMode: Phaser.BlendModes.ADD,
    frequency: 55,
    quantity: 2,
  });
  e.setDepth(11);
  e.startFollow(target);
  return e;
}

/** Stop a burning plume (let in-flight particles fade), then destroy it. */
export function stopBurning(scene: Phaser.Scene, e: Phaser.GameObjects.Particles.ParticleEmitter): void {
  e.stop();
  scene.time.delayedCall(700, () => e.destroy());
}

/** A pale steam/smoke puff — used when fire is doused in water, or for vents. */
export function steamPuff(scene: Phaser.Scene, x: number, y: number, count = 7): void {
  const e = scene.add.particles(x, y, FX_MIST, {
    speed: { min: 10, max: 40 },
    angle: { min: 235, max: 305 },
    lifespan: { min: 400, max: 900 },
    scale: { start: 0.5, end: 1.3 },
    alpha: { start: 0.6, end: 0 },
    tint: 0xdfe6ec,
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  });
  e.setDepth(11);
  e.explode(count, x, y);
  scene.time.delayedCall(950, () => e.destroy());
}

/** A short splash burst (water contact) — bright droplets + a quick ripple. */
export function splashPuff(scene: Phaser.Scene, x: number, y: number, count = 6): void {
  const e = scene.add.particles(x, y, FX_DROP, {
    speed: { min: 20, max: 80 },
    angle: { min: 200, max: 340 },
    lifespan: { min: 200, max: 460 },
    scale: { start: 0.5, end: 0 },
    alpha: { start: 0.8, end: 0 },
    rotate: { min: 0, max: 360 },
    gravityY: 220,
    tint: 0xbfe1ff,
    emitting: false,
  });
  e.setDepth(7);
  e.explode(count, x, y);
  scene.time.delayedCall(560, () => e.destroy());
}

/** A few rising embers (lava/ash contact). */
export function emberPuff(scene: Phaser.Scene, x: number, y: number, count = 5): void {
  const e = scene.add.particles(x, y, FX_BLOOD, {
    speed: { min: 14, max: 60 },
    angle: { min: 250, max: 290 },
    lifespan: { min: 300, max: 760 },
    scale: { start: 0.5, end: 0 },
    alpha: { start: 0.95, end: 0 },
    gravityY: -50,
    tint: [0xffd27a, 0xff7a2a],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  });
  e.setDepth(11);
  e.explode(count, x, y);
  scene.time.delayedCall(820, () => e.destroy());
}
