// Batch AI-asset generator for OUTBREAK. Reads tools/assets.json, generates each
// missing asset via the generate-image skill (Replicate nano-banana-pro), then
// post-processes with sharp — keys the flat background to transparency, trims, and
// resizes to game resolution — writing public/assets/generated/<key>.png.
//
//   REPLICATE_API_TOKEN=… npm run gen:assets
//
// Idempotent (skips assets that already exist). Generated PNGs are committed and
// loaded by BootScene via the AssetManifest, with procedural art as the fallback.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { optimizePrompt } from "../.claude/skills/generate-image/scripts/utils/prompt-optimizer";
import { generateImage } from "../.claude/skills/generate-image/scripts/api/replicate";

interface Spec {
  key: string;
  description: string;
  assetType?: string;
  size?: number;
  base?: string; // optional reference asset (key) for style-consistent image-to-image
}

const OUT = join(process.cwd(), "public", "assets", "generated");
const KEY_THRESHOLD = 44; // colour distance from the corner background that becomes transparent

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error(
      "REPLICATE_API_TOKEN not set — get one at https://replicate.com/account/api-tokens,\n" +
        "add it to the environment, then re-run `npm run gen:assets`.\n" +
        "(The game still runs on procedural art until then.)",
    );
    process.exit(1);
  }
  const specs = JSON.parse(await readFile(join(process.cwd(), "tools", "assets.json"), "utf8")) as Spec[];
  await mkdir(OUT, { recursive: true });

  let made = 0;
  for (const s of specs) {
    const outPath = join(OUT, s.key.replace(/[^a-z0-9]+/gi, "_") + ".png");
    if (await exists(outPath)) {
      console.error(`skip  ${s.key} (exists)`);
      continue;
    }
    console.error(`gen   ${s.key} …`);
    const basePath = s.base ? join(OUT, s.base.replace(/[^a-z0-9]+/gi, "_") + ".png") : undefined;
    const raw = await generateImage(optimizePrompt(s.description, s.assetType), basePath && (await exists(basePath)) ? basePath : undefined);
    const png = await postProcess(raw, s.size ?? 32);
    await writeFile(outPath, png);
    made++;
    console.error(`  ->  ${outPath}`);
  }
  console.error(`done. generated ${made}, ${specs.length - made} already present.`);
}

/** Key the flat background to transparency, trim the margin, resize to game res. */
async function postProcess(buf: Buffer, size: number): Promise<Buffer> {
  const keyed = await keyBackground(buf);
  return sharp(keyed)
    .trim()
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Set pixels close to the top-left corner colour (the flat backdrop) to alpha 0. */
async function keyBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const br = data[0];
  const bg = data[1];
  const bb = data[2];
  for (let i = 0; i < data.length; i += ch) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    if (Math.sqrt(dr * dr + dg * dg + db * db) < KEY_THRESHOLD) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

void main();
