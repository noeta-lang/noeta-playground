/* The engine worker: instantiates the Noeta toolchain cdylib
 * (public/engine/noeta_playground.wasm) and serves requests over its
 * hand-rolled (ptr, len) ABI — the same calls the language repo's node smoke
 * test proves (crates/noeta-playground/tests/browser_smoke.mjs).
 *
 * The page runs two instances of this worker:
 *  - a LANGUAGE worker (check / fmt / hover / complete / definition /
 *    signature) that stays responsive while programs run, and
 *  - a RUN worker (run / run-browser / debug) that the main thread terminates
 *    and respawns on timeout — the runaway-loop guard; the VM deliberately has
 *    no fuel counter, and worker state is throwaway.
 *
 * Debugging: `debug` requests carry a SharedArrayBuffer. When the engine hits
 * a breakpoint it calls the `js_debug_pause` import, which posts the captured
 * stack to the main thread and parks this whole worker on Atomics.wait until
 * the user picks a resume action — from the wasm side it is an ordinary
 * synchronous import. Requires crossOriginIsolated (see public/_headers).
 *
 * "Real host" runs reach entropy / wall clock / outbound HTTP through the
 * noeta_host imports; with JSPI available the async entry genuinely overlaps
 * fetches, otherwise the synchronous XHR path runs serial-but-correct. */

type Engine = {
  memory: WebAssembly.Memory;
  noeta_alloc(len: number): number;
  noeta_free_result(ptr: number): void;
  noeta_check(ptr: number, len: number): number;
  noeta_run(ptr: number, len: number): number;
  noeta_run_browser(ptr: number, len: number): number;
  noeta_run_browser_async(ptr: number, len: number): number;
  noeta_debug_run(ptr: number, len: number): number;
  noeta_fmt(ptr: number, len: number): number;
  noeta_hover(ptr: number, len: number, line: number, character: number): number;
  noeta_definition(ptr: number, len: number, line: number, character: number): number;
  noeta_complete(ptr: number, len: number, line: number, character: number): number;
  noeta_signature(ptr: number, len: number, line: number, character: number): number;
};

let engine: Engine | null = null;
let runBrowserAsync: ((ptr: number, len: number) => Promise<number>) | null = null;

// The current debug session's shared-memory channel, set for the duration of a
// `debug` request. ctrl[0] is the command flag (0 = empty, 1 = ready),
// ctrl[1] the command's byte length; the command JSON lives from byte 8.
let debugChannel: { ctrl: Int32Array; data: Uint8Array; id: number } | null = null;

const JSPI =
  typeof (WebAssembly as any).Suspending === "function" &&
  typeof (WebAssembly as any).promising === "function";

// In-flight fetch tickets for the JSPI path, plus the wake signal js_wait races.
const tickets = new Map<bigint, { done: boolean; resultJson: string | null }>();
let nextTicket = 1n;
let settledSinceWait = false;
let wakeResolve: () => void = () => {};
let wakePromise = new Promise<void>((resolve) => {
  wakeResolve = resolve;
});
function signalSettled() {
  settledSinceWait = true;
  wakeResolve();
}
function rotateWake() {
  settledSinceWait = false;
  wakePromise = new Promise<void>((resolve) => {
    wakeResolve = resolve;
  });
}

/* Mirror of the engine's pack(): [len: u32 LE][bytes] in one engine allocation. */
function pack(json: string): number {
  const bytes = new TextEncoder().encode(json);
  const ptr = engine!.noeta_alloc(4 + bytes.length);
  new DataView(engine!.memory.buffer).setUint32(ptr, bytes.length, true);
  new Uint8Array(engine!.memory.buffer, ptr + 4, bytes.length).set(bytes);
  return ptr;
}

function readWasmString(ptr: number, len: number): string {
  return new TextDecoder().decode(new Uint8Array(engine!.memory.buffer, ptr, len));
}

