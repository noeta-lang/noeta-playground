/* E2E for the playground. Serve the built site first (pnpm run preview, or
 * `wrangler dev --port 8788`), then `node scripts/e2e.mjs`. Drives the real
 * page: engine warm-up, run, live diagnostics, hover, completion, a full
 * debug session (breakpoint → pause → variables → step → continue →
 * terminate), the runaway-loop guard, and share links. The server must send
 * the COOP/COEP pair (wrangler serves public/_headers; astro dev sets them in
 * astro.config.mjs) — the debug steps assert crossOriginIsolated.
 *
 * Set E2E_SHOTS_DIR to also capture screenshots. */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:8788";
const SHOTS = process.env.E2E_SHOTS_DIR ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("  [console.error]", msg.text());
});
page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

await page.goto(BASE, { waitUntil: "networkidle" });

// 1. Cross-origin isolation (the debugger's precondition).
assert.equal(await page.evaluate(() => crossOriginIsolated), true, "page must be crossOriginIsolated");
console.log("✓ crossOriginIsolated");

// 2. Engine warms up.
await page.waitForFunction(() => document.getElementById("status")?.textContent === "ready", null, { timeout: 30000 });
console.log("✓ engine ready");

// 3. Monaco mounted with the ink-signal theme (background = --ink-1).
const editorBg = await page.evaluate(() => {
  const el = document.querySelector(".monaco-editor .view-lines");
  return !!el && getComputedStyle(document.querySelector(".monaco-editor")).getPropertyValue("--vscode-editor-background").trim();
});
console.log(`✓ Monaco mounted (editor background ${editorBg})`);
assert.equal(editorBg, "#191715");

// 4. Run the welcome example.
await page.click("#run");
await page.waitForFunction(() => document.getElementById("exit")?.textContent?.startsWith("exit"), null, { timeout: 15000 });
const stdout = await page.textContent("#stdout");
assert.match(stdout, /fib\(8\) = 21/);
assert.match(stdout, /fib\(16\) = 987/);
assert.equal(await page.textContent("#exit"), "exit 0");
console.log("✓ run: welcome example output correct");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-run.png` });

// 5. Diagnostics: introduce a type error, expect a marker + diagnostics row.
await page.evaluate(() => {
  window.__playground.editor.getModel().setValue('mut x = 1;\nx = "s";\n');
});
await page.waitForFunction(() => document.querySelectorAll("#diagnostics .diag").length > 0, null, { timeout: 10000 });
const diagText = await page.textContent("#diagnostics");
assert.match(diagText, /E\d{4}/);
const markerCount = await page.evaluate(
  () => window.__playground.monaco.editor.getModelMarkers({}).length,
);
assert.ok(markerCount > 0, "squiggle markers present");
console.log(`✓ live diagnostics (${markerCount} marker(s), pane shows ${diagText.match(/E\d{4}/)[0]})`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-diagnostics.png` });

// 6. Hover: type of `a` inside add.
await page.evaluate(() => {
  window.__playground.editor.getModel().setValue(
    "fn add(a: int, b: int): int {\n  return a + b;\n}\n\necho add(1, 2);\n",
  );
});
await page.waitForTimeout(600); // let the checker clear old markers
await page.evaluate(() => {
  const editor = window.__playground.editor;
  editor.setPosition({ lineNumber: 2, column: 10 });
  editor.trigger("e2e", "editor.action.showHover", {});
});
await page.waitForSelector(".monaco-hover:not(.hidden)", { timeout: 10000 });
const hoverText = await page.textContent(".monaco-hover");
assert.match(hoverText, /int/);
console.log(`✓ hover shows a type (${JSON.stringify(hoverText.trim().slice(0, 40))})`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-hover.png` });

// 7. Completion: suggest widget offers `add`.
await page.evaluate(() => {
  const editor = window.__playground.editor;
  editor.setPosition({ lineNumber: 5, column: 1 });
  editor.trigger("e2e", "editor.action.triggerSuggest", {});
});
await page.waitForSelector(".suggest-widget:not(.hidden) .monaco-list-row", { timeout: 10000 });
const suggestions = await page.$$eval(".suggest-widget .monaco-list-row", (rows) =>
  rows.map((r) => r.getAttribute("aria-label") ?? r.textContent),
);
assert.ok(suggestions.some((s) => s && s.includes("add")), `add in ${suggestions.slice(0, 8)}`);
console.log(`✓ completion offers declared functions (${suggestions.length} items)`);
await page.keyboard.press("Escape");

// 8. Debug session: breakpoint in a loop body, pause, inspect, step, continue.
await page.evaluate(() => {
  const p = window.__playground;
  p.editor.getModel().setValue(
    "fn sum(values: List<int>): int {\n  mut total = 0;\n  for v in values {\n    total = total + v;\n  }\n  return total;\n}\n\necho sum([3, 7, 11]);\n",
  );
  p.toggleBreakpoint(4); // total = total + v
});
assert.deepEqual(await page.evaluate(() => window.__playground.breakpointLines()), [4]);
await page.click("#debug");
await page.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("paused"), null, { timeout: 15000 });
assert.equal(await page.textContent("#status"), "paused: breakpoint");
// The stack shows sum → main; the variables show total and v.
const frames = await page.$$eval("#stack .frame-name", (els) => els.map((e) => e.textContent));
assert.deepEqual(frames, ["sum", "main"]);
let vars = await page.$$eval("#vars .var", (els) =>
  els.map((e) => `${e.querySelector(".var-name").textContent}=${e.querySelector(".var-value").textContent}:${e.querySelector(".var-type").textContent}`),
);
console.log(`✓ paused at breakpoint; stack ${frames.join(" → ")}; locals ${vars.join(", ")}`);
assert.ok(vars.some((v) => v.startsWith("total=0:int")), `first-iteration total in ${vars}`);
// The loop variable is a visible local too (the compiler records loop/match bindings).
assert.ok(vars.some((v) => v.startsWith("v=3:int")), `loop var v in ${vars}`);

// The debug console: an expression over the frame's locals, then a CALL — the program stays
// paused (same stack), and each outcome lands in the log with its type.
await page.fill("#console-input", "total + v");
await page.press("#console-input", "Enter");
await page.waitForSelector(".console-value", { timeout: 15000 });
let consoleValues = await page.$$eval(".console-value", (els) =>
  els.map((e) => `${e.querySelector(".console-text").textContent}:${e.querySelector(".console-type").textContent}`),
);
assert.deepEqual(consoleValues, ["3:int"]);
await page.fill("#console-input", "sum([100, 200])");
await page.press("#console-input", "Enter");
await page.waitForFunction(() => document.querySelectorAll(".console-value").length === 2, null, { timeout: 15000 });
consoleValues = await page.$$eval(".console-value", (els) =>
  els.map((e) => `${e.querySelector(".console-text").textContent}:${e.querySelector(".console-type").textContent}`),
);
assert.deepEqual(consoleValues, ["3:int", "300:int"]);
// An ill-typed fragment is refused inline with its E-code; still paused.
await page.fill("#console-input", 'total + "s"');
await page.press("#console-input", "Enter");
await page.waitForSelector(".console-error", { timeout: 15000 });
const consoleError = await page.textContent(".console-error .console-text");
assert.match(consoleError, /E\d{4}/);
assert.equal(await page.textContent("#status"), "paused: breakpoint");
console.log(`✓ debug console: total + v = 3, sum([100, 200]) = 300, ill-typed refused (${consoleError.slice(0, 30)}…)`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-debug-paused.png` });

