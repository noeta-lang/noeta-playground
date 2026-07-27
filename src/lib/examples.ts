/* Curated example programs. `welcome` is the page's starting buffer: small
 * enough to read at a glance, rich enough that Run, hover, and the debugger
 * all have something to show. Statement terminators are newlines — the default
 * Noeta style, matching `noeta fmt` (the Format button).
 *
 * Every sample carries what the toolchain should say about it, and
 * scripts/check-examples.mjs holds the shipped engine to it (`pnpm run
 * check:examples`, gated in CI). These are the first Noeta most visitors ever
 * run; nothing else in this repo compiles them, so without that gate a language
 * change in ../lang rots a sample silently and the page greets people with red
 * squiggles. */

export interface Example {
  /** The program text loaded into the editor. */
  source: string;
  /**
   * What `noeta check` must say. `"clean"` — no diagnostics at all; `"diagnostics"` —
   * the sample exists to show the checker working, so *not* being rejected is the failure.
   */
  expect: "clean" | "diagnostics";
  /** Sandbox exit code a `"clean"` sample must produce. Unused when it is `"diagnostics"`. */
  exit?: number;
}

export const EXAMPLES: Record<string, Example> = {
  welcome: {
    expect: "clean",
    exit: 0,
    source: `// Welcome to the Noeta playground — the real toolchain, running in
// your browser. Hit Run (Ctrl+Enter), hover a name for its type, or
// click the gutter to set a breakpoint and hit Debug.

fn fib(n: int): int {
  if n < 2 { return n }
  a = fib(n - 1)
  b = fib(n - 2)
  return a + b
}

for n in [8, 12, 16] {
  value = fib(n)
  echo "fib(\${n}) = \${value}"
}
`,
  },
  "seeded random": {
    expect: "clean",
    exit: 0,
    source: `// The playground runs the deterministic sandbox: the same seed
// always produces the same stream — run it twice and see.
use std.random

random.seed(42)
for i in [1, 2, 3] {
  echo random.int(0, 100)
}
`,
  },
  "stack trace": {
    // Compiles cleanly and aborts on purpose — the point is the traceback below the output.
    expect: "clean",
    exit: 1,
    source: `fn inner(): int {
  panic("something went wrong")
}

fn outer(): int {
  return inner()
}

echo outer()
`,
  },
  "type error": {
    expect: "diagnostics",
    source: `// The checker runs as you type: \`mut\` is stably typed, so this
// reassignment is flagged before you ever hit Run.
mut count = 1
count = "not a number"
`,
  },
  "http fetch": {
    expect: "clean",
    exit: 0,
    // Every client verb returns a `Result<Response, HttpError>`, so the request is spent with
    // `?` before there is a `Response` to ask for a `status()`. Without it this sample checked
    // clean and then failed on Run — which is why check:examples runs the samples too.
    source: `// Tick "real host" in the toolbar: the request leaves your browser
// (subject to CORS). In the default sandbox the same code gets the
// deterministic pure responder instead.
use std.http.client

r = client.get("https://api.github.com/zen")?
echo r.status()
echo r.body()
`,
  },
  "debug me": {
    expect: "clean",
    exit: 0,
    source: `// Set a breakpoint on the \`total = total + v\` line (click the
// gutter), hit Debug, and step: the call stack and each frame's
// locals update at every pause — and the console evaluates
// expressions against the paused frame (try \`total + v\`, or even
// a call like \`sum([100])\`).

fn sum(values: List<int>): int {
  mut total = 0
  for v in values {
    total = total + v
  }
  return total
}

result = sum([3, 7, 11])
echo "sum = \${result}"
`,
  },
};

export const DEFAULT_EXAMPLE = "welcome";
