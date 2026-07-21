/* Monaco ↔ Noeta: the language registration (Monarch tokenizer mirroring the
 * shared @noeta/theme highlighter), the "signal-dark"/"signal-light" editor
 * themes (the same cool syntax palette as the rest of noeta.dev, one per
 * color-scheme), and the language providers — hover, completion, definition,
 * signature help, formatting, and live diagnostics — each a thin adapter over
 * the wasm engine's IDE exports.
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
import {
  bytePosition,
  completionSuggestions,
  definitionResult,
  hoverResult,
  signatureResult,
} from "./providers";

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

  // "Signal" for Monaco, in both modes: slate surfaces, cool text, blue accent,
  // mint keywords — the token palette from @noeta/theme/theme.css. The two
  // themes mirror the site's light/dark tokens; applyEditorTheme() picks the one
  // matching the OS/browser preference and follows changes live.
  monaco.editor.defineTheme("signal-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "5fe0b0" },
      { token: "string", foreground: "8fd6a0" },
      { token: "string.quote", foreground: "8fd6a0" },
      { token: "string.escape", foreground: "7defc0" },
      { token: "string.hole", foreground: "7defc0" },
      { token: "number", foreground: "e0a878" },
      { token: "type.identifier", foreground: "8fb8f5" },
      { token: "function", foreground: "cdd6e0" },
      { token: "comment", foreground: "69727e", fontStyle: "italic" },
      { token: "annotation", foreground: "7defc0" },
      { token: "identifier", foreground: "e8ebef" },
      { token: "operator", foreground: "a3adba" },
      { token: "delimiter", foreground: "a3adba" },
    ],
    colors: {
      "editor.background": "#111419",
      "editor.foreground": "#e8ebef",
      "editorLineNumber.foreground": "#4a5260",
      "editorLineNumber.activeForeground": "#a3adba",
      "editorCursor.foreground": "#4f8ff7",
      "editor.selectionBackground": "#4f8ff733",
      "editor.inactiveSelectionBackground": "#4f8ff71f",
      "editor.lineHighlightBackground": "#171b21",
      "editorWhitespace.foreground": "#2b313a",
      "editorIndentGuide.background1": "#232a33",
      "editorIndentGuide.activeBackground1": "#38404b",
      "editorBracketMatch.background": "#4f8ff722",
      "editorBracketMatch.border": "#4f8ff766",
      "editorWidget.background": "#171b21",
      "editorWidget.border": "#2b313a",
      "editorSuggestWidget.background": "#171b21",
      "editorSuggestWidget.border": "#2b313a",
      "editorSuggestWidget.selectedBackground": "#1f242c",
      "editorHoverWidget.background": "#171b21",
      "editorHoverWidget.border": "#2b313a",
      "editorError.foreground": "#e5766a",
      "editorWarning.foreground": "#e0a878",
      "scrollbarSlider.background": "#2b313a80",
      "scrollbarSlider.hoverBackground": "#38404ba0",
      "minimap.background": "#111419",
      "input.background": "#171b21",
      "input.border": "#2b313a",
      "focusBorder": "#4f8ff766",
    },
  });

  monaco.editor.defineTheme("signal-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "0c8a66" },
      { token: "string", foreground: "3f8f4f" },
      { token: "string.quote", foreground: "3f8f4f" },
      { token: "string.escape", foreground: "097053" },
      { token: "string.hole", foreground: "097053" },
      { token: "number", foreground: "b5651d" },
      { token: "type.identifier", foreground: "2767d6" },
      { token: "function", foreground: "384657" },
      { token: "comment", foreground: "8a94a4", fontStyle: "italic" },
      { token: "annotation", foreground: "097053" },
      { token: "identifier", foreground: "14181f" },
      { token: "operator", foreground: "47515f" },
      { token: "delimiter", foreground: "47515f" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#14181f",
      "editorLineNumber.foreground": "#b0b8c4",
      "editorLineNumber.activeForeground": "#47515f",
      "editorCursor.foreground": "#2767d6",
      "editor.selectionBackground": "#2767d628",
      "editor.inactiveSelectionBackground": "#2767d615",
      "editor.lineHighlightBackground": "#eceff5",
      "editorWhitespace.foreground": "#d7dce4",
      "editorIndentGuide.background1": "#e4e8f0",
      "editorIndentGuide.activeBackground1": "#c7cedb",
      "editorBracketMatch.background": "#2767d61f",
      "editorBracketMatch.border": "#2767d655",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e4e8f0",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#e4e8f0",
      "editorSuggestWidget.selectedBackground": "#eceff5",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#e4e8f0",
      "editorError.foreground": "#cf3b2f",
      "editorWarning.foreground": "#b5651d",
      "scrollbarSlider.background": "#14181f22",
      "scrollbarSlider.hoverBackground": "#14181f33",
      "minimap.background": "#ffffff",
      "input.background": "#ffffff",
      "input.border": "#e4e8f0",
      "focusBorder": "#2767d655",
    },
  });

  registerProviders();
}

/** The editor theme matching the current OS/browser color-scheme. */
export function editorThemeName(): "signal-dark" | "signal-light" {
  const light =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches;
  return light ? "signal-light" : "signal-dark";
}

/** Follow OS/browser light↔dark changes, re-applying the matching editor theme. */
export function watchEditorTheme(): void {
  if (typeof matchMedia === "undefined") return;
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    monaco.editor.setTheme(editorThemeName());
  });
}

/* --- Providers: thin adapters over the engine's IDE exports. Positions cross
 * as zero-based (line, UTF-16 character) — the LSP convention the engine
 * speaks natively; Monaco is 1-based, so ±1 at the boundary. --- */

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
      return hoverResult(reply);
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
        suggestions: completionSuggestions(
          reply.items,
          range,
          (kind) => COMPLETION_KINDS[kind] ?? monaco.languages.CompletionItemKind.Text,
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
      return definitionResult(reply, model.uri);
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
      return signatureResult(reply);
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
 * mapped exactly (see `bytePosition` in `providers.ts`) rather than assumed
 * equal, so non-ASCII sources square. --- */

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
