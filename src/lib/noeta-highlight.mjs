// Build-time Noeta highlighting with the CANONICAL TextMate grammar (synced
// into syntaxes/ by scripts/sync-grammars.mjs) through shiki, replacing the
// regex-based `highlightNoeta` from @noeta/theme on this site.
//
// Two grammars are registered:
//   - noeta.tmLanguage.json          — the core grammar (source.noeta)
//   - tier-languages.tmLanguage.json — the injection grammar (injectTo
//     source.noeta) that colors embedded-language tier bodies: @sql{…} as SQL,
//     @html{…} as HTML, …, with ${…} holes scoped back to source.noeta. The
//     languages it injects are preloaded below so the includes resolve.
//
// Instead of a pre-baked color theme, the shiki theme maps TextMate scopes to
// the Ink & Signal syntax variables (--syn-* from @noeta/theme), i.e. the same
// palette the old tok-* highlighter used. Shiki passes `var(…)` foregrounds
// straight through to inline styles, and the variables flip with
// prefers-color-scheme, so light/dark keeps working with a single theme.
//
// The exported helper returns the INNER html (token spans only, no <pre><code>
// wrapper) because the consuming templates (CodeWindow.astro, og.astro) bring
// their own pre/code chrome, exactly as they did around the old highlighter's
// span soup.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHighlighter } from "shiki";

// Resolved from the project root, not import.meta.url: prerendered pages are
// bundled into dist/.prerender/chunks/, where a module-relative path would
// point at dist/syntaxes/. Astro always runs with cwd = project root.
const grammar = (file) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "syntaxes", file), "utf8"));

/** Languages the tier-languages injection grammar embeds (by scope name). */
const TIER_LANGS = [
  "sql",
  "html",
  "css",
  "json",
  "yaml",
  "xml",
  "graphql",
  "markdown",
  "javascript",
  "python",
  "shellscript",
  "toml",
  "sparql",
];

/** Ink & Signal as a shiki theme: scope → the site's --syn-* CSS variables. */
const inkSignal = {
  name: "noeta-ink-signal",
  type: "dark",
  colors: {
    "editor.foreground": "var(--text-0)",
    "editor.background": "transparent",
  },
  settings: [
    { settings: { foreground: "var(--text-0)", background: "transparent" } },
    { scope: "comment", settings: { foreground: "var(--syn-comment)", fontStyle: "italic" } },
    { scope: ["string", "punctuation.definition.string", "constant.character.escape"], settings: { foreground: "var(--syn-string)" } },
    { scope: "constant.numeric", settings: { foreground: "var(--syn-number)" } },
    { scope: ["keyword", "storage", "constant.language", "variable.language"], settings: { foreground: "var(--syn-keyword)" } },
    // Symbolic operators stay plain (as the site always rendered them);
    // word operators (`is`, `and`, …) read as keywords.
    { scope: "keyword.operator", settings: { foreground: "var(--text-0)" } },
    { scope: "keyword.operator.word", settings: { foreground: "var(--syn-keyword)" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "var(--syn-type)" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "var(--syn-fn)" } },
    // @directives and @tier{…} openers — the tok-tier accent.
    { scope: "entity.name.function.decorator", settings: { foreground: "var(--accent-2-bright)" } },
    { scope: "entity.name.tag", settings: { foreground: "var(--syn-tag)" } },
    { scope: "entity.other.attribute-name", settings: { foreground: "var(--syn-string)" } },
    // ${…} interpolation/hole delimiters — the tok-hole accent.
    { scope: ["punctuation.definition.template-expression", "punctuation.section.embedded"], settings: { foreground: "var(--syn-hole)" } },
    // Markdown bodies inside @doc/text tiers.
    { scope: "markup.heading", settings: { foreground: "var(--syn-keyword)", fontStyle: "bold" } },
    { scope: "markup.bold", settings: { fontStyle: "bold" } },
    { scope: "markup.italic", settings: { fontStyle: "italic" } },
    { scope: "markup.inline.raw", settings: { foreground: "var(--syn-string)" } },
  ],
};

let highlighterPromise;
function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: [inkSignal],
    langs: [
      ...TIER_LANGS,
      { ...grammar("noeta.tmLanguage.json"), name: "noeta" },
      {
        ...grammar("tier-languages.tmLanguage.json"),
        name: "noeta-tier-languages",
        injectTo: ["source.noeta"],
      },
    ],
    langAlias: { noe: "noeta" },
  });
  return highlighterPromise;
}

/**
 * Highlight Noeta source into inner HTML (token spans with inline
 * `var(--syn-*)` colors, one `span.line` per source line) for embedding in a
 * caller-owned `<pre><code>`.
 * @param {string} code
 * @returns {Promise<string>} HTML
 */
export async function highlightNoeta(code) {
  const highlighter = await getHighlighter();
  const html = highlighter.codeToHtml(code, { lang: "noeta", theme: "noeta-ink-signal" });
  const match = /^<pre[^>]*><code[^>]*>([\s\S]*)<\/code><\/pre>\s*$/.exec(html);
  if (!match) throw new Error("unexpected shiki output shape");
  return match[1];
}
