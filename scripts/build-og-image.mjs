/**
 * Screenshots the built /og page into dist/images/og-image.png so the
 * social-share image stays a pixel-perfect render of the hero card. Runs after
 * `astro build` (see package.json `build`).
 *
 * A tiny static server serves dist/ so headless Chromium can load the page with
 * its CSS and self-hosted fonts (no network); we await document.fonts.ready
 * before capturing. After a successful screenshot the dist/og/ directory is
 * removed so the screenshot target never ships.
 *
 * Skip via OG_IMAGE_SKIP=1 when iterating on unrelated build issues, or in
 * environments without Chromium.
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

if (process.env.OG_IMAGE_SKIP) {
  console.log("  [og-image] OG_IMAGE_SKIP set — skipping screenshot");
  process.exit(0);
}

const dist = resolve(process.cwd(), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

// Minimal static file server over dist/ — directory paths fall back to
// index.html, with a guard against path traversal outside dist/.
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let fp = normalize(join(dist, urlPath));
    if (fp !== dist && !fp.startsWith(dist + "/")) {
      res.statusCode = 403;
      return res.end();
    }
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, "index.html");
    if (!existsSync(fp)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("Content-Type", MIME[extname(fp)] ?? "application/octet-stream");
    res.end(await readFile(fp));
  } catch {
    res.statusCode = 500;
    res.end();
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/og/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const outPath = join(dist, "images", "og-image.png");
  await mkdir(join(dist, "images"), { recursive: true });
  await page.screenshot({
    path: outPath,
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  console.log("  [og-image] Wrote dist/images/og-image.png (1200x630)");

  // Remove the screenshot target so it never deploys. The page exists only to
  // give Chromium something to navigate to. Left in place on failure to debug.
  await rm(join(dist, "og"), { recursive: true, force: true });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
