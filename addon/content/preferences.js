/**
 * The preference pane's controller (P1-T44).
 *
 * Loaded by Zotero's preferences window through
 * `Zotero.PreferencePanes.register({ scripts })`, which evaluates it with
 * `Services.scriptloader.loadSubScript` inside a `Cu.Sandbox` whose prototype
 * is the preferences window (Zotero 8+: "Preference panes now have isolated
 * global scope"). So `window`, `document` and `Zotero` resolve, but nothing
 * declared here is visible to the window, and nothing declared by another
 * pane is visible here. The file declares one `var` and exports nothing; the
 * integration spec reaches it through `Zotero_Preferences.getScope(paneID)`.
 *
 * ## How it starts
 *
 * Zotero inserts `preferences.xhtml`, translates it, then dispatches a
 * non-bubbling `load` event on the fragment's root (`#rh-preferences`). This
 * script registers a **capturing** listener on `document` — capture reaches
 * the ancestors of a non-bubbling event on the way down — and initialises when
 * the target is our root. No inline `onload` in the markup: an inline handler
 * compiles in the window's scope, where `RHPreferences` does not exist.
 *
 * ## What this file may and may not do
 *
 * - **No network call, ever.** `docs/01` §8.3. The Test call is made by the
 *   privileged host in the plugin sandbox; this file asks for an outcome.
 * - **No key is ever read back.** The host returns booleans, a digest and
 *   outcomes; `SecretStore.get()` is never called to populate a field
 *   (`docs/09` §1.9 rule 2). The digest the host returns goes into the field's
 *   `placeholder` and nowhere else — not into a log line, not into an error.
 * - **No clipboard.** Nothing here reads or writes the clipboard, there is no
 *   copy button, and `copy` / `cut` on a key field are refused (rule 7/8).
 * - **No `Zotero.Prefs` write.** The host reads the one non-secret row the
 *   badge needs; this file writes no preference at all (rule 9, decision D5).
 * - **No literal human-readable string.** Every visible string is a Fluent id
 *   from `research-helper-mainWindow.ftl`; the ids are listed in
 *   {@link RHPreferences.l10n} and `test/unit/ui/preferencesPane.test.ts`
 *   asserts they agree with `src/ui/prefs/preferencesPane.ts`.
 *
 * ## Where the data comes from
 *
 * The privileged host is published by `src/bootstrap/registerUI.ts` at
 * `Zotero.<addonInstance>.api.preferences` (`PREFERENCES_API_PROPERTY`). With
 * no host — startup failed before publication — every control is disabled and
 * the badge shows the unavailable state, which is the honest reading: nothing
 * can be stored.
 */

/* global Zotero, window, document */

