/**
 * Populate public/engine/noeta_playground.wasm — the toolchain cdylib the
 * playground instantiates in its workers. Resolution order:
 *
 *  1. NOETA_ENGINE_WASM   — an explicit artifact path (CI artifact, custom build).
 *  2. A local ../lang checkout's wasm-release artifact, building it if the
 *     checkout exists but the artifact doesn't (needs the wasm32-unknown-unknown
 *     target: `rustup target add wasm32-unknown-unknown`).
 *  3. NOETA_SKIP_SYNC=1   — trust whatever is already in public/engine/.
 *
 * The CI workflow checks the language repo out next to the site (see
 * .github/workflows/deploy.yml), so path 2 is the same on CI and local disk.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dest = resolve(process.cwd(), "public", "engine", "noeta_playground.wasm");

if (process.env.NOETA_SKIP_SYNC) {
  if (!existsSync(dest)) {
    console.error("  [sync-engine] NOETA_SKIP_SYNC set but public/engine/noeta_playground.wasm is missing");
    process.exit(1);
  }
  console.log("  [sync-engine] NOETA_SKIP_SYNC set — using the engine already in public/engine/");
  process.exit(0);
}

function install(from) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
  const mib = (statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`  [sync-engine] ${from} → public/engine/noeta_playground.wasm (${mib} MiB)`);
}

const explicit = process.env.NOETA_ENGINE_WASM;
if (explicit) {
  if (!existsSync(explicit)) {
    console.error(`  [sync-engine] NOETA_ENGINE_WASM points at a missing file: ${explicit}`);
    process.exit(1);
  }
  install(explicit);
  process.exit(0);
}

const langRepo = resolve(process.cwd(), "..", "lang");
const artifact = resolve(langRepo, "target", "wasm32-unknown-unknown", "wasm-release", "noeta_playground.wasm");

if (!existsSync(langRepo)) {
  console.error(
    "  [sync-engine] no ../lang checkout and no NOETA_ENGINE_WASM — cannot obtain the engine.\n" +
      "  Clone the language repo next to this one, or point NOETA_ENGINE_WASM at a built artifact.",
  );
  process.exit(1);
}

if (!existsSync(artifact)) {
  console.log("  [sync-engine] building the engine (cargo build -p noeta-playground --target wasm32-unknown-unknown --profile wasm-release)…");
  execSync("cargo build -p noeta-playground --target wasm32-unknown-unknown --profile wasm-release", {
    cwd: langRepo,
    stdio: "inherit",
  });
}
install(artifact);
