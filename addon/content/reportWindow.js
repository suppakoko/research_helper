/**
 * The report window's script (P4-T19, P4-T20; docs/08 §6.1–§6.4 and their
 * notes of 2026-10-29 and 2026-11-02).
 *
 * Loaded as a classic chrome script by `reportWindow.xhtml`, so it declares
 * one global `var` and exports nothing, as `summarize.js` does (`docs/01` §8.3
 * forbids an inline `<script>`).
 *
 * ## What it does
 *
 * It draws the model `src/ui/viewModels/reportViewModel.ts` builds — every
 * line is a Fluent id with its arguments, or text the host already formatted
 * from the main-window bundle — and calls the privileged session it was handed
 * as `window.arguments[0].session`: `describe()` and `attach(sink)` on load,
 * `start()` on Generate, `cancel()` on Cancel, the three delivery actions,
 * `closed()` when the window goes away. The session calls back `render(model)`
 * and `ask(question)`.
 *
 * The language selector starts on the model's `language` (the `reportLanguage`
 * preference) and is a per-run override: {@link RHReportWindow.selectedLanguage}
 * reads it, and nothing writes it back to the preference.
 *
 * ## The preview (docs/08 §6.2, §9)
 *
 * Raw text only, appended to one text node while the draft streams: Markdown
 * is never parsed here. `aria-live` is set on the container only when the model
 * says no more deltas follow, or a screen reader would read every token. It
 * stays at the bottom only while the user has not scrolled up.
 *
 * ## What it may not do
 *
 * - **No run here.** A job belongs to the privileged side.
 * - **No literal human-readable string**, no network call, no preference
 *   write; nothing is logged but an error's name; the file chooser's path is
 *   passed on once and never kept or logged (`docs/09` §2.2).
 */

/* global Zotero, window, document, ChromeUtils */

