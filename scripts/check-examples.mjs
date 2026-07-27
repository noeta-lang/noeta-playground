/**
 * Gate: every curated example in src/lib/examples.ts must still satisfy the engine
 * the playground actually ships.
 *
 * The samples are the first Noeta most visitors ever run, and they are the one piece
 * of Noeta source in this repo that nothing else compiles — a language change lands in
 * ../lang, the engine is rebuilt on the next deploy, and a sample that no longer checks
 * only shows up as red squiggles in front of a visitor. This closes that gap: it drives
 * public/engine/noeta_playground.wasm over the same hand-rolled (ptr, len) ABI the
 * engine worker uses (src/workers/engine.worker.ts), so a sample is proven against the
 * exact artifact the page loads.
 *
 * Run after the engine is in place (`pnpm run sync-engine`, which `prebuild` does):
 *
 *   pnpm run check:examples          # or: node scripts/check-examples.mjs [path/to/engine.wasm]
 *
 * The package script passes --experimental-strip-types so importing examples.ts works on
 * every Node from 22.6 up, not just the ones that strip types unflagged (22.18+).
 *
 * Each example declares what the toolchain should say about it (see `Example` in
 * src/lib/examples.ts): `expect: "clean"` samples must check with zero diagnostics and
 * run to their declared `exit` code, `expect: "diagnostics"` samples exist to show the
 * checker working and fail if they ever stop being wrong.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { EXAMPLES } from "../src/lib/examples.ts";

const wasmPath =
  process.argv[2] ?? resolve(process.cwd(), "public", "engine", "noeta_playground.wasm");
const bytes = await readFile(wasmPath);

// The `noeta_host` imports, supplied the way the worker does — except that outbound fetch is
// canned: node has no synchronous XHR, and a gate must not depend on the network. Only the
// sandbox entry (`noeta_run`) is used below, so these stay unreached in practice; the engine
// still needs them present to instantiate.
let engine = null; // late-bound: imports are only called during an export call

function packReply(json) {
  const replyBytes = new TextEncoder().encode(json);
  const ptr = engine.noeta_alloc(4 + replyBytes.length);
  new DataView(engine.memory.buffer).setUint32(ptr, replyBytes.length, true);
  new Uint8Array(engine.memory.buffer, ptr + 4, replyBytes.length).set(replyBytes);
  return ptr;
}

const imports = {
  noeta_host: {
    js_debug_pause: () => packReply('{"action":"terminate"}'),
    js_entropy_u64() {
      const word = new BigUint64Array(1);
      crypto.getRandomValues(word);
      return word[0];
    },
    js_now_ms: () => Date.now(),
    js_net_fetch: () => packReply(JSON.stringify({ status: 200, headers: [], body: "pong" })),
    js_fetch_start: () => 0n,
    js_fetch_take: () => 0,
    js_wait: () => {
      throw new Error("js_wait requires JSPI");
    },
  },
};

const { instance } = await WebAssembly.instantiate(bytes, imports);
engine = instance.exports;

/* Mirror of the worker's call(): write the input into engine memory, read the
 * [len: u32 LE][bytes] reply back out, free it. */
function call(entry, input, ...extra) {
  const encoded = new TextEncoder().encode(input);
  const ptr = engine.noeta_alloc(encoded.length);
  new Uint8Array(engine.memory.buffer, ptr, encoded.length).set(encoded);
  const out = entry(ptr, encoded.length, ...extra); // consumes the input buffer
  const len = new DataView(engine.memory.buffer).getUint32(out, true);
  const json = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out + 4, len));
  engine.noeta_free_result(out);
  return JSON.parse(json);
}

const render = (diagnostics) =>
  diagnostics
    .map((d) => `      ${d.severity} ${d.code} at ${d.line}:${d.column} — ${d.message}`)
    .join("\n");

const failures = [];

for (const [name, example] of Object.entries(EXAMPLES)) {
  const { diagnostics } = call(engine.noeta_check, example.source);
  const errors = diagnostics.filter((d) => d.severity !== "warning");

  if (example.expect === "diagnostics") {
    // A teaching sample: it is broken on purpose, and silently starting to compile would
    // leave the page demonstrating nothing.
    if (errors.length === 0) {
      failures.push(`${name}: expected the checker to reject it, but it checks clean`);
    } else {
      console.log(`  ✓ ${name} — rejected as intended (${errors[0].code})`);
    }
    continue;
  }

  if (diagnostics.length > 0) {
    failures.push(`${name}: expected a clean check, got ${diagnostics.length}:\n${render(diagnostics)}`);
    continue;
  }

  // Clean samples must also survive the sandbox — and this is not a formality. `noeta_check`
  // and the run path do not agree in every corner: the `http fetch` sample this gate was
  // written for checked *clean* and still failed on Run with an E0005 the checker never
  // reported. Running is what catches that class, so every clean sample is actually run.
  const result = call(engine.noeta_run, example.source);
  const runErrors = (result.diagnostics ?? []).filter((d) => d.severity !== "warning");
  // A run reports errors for two very different things, told apart by `trace`: a program that
  // aborted has a stack to unwind (the `stack trace` sample does this on purpose), while a
  // program the compiler rejected never ran and has none.
  const rejected = runErrors.length > 0 && !result.trace;
  if (!result.compiled || rejected) {
    failures.push(
      `${name}: checks clean but is rejected on Run — the visitor sees this, the editor does not:\n${render(runErrors)}`,
    );
  } else if (result.exit_code !== example.exit) {
    failures.push(
      `${name}: expected exit ${example.exit}, got ${result.exit_code}` +
        (result.trace ? `\n${result.trace}` : ""),
    );
  } else {
    console.log(`  ✓ ${name} — checks clean, exits ${result.exit_code}`);
  }
}

if (failures.length > 0) {
  console.error(`\n  ${failures.length} playground example(s) no longer work:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(`\n  ${Object.keys(EXAMPLES).length} playground examples OK.`);
