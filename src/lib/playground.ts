/* The playground app: mounts Monaco, wires the toolbar, and runs the two
 * worker flows — plain runs (with the terminate-on-timeout guard) and debug
 * sessions (gutter breakpoints → pause → stack + variables → step/continue).
 * Loaded once from the index page. */

import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { monaco, registerNoeta, attachDiagnostics, LANGUAGE_ID } from "./monaco-noeta";
import { engine, type Diagnostic, type PausedState, type DebugCommand } from "./engine-client";
import { EXAMPLES, DEFAULT_EXAMPLE } from "./examples";
import { encodeShare, decodeShare } from "./share";

// Monaco's own worker (tokenization bookkeeping etc.). Our language smarts
// live in the engine workers, so the core editor worker is all Monaco needs.
(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusLine = $("status");
const stdoutPane = $("stdout");
const tracePane = $("trace");
const exitBadge = $("exit");
const diagnosticsPane = $("diagnostics");
const debugPanel = $("debug-panel");
const stackList = $("stack") as unknown as HTMLOListElement;
const varsBody = $("vars");
const runButton = $("run") as HTMLButtonElement;
const debugButton = $("debug") as HTMLButtonElement;
const stopButton = $("stop") as HTMLButtonElement;
const fmtButton = $("fmt") as HTMLButtonElement;
const shareButton = $("share") as HTMLButtonElement;
const realHostToggle = $("realhost") as HTMLInputElement;
const examplePicker = $("examples") as HTMLSelectElement;
const stepButtons = {
  continue: $("step-continue") as HTMLButtonElement,
  stepOver: $("step-over") as HTMLButtonElement,
  stepIn: $("step-in") as HTMLButtonElement,
  stepOut: $("step-out") as HTMLButtonElement,
};

function setStatus(text: string, tone: "" | "ok" | "err" = "") {
  statusLine.textContent = text;
  statusLine.dataset.tone = tone;
}

/* --- Editor --- */

registerNoeta();

const editor = monaco.editor.create($("editor"), {
  value: decodeShare(location.hash.slice(1)) ?? EXAMPLES[DEFAULT_EXAMPLE]!,
  language: LANGUAGE_ID,
  theme: "ink-signal",
  fontFamily: '"Spline Sans Mono Variable", "Spline Sans Mono", monospace',
  fontSize: 13.5,
  lineHeight: 1.65,
  minimap: { enabled: false },
  glyphMargin: true,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: "line",
  cursorBlinking: "phase",
  smoothScrolling: true,
  fixedOverflowWidgets: true,
});
// The theme font loads async; remeasure once it lands so glyphs align.
document.fonts.ready.then(() => monaco.editor.remeasureFonts());

const model = editor.getModel()!;
attachDiagnostics(model, renderDiagnostics);

/* --- Breakpoints: glyph-margin decorations, toggled from the gutter. They
 * ride Monaco's decoration tracking, so they follow the code as it moves. --- */

const breakpoints = editor.createDecorationsCollection([]);

function breakpointLines(): number[] {
  const lines = new Set<number>();
  for (const range of breakpoints.getRanges()) lines.add(range.startLineNumber);
  return [...lines].sort((a, b) => a - b);
}

function toggleBreakpoint(lineNumber: number) {
  const existing = breakpoints
    .getRanges()
    .findIndex((range) => range.startLineNumber === lineNumber);
  const next = breakpoints
    .getRanges()
    .filter((range) => range.startLineNumber !== lineNumber)
    .map((range) => breakpointDecoration(range.startLineNumber));
  if (existing === -1) next.push(breakpointDecoration(lineNumber));
  breakpoints.set(next);
}

function breakpointDecoration(lineNumber: number): monaco.editor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: "bp-glyph",
      glyphMarginHoverMessage: { value: "Breakpoint — hit Debug to use it" },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  };
}

editor.onMouseDown((e) => {
  const type = e.target.type;
  if (
    type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
    type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
  ) {
    const line = e.target.position?.lineNumber;
    if (line) toggleBreakpoint(line);
  }
});

/* --- Output panel --- */

function clearOutput() {
  stdoutPane.textContent = "";
  tracePane.textContent = "";
  tracePane.hidden = true;
  exitBadge.textContent = "";
  exitBadge.dataset.tone = "";
  diagnosticsPane.replaceChildren();
}

