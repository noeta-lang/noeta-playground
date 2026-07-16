# noeta-playground

The [Noeta](https://noeta.dev) language playground — play.noeta.dev.

The **real toolchain, client-side**: the same lexer → parser → checker → compiler → VM that
`noeta run` uses, compiled to `wasm32-unknown-unknown` (the noeta repo's `noeta-playground`
crate) and embedded in a [Monaco](https://microsoft.github.io/monaco-editor/) workbench on the
shared [@noeta/theme](../noeta-theme) design system ("Ink & Signal"). No backend — nothing you
type leaves the tab.

## What it does

- **Run** — execute on the deterministic sandbox (or tick *real host* for real entropy, wall
  clock, and outbound HTTP; JSPI overlaps async fetches where the browser supports it).
- **IDE smarts, no language server** — live diagnostics, hover types, completion,
  go-to-definition, and signature help come straight from the engine's `noeta-ide` exports:
  the exact DocumentStore `noeta lsp` adapts over, so the answers are the LSP's answers
  with none of the JSON-RPC.
- **Debug** — gutter breakpoints, continue/step over/in/out, call stack, and per-frame
  variables. The engine pauses by parking its worker on `Atomics.wait` until the UI writes a
  resume command into shared memory — which is why the site serves COOP/COEP headers
  (`public/_headers`): `SharedArrayBuffer` needs a crossOriginIsolated page.
- **Format** (the canonical `noeta fmt`) and **Share** (the buffer in the URL fragment,
  byte-compatible with the reference playground's `#code=v1:` links).

## Architecture

Two instances of one worker (`src/workers/engine.worker.ts`), each holding its own copy of the
wasm engine:

- the **language worker** answers editor smarts and never blocks — hover keeps working while
  your program loops;
- the **run worker** executes programs and is terminated + respawned when a run exceeds its
  wall-clock budget (the runaway-loop guard — the VM deliberately has no fuel counter). A debug
  session's clock only ticks while the program is *running*: sitting at a breakpoint never
  trips it.

`scripts/sync-engine.mjs` (predev/prebuild) populates `public/engine/noeta_playground.wasm` —
from `NOETA_ENGINE_WASM`, or the sibling `../lang` checkout's `wasm-release` artifact (building
it if missing; needs `rustup target add wasm32-unknown-unknown`).

## Local development

```sh
pnpm install
pnpm run dev        # syncs the engine, then astro dev — http://localhost:4321
pnpm run build      # dist/ + OG image (needs a Playwright chromium)
pnpm run preview    # build, then serve dist/ through wrangler
```

End-to-end checks (engine warm-up, run, diagnostics, hover, completion, the full debug
loop, the runaway guard, share links) live in `scripts/e2e.mjs` — serve the built site
(`wrangler dev --port 8788`), then `node scripts/e2e.mjs`.

## Deploy (your Cloudflare account)

```sh
pnpm run deploy
```

Then bind the custom domain play.noeta.dev via the `routes` entry in `wrangler.jsonc`. The
GitHub workflow needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets and clones the
theme and language repos next to the site checkout.

Generated with assistance from Claude Code; not yet deployed.
