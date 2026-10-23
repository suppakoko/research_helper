/**
 * The key-storage degradation dialog's window script (P3-T03; docs/09 §1.7).
 *
 * Loaded as a classic chrome script by `secretBackend.xhtml`, so it declares
 * one global `var` and exports nothing, as `searchDialog.js` does and for the
 * same reason (`docs/01` §8.3 forbids an inline `<script>`).
 *
 * ## What it does
 *
 * It reports exactly one choice to the privileged side, through the
 * `onChoice` function `src/ui/dialogs/secretBackendDialog.ts` passes as
 * `window.arguments[0]`:
 *
 * - **accept** ("Keep keys for this session") → `"session"`;
 * - **cancel**, Escape, or closing the window → `"none"`.
 *
 * Only the first report counts, so the `unload` that follows an accept cannot
 * turn it into `"none"`. Nothing here stores, reads or sees a key: the dialog
 * runs before any key exists, and it only reports which store to install.
 *
 * ## What it may not do
 *
 * - **No silent choice.** The default button is cancel (`defaultButton` in the
 *   document), so Enter on an untouched dialog stores nothing.
 * - **No literal human-readable string.** The window title and the two button
 *   labels sit in XUL attributes the bundle cannot target, so they are
 *   formatted from `research-helper-mainWindow.ftl` here; the three paragraphs
 *   are `data-l10n-id`s in the document. The ids are repeated from
 *   `SECRET_BACKEND_DIALOG_L10N` in `src/ui/dialogs/secretBackendDialog.ts`,
 *   because this file cannot import from `src/`.
 * - **No network call** (`docs/01` §8.3).
 */

/* global Zotero, window, document */

var RHSecretBackendDialog = {
  /** Element ids this file and `secretBackend.xhtml` share. */
  spec: {
    root: "rh-secret-backend-dialog",
  },

  /** The three ids formatted here (see the header). */
  l10n: {
    title: "research-helper-secret-backend-title",
    accept: "research-helper-secret-backend-accept",
    decline: "research-helper-secret-backend-decline",
  },

  /** The two choices, spelled as `SECRET_BACKEND_CHOICES` spells them. */
  choices: {
    accept: "session",
    decline: "none",
  },

  state: {
    initialized: false,
    reported: false,
  },

  /** `window.arguments[0]`, or an empty object when opened without one. */
  io: {},

  /**
   * Called from the document's `onload` and from a `load` listener at the
   * bottom of this file (the CSP fallback `searchDialog.js` also carries);
   * the second call is a no-op.
   */
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

    document.addEventListener("dialogaccept", () =>
      this.report(this.choices.accept),
    );
    document.addEventListener("dialogcancel", () =>
      this.report(this.choices.decline),
    );
    window.addEventListener("unload", () => this.report(this.choices.decline), {
      once: true,
    });
  },

  /**
   * Hand one choice to the privileged side. Later calls do nothing, so the
   * `unload` after an accept or a cancel does not report twice.
   *
   * @param {string} choice - `"session"` or `"none"`
   */
  report(choice) {
    if (this.state.reported) {
      return;
    }
    this.state.reported = true;
    try {
      if (this.io && typeof this.io.onChoice === "function") {
        this.io.onChoice(choice);
      }
    } catch (error) {
      this.debug("could not report the key-storage choice", error);
    }
  },

  /**
   * `Zotero.UIProperties.registerRoot()`, which applies the user's font size
   * and density to this window (`docs/08` §4.1.1 requirement 2). Wrapped: a
   * dialog that cannot register its root must still let the user choose.
   */
  registerUIRoot() {
    try {
      Zotero.UIProperties.registerRoot(document.getElementById(this.spec.root));
    } catch (error) {
      this.debug("could not register the dialog root", error);
    }
  },

  /**
   * Set the window title and the two button labels from Fluent.
   *
   * @returns {Promise<void>|undefined}
   */
  applyChromeStrings() {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.formatMessages !== "function") {
      return undefined;
    }
    return l10n
      .formatMessages([
        { id: this.l10n.title },
        { id: this.l10n.accept },
        { id: this.l10n.decline },
      ])
      .then(([title, accept, decline]) => {
        if (title && title.value) {
          document.title = title.value;
        }
        const dialog = document.getElementById(this.spec.root);
        const acceptLabel = this.attributeOf(accept, "label");
        const declineLabel = this.attributeOf(decline, "label");
        if (dialog && acceptLabel !== undefined) {
          dialog.setAttribute("buttonlabelaccept", acceptLabel);
        }
        if (dialog && declineLabel !== undefined) {
          dialog.setAttribute("buttonlabelcancel", declineLabel);
        }
      })
      .catch((error) =>
        this.debug("could not format the dialog strings", error),
      );
  },

  /**
   * One attribute of a formatted Fluent message.
   *
   * @param {{ attributes?: { name: string, value: string }[] }|null|undefined} message
   * @param {string} name
   * @returns {string|undefined}
   */
  attributeOf(message, name) {
    const attributes = (message && message.attributes) || [];
    for (const attribute of attributes) {
      if (attribute.name === name) {
        return attribute.value;
      }
    }
    return undefined;
  },

  /**
   * One Debug Output line: the error's name only, never a value.
   *
   * @param {string} what
   * @param {unknown} error
   */
  debug(what, error) {
    try {
      Zotero.debug(
        "[research-helper] key-storage dialog: " +
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
  window.addEventListener("load", () => RHSecretBackendDialog.init(), {
    once: true,
  });
}
