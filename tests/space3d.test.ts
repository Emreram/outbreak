// render3d/space.ts — the coordinate & unit contract (3D master plan §3.1).
// Round-trip identity, the 32px≡1m scale, and the binding orientation rule:
// with the documented right-handed scene + CAMERA_ALPHA_NORTH_UP, sim-north
// (−y px) is screen-up and sim-east (+x px) is screen-right, matching the
// minimap. Verified against Babylon's own LookAt math so a regression in
// either the mapping or the camera constant fails here, not on screen.

import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  CAMERA_ALPHA_NORTH_UP,
  CAMERA_BETA_DEFAULT,
  CAMERA_RADIUS_DEFAULT,
  WORLD_SCALE,
  simToWorld,
  worldToSim,
  groundHeightAt,
} from "../src/render3d/space";
import { TILE_SIZE } from "../src/game/constants";

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

// --- scale + round-trip -------------------------------------------------------------
{
  // Arrange / Act.
  const w = simToWorld(TILE_SIZE, TILE_SIZE * 2, 1.7);
  const back = worldToSim(w.x, w.z);
  // Assert: one tile is one meter; x→X, y→Z, height→Y; round-trip is exact.
  ok(WORLD_SCALE === 1 / 32, "WORLD_SCALE is 1/32 (32px ≡ 1m)");
  ok(w.x === 1 && w.z === 2 && w.y === 1.7, `sim(32,64)+1.7m → world(1, 1.7, 2) (got ${w.x},${w.y},${w.z})`);
  ok(back.x === TILE_SIZE && back.y === TILE_SIZE * 2, "world→sim round-trips exactly");
  ok(groundHeightAt(12345, 678) === 0, "ground height is flat 0 until the visual-height flag (M6)");
}

// --- minimap orientation (north-up, east-right) --------------------------------------
{
  // Arrange: ArcRotate camera position formula at the locked alpha, looking at
  // a target in the middle of the world (right-handed system → LookAtRH).
  const target = simToWorld(1000, 1000);
  const a = CAMERA_ALPHA_NORTH_UP;
  const b = CAMERA_BETA_DEFAULT;
  const r = CAMERA_RADIUS_DEFAULT;
  const eye = new Vector3(
    target.x + r * Math.cos(a) * Math.sin(b),
    target.y + r * Math.cos(b),
    target.z + r * Math.sin(a) * Math.sin(b),
  );
  const view = Matrix.LookAtRH(eye, new Vector3(target.x, target.y, target.z), Vector3.Up());

  // Act: project the target, a point 10 tiles to sim-NORTH (−y), and one 10
  // tiles to sim-EAST (+x) into view space (+X right, +Y up on screen).
  const pT = simToWorld(1000, 1000);
  const pN = simToWorld(1000, 1000 - 320);
  const pE = simToWorld(1320, 1000);
  const vT = Vector3.TransformCoordinates(new Vector3(pT.x, pT.y, pT.z), view);
  const vN = Vector3.TransformCoordinates(new Vector3(pN.x, pN.y, pN.z), view);
  const vE = Vector3.TransformCoordinates(new Vector3(pE.x, pE.y, pE.z), view);

  // Assert.
  ok(vN.y > vT.y + 0.5, `sim-north is screen-up (Δ=${(vN.y - vT.y).toFixed(2)}m)`);
  ok(vE.x > vT.x + 0.5, `sim-east is screen-right (Δ=${(vE.x - vT.x).toFixed(2)}m)`);
  ok(Math.abs(vN.x - vT.x) < 1e-6, "north has no sideways skew at the locked alpha");
}

console.log(fail === 0 ? "ALL SPACE3D CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