function renderDiagnostics(diagnostics: Diagnostic[]) {
  diagnosticsPane.replaceChildren();
  for (const d of diagnostics) {
    const row = document.createElement("button");
    row.className = `diag diag-${d.severity}`;
    row.type = "button";
    const loc = document.createElement("span");
    loc.className = "diag-loc";
    loc.textContent = `${d.line}:${d.column}`;
    const code = document.createElement("span");
    code.className = "diag-code";
    code.textContent = d.code;
    const message = document.createElement("span");
    message.className = "diag-msg";
    message.textContent = d.message;
    row.append(loc, code, message);
    if (d.help) {
      const help = document.createElement("span");
      help.className = "diag-help";
      help.textContent = `help: ${d.help}`;
      row.append(help);
    }
    row.addEventListener("click", () => {
      editor.setPosition({ lineNumber: d.line, column: d.column });
      editor.revealLineInCenter(d.line);
      editor.focus();
    });
    diagnosticsPane.append(row);
  }
}

function renderRunResult(result: {
  compiled: boolean;
  stdout?: string;
  exit_code?: number;
  trace?: string | null;
  diagnostics?: Diagnostic[];
  error?: string;
  terminated?: boolean;
}) {
  if (result.diagnostics) renderDiagnostics(result.diagnostics);
  if (!result.compiled) {
    setStatus(result.error ?? "did not compile", "err");
    return;
  }
  stdoutPane.textContent = result.stdout ?? "";
  if (result.trace) {
    tracePane.textContent = result.trace;
    tracePane.hidden = false;
  }
  if (result.terminated) {
    exitBadge.textContent = "stopped";
    exitBadge.dataset.tone = "err";
    setStatus("stopped from the debugger", "");
  } else {
    const exit = result.exit_code ?? 0;
    exitBadge.textContent = `exit ${exit}`;
    exitBadge.dataset.tone = exit === 0 ? "ok" : "err";
    setStatus(exit === 0 ? "finished ✓" : `exited with ${exit}`, exit === 0 ? "ok" : "err");
  }
}

/* --- Run --- */

let busy = false;

async function doRun() {
  if (busy) return;
  busy = true;
  clearOutput();
  setStatus(realHostToggle.checked ? "running (real host)…" : "running…");
  stopButton.hidden = false;
  try {
    const result = await engine.run(model.getValue(), realHostToggle.checked);
    renderRunResult(result);
  } catch (error) {
    setStatus(String((error as Error).message ?? error), "err");
  } finally {
    busy = false;
    stopButton.hidden = true;
  }
}

async function doFmt() {
  await editor.getAction("editor.action.formatDocument")?.run();
  setStatus("formatted ✓", "ok");
}

async function doShare() {
  const url = new URL(location.href);
  url.hash = encodeShare(model.getValue());
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url.href);
    setStatus("share link copied ✓", "ok");
  } catch {
    setStatus("share link is in the address bar", "");
  }
}

/* --- Debug sessions --- */

const pausedDecoration = editor.createDecorationsCollection([]);
let resumeCurrent: ((command: DebugCommand) => void) | null = null;
let debugging = false;

function setStepButtonsEnabled(enabled: boolean) {
  for (const button of Object.values(stepButtons)) button.disabled = !enabled;
}

function renderPaused(state: PausedState) {
  // Stack: innermost frame first, click to inspect any frame's locals.
  stackList.replaceChildren();
  state.frames.forEach((frame, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame";
    if (index === 0) button.dataset.active = "true";
    const name = document.createElement("span");
    name.className = "frame-name";
    name.textContent = frame.name;
    const where = document.createElement("span");
    where.className = "frame-loc";
    where.textContent = frame.line > 0 ? `:${frame.line}` : "";
    button.append(name, where);
    button.addEventListener("click", () => {
      stackList.querySelectorAll(".frame").forEach((el) => delete (el as HTMLElement).dataset.active);
      button.dataset.active = "true";
      renderLocals(state.frames[index]!.locals);
      if (frame.line > 0) editor.revealLineInCenter(frame.line);
    });
    item.append(button);
    stackList.append(item);
  });
  renderLocals(state.frames[0]?.locals ?? []);

  // Highlight the paused line (innermost frame).
  const line = state.frames[0]?.line ?? 0;
  if (line > 0) {
    pausedDecoration.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: "paused-line",
          glyphMarginClassName: "paused-glyph",
        },
      },
    ]);
    editor.revealLineInCenter(line);
  }
}

