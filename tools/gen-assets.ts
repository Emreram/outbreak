// Batch AI-asset generator for OUTBREAK (PR-E). Reads tools/assets.json,
// generates each missing asset with the Gemini image API, then post-processes
// with sharp — keys the flat chroma background to transparency, trims, resizes
// to game resolution — writing public/assets/generated/<key>.png + manifest.json.
//
//   GEMINI_API_KEY=… npm run gen:assets            # all missing
//   GEMINI_API_KEY=… npm run gen:assets -- --only=pet_griffin
//   GEMINI_API_KEY=… npm run gen:assets -- --force # regenerate listed/all
//
// Two Google endpoints are supported and probed in order (standard API keys use
// generativelanguage.googleapis.com; "AQ."-prefixed Vertex express keys use
// aiplatform.googleapis.com): whichever answers first is cached for the run.
//
// BUILD-TIME ONLY: the game never calls this at runtime. Generated PNGs are
// committed and loaded by BootScene via the AssetManifest, with procedural art
// as the always-on fallback — no key, no network, no problem (exit 0).

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

interface Spec {
  key: string;
  description: string;
  assetType?: string;
  size?: number;
  /** Fraction of the canvas the subject spans (default 1). Pets use ~0.7 so a
   *  generated sprite sits at the same world scale as the procedural 64px art. */
  fill?: number;
  /** Animation variant (Anim PR 3): redraw the committed PNG of this spec key in
   *  a new pose via image-to-image. Skipped gracefully when the base is absent. */
  variantOf?: string;
  /** The pose change for a variant (appended to VARIANT_STYLE). */
  instruction?: string;
}

const OUT = join(process.cwd(), "public", "assets", "generated");
const MODEL = "gemini-2.5-flash-image";
const KEY_THRESHOLD = 90; // colour distance from pure chroma green that becomes transparent

// Every prompt shares one art direction so the set reads as ONE game.
const STYLE =
  "Top-down orthographic 2D game sprite viewed directly from above, neutral overhead studio lighting " +
  "with NO green colour cast on the subject, gritty muted survival-game palette, crisp readable " +
  "silhouette, subtle dark outline, single centered subject facing RIGHT, plain solid pure green " +
  "#00FF00 background filling the whole frame, no text, no watermark, no border, no ground shadow. Subject: ";

// Identity-pinning prefix for image-to-image animation frames (Anim PR 3): the
// model must change NOTHING except the pose, or the frame pair will flicker.
const VARIANT_STYLE =
  "Redraw this exact sprite: the SAME creature, same colours and markings, same art style, same " +
  "top-down orthographic viewing angle, same facing direction (RIGHT), same plain solid green " +
  "background, same framing and same subject size. Change ONLY the pose, as follows: ";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

type Endpoint = "genlang" | "vertex";
let working: Endpoint | null = null;

/** One generateContent call returning the first inline image as a Buffer.
 *  `baseImage` switches to image-to-image: the PNG is sent as an inline part
 *  ahead of the pose instruction (Anim PR 3 stride frames). */
