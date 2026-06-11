import Phaser from "phaser";
import { propKey } from "./propSprites";

// AssetManifest (Feature 3): the single swap-point between AI-generated PNGs and the
// always-on procedural art. The asset pipeline (tools/gen-assets.ts) writes
// public/assets/generated/<key>.png plus a manifest.json (spec-key → file). At boot we
// optionally load that manifest; any listed PNG is loaded under its RUNTIME texture key,
// so the matching procedural generator — which skips keys whose texture already exists —
// is bypassed. With no token / no generated assets the manifest is simply absent and the
// game runs entirely on procedural art: zero behavioural change, no hard dependency.

export const GENERATED_DIR = "assets/generated";
export const GEN_MANIFEST_KEY = "__gen_manifest";

/** asset-spec key (tools/assets.json) → runtime texture key used in-engine. */
export const GENERATED_KEY_MAP: Record<string, string> = {
  player: "player",
  zombie: "zombie",
  survivor_npc: "survivor_npc",
  prop_car: propKey("car"),
  prop_tree: propKey("tree"),
  prop_crate: propKey("crate"),
  prop_barrel: propKey("barrel"),
  prop_corpse: propKey("corpse"),
  vehicle_sedan: propKey("veh_sedan"),
  vehicle_pickup: propKey("veh_pickup"),
  vehicle_van: propKey("veh_van"),
  animal_deer: propKey("animal_deer"),
};

/** Queue an optional generated-asset load from a scene's preload(). If the manifest is
 *  present, each mapped PNG is loaded under its runtime key (winning over procedural
 *  art, since generators skip existing textures); if absent, this is a silent no-op.
 *  Loaded as TEXT, not JSON: Phaser's JSON loader re-THROWS on a parse failure, and a
 *  missing manifest comes back as the SPA's index.html on dev/static hosts — which
 *  used to surface an uncaught SyntaxError on every boot. */
export function loadGeneratedAssets(scene: Phaser.Scene): void {
  scene.load.text(GEN_MANIFEST_KEY, `${GENERATED_DIR}/manifest.json`);
  // When the manifest finishes loading, add the listed PNGs to the SAME load run so
  // they're ready by the time create() runs the procedural generators.
  scene.load.once(
    `filecomplete-text-${GEN_MANIFEST_KEY}`,
    (_key: string, _type: string, raw: unknown) => {
      if (typeof raw !== "string" || !raw.trim().startsWith("{")) return; // absent / HTML fallback
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return; // malformed manifest — procedural art carries the game
      }
      if (!data || typeof data !== "object") return;
      for (const [specKey, file] of Object.entries(data as Record<string, string>)) {
        const runtime = GENERATED_KEY_MAP[specKey];
        if (runtime && typeof file === "string") scene.load.image(runtime, `${GENERATED_DIR}/${file}`);
      }
    },
  );
}
