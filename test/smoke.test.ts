import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("serves an HTML page at /", async () => {
  const res = await SELF.fetch("https://play.noeta.dev/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("Noeta Playground");
});
