# noeta-playground

The Noeta language playground — compile and run Noeta in the browser via WASM.

Served at **play.noeta.dev**. A dependency-free Cloudflare Worker (no runtime npm deps).

## Local development

```sh
pnpm install
pnpm run dev        # wrangler dev — http://localhost:8787
```

## Deploy (your Cloudflare account)

```sh
pnpm run deploy
```

Then bind the custom domain play.noeta.dev via the `routes` entry in `wrangler.jsonc`.

Generated with assistance from Claude Code; not yet deployed.
