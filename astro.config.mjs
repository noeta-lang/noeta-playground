// noeta-playground — the play.noeta.dev language playground. Static Astro build
// served as a Cloudflare Worker with static assets (see wrangler.jsonc). The
// engine (the real Noeta toolchain compiled to wasm32-unknown-unknown) is
// synced into public/engine/ by scripts/sync-engine.mjs (predev/prebuild).
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// The COOP/COEP pair that makes the page crossOriginIsolated. Production gets
// it from public/_headers (Cloudflare static assets); dev and preview need it
// applied to every response — without it SharedArrayBuffer is undefined and the
// debugger's Atomics.wait pause protocol cannot run.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Astro's dev server does NOT propagate `vite.server.headers` to page responses
// (only to Vite's own asset handlers), so the HTML document loads without
// COOP/COEP and the tab is not crossOriginIsolated. This tiny integration
// installs a Connect middleware on the dev server that stamps the pair on every
// response — the reliable way to isolate the dev tab. Production is unaffected
// (static build; Cloudflare serves public/_headers).
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  hooks: {
    "astro:server:setup": ({ server }) => {
      server.middlewares.use((_req, res, next) => {
        for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value);
        next();
      });
    },
  },
};

export default defineConfig({
  site: "https://play.noeta.dev",
  output: "static",
  build: { format: "directory" },
  integrations: [
    crossOriginIsolation,
    sitemap({
      // /og is the OG-image screenshot target (deleted post-build); never index it.
      filter: (page) => !/\/og\/?$/.test(page),
      serialize(item) {
        // Match the no-trailing-slash canonical URLs BaseHead emits.
        item.url = item.url.replace(/\/$/, "");
        return item;
      },
    }),
  ],
  vite: {
    // `astro preview` runs Vite's preview server, which DOES honor this.
    preview: { headers: isolationHeaders },
    // monaco-editor ships ESM with worker entry points; keep them as ES modules.
    worker: { format: "es" },
  },
});
