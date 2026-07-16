/* Monaco ↔ Noeta: the language registration (Monarch tokenizer mirroring the
 * shared @noeta/theme highlighter), the "ink-signal" editor theme (the same
 * everforest-warm syntax palette as the rest of noeta.dev), and the language
 * providers — hover, completion, definition, signature help, formatting, and
 * live diagnostics — each a thin adapter over the wasm engine's IDE exports.
 *
 * There is no language server process and no JSON-RPC: the engine IS
 * noeta-ide, the exact DocumentStore `noeta lsp` adapts over, compiled to
 * wasm. Monaco's providers call it directly, so the answers here are the
 * LSP's answers with none of the wire. */

// editor.all (side-effect import) wires every editor contribution — the hover
// widget, suggest, parameter hints, the format action — while leaving out the
// built-in web languages that the full "monaco-editor" entry drags along
// (Noeta's smarts come from the wasm engine instead). editor.api is the typed
// API surface over it; explicit .js so Vite and TypeScript's bundler
// resolution land on the same files (each .d.ts sits beside its .js).
import "monaco-editor/esm/vs/editor/editor.all.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { engine, type Diagnostic } from "./engine-client";

export const LANGUAGE_ID = "noeta";

const KEYWORDS = [
  "fn", "return", "if", "else", "for", "in", "match", "enum", "struct", "class",
  "use", "mut", "async", "await", "concurrent", "true", "false", "void",
];

export function registerNoeta() {
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".noe"], aliases: ["Noeta"] });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: "//" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /[{([]\s*$/,
      decreaseIndentPattern: /^\s*[})\]]/,
    },
  });

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: "",
    tokenPostfix: ".noeta",
    keywords: KEYWORDS,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/@[a-z_]\w*/, "annotation"],
        [/"/, { token: "string.quote", next: "@string" }],
        [/\d[\d_]*(\.\d+)?/, "number"],
        [/[A-Z]\w*/, "type.identifier"],
        [/[a-z_]\w*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function" } }],
        [/[a-z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[{}()[\]]/, "@brackets"],
        [/[=+\-*/%<>!&|^~?:;,.]+/, "operator"],
      ],
      string: [
        [/\$\{[^}]*\}/, "string.hole"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", next: "@pop" }],
        [/[^"\\$]+/, "string"],
        [/\$/, "string"],
      ],
    },
  });

  // "Ink & Signal" for Monaco: ink surfaces, paper text, amber signal accent,
  // the everforest-warm syntax palette — the tokens from @noeta/theme/theme.css.
  monaco.editor.defineTheme("ink-signal", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "e69f37" },
      { token: "string", foreground: "a9c181" },
      { token: "string.quote", foreground: "a9c181" },
      { token: "string.escape", foreground: "ffc46b" },
      { token: "string.hole", foreground: "ffc46b" },
      { token: "number", foreground: "e6836a" },
      { token: "type.identifier", foreground: "dbbc7f" },
      { token: "function", foreground: "d3c6aa" },
      { token: "comment", foreground: "837d6f", fontStyle: "italic" },
      { token: "annotation", foreground: "ffc46b" },
      { token: "identifier", foreground: "ece7da" },
      { token: "operator", foreground: "b9b2a1" },
      { token: "delimiter", foreground: "b9b2a1" },
    ],
    colors: {
      "editor.background": "#191715",
      "editor.foreground": "#ece7da",
      "editorLineNumber.foreground": "#5c574d",
      "editorLineNumber.activeForeground": "#b9b2a1",
      "editorCursor.foreground": "#e69f37",
      "editor.selectionBackground": "#e69f3730",
      "editor.inactiveSelectionBackground": "#e69f3718",
      "editor.lineHighlightBackground": "#211e1b",
      "editorWhitespace.foreground": "#2b2723",
      "editorIndentGuide.background1": "#2b2723",
      "editorIndentGuide.activeBackground1": "#3d382f",
      "editorBracketMatch.background": "#e69f3722",
      "editorBracketMatch.border": "#e69f3766",
      "editorWidget.background": "#211e1b",
      "editorWidget.border": "#3d382f",
      "editorSuggestWidget.background": "#211e1b",
      "editorSuggestWidget.border": "#3d382f",
      "editorSuggestWidget.selectedBackground": "#2b2723",
      "editorHoverWidget.background": "#211e1b",
      "editorHoverWidget.border": "#3d382f",
      "editorError.foreground": "#e67e70",
      "editorWarning.foreground": "#dbbc7f",
      "scrollbarSlider.background": "#2b272380",
      "scrollbarSlider.hoverBackground": "#3d382fa0",
      "minimap.background": "#191715",
      "input.background": "#211e1b",
      "input.border": "#3d382f",
      "focusBorder": "#e69f3766",
    },
  });

  registerProviders();
}

/* --- Providers: thin adapters over the engine's IDE exports. Positions cross
 * as zero-based (line, UTF-16 character) — the LSP convention the engine
 * speaks natively; Monaco is 1-based, so ±1 at the boundary. --- */

type EngineRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

