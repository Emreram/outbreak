// generate-image skill entrypoint (OUTBREAK port). Run with:
//   npx tsx .claude/skills/generate-image/scripts/generate.ts '{"description":"...","assetType":"prop"}'
// Outputs JSON {imagePath, prompt} to stdout; progress + errors to stderr.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { optimizePrompt } from "./utils/prompt-optimizer";
import { generateImage } from "./api/replicate";

interface Args {
  description?: string;
  assetType?: string;
  baseImagePath?: string;
  outDir?: string; // default public/assets/generated
  outName?: string; // default sanitized(description)_timestamp
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) return fail("missing JSON argument");
  let args: Args;
  try {
    args = JSON.parse(raw) as Args;
  } catch {
    return fail("invalid JSON argument");
  }
  if (!args.description) return fail("description is required");

  const prompt = optimizePrompt(args.description, args.assetType);
  process.stderr.write(`[generate-image] ${args.description} (${args.assetType ?? "general"})\n`);

  let buf: Buffer;
  try {
    buf = await generateImage(prompt, args.baseImagePath);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const outDir = args.outDir ?? join(process.cwd(), "public", "assets", "generated");
  await mkdir(outDir, { recursive: true });
  const name = (args.outName ?? `${sanitize(args.description)}_${stamp()}`) + ".png";
  const imagePath = join(outDir, name);
  await writeFile(imagePath, buf);
  process.stdout.write(JSON.stringify({ imagePath, prompt }) + "\n");
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
}
function stamp(): string {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}
function fail(msg: string): void {
  process.stderr.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(1);
}

void main();
