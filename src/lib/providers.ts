/* The pure adapters between the wasm engine's JSON replies and Monaco's provider
 * shapes — extracted from `monaco-noeta.ts` so they can be unit-tested without a
 * browser, a live engine, or the `monaco-editor` runtime.
 *
 * The one runtime dependency deliberately avoided here is `monaco-editor` itself:
 * these functions build plain objects (a `monaco.IRange` is structurally just
 * `{startLineNumber, …}`), and the `monaco` import is **type-only** so nothing
 * from that package is loaded at runtime. That is what lets `node --test` import
 * this module directly. Anything that needs a real Monaco enum value (completion
 * `kind`, marker `severity`) stays in `monaco-noeta.ts`; the string→enum table is
 * passed in where a pure function needs it, so even that mapping is testable.
 *
 * Positions on the wire are zero-based `(line, character)` UTF-16 units (the LSP
 * convention the engine speaks); Monaco is one-based, hence the ±1 at the edges. */

import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export type EngineRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

/** A zero-based engine range → Monaco's one-based `IRange`. */
export function toMonacoRange(range: EngineRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/** The engine's `hover` reply — already-composed Markdown plus an optional span. */
export type HoverReply = {
  found: boolean;
  value?: string;
  range?: EngineRange;
};

/**
 * A `hover` reply → a Monaco `Hover`, or `null` when nothing is under the cursor.
 *
 * `value` is passed through verbatim: it is the Markdown `noeta-ide` already
 * composed (signature + doc, type declaration, tier/directive/use/namespace, or
 * the bare type), the same content VS Code shows. `range` is **absent** for a
 * doc-only hover, which has no single span to underline — that case yields a
 * hover with no `range` rather than a fabricated one.
 */
export function hoverResult(reply: HoverReply): monaco.languages.Hover | null {
  if (!reply.found) return null;
  return {
    range: reply.range ? toMonacoRange(reply.range) : undefined,
    contents: [{ value: reply.value ?? "" }],
  };
}

/** The engine's `definition` reply. */
export type DefinitionReply = {
  found: boolean;
  range?: EngineRange;
};

/**
 * A `definition` reply → a Monaco `Definition`, or `null`. The playground is
 * single-file, so the target is always in the same model — `uri` is the caller's
 * own model URI.
 */
export function definitionResult(
  reply: DefinitionReply,
  uri: monaco.Uri,
): monaco.languages.Definition | null {
  if (!reply.found || !reply.range) return null;
  return { uri, range: toMonacoRange(reply.range) };
}

/** The engine's `signature` reply. */
export type SignatureReply = {
  found: boolean;
  label?: string;
  parameters?: string[];
  active?: number;
};

/**
 * A `signature` reply → a Monaco `SignatureHelpResult`, or `null`. One signature
 * (Noeta has no overloading), `active` naming the argument under the cursor and
 * defaulting to the first.
 */
export function signatureResult(
  reply: SignatureReply,
): monaco.languages.SignatureHelpResult | null {
  if (!reply.found) return null;
  return {
    value: {
      signatures: [
        {
          label: reply.label ?? "",
          parameters: (reply.parameters ?? []).map((p) => ({ label: p })),
        },
      ],
      activeSignature: 0,
      activeParameter: reply.active ?? 0,
    },
    dispose() {},
  };
}

/** One completion item as the engine reports it. */
export type CompletionItem = { label: string; kind: string; detail?: string };

/**
 * Completion items → Monaco suggestions, all sharing `range` (the word under the
 * cursor). `kindOf` resolves the engine's kind string to a Monaco enum value and
 * is injected rather than imported so this stays runtime-free and testable; an
 * unknown kind is the caller's fallback, exercised by passing a `kindOf` that
 * returns it.
 */
export function completionSuggestions<K>(
  items: CompletionItem[] | undefined,
  range: monaco.IRange,
  kindOf: (kind: string) => K,
): Array<{ label: string; kind: K; detail?: string; insertText: string; range: monaco.IRange }> {
  return (items ?? []).map((item) => ({
    label: item.label,
    kind: kindOf(item.kind),
    detail: item.detail,
    insertText: item.label,
    range,
  }));
}

/**
 * Map a UTF-8 byte offset into a Monaco `(lineNumber, column)`, both one-based.
 *
 * The engine reports diagnostic spans as UTF-8 byte offsets; Monaco columns count
 * UTF-16 code units. A non-ASCII character (`é` is two UTF-8 bytes, one UTF-16
 * unit) makes those diverge, so the two are mapped rather than assumed equal.
 */
export function bytePosition(
  source: string,
  byteOffset: number,
): { lineNumber: number; column: number } {
  let bytes = 0;
  let line = 1;
  let column = 1;
  const encoder = new TextEncoder();
  for (const ch of source) {
    if (bytes >= byteOffset) break;
    bytes += encoder.encode(ch).length;
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += ch.length; // UTF-16 units — what Monaco columns count
    }
  }
  return { lineNumber: line, column };
}