// Step over → the loop advances; continue twice through remaining hits.
await page.click("#step-over");
await page.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("paused"), null, { timeout: 15000 });
assert.equal(await page.textContent("#status"), "paused: step");
vars = await page.$$eval("#vars .var", (els) =>
  els.map((e) => `${e.querySelector(".var-name").textContent}=${e.querySelector(".var-value").textContent}`),
);
assert.ok(vars.some((v) => v === "total=3"), `after one iteration total=3 in ${vars}`);
console.log(`✓ step over landed (locals now ${vars.join(", ")})`);

// Continue through the remaining two breakpoint hits, then the run finishes.
await page.click("#step-continue");
await page.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("paused"), null, { timeout: 15000 });
await page.click("#step-continue");
await page.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("paused"), null, { timeout: 15000 });
await page.click("#step-continue");
await page.waitForFunction(() => document.getElementById("exit")?.textContent?.startsWith("exit"), null, { timeout: 15000 });
assert.equal(await page.textContent("#exit"), "exit 0");
assert.match(await page.textContent("#stdout"), /21/);
console.log("✓ continued to completion (sum = 21)");

// 9. Debug terminate: pause again and stop.
await page.click("#debug");
await page.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("paused"), null, { timeout: 15000 });
await page.click("#stop");
await page.waitForFunction(() => document.getElementById("exit")?.textContent === "stopped", null, { timeout: 15000 });
console.log("✓ stop from a pause terminates the session");

// 10. Infinite loop guard: a spin gets terminated and the worker respawns.
await page.evaluate(() => {
  window.__playground.editor.getModel().setValue("mut i = 0;\nwhile true {\n  i = i + 1;\n}\n");
});
await page.waitForTimeout(400);
await page.click("#run");
await page.waitForFunction(
  () => document.getElementById("status")?.textContent?.includes("stopped"),
  null,
  { timeout: 20000 },
);
const guardStatus = await page.textContent("#status");
console.log(`✓ runaway guard fired (${JSON.stringify(guardStatus)})`);

// After a respawn the engine still answers.
await page.evaluate(() => {
  window.__playground.editor.getModel().setValue('echo "alive";\n');
});
await page.waitForTimeout(400);
await page.click("#run");
await page.waitForFunction(() => document.getElementById("stdout")?.textContent === "alive\n", null, { timeout: 20000 });
console.log("✓ engine worker respawned and runs again");

// 11. Share round-trip.
await page.click("#share");
const url = await page.evaluate(() => location.href);
assert.match(url, /#code=v1:/);
const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page2.goto(url, { waitUntil: "networkidle" });
const restored = await page2.evaluate(() => window.__playground.editor.getModel().getValue());
assert.equal(restored, 'echo "alive";\n');
console.log("✓ share link restores the buffer");
await page2.close();

// 12. Mobile layout screenshot.
await page.setViewportSize({ width: 390, height: 844 });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-mobile.png` });

await browser.close();
console.log("\nplayground E2E: all assertions passed ✓");
