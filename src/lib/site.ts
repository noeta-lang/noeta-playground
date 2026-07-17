/* Site-wide constants: one place for the copy that must stay consistent across
 * pages, <head> metadata, JSON-LD, and the OG image. */

export const SITE = {
  name: "Noeta Playground",
  url: "https://play.noeta.dev",
  title: "Noeta Playground — run, inspect, and debug Noeta in your browser",
  description:
    "The real Noeta toolchain, client-side: write code with live diagnostics, hover types, and " +
    "completion, run it on the deterministic sandbox, format it, set breakpoints and step " +
    "through it — all in your browser, no backend.",
  ogImage: "https://play.noeta.dev/images/og-image.png",
  themeColor: "#0b0d10",
  themeColorLight: "#f6f8fb",
  /** The current Noeta release, baked in at build from NOETA_VERSION (the deploy workflow sets it to
   *  the latest release tag). null on an unreleased build, so the UI omits the version. */
  version: process.env.NOETA_VERSION ?? null,
  links: {
    home: "https://noeta.dev",
    docs: "https://docs.noeta.dev",
    registry: "https://registry.noeta.dev",
    github: "https://github.com/noeta-lang/noeta",
  },
} as const;
