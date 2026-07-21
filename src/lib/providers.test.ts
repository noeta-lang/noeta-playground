/* Unit tests for the pure engine→Monaco adapters. Run with `node --test` — Node
 * strips the types natively, and `providers.ts` imports `monaco-editor` only as a
 * type, so nothing here needs a browser, the wasm engine, or the Monaco runtime.
 *
 * These cover the mapping layer that a hover regression hid in: a reply shape
 * change is invisible to the engine's own Rust tests and to a passing e2e that
 * only checks a tooltip appeared — but it lands squarely here. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bytePosition,
  completionSuggestions,
  definitionResult,
  hoverResult,
  signatureResult,
  toMonacoRange,
  type EngineRange,
} from "./providers.ts";

const RANGE: EngineRange = {
  start: { line: 0, character: 4 },
  end: { line: 2, character: 9 },
};

test("toMonacoRange shifts zero-based to one-based at both corners", () => {
  assert.deepEqual(toMonacoRange(RANGE), {
    startLineNumber: 1,
    startColumn: 5,
    endLineNumber: 3,
    endColumn: 10,
  });
});

test("hoverResult passes the composed markdown through unchanged", () => {
  // The value is whatever `noeta-ide` composed — a signature, a type decl, prose.
  // The adapter must not reshape it, or the playground would show less than VS Code.
  const value = "```noeta\nfn add(a: int, b: int): int\n```\n\n---\n\nAdds two numbers.";
  const hover = hoverResult({ found: true, value, range: RANGE });
  assert.ok(hover);
  assert.deepEqual(hover.contents, [{ value }]);
  assert.deepEqual(hover.range, toMonacoRange(RANGE));
});

test("hoverResult yields no range for a doc-only hover", () => {
  // A declaration name with attached `@doc` has no span of its own; the engine
  // omits `range`. A fabricated range would underline the wrong text.
  const hover = hoverResult({ found: true, value: "Module docs." });
  assert.ok(hover);
  assert.equal(hover.range, undefined);
  assert.deepEqual(hover.contents, [{ value: "Module docs." }]);
});

test("hoverResult returns null when nothing is under the cursor", () => {
  assert.equal(hoverResult({ found: false }), null);
});

test("definitionResult carries the caller's uri and the mapped range", () => {
  const uri = { toString: () => "inmemory://model/1" } as never;
  const def = definitionResult({ found: true, range: RANGE }, uri);
  assert.deepEqual(def, { uri, range: toMonacoRange(RANGE) });
});

test("definitionResult is null without a target", () => {
  assert.equal(definitionResult({ found: false }, {} as never), null);
  // Defensive: found but no range is not a jump either.
  assert.equal(definitionResult({ found: true }, {} as never), null);
});

test("signatureResult exposes one signature and the active parameter", () => {
  const help = signatureResult({
    found: true,
    label: "add(a: int, b: int)",
    parameters: ["a: int", "b: int"],
    active: 1,
  });
  assert.ok(help);
  assert.equal(help.value.signatures.length, 1);
  assert.equal(help.value.signatures[0].label, "add(a: int, b: int)");
  assert.deepEqual(help.value.signatures[0].parameters, [{ label: "a: int" }, { label: "b: int" }]);
  assert.equal(help.value.activeParameter, 1);
  assert.equal(help.value.activeSignature, 0);
});

test("signatureResult defaults the active parameter to the first", () => {
  const help = signatureResult({ found: true, label: "f()", parameters: [] });
  assert.ok(help);
  assert.equal(help.value.activeParameter, 0);
});

test("signatureResult is null outside a call", () => {
  assert.equal(signatureResult({ found: false }), null);
});

test("completionSuggestions resolves kinds through the injected table and falls back", () => {
  const kindOf = (k: string): string => (k === "function" ? "FN" : "FALLBACK");
  const suggestions = completionSuggestions(
    [
      { label: "add", kind: "function", detail: "fn add(): int" },
      { label: "mystery", kind: "unheard-of" },
    ],
    { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    kindOf,
  );
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].kind, "FN");
  assert.equal(suggestions[0].insertText, "add");
  assert.equal(suggestions[0].detail, "fn add(): int");
  // An unknown kind takes the caller's fallback rather than crashing or vanishing.
  assert.equal(suggestions[1].kind, "FALLBACK");
});

test("completionSuggestions tolerates a missing item list", () => {
  assert.deepEqual(
    completionSuggestions(undefined, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, () => 0),
    [],
  );
});

test("bytePosition maps ASCII byte offsets straight through", () => {
  // "ab\ncd", offset 4 = 'd' on line 2, column 2 (1-based).
  assert.deepEqual(bytePosition("ab\ncd", 4), { lineNumber: 2, column: 2 });
  assert.deepEqual(bytePosition("ab\ncd", 0), { lineNumber: 1, column: 1 });
});

test("bytePosition accounts for multi-byte UTF-8 vs UTF-16 columns", () => {
  // "é" is two UTF-8 bytes but one UTF-16 unit. The "!" after it is at byte 2,
  // and must land at column 2 (Monaco counts UTF-16 units), not column 3.
  assert.deepEqual(bytePosition("é!", 2), { lineNumber: 1, column: 2 });
});
