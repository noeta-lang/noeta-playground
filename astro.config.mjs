// noeta-playground — the play.noeta.dev language playground. Static Astro build
// served as a Cloudflare Worker with static assets (see wrangler.jsonc). The
// engine (the real Noeta toolchain compiled to wasm32-unknown-unknown) is
// synced into public/engine/ by scripts/sync-engine.mjs (predev/prebuild).
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// The COOP/COEP pair that makes the page crossOriginIsolated. Production gets
// it from public/_headers (Cloudflare static assets); the dev server needs it
// here — without it SharedArrayBuffer is undefined and the debugger's
// Atomics.wait pause protocol cannot run.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  site: "https://play.noeta.dev",
  output: "static",
  build: { format: "directory" },
  integrations: [
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
    server: { headers: isolationHeaders },
    preview: { headers: isolationHeaders },
    // monaco-editor ships ESM with worker entry points; keep them as ES modules.
    worker: { format: "es" },
  },
});