function toMonacoRange(range: EngineRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

const COMPLETION_KINDS: Record<string, monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  function: monaco.languages.CompletionItemKind.Function,
  struct: monaco.languages.CompletionItemKind.Struct,
  class: monaco.languages.CompletionItemKind.Class,
  enum: monaco.languages.CompletionItemKind.Enum,
  variable: monaco.languages.CompletionItemKind.Variable,
  field: monaco.languages.CompletionItemKind.Field,
  method: monaco.languages.CompletionItemKind.Method,
  "enum-member": monaco.languages.CompletionItemKind.EnumMember,
  type: monaco.languages.CompletionItemKind.TypeParameter,
  module: monaco.languages.CompletionItemKind.Module,
};

function registerProviders() {
  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    async provideHover(model, position) {
      const reply = await engine.hover(
        model.getValue(),
        position.lineNumber - 1,
        position.column - 1,
      );
      if (!reply.found) return null;
      const note = reply.note ? `\n\n${reply.note}` : "";
      return {
        range: toMonacoRange(reply.range),
        contents: [{ value: "```noeta\n" + reply.type + "\n```" + note }],
      };
    },
  });

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      const reply = await engine.complete(
        model.getValue(),
        position.lineNumber - 1,
        position.column - 1,
      );
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };
      return {
        suggestions: (reply.items ?? []).map(
          (item: { label: string; kind: string; detail?: string }) => ({
            label: item.label,
            kind: COMPLETION_KINDS[item.kind] ?? monaco.languages.CompletionItemKind.Text,
            detail: item.detail,
            insertText: item.label,
            range,
          }),
        ),
      };
    },
  });

  monaco.languages.registerDefinitionProvider(LANGUAGE_ID, {
    async provideDefinition(model, position) {
      const reply = await engine.definition(
        model.getValue(),
        position.lineNumber - 1,
        position.column - 1,
      );
      if (!reply.found) return null;
      return { uri: model.uri, range: toMonacoRange(reply.range) };
    },
  });

  monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
    signatureHelpTriggerCharacters: ["(", ","],
    async provideSignatureHelp(model, position) {
      const reply = await engine.signature(
        model.getValue(),
        position.lineNumber - 1,
        position.column - 1,
      );
      if (!reply.found) return null;
      return {
        value: {
          signatures: [
            {
              label: reply.label,
              parameters: (reply.parameters ?? []).map((p: string) => ({ label: p })),
            },
          ],
          activeSignature: 0,
          activeParameter: reply.active ?? 0,
        },
        dispose() {},
      };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
    async provideDocumentFormattingEdits(model) {
      const reply = await engine.fmt(model.getValue());
      if (!reply.ok || typeof reply.formatted !== "string") return [];
      return [{ range: model.getFullModelRange(), text: reply.formatted }];
    },
  });
}

/* --- Live diagnostics: `check` on every edit (debounced), surfaced as Monaco
 * markers. The engine's byte offsets are UTF-8; Monaco positions are UTF-16 —
 * mapped exactly rather than assumed equal, so non-ASCII sources square. --- */

/** Map a UTF-8 byte offset into a Monaco (line, column), both 1-based. */
function bytePosition(source: string, byteOffset: number): { lineNumber: number; column: number } {
  let bytes = 0;
  let line = 1;
  let column = 1;
  for (const ch of source) {
    if (bytes >= byteOffset) break;
    bytes += new TextEncoder().encode(ch).length;
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += ch.length; // UTF-16 units — what Monaco columns count
    }
  }
  return { lineNumber: line, column };
}

const SEVERITY: Record<string, monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  note: monaco.MarkerSeverity.Info,
};

export function toMarkers(source: string, diagnostics: Diagnostic[]): monaco.editor.IMarkerData[] {
  return diagnostics.map((d) => {
    const start = bytePosition(source, d.byte_start);
    const end = d.byte_end > d.byte_start ? bytePosition(source, d.byte_end) : start;
    return {
      severity: SEVERITY[d.severity] ?? monaco.MarkerSeverity.Info,
      code: d.code,
      message: d.message + (d.help ? `\nhelp: ${d.help}` : ""),
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column === start.column && end.lineNumber === start.lineNumber ? end.column + 1 : end.column,
    };
  });
}

/** Wire live checking to a model: debounce edits, check, set markers. */
export function attachDiagnostics(model: monaco.editor.ITextModel, onDiagnostics?: (d: Diagnostic[]) => void) {
  let timer = 0;
  let generation = 0;
  const refresh = () => {
    const gen = ++generation;
    const source = model.getValue();
    engine
      .check(source)
      .then((reply) => {
        if (gen !== generation || model.isDisposed()) return;
        monaco.editor.setModelMarkers(model, "noeta", toMarkers(source, reply.diagnostics));
        onDiagnostics?.(reply.diagnostics);
      })
      .catch(() => {});
  };
  model.onDidChangeContent(() => {
    clearTimeout(timer);
    timer = window.setTimeout(refresh, 250);
  });
  refresh();
}

export { monaco };
