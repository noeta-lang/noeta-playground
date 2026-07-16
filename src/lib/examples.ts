/* Curated example programs. `welcome` is the page's starting buffer: small
 * enough to read at a glance, rich enough that Run, hover, and the debugger
 * all have something to show. */

export const EXAMPLES: Record<string, string> = {
  welcome: `// Welcome to the Noeta playground — the real toolchain, running in
// your browser. Hit Run (Ctrl+Enter), hover a name for its type, or
// click the gutter to set a breakpoint and hit Debug.

fn fib(n: int): int {
  if n < 2 { return n; }
  a = fib(n - 1);
  b = fib(n - 2);
  return a + b;
}

for n in [8, 12, 16] {
  value = fib(n);
  echo "fib(\${n}) = \${value}";
}
`,
  "seeded random": `// The playground runs the deterministic sandbox: the same seed
// always produces the same stream — run it twice and see.
use std.random;

random.seed(42);
for i in [1, 2, 3] {
  echo random.int(0, 100);
}
`,
  "stack trace": `fn inner(): int {
  panic("something went wrong");
}

fn outer(): int {
  return inner();
}

echo outer();
`,
  "type error": `// The checker runs as you type: \`mut\` is stably typed, so this
// reassignment is flagged before you ever hit Run.
mut count = 1;
count = "not a number";
`,
  "http fetch": `// Tick "real host" in the toolbar: the request leaves your browser
// (subject to CORS). In the default sandbox the same code gets the
// deterministic pure responder instead.
use std.http.client

r = client.get("https://api.github.com/zen")
echo r.status()
echo r.body()
`,
  "debug me": `// Set a breakpoint on the \`total = total + v\` line (click the
// gutter), hit Debug, and step: the call stack and each frame's
// locals update at every pause — and the console evaluates
// expressions against the paused frame (try \`total + v\`, or even
// a call like \`sum([100])\`).

fn sum(values: List<int>): int {
  mut total = 0;
  for v in values {
    total = total + v;
  }
  return total;
}

result = sum([3, 7, 11]);
echo "sum = \${result}";
`,
};

export const DEFAULT_EXAMPLE = "welcome";
