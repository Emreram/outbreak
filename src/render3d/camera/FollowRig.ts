// The follow camera (3D master plan §6.1): an ArcRotateCamera on a lerped
// target proxy. Alpha locked to CAMERA_ALPHA_NORTH_UP so sim-north stays
// screen-up (minimap-consistent — asserted in tests/space3d.test.ts); beta and
// radius wheel-clamped; follow lerp 0.12 matching the Phaser camera. Feel
// impulses (shake / zoom-punch / hurt) land here so views stay dumb.

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  CAMERA_ALPHA_NORTH_UP,
  CAMERA_BETA_DEFAULT,
  CAMERA_BETA_MAX,
  CAMERA_BETA_MIN,
  CAMERA_FOLLOW_LERP,
  CAMERA_RADIUS_DEFAULT,
  CAMERA_RADIUS_MAX,
  CAMERA_RADIUS_MIN,
} from "../space";

export class FollowRig {
  readonly camera: ArcRotateCamera;
  readonly proxy: TransformNode;
  private shakeTrauma = 0;
  private punch = 0;
  private baseRadius = CAMERA_RADIUS_DEFAULT;
  private t = 0;
  /** Persistent 6% push-in while the encounter modal is open (cinematic beat). */
  private pushIn = 0;
  private pushTarget = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.proxy = new TransformNode("camTargetProxy", scene);
    this.camera = new ArcRotateCamera(
      "follow",
      CAMERA_ALPHA_NORTH_UP,
      CAMERA_BETA_DEFAULT,
      CAMERA_RADIUS_DEFAULT,
      this.proxy.position,
      scene,
    );
    this.camera.lowerRadiusLimit = CAMERA_RADIUS_MIN;
    this.camera.upperRadiusLimit = CAMERA_RADIUS_MAX;
    this.camera.lowerBetaLimit = CAMERA_BETA_MIN;
    this.camera.upperBetaLimit = CAMERA_BETA_MAX;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 400;

    // Wheel zoom only — orbit stays locked (movement = world-relative rule).
    canvas.addEventListener(
      "wheel",
      (e) => {
        this.baseRadius = Math.max(
          CAMERA_RADIUS_MIN,
          Math.min(CAMERA_RADIUS_MAX, this.baseRadius + Math.sign(e.deltaY) * 1.2),
        );
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Snap the proxy to a position (spawn / teleport). */
  snapTo(p: Vector3): void {
    this.proxy.position.copyFrom(p);
  }

  shake(trauma: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + trauma);
  }

  zoomPunch(amount = 1): void {
    this.punch = Math.min(1.5, this.punch + amount);
  }

  /** Slow 6% dolly-in while an encounter plays (plan §6.1), eased both ways. */
  encounterPush(on: boolean): void {
    this.pushTarget = on ? 1 : 0;
  }

  /** Per-render-frame: lerp the proxy toward the target visual position. */
  update(target: Vector3, dtMs: number): void {
    this.t += dtMs;
    // Frame-rate-corrected lerp equivalent to 0.12/frame at 60fps.
    const k = 1 - Math.pow(1 - CAMERA_FOLLOW_LERP, dtMs / (1000 / 60));
    this.proxy.position.x += (target.x - this.proxy.position.x) * k;
    this.proxy.position.y += (target.y - this.proxy.position.y) * k;
    this.proxy.position.z += (target.z - this.proxy.position.z) * k;

    // Trauma-squared shake on the target (decays fast), zoom punch on radius.
    let ox = 0;
    let oz = 0;
    if (this.shakeTrauma > 0.001) {
      const s = this.shakeTrauma * this.shakeTrauma * 0.35;
      ox = (Math.sin(this.t * 0.061) + Math.sin(this.t * 0.097)) * 0.5 * s;
      oz = (Math.cos(this.t * 0.083) + Math.sin(this.t * 0.051)) * 0.5 * s;
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dtMs / 450);
    }
    if (this.punch > 0.001) this.punch = Math.max(0, this.punch - dtMs / 220);
    this.pushIn += (this.pushTarget - this.pushIn) * Math.min(1, dtMs / 600);

    this.camera.target.set(this.proxy.position.x + ox, this.proxy.position.y, this.proxy.position.z + oz);
    this.camera.radius = this.baseRadius * (1 - this.pushIn * 0.06) - this.punch * 1.6;
  }
}