var RHPreferences = {
  /** Element ids this file and `preferences.xhtml` share. */
  spec: {
    root: "rh-preferences",
    backend: "rh-prefs-backend",
    removeAll: "rh-prefs-remove-all",
    removeAllStatus: "rh-prefs-remove-all-status",
    /**
     * One entry per credential block, keyed by `SecretId`. The element ids are
     * `<prefix>-key`, `-reveal`, `-test`, `-clear`, `-backend`, `-status`
     * (`SOURCE_CREDENTIALS` in src/ui/prefs/preferencesPane.ts).
     */
    credentials: {
      "source.ncbi": "rh-ncbi",
      "source.semanticscholar": "rh-s2",
    },
    s2Request: "rh-s2-request",
  },

  /**
   * Fluent ids, as literals: this file cannot import `PREFERENCES_L10N`.
   * `test/unit/ui/preferencesPane.test.ts` asserts every value here is in it.
   */
  l10n: {
    backendWindows: "research-helper-prefs-backend-windows",
    backendMac: "research-helper-prefs-backend-mac",
    backendIndeterminate: "research-helper-prefs-backend-indeterminate",
    backendUnavailable: "research-helper-prefs-backend-unavailable",
    removeAllDone: "research-helper-prefs-remove-all-done",
    keyAbsent: "research-helper-prefs-key-absent",
    keyAbsentOs: "research-helper-prefs-key-absent-os",
    keyPresent: "research-helper-prefs-key-present",
    keyCleared: "research-helper-prefs-key-cleared",
    storeUnavailable: "research-helper-prefs-store-unavailable",
    storeEmpty: "research-helper-prefs-store-empty",
    testRunning: "research-helper-prefs-test-running",
    testOk: "research-helper-prefs-test-ok",
    testInconclusive: "research-helper-prefs-test-inconclusive",
    testRejected: "research-helper-prefs-test-rejected",
    testForbidden: "research-helper-prefs-test-forbidden",
    testAbsent: "research-helper-prefs-test-absent",
    testUnavailable: "research-helper-prefs-test-unavailable",
  },

  /**
   * `docs/07` §8.5's `secretBackend` value for tier 1 — the same literal as
   * `OS_KEYSTORE_PREF_VALUE` in src/ui/prefs/preferencesPane.ts, asserted equal
   * by the unit test.
   */
  OS_KEYSTORE: "oskeystore",

  /** The privileged host, or `{}` when nothing published one. */
  host: null,

  /** Set by `init()`; `true` while a Test call is in flight for a credential. */
  busy: {},

  /**
   * Pure decisions, kept free of DOM so the unit test can evaluate this file
   * with `new Function` and assert them in plain Node.
   */
  logic: {
    /**
     * `backendBadge()`'s table, duplicated as data: which message and whether
     * it is a warning, for a `secretBackend` value and a platform.
     *
     * @param {string} backendPref
     * @param {"win"|"mac"|"linux"|"other"} platform
     * @param {{ OS_KEYSTORE: string, l10n: object }} ctx
     * @returns {{ messageId: string, warning: boolean, canStore: boolean, osStore: boolean }}
     */
    badge(backendPref, platform, ctx) {
      if (backendPref !== ctx.OS_KEYSTORE) {
        return {
          messageId: ctx.l10n.backendUnavailable,
          warning: true,
          canStore: false,
          osStore: false,
        };
      }
      if (platform === "win") {
        return {
          messageId: ctx.l10n.backendWindows,
          warning: false,
          canStore: true,
          osStore: true,
        };
      }
      if (platform === "mac") {
        return {
          messageId: ctx.l10n.backendMac,
          warning: false,
          canStore: true,
          osStore: true,
        };
      }
      return {
        messageId: ctx.l10n.backendIndeterminate,
        warning: true,
        canStore: true,
        osStore: false,
      };
    },

    /**
     * The status-row message for a credential's state.
     *
     * @param {{ present: boolean, lastTest?: object }} credential
     * @param {boolean} osStore - whether the badge names an operating-system
     *   store, which is the only case docs/09 §1.9 item 8's sentence is true in
     * @param {object} l10n
     * @returns {{ id: string, args?: object }}
     */
    statusMessage(credential, osStore, l10n) {
      if (!credential.present) {
        return { id: osStore ? l10n.keyAbsentOs : l10n.keyAbsent };
      }
      const test = credential.lastTest;
      if (!test || test.kind !== "tested") {
        return { id: l10n.keyPresent };
      }
      return RHPreferences.logic.testMessage(test, l10n);
    },

    /**
     * The status-row message for a Test report.
     *
     * @param {{ kind: string, outcome?: string, checkedAt?: string }} report
     * @param {object} l10n
     * @returns {{ id: string, args?: object }}
     */
    testMessage(report, l10n) {
      if (report.kind === "absent") {
        return { id: l10n.testAbsent };
      }
      if (report.kind === "unavailable") {
        return { id: l10n.testUnavailable };
      }
      const time = RHPreferences.logic.formatTime(report.checkedAt);
      switch (report.outcome) {
        case "ok":
          return { id: l10n.testOk, args: { time } };
        case "rejected":
          return { id: l10n.testRejected, args: { time } };
        case "forbidden":
          return { id: l10n.testForbidden, args: { time } };
        default:
          return { id: l10n.testInconclusive, args: { time } };
      }
    },

    /**
     * `docs/08` §10.3: dates are formatted by the caller with `Intl` over
     * `Zotero.locale`, never built in the sentence.
     *
     * @param {string} iso
     * @returns {string}
     */
    formatTime(iso) {
      const locale =
        typeof Zotero !== "undefined" && Zotero.locale
          ? Zotero.locale
          : "en-US";
      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    },

    /**
     * Which platform the badge is for, from the three Zotero flags.
     *
     * @param {{ isWin?: boolean, isMac?: boolean, isLinux?: boolean }} zotero
     * @returns {"win"|"mac"|"linux"|"other"}
     */
    platform(zotero) {
      if (zotero && zotero.isWin) return "win";
      if (zotero && zotero.isMac) return "mac";
      if (zotero && zotero.isLinux) return "linux";
      return "other";
    },
  },

  /** @returns {object} the host, never null */
  resolveHost() {
    const instance =
      typeof Zotero === "undefined" ? undefined : Zotero.__addonInstance__;
    const api = instance && instance.api;
    return (api && api.preferences) || {};
  },

  /** @returns {boolean} whether the resolved host has the method */
  can(method) {
    return !!this.host && typeof this.host[method] === "function";
  },

  /**
   * @param {string} id
   * @returns {Element|null}
   */
  el(id) {
    return document.getElementById(id);
  },

  /**
   * Translate `el` through the window's Fluent, or leave it alone when the
   * window has none (which never happens in a live preferences window, and is
   * the unit test's case).
   */
  localize(el, id, args) {
    if (!el) return;
    const l10n = document.l10n;
    if (l10n && typeof l10n.setAttributes === "function") {
      l10n.setAttributes(el, id, args);
    } else {
      el.setAttribute("data-l10n-id", id);
      if (args) el.setAttribute("data-l10n-args", JSON.stringify(args));
    }
  },

  /**
   * Entry point. Called from the capturing `load` listener at the bottom of
   * this file with the fragment root as `root`.
   *
   * @param {Element} root
   * @returns {Promise<void>}
   */
  async init(root) {
    this.host = this.resolveHost();
    this.busy = {};
    this.wireStorageBlock();
    for (const id of Object.keys(this.spec.credentials)) {
      this.wireCredentialBlock(id, this.spec.credentials[id]);
    }
    await this.refresh();
    if (root && typeof root.setAttribute === "function") {
      root.setAttribute("data-rh-initialized", "true");
    }
  },

  /** Re-read the host's state and repaint every block. */
  async refresh() {
    let state;
    if (this.can("readState")) {
      try {
        state = await this.host.readState();
      } catch (error) {
        this.report("readState", error);
      }
    }
    if (!state) {
      state = {
        backendPref: "",
        storeAvailable: false,
        credentials: Object.keys(this.spec.credentials).map((id) => ({
          id,
          present: false,
          lastTest: undefined,
        })),
      };
    }
    const badge = this.logic.badge(
      state.storeAvailable ? state.backendPref : "",
      this.logic.platform(typeof Zotero === "undefined" ? undefined : Zotero),
      this,
    );
    this.paintBadge(this.el(this.spec.backend), badge);
    for (const credential of state.credentials) {
      const prefix = this.spec.credentials[credential.id];
      if (!prefix) continue;
      this.paintBadge(this.el(prefix + "-backend"), badge);
      this.paintCredential(prefix, credential, badge);
    }
    const removeAll = this.el(this.spec.removeAll);
    if (removeAll) removeAll.disabled = !badge.canStore;
  },

  /**
   * @param {Element|null} el
   * @param {{ messageId: string, warning: boolean }} badge
   */
  paintBadge(el, badge) {
    if (!el) return;
    this.localize(el, badge.messageId);
    el.classList.toggle("rh-warning", badge.warning);
    // Zotero's own palette variables, so both themes get the right colour
    // without a stylesheet of this pane's own.
    el.style.color = badge.warning
      ? "var(--accent-red)"
      : "var(--accent-green)";
    el.style.fontWeight = badge.warning ? "bold" : "normal";
  },

  /**
   * Paint one credential block from its state. The field is **not** given the
   * key — rule 2 — only its `placeholder` carries the digest, and only right
   * after a store, because the host never recomputes a digest from storage.
   *
   * @param {string} prefix
   * @param {{ id: string, present: boolean, lastTest?: object }} credential
   * @param {{ canStore: boolean, osStore: boolean }} badge
   */
  paintCredential(prefix, credential, badge) {
    const input = this.el(prefix + "-key");
    const test = this.el(prefix + "-test");
    const clear = this.el(prefix + "-clear");
    const reveal = this.el(prefix + "-reveal");
    if (input) {
      input.disabled = !badge.canStore;
      if (!credential.present) input.placeholder = "";
    }
    if (reveal) reveal.disabled = !badge.canStore;
    if (test) test.disabled = !badge.canStore || !credential.present;
    if (clear) clear.disabled = !badge.canStore || !credential.present;
    const message = this.logic.statusMessage(
      credential,
      badge.osStore,
      this.l10n,
    );
    this.setStatus(prefix, message);
  },

  /**
   * @param {string} prefix
   * @param {{ id: string, args?: object }} message
   */
  setStatus(prefix, message) {
    this.localize(this.el(prefix + "-status"), message.id, message.args);
  },

  wireStorageBlock() {
    const removeAll = this.el(this.spec.removeAll);
    if (removeAll) {
      removeAll.addEventListener("command", () => {
        this.settle(this.removeAllKeys());
      });
    }
    const request = this.el(this.spec.s2Request);
    if (request) {
      request.addEventListener("click", (event) => {
        event.preventDefault();
        const href = request.getAttribute("href");
        if (href && typeof Zotero !== "undefined" && Zotero.launchURL) {
          Zotero.launchURL(href);
        }
      });
    }
  },

  /**
   * @param {string} id - the `SecretId`
   * @param {string} prefix - the block's element-id prefix
   */
  wireCredentialBlock(id, prefix) {
    const input = this.el(prefix + "-key");
    const reveal = this.el(prefix + "-reveal");
    const test = this.el(prefix + "-test");
    const clear = this.el(prefix + "-clear");

    if (input) {
      // Rule 7: the host normalises what it stores; this only keeps the field
      // honest about what will be stored while the key is still visible.
      input.addEventListener("paste", () => {
        window.setTimeout(() => {
          input.value = this.normalizeForDisplay(input.value);
        }, 0);
      });
      // Store on `change` (blur or Enter), as docs/08 §7.3's three-button
      // layout implies; an empty field is a no-op, not a clear.
      input.addEventListener("change", () => {
        if (input.value.length === 0) return;
        this.settle(this.storeKey(id, prefix, input));
      });
      // Rule 8: nothing leaves the field for the clipboard, even while shown.
      for (const type of ["copy", "cut"]) {
        input.addEventListener(type, (event) => event.preventDefault());
      }
    }

    if (reveal && input) {
      // Rule 1: hold-to-show. Pressed → text; released, left, blurred → password.
      const show = () => {
        input.type = "text";
      };
      const hide = () => {
        input.type = "password";
      };
      reveal.addEventListener("mousedown", show);
      reveal.addEventListener("mouseup", hide);
      reveal.addEventListener("mouseleave", hide);
      reveal.addEventListener("blur", hide);
      reveal.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          show();
        }
      });
      reveal.addEventListener("keyup", (event) => {
        if (event.key === " " || event.key === "Enter") hide();
      });
      // A XUL button also fires `command` on click; swallow it so the click's
      // mouseup is the only thing that decides the field's type.
      reveal.addEventListener("command", (event) => event.preventDefault());
    }

    if (test) {
      test.addEventListener("command", () => {
        this.settle(this.testKey(id, prefix));
      });
    }
    if (clear) {
      clear.addEventListener("command", () => {
        this.settle(this.clearKey(id, prefix, input));
      });
    }
  },

  /**
   * The display-side half of rule 7 — the host's `normalizeKeyInput` is the
   * one that decides what is stored.
   *
   * @param {string} raw
   * @returns {string}
   */
  normalizeForDisplay(raw) {
    return String(raw)
      .trim()
      .replace(/^bearer(?:\s+|$)/i, "")
      .trim();
  },

  /**
   * @param {string} id
   * @param {string} prefix
   * @param {HTMLInputElement} input
   */
  async storeKey(id, prefix, input) {
    if (!this.can("storeKey")) return;
    const result = await this.host.storeKey(id, input.value);
    // The typed value is dropped from the DOM whatever happened: a key that was
    // refused is not left on screen either.
    input.value = "";
    input.type = "password";
    if (result && result.stored) {
      input.placeholder = result.digest;
      await this.refresh();
      return;
    }
    const reason = result && result.reason;
    this.setStatus(prefix, {
      id:
        reason === "unavailable"
          ? this.l10n.storeUnavailable
          : this.l10n.storeEmpty,
    });
  },

  /**
   * @param {string} id
   * @param {string} prefix
   */
  async testKey(id, prefix) {
    if (!this.can("testKey") || this.busy[id]) return;
    this.busy[id] = true;
    const button = this.el(prefix + "-test");
    if (button) button.disabled = true;
    this.setStatus(prefix, { id: this.l10n.testRunning });
    try {
      const report = await this.host.testKey(id);
      this.setStatus(prefix, this.logic.testMessage(report, this.l10n));
    } catch (error) {
      // The outcome vocabulary has no "error" member on purpose: a thrown
      // error is "could not verify", and its text stays out of the pane.
      this.report("testKey", error);
      this.setStatus(
        prefix,
        this.logic.testMessage(
          {
            kind: "tested",
            outcome: "inconclusive",
            checkedAt: new Date().toISOString(),
          },
          this.l10n,
        ),
      );
    } finally {
      this.busy[id] = false;
      if (button) button.disabled = false;
    }
  },

  /**
   * @param {string} id
   * @param {string} prefix
   * @param {HTMLInputElement|null} input
   */
  async clearKey(id, prefix, input) {
    if (!this.can("clearKey")) return;
    await this.host.clearKey(id);
    if (input) {
      input.value = "";
      input.placeholder = "";
      input.type = "password";
    }
    await this.refresh();
    this.setStatus(prefix, { id: this.l10n.keyCleared });
  },

  async removeAllKeys() {
    if (!this.can("clearAllKeys")) return;
    const count = await this.host.clearAllKeys();
    for (const id of Object.keys(this.spec.credentials)) {
      const input = this.el(this.spec.credentials[id] + "-key");
      if (input) {
        input.value = "";
        input.placeholder = "";
        input.type = "password";
      }
    }
    await this.refresh();
    this.localize(this.el(this.spec.removeAllStatus), this.l10n.removeAllDone, {
      count,
    });
  },

  /**
   * Run a handler's promise and report a rejection by **name only**. The
   * message is never written: a failure path is where a value escapes, and a
   * platform or HTTP error message can carry a URL that carries a key.
   *
   * @param {Promise<unknown>} promise
   */
  settle(promise) {
    Promise.resolve(promise).catch((error) => this.report("handler", error));
  },

  /**
   * @param {string} where
   * @param {unknown} error
   */
  report(where, error) {
    try {
      Zotero.debug(
        "[research-helper] preference pane " +
          where +
          " failed: " +
          String(error && error.name ? error.name : typeof error),
      );
    } catch {
      /* a diagnostic that cannot be written is not worth a second failure */
    }
  },
};

// Zotero dispatches a non-bubbling `load` on the fragment root after inserting
// and translating it (preferences.js, _initImportedNodesPostInsert). A
// capturing listener sees it; a bubbling one would not.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener(
    "load",
    (event) => {
      const target = event.target;
      if (target && target.id === RHPreferences.spec.root) {
        RHPreferences.settle(RHPreferences.init(target));
      }
    },
    true,
  );
}