var RHReportWindow = {
  spec: {
    root: "rh-report-dialog",
    collection: "rh-report-collection",
    language: "rh-report-language",
    model: "rh-report-model",
    generate: "rh-report-generate",
    cancel: "rh-report-cancel",
    stage: "rh-report-stage",
    rows: "rh-report-rows",
    spend: "rh-report-spend",
    notice: "rh-report-notice",
    question: "rh-report-question",
    questionText: "rh-report-question-text",
    yes: "rh-report-yes",
    no: "rh-report-no",
    previewLabel: "rh-report-preview-label",
    preview: "rh-report-preview",
    outcome: "rh-report-outcome",
    stop: "rh-report-stop-reason",
    note: "rh-report-note",
    delivery: "rh-report-delivery",
    saveNote: "rh-report-save-note",
    exportButton: "rh-report-export",
    copy: "rh-report-copy",
  },

  filePickerModule: "chrome://zotero/content/modules/filePicker.mjs",

  /** `reportLanguage`'s values (docs/07 §8.5), the selector's items. */
  languages: ["auto", "en", "ko", "both"],

  state: {
    initialized: false,
    running: false,
    pendingAnswer: null,
    /** The text the preview's node holds, to append rather than replace. */
    previewText: "",
    /** Each element's last line, so an unchanged line is not set again. */
    placed: new Map(),
  },

  /** `window.arguments[0]`, or an empty object when opened without one. */
  io: {},

  /** Resolves when the first `describe()` has been drawn (for a test). */
  ready: undefined,

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
    this.applyChromeStrings();
    this.on(this.spec.generate, () => this.start());
    this.on(this.spec.cancel, () => this.cancel());
    this.on(this.spec.yes, () => this.answer("resume"));
    this.on(this.spec.no, () => this.answer("cancel"));
    this.on(this.spec.saveNote, () => this.settle(this.callAsync("saveNote")));
    this.on(this.spec.exportButton, () => this.settle(this.exportMarkdown()));
    this.on(this.spec.copy, () => this.copy());
    window.addEventListener(
      "unload",
      () => {
        // `closed` first: a closing window does not answer for a run that
        // goes on waiting for the next one (plan/00 §6 item 324(a)).
        this.call("closed");
        this.answer("cancel");
      },
      { once: true },
    );
    const session = this.io.session;
    if (session && typeof session.describe === "function") {
      this.ready = session
        .describe()
        .then(
          (model) => this.render(model),
          (error) => this.debug("session.describe rejected", error),
        )
        .then(() => {
          if (typeof session.attach === "function") {
            this.settle(session.attach(this.sink()));
          }
        });
    } else {
      this.ready = Promise.resolve();
    }
  },

  /** What the session calls back. */
  sink() {
    return {
      render: (model) => this.renderRun(model),
      ask: (question) => this.ask(question),
    };
  },

  /** Draw the model: the collection line, the language, the model line. */
  render(model) {
    if (!model) {
      return;
    }
    this.place(this.el(this.spec.collection), model.collection);
    this.place(this.el(this.spec.model), model.model);
    this.selectLanguage(model.language);
  },

  /** Draw the run: stage, rows, preview, outcome and the buttons. */
  renderRun(model) {
    if (!model) {
      return;
    }
    this.place(this.el(this.spec.stage), model.stage);
    this.place(this.el(this.spec.spend), model.spend);
    this.place(this.el(this.spec.notice), model.notice);
    this.place(this.el(this.spec.outcome), model.outcome);
    this.place(this.el(this.spec.stop), model.stop);
    this.place(this.el(this.spec.note), model.note);
    this.place(this.el(this.spec.delivery), model.delivery);
    this.place(this.el(this.spec.previewLabel), model.preview.label);
    this.renderRows(model.rows || []);
    this.renderPreview(model.preview);
    const running = model.running === true;
    this.state.running = running;
    const buttons = model.buttons || {};
    this.setDisabled(this.spec.generate, buttons.generate !== true);
    this.setDisabled(this.spec.cancel, buttons.cancel !== true);
    this.setDisabled(this.spec.saveNote, buttons.saveNote !== true);
    this.setDisabled(this.spec.exportButton, buttons.export !== true);
    this.setDisabled(this.spec.copy, buttons.copy !== true);
    this.setDisabled(this.spec.language, running);
  },

  renderRows(rows) {
    const container = this.el(this.spec.rows);
    if (!container) {
      return;
    }
    while (container.children.length > rows.length) {
      container.lastElementChild.remove();
    }
    rows.forEach((row, index) => {
      let p = container.children[index];
      if (!p) {
        p = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
        p.style.margin = "0";
        container.appendChild(p);
      }
      if (p.getAttribute("data-status") !== row.status) {
        p.setAttribute("data-status", row.status);
        if (row.status === "active") {
          p.setAttribute("aria-current", "step");
        } else {
          p.removeAttribute("aria-current");
        }
      }
      p.setAttribute("data-row", row.key);
      this.place(p, row.line);
    });
  },

  /** Append when the text grew, replace otherwise; never parse it. */
  renderPreview(preview) {
    const box = this.el(this.spec.preview);
    if (!box || !preview) {
      return;
    }
    const text = preview.text || "";
    const had = this.state.previewText;
    if (text !== had) {
      // Bottom-anchored only while the user has not scrolled up (docs/08 §6.2).
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
      const node = box.firstChild;
      if (node && node.nodeType === 3 && had !== "" && text.startsWith(had)) {
        node.appendData(text.slice(had.length));
      } else {
        box.textContent = text;
      }
      this.state.previewText = text;
      if (atBottom) {
        box.scrollTop = box.scrollHeight;
      }
    }
    box.hidden = text === "";
    // docs/08 §9: only after streaming completes.
    if (preview.final === true) {
      box.setAttribute("aria-live", "polite");
    } else {
      box.removeAttribute("aria-live");
    }
  },

  start() {
    const session = this.io.session;
    if (this.state.running || !session || typeof session.start !== "function") {
      return;
    }
    this.state.running = true;
    this.setDisabled(this.spec.generate, true);
    this.setDisabled(this.spec.cancel, false);
    this.setDisabled(this.spec.language, true);
    this.settle(
      session.start({ language: this.selectedLanguage() }, this.sink()),
    );
  },

  cancel() {
    this.answer("cancel");
    this.call("cancel");
  },

  /** A question, asked in place; resolves "resume" (first button) or "cancel". */
  ask(question) {
    this.answer("cancel");
    this.place(this.el(this.spec.questionText), question.line);
    this.setL10n(this.el(this.spec.yes), { id: question.yes });
    this.setL10n(this.el(this.spec.no), { id: question.no });
    const box = this.el(this.spec.question);
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

  async exportMarkdown() {
    const session = this.io.session;
    if (!session || typeof session.exportMarkdown !== "function") {
      return;
    }
    const path = await this.pickExportPath(
      typeof session.exportFileName === "function"
        ? session.exportFileName()
        : undefined,
    );
    if (path) {
      await session.exportMarkdown(path);
    }
  },

  /**
   * The save dialog, as `summarize.js`'s `pickExportPath`: a window, not a
   * BrowsingContext; every failure is `""`; nothing is logged, because a
   * picker's message can quote the path.
   */
  async pickExportPath(suggested) {
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
      // "Markdown" is a format name and is not translated (`docs/08` §10.3).
      picker.appendFilter("Markdown", "*.md");
      picker.defaultExtension = "md";
      if (suggested) {
        picker.defaultString = suggested;
      }
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) {
        return "";
      }
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      return "";
    }
  },

  /** "Copy": `Zotero.Utilities.Internal` is the window's to name (docs/08 §6.3). */
  copy() {
    const session = this.io.session;
    if (!session || typeof session.copyText !== "function") {
      return;
    }
    try {
      const text = session.copyText();
      if (typeof text === "string" && text !== "") {
        Zotero.Utilities.Internal.copyTextToClipboard(text);
        this.call("copied");
      }
    } catch (error) {
      this.debug("copy failed", error);
    }
  },

  /** The language chosen for this run, one of {@link languages}. */
  selectedLanguage() {
    const list = this.el(this.spec.language);
    const value = list ? list.value : undefined;
    return this.languages.includes(value) ? value : "auto";
  },

  /** Put the selector on `value`, or on `auto` for anything unknown. */
  selectLanguage(value) {
    const list = this.el(this.spec.language);
    if (!list) {
      return;
    }
    const wanted = this.languages.includes(value) ? value : "auto";
    list.value = wanted;
  },

  /**
   * Place a line, or empty and hide the element when there is none. A line
   * with `text` is the host's, already formatted. An unchanged line is not set
   * again: a render follows every streamed delta.
   */
  place(element, line) {
    if (!element) {
      return;
    }
    const key = line ? JSON.stringify(line) : "";
    if (this.state.placed.get(element) === key) {
      return;
    }
    this.state.placed.set(element, key);
    if (!line || (!line.id && line.text === undefined)) {
      element.removeAttribute("data-l10n-id");
      element.removeAttribute("data-l10n-args");
      element.textContent = "";
      element.hidden = true;
      return;
    }
    element.hidden = false;
    if (line.text !== undefined) {
      element.removeAttribute("data-l10n-id");
      element.removeAttribute("data-l10n-args");
      element.textContent = line.text;
      return;
    }
    this.setL10n(element, line);
  },

  setL10n(element, line) {
    if (!element) {
      return;
    }
    if (document.l10n && typeof document.l10n.setAttributes === "function") {
      document.l10n.setAttributes(element, line.id, line.args || undefined);
    } else {
      element.setAttribute("data-l10n-id", line.id);
    }
  },

  /**
   * The window title and the dialog's Close label: XUL carries them in
   * attributes (`title`, `buttonlabelcancel`) that the bundle's entries do
   * not target, so they are formatted here, as `searchDialog.js` does.
   */
  applyChromeStrings() {
    const ids = (this.io && this.io.l10n) || {};
    const l10n = document.l10n;
    if (!ids.title || !ids.close || !l10n) {
      return;
    }
    if (typeof l10n.formatMessages !== "function") {
      return;
    }
    l10n.formatMessages([{ id: ids.title }, { id: ids.close }]).then(
      (messages) => {
        const [title, close] = messages;
        if (title && title.value) {
          document.title = title.value;
        }
        const label =
          close && Array.isArray(close.attributes)
            ? close.attributes.find((attr) => attr.name === "label")
            : undefined;
        const dialog = this.el(this.spec.root);
        if (dialog && label && label.value) {
          dialog.setAttribute("buttonlabelcancel", label.value);
        }
      },
      (error) => this.debug("the window's chrome strings failed", error),
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

  /** Call a session member that returns a promise, or nothing. */
  callAsync(name) {
    const session = this.io.session;
    if (session && typeof session[name] === "function") {
      return session[name]();
    }
    return Promise.resolve();
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
        "[research-helper] report window: " +
          what +
          ": " +
          String(error && error.name ? error.name : typeof error),
      );
    } catch {
      /* a diagnostic that cannot be written is not worth a second failure */
    }
  },
};

// The CSP fallback for the document's `onload` attribute, as summarize.js.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("load", () => RHReportWindow.init(), {
    once: true,
  });
}
