// Asset-pipeline specs: pure JSON/map checks, zero network. The Gemini pipeline
// stays intact (variant specs reference a real base, carry a pose instruction,
// match canvas size), but the runtime mapping now ENFORCES the rendering fix:
// nothing the engine rotates may be PNG-overridden — only static decor props —
// so generated side-view illustrations can never spin like cutouts again.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_KEY_MAP } from "../src/engine/assets";

interface Spec {
  key: string;
  description?: string;
  variantOf?: string;
  instruction?: string;
  size?: number;
  fill?: number;
}

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok  :", msg);
  }
};

const specs = JSON.parse(readFileSync(join(process.cwd(), "tools", "assets.json"), "utf8")) as Spec[];
const byKey = new Map(specs.map((s) => [s.key, s]));
const variants = specs.filter((s) => s.variantOf);

// --- structural validity --------------------------------------------------------
{
  ok(specs.length >= 60, `a full spec book (${specs.length} specs)`);
  ok(variants.length >= 25, `every pet + the deer get a stride variant (${variants.length})`);

  const danglers = variants.filter((v) => !byKey.has(v.variantOf!));
  ok(danglers.length === 0, `every variant references a real base spec${danglers.length ? " — DANGLING: " + danglers.map((v) => v.key).join(",") : ""}`);

  const badNames = variants.filter((v) => v.key !== `${v.variantOf}_b`);
  ok(badNames.length === 0, `variant keys follow the <base>_b convention${badNames.length ? " — BAD: " + badNames.map((v) => v.key).join(",") : ""}`);

  const noInstr = variants.filter((v) => !v.instruction || v.instruction.trim().length < 10);
  ok(noInstr.length === 0, `every variant carries a real pose instruction${noInstr.length ? " — EMPTY: " + noInstr.map((v) => v.key).join(",") : ""}`);

  const sizeMismatch = variants.filter((v) => (v.size ?? 32) !== (byKey.get(v.variantOf!)?.size ?? 32));
  ok(sizeMismatch.length === 0, `variant canvas sizes match their base${sizeMismatch.length ? " — MISMATCH: " + sizeMismatch.map((v) => v.key).join(",") : ""}`);

  const plainKeys = specs.filter((s) => !s.variantOf && (!s.description || s.description.length < 8));
  ok(plainKeys.length === 0, "every base spec has a real description");
}

// --- runtime mapping: rotating creatures must NOT be overridden ------------------
// The regression guard for the broken-creature-rendering bug: every mapped key
// must be a STATIC prop, and no creature/vehicle key may sneak back in.
{
  const mapped = Object.keys(GENERATED_KEY_MAP);
  ok(mapped.length > 0 && mapped.every((k) => k.startsWith("prop_")), `only static decor props are PNG-overridden (${mapped.join(", ")})`);

  const ROTATING = /^(player|zombie|survivor_npc|pet_|animal_|vehicle_)/;
  const leaked = mapped.filter((k) => ROTATING.test(k));
  ok(leaked.length === 0, `no rotation-facing creature/vehicle key is overridden${leaked.length ? " — LEAKED: " + leaked.join(",") : ""}`);

  // The Gemini pipeline + its variant specs survive for future use, but those
  // creature variants are deliberately UNMAPPED now (procedural art ships).
  const mappedVariants = variants.filter((v) => GENERATED_KEY_MAP[v.key]);
  ok(mappedVariants.length === 0, `creature variant specs stay in the pipeline but unmapped at runtime (${variants.length} specs, 0 mapped)`);
}

console.log(fail === 0 ? "ALL GEN-ASSET CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
