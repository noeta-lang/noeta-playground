// noeta-playground — a Cloudflare Worker serving play.noeta.dev.
//
// Placeholder scaffold: returns a single static HTML page. The real content lands next.

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Noeta Playground</title>
  </head>
  <body>
    <main>
      <h1>Noeta Playground</h1>
      <p>Write, compile, and run Noeta in your browser.</p>
    </main>
  </body>
</html>
`;

export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