function hostImports(): WebAssembly.Imports {
  return {
    noeta_host: {
      // The debugger's pause seam: post the captured stack to the main thread,
      // park on Atomics.wait until it writes a resume command into the shared
      // buffer, and hand the command back to the engine.
      js_debug_pause(ptr: number, len: number): number {
        if (!debugChannel) return pack('{"action":"terminate"}');
        const state = JSON.parse(readWasmString(ptr, len));
        self.postMessage({ type: "debug-paused", id: debugChannel.id, state });
        Atomics.wait(debugChannel.ctrl, 0, 0);
        const cmdLen = debugChannel.ctrl[1] ?? 0;
        const command = new TextDecoder().decode(debugChannel.data.slice(0, cmdLen));
        Atomics.store(debugChannel.ctrl, 0, 0);
        return pack(command);
      },
      // Real entropy for uuids and span ids: an i64 import, so a BigInt.
      js_entropy_u64(): bigint {
        const word = new BigUint64Array(1);
        crypto.getRandomValues(word);
        return word[0]!;
      },
      js_now_ms: () => Date.now(),
      // Synchronous fetch — legal in a worker (only the main thread bans sync
      // XHR), which is what lets the engine's synchronous Host trait reach the
      // real network with no VM seam change.
      js_net_fetch(ptr: number, len: number): number {
        const request = JSON.parse(readWasmString(ptr, len));
        let reply;
        try {
          const xhr = new XMLHttpRequest();
          xhr.open(request.method, request.url, false);
          for (const [name, value] of request.headers) xhr.setRequestHeader(name, value);
          xhr.send(request.body.length > 0 ? request.body : null);
          const headers = xhr
            .getAllResponseHeaders()
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const at = line.indexOf(": ");
              return [line.slice(0, at), line.slice(at + 2)];
            });
          reply = { status: xhr.status, headers, body: xhr.responseText };
        } catch (error) {
          reply = { error: String((error as Error)?.message ?? error) };
        }
        return pack(JSON.stringify(reply));
      },
      // The JSPI trio: plain stubs when JSPI is off (the worker then routes
      // real-host runs to the synchronous entry, so they are unreachable —
      // but instantiation requires them).
      js_fetch_start(ptr: number, len: number): bigint {
        const request = JSON.parse(readWasmString(ptr, len));
        const ticket = nextTicket++;
        const entry: { done: boolean; resultJson: string | null } = { done: false, resultJson: null };
        tickets.set(ticket, entry);
        (async () => {
          try {
            const response = await fetch(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.body.length > 0 ? request.body : undefined,
            });
            const body = await response.text();
            entry.resultJson = JSON.stringify({
              status: response.status,
              headers: [...response.headers.entries()],
              body,
            });
          } catch (error) {
            entry.resultJson = JSON.stringify({ error: String((error as Error)?.message ?? error) });
          }
          entry.done = true;
          signalSettled();
        })();
        return ticket;
      },
      js_fetch_take(ticket: bigint): number {
        const entry = tickets.get(ticket);
        if (!entry?.done) return 0;
        tickets.delete(ticket);
        return pack(entry.resultJson!);
      },
      js_wait: JSPI
        ? new (WebAssembly as any).Suspending(async (timeoutMs: number) => {
            if (settledSinceWait) {
              rotateWake();
              return;
            }
            const racers: Promise<unknown>[] = [wakePromise];
            if (timeoutMs >= 0) racers.push(new Promise((r) => setTimeout(r, timeoutMs)));
            await Promise.race(racers);
            rotateWake();
          })
        : () => {
            throw new Error("js_wait requires JSPI");
          },
    },
  };
}

async function instantiate(): Promise<Engine> {
  const response = await fetch("/engine/noeta_playground.wasm");
  const imports = hostImports();
  try {
    const { instance } = await WebAssembly.instantiateStreaming(response.clone(), imports);
    return instance.exports as unknown as Engine;
  } catch {
    // A host serving the artifact without `application/wasm` breaks streaming
    // instantiation; fall back to the buffered path.
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    return instance.exports as unknown as Engine;
  }
}

async function call(
  entry: (ptr: number, len: number, ...extra: number[]) => number | Promise<number>,
  input: string,
  ...extra: number[]
): Promise<unknown> {
  const encoded = new TextEncoder().encode(input);
  const ptr = engine!.noeta_alloc(encoded.length);
  new Uint8Array(engine!.memory.buffer, ptr, encoded.length).set(encoded);
  const out = await entry(ptr, encoded.length, ...extra); // consumes the input buffer
  const len = new DataView(engine!.memory.buffer).getUint32(out, true);
  const json = readWasmString(out + 4, len);
  engine!.noeta_free_result(out);
  return JSON.parse(json);
}

type EngineRequest = {
  id: number;
  op: string;
  source: string;
  line?: number;
  character?: number;
  breakpoints?: number[];
  stopOnEntry?: boolean;
  sab?: SharedArrayBuffer;
};

self.onmessage = async (event: MessageEvent<EngineRequest>) => {
  const { id, op, source, line, character, breakpoints, stopOnEntry, sab } = event.data;
  try {
    if (!engine) {
      engine = await instantiate();
      runBrowserAsync = JSPI
        ? (WebAssembly as any).promising(engine.noeta_run_browser_async)
        : null;
    }
    let result: unknown;
    switch (op) {
      case "check":
        result = await call(engine.noeta_check, source);
        break;
      case "run":
        result = await call(engine.noeta_run, source);
        break;
      case "run-browser":
        // The JSPI-pumped entry when the platform has it (overlapping fetches,
        // real-time sleep), else the synchronous one (serial-but-correct).
        result = await call(runBrowserAsync ?? engine.noeta_run_browser, source);
        break;
      case "fmt":
        result = await call(engine.noeta_fmt, source);
        break;
      case "hover":
        result = await call(engine.noeta_hover, source, line!, character!);
        break;
      case "complete":
        result = await call(engine.noeta_complete, source, line!, character!);
        break;
      case "definition":
        result = await call(engine.noeta_definition, source, line!, character!);
        break;
      case "signature":
        result = await call(engine.noeta_signature, source, line!, character!);
        break;
      case "debug": {
        debugChannel = sab
          ? { ctrl: new Int32Array(sab, 0, 2), data: new Uint8Array(sab, 8), id }
          : null;
        try {
          result = await call(
            engine.noeta_debug_run,
            JSON.stringify({
              source,
              breakpoints: breakpoints ?? [],
              stop_on_entry: stopOnEntry ?? false,
            }),
          );
        } finally {
          debugChannel = null;
        }
        break;
      }
      default:
        throw new Error(`unknown op: ${op}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    // A trap poisons the instance; drop it so the next request re-instantiates.
    engine = null;
    runBrowserAsync = null;
    debugChannel = null;
    self.postMessage({ id, ok: false, error: String((error as Error)?.message ?? error) });
  }
};

// Tell the main thread the engine is warm (first paint can enable the buttons
// as soon as instantiation lands).
instantiate().then(
  (exports) => {
    engine = exports;
    runBrowserAsync = JSPI ? (WebAssembly as any).promising(engine.noeta_run_browser_async) : null;
    self.postMessage({ type: "ready" });
  },
  (error) => self.postMessage({ type: "ready-error", error: String((error as Error)?.message ?? error) }),
);
