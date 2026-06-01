import Phaser from "phaser";

// Procedural visual FX (CLAUDE.md §9 keeps art CC0/placeholder). The character
// sprites are single-frame, so "animation" here is motion + particles + lighting
// built at runtime — no new art. All textures are generated once at boot.

export const FX_BLOOD = "fx_blood";
export const FX_DUST = "fx_dust";
export const FX_GLOW = "fx_glow";
export const FX_VIGNETTE = "fx_vignette";

/** Generate the small textures the FX below draw with. Idempotent. */
export function generateFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX_BLOOD)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture(FX_BLOOD, 8, 8);
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

/** A one-shot blood spray at a world point. */
export function bloodBurst(scene: Phaser.Scene, x: number, y: number, count = 8, color = 0x9c1414): void {
  const e = scene.add.particles(x, y, FX_BLOOD, {
    speed: { min: 30, max: 140 },
    angle: { min: 0, max: 360 },
    lifespan: { min: 220, max: 520 },
    scale: { start: 1.1, end: 0 },
    gravityY: 140,
    tint: color,
    emitting: false,
  });
  e.setDepth(9);
  e.explode(count, x, y);
  scene.time.delayedCall(650, () => e.destroy());
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

/** A quick swing arc in front of the attacker. */
export function meleeArc(scene: Phaser.Scene, x: number, y: number, facing: number): void {
  const g = scene.add.graphics({ x, y });
  g.setDepth(11);
  g.lineStyle(3, 0xeaf5ff, 0.85);
  g.beginPath();
  g.arc(0, 0, 30, facing - 0.7, facing + 0.7, false);
  g.strokePath();
  scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.25, scaleY: 1.25, duration: 200, onComplete: () => g.destroy() });
}

/** An additive radial light that follows the player and brightens at night. */
export function makeGlow(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, FX_GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(520).setAlpha(0);
}
