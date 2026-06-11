// Asset-pipeline specs (Anim PR 3): pure JSON/map checks, zero network. Every
// variant spec must reference a real base spec, carry a non-empty pose
// instruction, match its base's canvas size, and resolve through
// GENERATED_KEY_MAP so the runtime can actually load what the pipeline emits.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_KEY_MAP } from "../src/engine/assets";
import { PET_IDS } from "../src/game/pets";

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

// --- runtime resolution ----------------------------------------------------------
{
  const unmapped = variants.filter((v) => !GENERATED_KEY_MAP[v.key]);
  ok(unmapped.length === 0, `every variant key resolves in GENERATED_KEY_MAP${unmapped.length ? " — UNMAPPED: " + unmapped.map((v) => v.key).join(",") : ""}`);

  const petVariants = variants.filter((v) => v.key.startsWith("pet_"));
  ok(petVariants.length === PET_IDS.length, `all ${PET_IDS.length} pet species have a stride variant spec (${petVariants.length})`);
  ok(GENERATED_KEY_MAP.animal_deer_b?.endsWith("_b") === true, "the deer's stride frame maps onto its prop key");
}

console.log(fail === 0 ? "ALL GEN-ASSET CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
