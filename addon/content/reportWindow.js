/**
 * The report window's script (P4-T19; docs/08 §6.4 and its note of
 * 2026-10-29).
 *
 * Loaded as a classic chrome script by `reportWindow.xhtml`, so it declares
 * one global `var` and exports nothing, as `summarize.js` does (`docs/01` §8.3
 * forbids an inline `<script>`).
 *
 * ## What it does
 *
 * It draws the model `src/ui/panes/reportWindow.ts` builds — every line is a
 * Fluent id with its arguments — and calls the privileged session it was
 * handed as `window.arguments[0].session`: `describe()` on load, `closed()`
 * when the window goes away. The language selector starts on the model's
 * `language` (the `reportLanguage` preference) and is a per-run override:
 * {@link RHReportWindow.selectedLanguage} reads it, and nothing writes it back
 * to the preference.
 *
 * `P4-T20` adds the run (start, stage rows, preview, cancel, delivery) here
 * and in the session.
 *
 * ## What it may not do
 *
 * - **No run here.** A job belongs to the privileged side.
 * - **No literal human-readable string**, no network call, no preference
 *   write; nothing is logged but an error's name.
 */

/* global Zotero, window, document */

var RHReportWindow = {
  spec: {
    root: "rh-report-dialog",
    collection: "rh-report-collection",
    language: "rh-report-language",
    model: "rh-report-model",
  },

  /** `reportLanguage`'s values (docs/07 §8.5), the selector's items. */
  languages: ["auto", "en", "ko", "both"],

  state: {
    initialized: false,
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
    window.addEventListener("unload", () => this.call("closed"), {
      once: true,
    });
    const session = this.io.session;
    if (session && typeof session.describe === "function") {
      this.ready = session.describe().then(
        (model) => this.render(model),
        (error) => this.debug("session.describe rejected", error),
      );
    } else {
      this.ready = Promise.resolve();
    }
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

  /** Put the selector on `value`, or on `auto` for anything unknown. */
  selectLanguage(value) {
    const list = this.el(this.spec.language);
    if (!list) {
      return;
    }
    const wanted = this.languages.includes(value) ? value : "auto";
    list.value = wanted;
  },

  /** The language chosen for this run, one of {@link languages}. */
  selectedLanguage() {
    const list = this.el(this.spec.language);
    const value = list ? list.value : undefined;
    return this.languages.includes(value) ? value : "auto";
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

  el(id) {
    return document.getElementById(id);
  },

  registerUIRoot() {
    try {
      Zotero.UIProperties.registerRoot(document.getElementById(this.spec.root));
    } catch (error) {
      this.debug("could not register the window root", error);
    }
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
