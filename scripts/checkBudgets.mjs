// Payload budget gate (3D master plan §5/§9): the Babylon entry chunk must
// stay ≤ 3.5 MB gzipped (subpath imports + tree-shaking keep it ~300 KB
// today — this guards regressions like importing the Inspector). Run after
// `npm run build`.

import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT_3D_GZ = 3.5 * 1024 * 1024;

const assets = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
let failed = 0;

const main3d = assets.filter((f) => f.startsWith("main3d-"));
if (main3d.length === 0) {
  console.error("budget: no main3d chunk in dist/assets — build first");
  process.exit(1);
}
for (const f of main3d) {
  const gz = gzipSync(readFileSync(`dist/assets/${f}`)).length;
  const ok = gz <= LIMIT_3D_GZ;
  console.log(`${ok ? "ok  " : "FAIL"}: ${f} gz=${(gz / 1024).toFixed(0)}KB (limit ${(LIMIT_3D_GZ / 1024 / 1024).toFixed(1)}MB)`);
  if (!ok) failed++;
}

process.exit(failed === 0 ? 0 : 1);
