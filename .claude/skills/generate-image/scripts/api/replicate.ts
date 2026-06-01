// Thin Replicate client for the generate-image skill. Calls Google's
// nano-banana-pro image model and returns the PNG bytes. Network access to
// api.replicate.com is required (confirmed reachable); REPLICATE_API_TOKEN must
// be set in the environment.

import Replicate from "replicate";
import { readFile } from "node:fs/promises";

const MODEL = "google/nano-banana-pro";

export async function generateImage(prompt: string, baseImagePath?: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const replicate = new Replicate({ auth: token });

  const input: Record<string, unknown> = { prompt, aspect_ratio: "1:1", output_format: "png" };
  if (baseImagePath) {
    // image-to-image: pass the reference image so a set stays style-consistent.
    input.image_input = [await readFile(baseImagePath)];
  }

  const output = await replicate.run(MODEL, { input });
  return toBuffer(output);
}

/** Replicate v1 may return a FileOutput (has .url()/.blob()), a URL string, or an array of these. */
async function toBuffer(output: unknown): Promise<Buffer> {
  const first = Array.isArray(output) ? output[0] : output;
  const f = first as { url?: () => string | URL; blob?: () => Promise<Blob> } | string | undefined;
  if (f && typeof f === "object" && typeof f.blob === "function") {
    return Buffer.from(await (await f.blob()).arrayBuffer());
  }
  if (f && typeof f === "object" && typeof f.url === "function") {
    const u = f.url();
    return fetchBuffer(typeof u === "string" ? u : u.href);
  }
  if (typeof f === "string") return fetchBuffer(f);
  throw new Error("Unexpected Replicate output shape");
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
