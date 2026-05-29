import Phaser from "phaser";

// Open-world camera: follows the player with a little smoothing and is clamped
// to the world bounds (CLAUDE.md §10 "camera follows the player").

export function setupCamera(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  worldWidthPx: number,
  worldHeightPx: number,
): void {
  const cam = scene.cameras.main;
  cam.setBounds(0, 0, worldWidthPx, worldHeightPx);
  cam.setZoom(1.25);
  cam.startFollow(target, true, 0.12, 0.12);
  cam.setRoundPixels(true);
}