async function callGemini(apiKey: string, prompt: string, ep: Endpoint, baseImage?: Buffer): Promise<Buffer> {
  const url =
    ep === "genlang"
      ? `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
      : `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ep === "genlang") headers["x-goog-api-key"] = apiKey;
  const parts: object[] = [];
  if (baseImage) parts.push({ inline_data: { mime_type: "image/png", data: baseImage.toString("base64") } });
  parts.push({ text: prompt });
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`${ep} HTTP ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error(`${ep}: no inline image in the response`);
  return Buffer.from(b64, "base64");
}

/** Probe endpoints once, then stick with the winner. */
async function generate(apiKey: string, prompt: string, baseImage?: Buffer): Promise<Buffer> {
  if (working) return callGemini(apiKey, prompt, working, baseImage);
  const order: Endpoint[] = apiKey.startsWith("AQ.") ? ["vertex", "genlang"] : ["genlang", "vertex"];
  let lastErr: unknown;
  for (const ep of order) {
    try {
      const buf = await callGemini(apiKey, prompt, ep, baseImage);
      working = ep;
      console.error(`  (endpoint: ${ep})`);
      return buf;
    } catch (e) {
      lastErr = e;
      console.error(`  ${String(e).slice(0, 160)}`);
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const specs = JSON.parse(await readFile(join(process.cwd(), "tools", "assets.json"), "utf8")) as Spec[];
  await mkdir(OUT, { recursive: true });
  if (process.argv.includes("--sheet")) {
    await contactSheet(specs); // curation needs no key — it reads what's on disk
    process.exit(0);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      "GEMINI_API_KEY not set — add it to your environment (or a gitignored .env) and re-run\n" +
        "`npm run gen:assets`. The game runs entirely on procedural art until then.",
    );
    process.exit(0); // a missing key must never fail a build
  }
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const force = process.argv.includes("--force");

  const fileFor = (key: string): string => join(OUT, key.replace(/[^a-z0-9]+/gi, "_") + ".png");
  let made = 0;
  let failed = 0;
  for (const s of specs) {
    if (only && s.key !== only) continue;
    const outPath = fileFor(s.key);
    if (!force && (await exists(outPath))) {
      console.error(`skip  ${s.key} (exists)`);
      continue;
    }
    // Variants (Anim PR 3): image-to-image off the committed base PNG. No base
    // on disk → skip gracefully (the runtime falls back to single frame + gait).
    let baseImage: Buffer | undefined;
    if (s.variantOf) {
      const basePath = fileFor(s.variantOf);
      if (!(await exists(basePath))) {
        console.error(`skip  ${s.key} (no base PNG ${s.variantOf} — run base generation first)`);
        continue;
      }
      baseImage = await readFile(basePath);
    }
    console.error(`gen   ${s.key} …`);
    try {
      const prompt = baseImage ? VARIANT_STYLE + (s.instruction ?? "the alternate walking stride") : STYLE + s.description;
      const raw = await generate(apiKey, prompt, baseImage);
      const png = await postProcess(raw, s.size ?? 32, s.fill ?? 1);
      await writeFile(outPath, png);
      made++;
      console.error(`  ->  ${outPath}`);
      // Drift guard: an i2i frame whose subject size strays from its base will
      // jitter when the pair cycles — flag it loudly for the curation pass.
      if (baseImage && s.variantOf) {
        const a = await subjectBox(await readFile(fileFor(s.variantOf)));
        const b = await subjectBox(png);
        if (a && b && (Math.abs(a.w - b.w) / a.w > 0.12 || Math.abs(a.h - b.h) / a.h > 0.12)) {
          console.error(`  WARN drift ${s.key}: base ${a.w}x${a.h} vs variant ${b.w}x${b.h} — eyeball this pair`);
        }
      }
    } catch (e) {
      failed++;
      console.error(`  FAILED ${s.key}: ${String(e).slice(0, 200)}`);
      if (failed >= 3 && made === 0) {
        console.error("Repeated failures with no successes — stopping (procedural art carries the game).");
        break;
      }
    }
  }

  // Manifest (spec-key → file) of every asset that now exists so BootScene's
  // AssetManifest can load them and override the procedural art for those keys.
  const manifest: Record<string, string> = {};
  for (const s of specs) {
    const fn = s.key.replace(/[^a-z0-9]+/gi, "_") + ".png";
    if (await exists(join(OUT, fn))) manifest[s.key] = fn;
  }
  await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.error(
    `done. generated ${made}, failed ${failed}. manifest: ${Object.keys(manifest).length} keys.`,
  );
  process.exit(0); // generation is best-effort by design
}

/** Key the chroma background to transparency, trim the margin, resize so the
 *  subject spans `size·fill`, then pad the canvas back out to `size` centred. */
async function postProcess(buf: Buffer, size: number, fill: number): Promise<Buffer> {
  const keyed = await keyBackground(buf);
  const inner = Math.max(8, Math.round(size * Math.min(1, Math.max(0.2, fill))));
  const padA = Math.floor((size - inner) / 2);
  const padB = size - inner - padA;
  return sharp(keyed)
    .trim()
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: padA, bottom: padB, left: padA, right: padB, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Set pixels close to the BACKDROP COLOUR to alpha 0 with a soft edge band.
 *  The backdrop is sampled from the corners (models often render our requested
 *  chroma green as a muted olive — keying on the actual corner colour beats
 *  trusting the prompt). Despill only applies when the backdrop really is green. */
async function keyBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  // average the four corners — robust against a stray subject pixel in one
  const w = info.width;
  const hgt = info.height;
  const corners = [0, (w - 1) * ch, (hgt - 1) * w * ch, ((hgt - 1) * w + (w - 1)) * ch];
  const br = Math.round(corners.reduce((a, o) => a + data[o], 0) / 4);
  const bg = Math.round(corners.reduce((a, o) => a + data[o + 1], 0) / 4);
  const bb = Math.round(corners.reduce((a, o) => a + data[o + 2], 0) / 4);
  const greenish = bg > 100 && bg > br * 1.2 && bg > bb * 1.2;
  for (let i = 0; i < data.length; i += ch) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    if (d < KEY_THRESHOLD) {
      data[i + 3] = 0;
      continue;
    }
    if (d < KEY_THRESHOLD * 1.5) data[i + 3] = Math.min(data[i + 3], Math.round(((d - KEY_THRESHOLD) / (KEY_THRESHOLD * 0.5)) * 255));
    // despill: green light bounced off a green backdrop tints kept pixels —
    // clamp green down toward the other channels so subjects stay colour-true
    if (greenish) {
      const cap = Math.round(Math.max(data[i], data[i + 2]) * 1.18);
      if (data[i + 1] > cap) data[i + 1] = cap;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

/** Trimmed (non-transparent) subject bounds — the drift guard's measure. */
async function subjectBox(png: Buffer): Promise<{ w: number; h: number } | null> {
  try {
    const t = await sharp(png).trim().toBuffer({ resolveWithObject: true });
    return { w: t.info.width, h: t.info.height };
  } catch {
    return null;
  }
}

/** --sheet: composite every base/variant pair side by side for curation. */
async function contactSheet(specs: Spec[]): Promise<void> {
  const pairs = specs.filter((s) => s.variantOf);
  const CELL = 72;
  const rows: sharp.OverlayOptions[] = [];
  let row = 0;
  for (const s of pairs) {
    const basePath = join(OUT, s.variantOf!.replace(/[^a-z0-9]+/gi, "_") + ".png");
    const varPath = join(OUT, s.key.replace(/[^a-z0-9]+/gi, "_") + ".png");
    if (!(await exists(basePath)) || !(await exists(varPath))) continue;
    const norm = (p: string) =>
      sharp(p).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    rows.push({ input: await norm(basePath), left: 4, top: row * CELL + 4 });
    rows.push({ input: await norm(varPath), left: CELL + 4, top: row * CELL + 4 });
    row++;
  }
  if (row === 0) {
    console.error("no base/variant pairs on disk yet");
    return;
  }
  await sharp({ create: { width: CELL * 2 + 8, height: row * CELL + 8, channels: 4, background: { r: 60, g: 64, b: 70, alpha: 255 } } })
    .composite(rows)
    .png()
    .toFile(join(process.cwd(), "tools", "contact-sheet.png"));
  console.error(`tools/contact-sheet.png: ${row} pairs (base | variant)`);
}

void main();
