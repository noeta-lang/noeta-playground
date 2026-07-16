/* Main-thread client for the engine workers.
 *
 * Two workers, one script (src/workers/engine.worker.ts):
 *  - the LANGUAGE worker answers editor smarts (check / fmt / hover /
 *    complete / definition / signature) and is never blocked by a running
 *    program — hover keeps answering while your code loops;
 *  - the RUN worker executes programs (run / run-browser / debug) and is
 *    terminated + respawned when a run exceeds its wall-clock budget — the
 *    runaway-loop guard (the VM deliberately has no fuel counter).
 *
 * A debug session's clock only ticks while the program is RUNNING: every
 * pause (breakpoint / step landing) stops it, every resume restarts it, so
 * you can sit at a breakpoint for an hour without the guard firing. */

export interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  column: number;
  byte_start: number;
  byte_end: number;
  help?: string | null;
}

export interface RunResult {
  compiled: boolean;
  diagnostics: Diagnostic[];
  stdout?: string;
  exit_code?: number;
  trace?: string | null;
  terminated?: boolean;
  error?: string;
}

export interface PausedFrame {
  name: string;
  path: string | null;
  line: number;
  column: number;
  locals: { name: string; value: string; ty: string }[];
}

export interface PausedState {
  reason: string;
  frames: PausedFrame[];
  /** A console eval's outcome, present on the trampoline re-entry payload that follows an
   * `eval` command. The frames alongside are re-captured, so a fragment's side effects are
   * already visible. */
  eval?: { ok: true; value: string; ty: string } | { ok: false; error: string } | null;
}

export type DebugCommand =
  | { action: "continue" }
  | { action: "stepOver" }
  | { action: "stepIn" }
  | { action: "stepOut" }
  | { action: "terminate" }
  /** Evaluate `expr` against paused frame `frame` (innermost-first). Full language — calls
   * included — type-checked against the frame's locals before it runs; the program stays
   * paused, and the outcome arrives on the next paused event. */
  | { action: "eval"; expr: string; frame: number };

const RUN_TIMEOUT_MS = 5000;
const LANGUAGE_TIMEOUT_MS = 10000;

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

class WorkerPool {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (reply: Reply) => void; timer: number }>();
  private readonly timeoutMs: number;
  /** Called with paused-state events (debug sessions on the run worker). */
  onPaused: ((id: number, state: PausedState) => void) | null = null;
  /** Called when the engine reports warm/failed instantiation. */
  onReady: ((ok: boolean, error?: string) => void) | null = null;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  private spawn() {
    this.worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "ready") return this.onReady?.(true);
      if (data.type === "ready-error") return this.onReady?.(false, data.error);
      if (data.type === "debug-paused") return this.onPaused?.(data.id, data.state);
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      entry.resolve(data.ok ? { ok: true, result: data.result } : { ok: false, error: data.error });
    };
  }

  start() {
    if (!this.worker) this.spawn();
  }

  /** Kill the worker (wedged or user-stopped) and fail everything in flight. */
  restart(reason: string) {
    this.worker?.terminate();
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
    }
    this.pending.clear();
    this.spawn();
  }

  /**
   * Send a request. `timer: false` sends with no deadline (debug sessions run
   * their own pause-aware clock via pauseTimer/resumeTimer).
   */
  request(payload: Record<string, unknown>, options?: { timer?: boolean }): { id: number; reply: Promise<Reply> } {
    this.start();
    const id = this.nextId++;
    const reply = new Promise<Reply>((resolve) => {
      const timer =
        options?.timer === false
          ? 0
          : window.setTimeout(() => this.expire(id), this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.worker!.postMessage({ id, ...payload });
    });
    return { id, reply };
  }

  private expire(id: number) {
    if (!this.pending.has(id)) return;
    this.restart(
      `no result after ${this.timeoutMs / 1000}s — the program was stopped (infinite loop?)`,
    );
  }

  /** Stop the deadline clock for `id` (a debug session paused). */
  pauseTimer(id: number) {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = 0;
    }
  }

  /** Restart the deadline clock for `id` (a debug session resumed). */
  resumeTimer(id: number) {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = window.setTimeout(() => this.expire(id), this.timeoutMs);
    }
  }
}

export class EngineClient {
  readonly language = new WorkerPool(LANGUAGE_TIMEOUT_MS);
  readonly runner = new WorkerPool(RUN_TIMEOUT_MS);

  /** Spawn both workers so the engine is warm before the first keystroke. */
  warmUp(onReady: (ok: boolean, error?: string) => void) {
    let announced = false;
    this.language.onReady = (ok, error) => {
      if (!announced) {
        announced = true;
        onReady(ok, error);
      }
    };
    this.language.start();
    this.runner.start();
  }

  private async ask<T>(pool: WorkerPool, payload: Record<string, unknown>): Promise<T> {
    const { reply } = pool.request(payload);
    const result = await reply;
    if (!result.ok) throw new Error(result.error);
    return result.result as T;
  }

  check(source: string): Promise<{ diagnostics: Diagnostic[] }> {
    return this.ask(this.language, { op: "check", source });
  }

  fmt(source: string): Promise<{ ok: boolean; formatted?: string; error?: string }> {
    return this.ask(this.language, { op: "fmt", source });
  }

  hover(source: string, line: number, character: number): Promise<any> {
    return this.ask(this.language, { op: "hover", source, line, character });
  }

  complete(source: string, line: number, character: number): Promise<any> {
    return this.ask(this.language, { op: "complete", source, line, character });
  }

  definition(source: string, line: number, character: number): Promise<any> {
    return this.ask(this.language, { op: "definition", source, line, character });
  }

  signature(source: string, line: number, character: number): Promise<any> {
    return this.ask(this.language, { op: "signature", source, line, character });
  }

  run(source: string, realHost: boolean): Promise<RunResult> {
    return this.ask(this.runner, { op: realHost ? "run-browser" : "run", source });
  }

  /** Stop whatever the run worker is doing (running program, wedged engine). */
  stopRunner() {
    this.runner.restart("stopped");
  }

  /**
   * Start a debug session. Requires crossOriginIsolated (SharedArrayBuffer).
   * `onPaused` receives every pause with a resumer to hand the user's next
   * command back to the parked engine; the returned promise settles with the
   * final run result when the program finishes or is terminated.
   */
  debug(
    source: string,
    breakpoints: number[],
    onPaused: (state: PausedState, resume: (command: DebugCommand) => void) => void,
  ): Promise<RunResult> {
    const sab = new SharedArrayBuffer(64 * 1024);
    const ctrl = new Int32Array(sab, 0, 2);
    const data = new Uint8Array(sab, 8);

    const { id, reply } = this.runner.request(
      { op: "debug", source, breakpoints, stopOnEntry: false, sab },
      { timer: false },
    );
    // The session clock ticks only while the program runs.
    this.runner.resumeTimer(id);

    this.runner.onPaused = (pausedId, state) => {
      if (pausedId !== id) return;
      this.runner.pauseTimer(id);
      onPaused(state, (command) => {
        const bytes = new TextEncoder().encode(JSON.stringify(command));
        data.set(bytes.subarray(0, data.length));
        ctrl[1] = Math.min(bytes.length, data.length);
        this.runner.resumeTimer(id);
        Atomics.store(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
      });
    };

    return reply.then((result) => {
      this.runner.onPaused = null;
      if (!result.ok) throw new Error(result.error);
      return result.result as RunResult;
    });
  }
}

export const engine = new EngineClient();
