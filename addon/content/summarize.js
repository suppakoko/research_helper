/**
 * The summarize window's script (P3-T29; docs/08 §2.5's note of 2026-10-29).
 *
 * Loaded as a classic chrome script by `summarize.xhtml`, so it declares one
 * global `var` and exports nothing, as `costConfirm.js` does (`docs/01` §8.3
 * forbids an inline `<script>`).
 *
 * ## What it does
 *
 * It renders the model `src/ui/dialogs/summarizeDialog.ts` builds — every
 * line is a Fluent id with arguments already formatted there — and calls the
 * privileged session it was handed as `window.arguments[0].session`:
 * `describe()` on load, `start()` on Summarize, `cancel()` on Cancel,
 * `exportSummaries(path)` on Export, `closed()` when the window goes away.
 * The session calls back `render(model)` and `ask(line)`, the latter for a
 * paused run's question (the wall-clock budget, a missing key).
 *
 * ## What it may not do
 *
 * - **No run here.** The job is the privileged side's; this window shows it.
 * - **No literal human-readable string**, no network call, no preference
 *   write; the file chooser's path is passed on once and never kept or
 *   logged (`docs/09` §2.2).
 */

/* global Zotero, window, document, ChromeUtils */

var RHSummarizeWindow = {
  spec: {
    root: "rh-summarize-window",
    header: "rh-summarize-header",
    resummarize: "rh-summarize-resummarize",
    writeNotes: "rh-summarize-write-notes",
    notesReadonly: "rh-summarize-notes-readonly",
    stage: "rh-summarize-stage",
    progress: "rh-summarize-progress",
    remaining: "rh-summarize-remaining",
    notice: "rh-summarize-notice",
    question: "rh-summarize-question",
    questionText: "rh-summarize-question-text",
    continueButton: "rh-summarize-continue",
    stopButton: "rh-summarize-stop",
    rows: "rh-summarize-rows",
    counts: "rh-summarize-counts",
    outcome: "rh-summarize-outcome",
    exportStatus: "rh-summarize-export-status",
    exportButton: "rh-summarize-export",
    start: "rh-summarize-start",
    cancel: "rh-summarize-cancel",
    close: "rh-summarize-close",
  },

  filePickerModule: "chrome://zotero/content/modules/filePicker.mjs",

  state: {
    initialized: false,
    started: false,
    running: false,
    pendingAnswer: null,
  },

  /** `window.arguments[0]`, or an empty object when opened without one. */
  io: {},

  init() {
    if (this.state.initialized) {
      return;
    }
    this.state.initialized = true;
    this.io =
      (typeof window !== "undefined" &&
        window.arguments &&
        window.arguments[0]) ||
      {};
    this.registerUIRoot();
    this.applyTitle();
    this.on(this.spec.start, () => this.start());
    this.on(this.spec.cancel, () => this.cancel());
    this.on(this.spec.close, () => window.close());
    this.on(this.spec.exportButton, () => this.exportSummaries());
    this.on(this.spec.continueButton, () => this.answer("resume"));
    this.on(this.spec.stopButton, () => this.answer("cancel"));
    window.addEventListener(
      "unload",
      () => {
        this.answer("cancel");
        this.call("closed");
      },
      { once: true },
    );
    const session = this.io.session;
    if (session && typeof session.describe === "function") {
      this.settle(
        session.describe().then((description) => {
          if (!description) {
            return;
          }
          const box = this.el(this.spec.writeNotes);
          if (box) {
            box.checked =
              description.writeNotesDefault === true &&
              description.model.notesWritable === true;
          }
          this.render(description.model);
        }),
      );
    }
  },

  /** The two options, read once at Start. */
  options() {
    return {
      resummarize: this.checked(this.spec.resummarize),
      writeNotes: this.checked(this.spec.writeNotes),
    };
  },

  start() {
    const session = this.io.session;
    if (this.state.running || !session || typeof session.start !== "function") {
      return;
    }
    this.state.started = true;
    this.state.running = true;
    this.setDisabled(this.spec.start, true);
    this.setDisabled(this.spec.cancel, false);
    const sink = {
      render: (model) => this.render(model),
      ask: (line) => this.ask(line),
    };
    this.settle(
      session.start(this.options(), sink).then(
        () => this.finished(),
        () => this.finished(),
      ),
    );
  },

  finished() {
    this.state.running = false;
    this.setDisabled(this.spec.cancel, true);
    this.setDisabled(this.spec.start, false);
  },

  cancel() {
    this.answer("cancel");
    this.call("cancel");
  },

  /** A paused run's question, asked here; resolves "resume" or "cancel". */
  ask(line) {
    this.answer("cancel");
    const box = this.el(this.spec.question);
    this.place(this.el(this.spec.questionText), line);
    if (box) {
      box.hidden = false;
    }
    return new Promise((resolve) => {
      this.state.pendingAnswer = resolve;
    });
  },

  answer(choice) {
    const resolve = this.state.pendingAnswer;
    this.state.pendingAnswer = null;
    const box = this.el(this.spec.question);
    if (box) {
      box.hidden = true;
    }
    if (typeof resolve === "function") {
      resolve(choice);
    }
  },

  render(model) {
    if (!model) {
      return;
    }
    this.place(this.el(this.spec.header), model.header);
    this.place(this.el(this.spec.stage), model.stage);
    this.place(this.el(this.spec.progress), model.progress);
    this.place(this.el(this.spec.remaining), model.remaining);
    this.place(this.el(this.spec.notice), model.notice);
    this.place(this.el(this.spec.counts), model.counts);
    this.place(this.el(this.spec.outcome), model.outcome);
    this.renderRows(model.rows || []);
    const running = model.running === true;
    this.setDisabled(this.spec.resummarize, running || this.state.running);
    this.setDisabled(
      this.spec.writeNotes,
      running || this.state.running || model.notesWritable !== true,
    );
    const readonly = this.el(this.spec.notesReadonly);
    if (readonly) {
      readonly.hidden = model.notesWritable === true;
    }
    if (model.notesWritable !== true) {
      const box = this.el(this.spec.writeNotes);
      if (box) {
        box.checked = false;
      }
    }
    const exportButton = this.el(this.spec.exportButton);
    if (exportButton) {
      exportButton.hidden = model.exportAvailable !== true;
    }
  },

  renderRows(rows) {
    const container = this.el(this.spec.rows);
    if (!container) {
      return;
    }
    while (container.firstChild) {
      container.firstChild.remove();
    }
    for (const line of rows) {
      const p = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
      this.setL10n(p, line);
      container.appendChild(p);
    }
  },

  /** Place a line, or empty and hide the element when there is none. */
  place(element, line) {
    if (!element) {
      return;
    }
    if (!line || !line.id) {
      element.removeAttribute("data-l10n-id");
      element.textContent = "";
      element.hidden = true;
      return;
    }
    element.hidden = false;
    this.setL10n(element, line);
  },

  setL10n(element, line) {
    if (document.l10n && typeof document.l10n.setAttributes === "function") {
      document.l10n.setAttributes(element, line.id, line.args || undefined);
    } else {
      element.setAttribute("data-l10n-id", line.id);
    }
  },

  async exportSummaries() {
    const session = this.io.session;
    if (!session || typeof session.exportSummaries !== "function") {
      return "";
    }
    const path = await this.pickExportPath();
    if (!path) {
      return "";
    }
    let outcome;
    try {
      outcome = await session.exportSummaries(path);
    } catch {
      outcome = "failed";
    }
    const status = this.el(this.spec.exportStatus);
    const ids = (this.io && this.io.l10n) || {};
    this.place(status, {
      id: ids.exportOutcome || "research-helper-summarize-export-outcome",
      args: { outcome: outcome === "written" ? "written" : "failed" },
    });
    return outcome;
  },

  /**
   * The save dialog, as `searchDialog.js`'s `pickExportPath`: a window, not a
   * BrowsingContext; every failure is `""`; nothing is logged, because a
   * picker's message can quote the path.
   */
  async pickExportPath() {
    try {
      const utils =
        typeof ChromeUtils === "undefined" ? undefined : ChromeUtils;
      if (!utils || typeof utils.importESModule !== "function") {
        return "";
      }
      const module = utils.importESModule(this.filePickerModule);
      const Picker = module ? module.FilePicker : undefined;
      if (typeof Picker !== "function") {
        return "";
      }
      const picker = new Picker();
      const button = this.el(this.spec.exportButton);
      const title =
        (button && button.getAttribute("label")) || document.title || "";
      picker.init(window, title, picker.modeSave);
      // "HTML" is a format name and is not translated (`docs/08` §10.3).
      picker.appendFilter("HTML", "*.html");
      picker.defaultExtension = "html";
      picker.defaultString = "research-helper-summaries.html";
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) {
        return "";
      }
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      return "";
    }
  },

  applyTitle() {
    const ids = (this.io && this.io.l10n) || {};
    const l10n = document.l10n;
    if (!ids.title || !l10n || typeof l10n.formatValue !== "function") {
      return;
    }
    this.settle(
      l10n.formatValue(ids.title).then((value) => {
        if (value) {
          document.title = value;
        }
      }),
    );
  },

  call(name) {
    const session = this.io.session;
    try {
      if (session && typeof session[name] === "function") {
        session[name]();
      }
    } catch (error) {
      this.debug("session." + name + " threw", error);
    }
  },

  checked(id) {
    const box = this.el(id);
    return Boolean(box && !box.disabled && box.checked);
  },

  setDisabled(id, disabled) {
    const element = this.el(id);
    if (element) {
      element.disabled = disabled;
    }
  },

  el(id) {
    return document.getElementById(id);
  },

  on(id, handler) {
    const element = this.el(id);
    if (element) {
      element.addEventListener("command", handler);
    }
  },

  registerUIRoot() {
    try {
      Zotero.UIProperties.registerRoot(document.getElementById(this.spec.root));
    } catch (error) {
      this.debug("could not register the window root", error);
    }
  },

  /** Swallow a promise's rejection, visibly: there is no console here. */
  settle(promise) {
    if (!promise || typeof promise.then !== "function") {
      return;
    }
    promise.then(undefined, (error) =>
      this.debug("a host call rejected", error),
    );
  },

  /** One Debug Output line: the error's name only, never a value. */
  debug(what, error) {
    try {
      Zotero.debug(
        "[research-helper] summarize window: " +
          what +
          ": " +
          String(error && error.name ? error.name : typeof error),
      );
    } catch {
      /* a diagnostic that cannot be written is not worth a second failure */
    }
  },
};

// The CSP fallback for the document's `onload` attribute; see `init()`.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("load", () => RHSummarizeWindow.init(), {
    once: true,
  });
}
