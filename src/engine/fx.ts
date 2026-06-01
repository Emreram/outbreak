import Phaser from "phaser";

// Procedural visual FX (CLAUDE.md §9 keeps art CC0/placeholder). The character
// sprites are single-frame, so "animation" here is motion + particles + lighting
// built at runtime — no new art. All textures are generated once at boot.

export const FX_BLOOD = "fx_blood";
export const FX_DUST = "fx_dust";
export const FX_GLOW = "fx_glow";
export const FX_VIGNETTE = "fx_vignette";
export const FX_SPLAT = "fx_splat";
export const FX_GIB = "fx_gib";

/** Generate the small textures the FX below draw with. Idempotent. */
export function generateFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_BLOOD)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture(FX_BLOOD, 8, 8);
    g.destroy();
  }
  // A persistent ground splat (drawn white → tinted dark red at stamp time) made of
  // a few overlapping blobs + flung droplets so each decal reads as a messy pool.
  if (!scene.textures.exists(FX_SPLAT)) {
    const S = 32;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(S / 2, S / 2, 7);
    g.fillCircle(S / 2 - 5, S / 2 + 3, 4.5);
    g.fillCircle(S / 2 + 6, S / 2 - 2, 4);
    g.fillCircle(S / 2 + 2, S / 2 + 6, 3);
    for (const [dx, dy, r] of [[-11, -7, 2], [10, 8, 2.4], [12, -8, 1.6], [-9, 9, 1.8], [0, -12, 1.6]]) {
      g.fillCircle(S / 2 + dx, S / 2 + dy, r); // flung droplets
    }
    g.generateTexture(FX_SPLAT, S, S);
    g.destroy();
  }
  // A small gore chunk flung on kills.
  if (!scene.textures.exists(FX_GIB)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 6, 5, 2);
    g.generateTexture(FX_GIB, 6, 5);
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

/** A one-shot blood spray at a world point. Bigger + longer-lived than before, and
 *  directional when `dir` is given (spray flies away from the blow). */
export function bloodBurst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  count = 8,
  color = 0x9c1414,
  dir?: { x: number; y: number },
): void {
  const angle = dir
    ? (() => {
        const a = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
        return { min: a - 38, max: a + 38 }; // a cone away from the strike
      })()
    : { min: 0, max: 360 };
  const e = scene.add.particles(x, y, FX_BLOOD, {
    speed: { min: 40, max: dir ? 220 : 170 },
    angle,
    lifespan: { min: 260, max: 680 },
    scale: { start: 1.35, end: 0 },
    gravityY: 200,
    tint: color,
    emitting: false,
  });
  e.setDepth(9);
  e.explode(count, x, y);
  scene.time.delayedCall(750, () => e.destroy());
}

// --- persistent gore: pooled ground decals (perf-bounded) ---------------------

const decalPool = new Map<Phaser.Scene, Phaser.GameObjects.Image[]>();
const DECAL_CAP = 64;

/** Reset the decal pool — call from the scene's create() so a fresh run starts clean
 *  and stale (destroyed) references from the previous run are dropped. */
export function resetFx(scene: Phaser.Scene): void {
  const pool = decalPool.get(scene);
  if (pool) for (const im of pool) im.destroy();
  decalPool.set(scene, []);
}

/** Stamp a lingering blood splat on the ground (depth ~3). Pooled + capped so the
 *  battlefield gets gory without unbounded sprite growth; old splats fade out. */
export function bloodDecal(scene: Phaser.Scene, x: number, y: number, scale = 1, color = 0x6e0d0d): void {
  let pool = decalPool.get(scene);
  if (!pool) {
    pool = [];
    decalPool.set(scene, pool);
  }
  const img = scene.add
    .image(x, y, FX_SPLAT)
    .setDepth(3)
    .setRotation(Math.random() * Math.PI * 2)
    .setScale(scale * (0.7 + Math.random() * 0.6))
    .setAlpha(0.72)
    .setTint(color);
  pool.push(img);
  // Slow fade so the ground eventually cleans itself up.
  scene.tweens.add({
    targets: img,
    alpha: 0,
    duration: 26000,
    delay: 9000,
    onComplete: () => {
      const p = decalPool.get(scene);
      const i = p ? p.indexOf(img) : -1;
      if (i >= 0) p!.splice(i, 1);
      img.destroy();
    },
  });
  // Cap: retire the oldest splats once we exceed the budget.
  while (pool.length > DECAL_CAP) {
    const old = pool.shift();
    if (old) {
      scene.tweens.killTweensOf(old);
      old.destroy();
    }
  }
}

/** A burst of gore chunks flung on a kill (tumbling, gravity, quick fade). */
export function gibs(scene: Phaser.Scene, x: number, y: number, count = 7, color = 0x7a1010): void {
  const e = scene.add.particles(x, y, FX_GIB, {
    speed: { min: 70, max: 240 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 380, max: 760 },
    scale: { start: 1.4, end: 0.6 },
    rotate: { start: 0, end: 360 },
    gravityY: 460,
    tint: color,
    emitting: false,
  });
  e.setDepth(9);
  e.explode(count, x, y);
  scene.time.delayedCall(820, () => e.destroy());
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
