---
name: generate-image
description: Generate OUTBREAK 2D game asset images (sprites, props, vehicles, buildings, animals, crops, characters) from text using Replicate's nano-banana-pro model. Use when asked to create/generate 2D images, sprites, textures, or visual assets.
metadata:
  mcpmarket-version: 1.0.0
---
# Generate Image Skill (OUTBREAK port)

Generates **top-down 2D** game assets via Replicate `google/nano-banana-pro`, framed for our
top-down survival game (overhead view, plain backdrop the post-processor keys to transparency,
cohesive gritty post-apocalyptic style). Procedural art remains the always-on fallback.

## Prerequisites
- `REPLICATE_API_TOKEN` set in the environment (get one at https://replicate.com/account/api-tokens).
- Network access to `api.replicate.com` (the env network policy must allow it — confirmed reachable).
- Dev deps installed: `replicate`, `tsx`, `sharp` (already in package.json).

## Single image
```bash
npm run gen:image -- '{ "description": "rusty sedan car wreck", "assetType": "vehicle" }'
```
`assetType`: `vehicle` | `building` | `character` | `animal` | `prop` | `obstacle` | `tile` | `item` | `general`.
Optional: `baseImagePath` (image-to-image for style consistency), `outDir`, `outName`.
Outputs JSON `{ imagePath, prompt }` to stdout; progress/errors to stderr; PNG saved under
`public/assets/generated/`.

## Batch (the game's asset set)
Edit `tools/assets.json` (key → description/assetType/size), then:
```bash
npm run gen:assets
```
Generates every missing asset, **keys the background to transparency**, trims, resizes to game
resolution, and writes `public/assets/generated/<key>.png`. Idempotent. The AssetManifest
(`src/engine/assets.ts`) loads these in BootScene, falling back to procedural art for any missing key.

## Files
- `.claude/skills/generate-image/scripts/generate.ts` — entrypoint (single image)
- `.claude/skills/generate-image/scripts/api/replicate.ts` — Replicate client (nano-banana-pro → PNG bytes)
- `.claude/skills/generate-image/scripts/utils/prompt-optimizer.ts` — top-down prompt builder
- `tools/assets.json` — the asset spec list · `tools/gen-assets.ts` — batch generator + sharp post-process