function renderLocals(locals: { name: string; value: string; ty: string }[]) {
  varsBody.replaceChildren();
  if (locals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "vars-empty";
    empty.textContent = "no locals in scope";
    varsBody.append(empty);
    return;
  }
  for (const local of locals) {
    const row = document.createElement("div");
    row.className = "var";
    const name = document.createElement("span");
    name.className = "var-name";
    name.textContent = local.name;
    const value = document.createElement("span");
    value.className = "var-value";
    value.textContent = local.value;
    const ty = document.createElement("span");
    ty.className = "var-type";
    ty.textContent = local.ty;
    row.append(name, value, ty);
    varsBody.append(row);
  }
}

function leavePause() {
  pausedDecoration.set([]);
  setStepButtonsEnabled(false);
  setStatus("running…");
}

function endDebugSession() {
  debugging = false;
  resumeCurrent = null;
  pausedDecoration.set([]);
  debugPanel.hidden = true;
  stopButton.hidden = true;
  editor.updateOptions({ readOnly: false });
}

async function doDebug() {
  if (busy || debugging) return;
  if (!crossOriginIsolated) {
    setStatus("debugging needs cross-origin isolation — this page isn't serving COOP/COEP", "err");
    return;
  }
  debugging = true;
  clearOutput();
  editor.updateOptions({ readOnly: true }); // the paused view must match the compiled program
  debugPanel.hidden = false;
  stackList.replaceChildren();
  varsBody.replaceChildren();
  setStepButtonsEnabled(false);
  stopButton.hidden = false;
  const lines = breakpointLines();
  setStatus(lines.length > 0 ? "debugging…" : "debugging (no breakpoints — will run through)…");
  try {
    const result = await engine.debug(model.getValue(), lines, (state, resume) => {
      resumeCurrent = resume;
      renderPaused(state);
      setStepButtonsEnabled(true);
      setStatus(`paused: ${state.reason}`, "");
    });
    renderRunResult(result);
  } catch (error) {
    setStatus(String((error as Error).message ?? error), "err");
  } finally {
    endDebugSession();
  }
}

function sendResume(command: DebugCommand) {
  if (!resumeCurrent) return;
  const resume = resumeCurrent;
  resumeCurrent = null;
  leavePause();
  resume(command);
}

stepButtons.continue.addEventListener("click", () => sendResume({ action: "continue" }));
stepButtons.stepOver.addEventListener("click", () => sendResume({ action: "stepOver" }));
stepButtons.stepIn.addEventListener("click", () => sendResume({ action: "stepIn" }));
stepButtons.stepOut.addEventListener("click", () => sendResume({ action: "stepOut" }));

stopButton.addEventListener("click", () => {
  if (debugging && resumeCurrent) {
    sendResume({ action: "terminate" });
  } else {
    // A free-running program (plain run, or a debug session between pauses):
    // the worker is parked in the VM loop, so termination is the only lever.
    engine.stopRunner();
    setStatus("stopped", "");
  }
});

/* --- Toolbar wiring --- */

runButton.addEventListener("click", doRun);
debugButton.addEventListener("click", doDebug);
fmtButton.addEventListener("click", doFmt);
shareButton.addEventListener("click", doShare);
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, doRun);

for (const name of Object.keys(EXAMPLES)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  examplePicker.append(option);
}
examplePicker.value = DEFAULT_EXAMPLE;
examplePicker.addEventListener("change", () => {
  model.setValue(EXAMPLES[examplePicker.value] ?? "");
  breakpoints.set([]);
  clearOutput();
  setStatus("ready");
});

if (!crossOriginIsolated) {
  debugButton.disabled = true;
  debugButton.title = "Debugging needs cross-origin isolation (COOP/COEP headers)";
}

setStatus("loading engine…");
engine.warmUp((ok, error) => {
  setStatus(ok ? "ready" : `engine failed to load: ${error}`, ok ? "ok" : "err");
});

// A console/scripting handle (used by the E2E checks; handy in devtools too).
(window as any).__playground = { editor, monaco, toggleBreakpoint, breakpointLines };
