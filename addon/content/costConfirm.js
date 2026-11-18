/**
 * The cost confirmation dialog's window script (P3-T16; docs/06 §5.4,
 * docs/10 FR-24, docs/09 §3.6).
 *
 * Loaded as a classic chrome script by `costConfirm.xhtml`, so it declares one
 * global `var` and exports nothing, as `secretBackend.js` does and for the same
 * reason (`docs/01` §8.3 forbids an inline `<script>`).
 *
 * ## What it does
 *
 * It renders the model `src/ui/dialogs/costConfirmDialog.ts` built — every
 * line is a Fluent id with arguments already formatted there — and reports
 * one answer through `window.arguments[0].onAnswer`:
 *
 * - **accept** → `{ accepted: true, downgrade, acknowledged, dontAskAgain }`,
 *   with `tierAnswer` when the model asked the audio tier question (P6-T17;
 *   the radio group's choice, the pre-selected one when nothing else was
 *   picked);
 * - **cancel**, Escape, or closing the window → `{ accepted: false }`.
 *
 * Only the first report counts. The privileged side checks the answer again
 * (`decideCostDialog`), so this file's enforcement — the accept button stays
 * disabled until a required acknowledgement is ticked — is a convenience, not
 * the guard.
 *
 * ## What it may not do
 *
 * - **No silent choice.** The default button is cancel; the abstract-only
 *   downgrade is shown ticked when the model pre-selects it, never applied
 *   without the user seeing it; switching plans clears the acknowledgement.
 * - **No literal human-readable string**, no network call, no preference
 *   write. It holds no Fluent id of its own either: every id it places,
 *   the title's and the two buttons' included, arrives in the model, whose
 *   ids are `COST_DIALOG_L10N`'s.
 */

/* global Zotero, window, document */

var RHCostDialog = {
  spec: {
    root: "rh-cost-dialog",
    header: "rh-cost-header",
    notices: "rh-cost-notices",
    plan: "rh-cost-plan",
    raise: "rh-cost-raise",
    downgrade: "rh-cost-downgrade",
    downgradeNote: "rh-cost-downgrade-note",
    acknowledge: "rh-cost-acknowledge",
    footer: "rh-cost-footer",
    dontAsk: "rh-cost-dont-ask",
    // P6-T17: the audio run's tier question (plan/00 §6 item 384).
    tier: "rh-cost-tier",
    tierPrompt: "rh-cost-tier-prompt",
    tierChoices: "rh-cost-tier-choices",
  },

  state: {
    initialized: false,
    reported: false,
  },

  /** `window.arguments[0]`, or an empty object when opened without one. */
  io: {},

  /**
   * Pure decisions, kept free of DOM so they can be evaluated in plain Node.
   */
  logic: {
    /**
     * The plan view in force: the downgrade's when it is ticked.
     *
     * @param {object} model - a preflight model
     * @param {boolean} downgrade
     * @returns {object}
     */
    viewFor(model, downgrade) {
      return downgrade && model.downgrade
        ? model.downgrade.plan
        : model.selected;
    },

    /**
     * Whether accept may be pressed.
     *
     * @param {object} model
     * @param {boolean} downgrade
     * @param {boolean} acknowledged
     * @returns {boolean}
     */
    canAccept(model, downgrade, acknowledged) {
      if (!model || model.mode !== "preflight") {
        return true;
      }
      const view = this.viewFor(model, downgrade);
      return !view.acknowledge || acknowledged === true;
    },

    /**
     * P6-T17: the tier answer to send with the accept — the choice selected,
     * or the model's pre-selected one; `undefined` when the model asked no
     * question, so nothing is sent.
     *
     * @param {object} model
     * @param {string | undefined} selected - the radio group's value
     * @returns {string | undefined}
     */
    tierAnswerFor(model, selected) {
      const question = model && model.tierQuestion;
      if (!question) {
        return undefined;
      }
      const offered = (question.choices || []).map((choice) => choice.answer);
      return offered.includes(selected) ? selected : question.preselected;
    },
  },

  /** Called from `onload` and from the `load` fallback below; once. */
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
    const model = this.io.model;

    this.registerUIRoot();
    if (model) {
      this.applyChromeStrings(model);
      if (model.mode === "preflight") {
        this.renderPreflight(model);
      } else {
        this.renderLines(this.spec.plan, model.lines || []);
      }
    }

    document.addEventListener("dialogaccept", (event) => {
      if (!this.canAccept()) {
        // Enforced again on the privileged side; here, keep the window open.
        event.preventDefault();
        return;
      }
      this.report(this.answer(true));
    });
    document.addEventListener("dialogcancel", () =>
      this.report({ accepted: false }),
    );
    window.addEventListener("unload", () => this.report({ accepted: false }), {
      once: true,
    });
  },

  /** The current answer, read from the three boxes and the tier question. */
  answer(accepted) {
    const answer = {
      accepted,
      downgrade: this.checked(this.spec.downgrade),
      acknowledged: this.checked(this.spec.acknowledge),
      dontAskAgain: this.checked(this.spec.dontAsk),
    };
    const group = document.getElementById(this.spec.tierChoices);
    const tierAnswer = this.logic.tierAnswerFor(
      this.io.model,
      group ? group.value : undefined,
    );
    if (accepted && tierAnswer !== undefined) {
      answer.tierAnswer = tierAnswer;
    }
    return answer;
  },

  checked(id) {
    const box = document.getElementById(id);
    return Boolean(box && !box.hidden && box.checked);
  },

  canAccept() {
    return this.logic.canAccept(
      this.io.model,
      this.checked(this.spec.downgrade),
      this.checked(this.spec.acknowledge),
    );
  },

  /** Place the header, notices, plan, downgrade, footer and checkbox labels. */
  renderPreflight(model) {
    this.renderLines(this.spec.header, model.header);
    this.renderLines(this.spec.notices, model.notices);
    this.renderLines(this.spec.footer, model.footer);

    const downgrade = document.getElementById(this.spec.downgrade);
    if (model.downgrade && downgrade) {
      this.setL10n(downgrade, model.downgrade.label);
      downgrade.checked = model.downgrade.preselected === true;
      downgrade.hidden = false;
      downgrade.addEventListener("command", () => this.renderPlan(model));
      const note = document.getElementById(this.spec.downgradeNote);
      if (note && model.downgrade.note) {
        this.setL10n(note, model.downgrade.note);
        note.hidden = false;
      }
    }
    const dontAsk = document.getElementById(this.spec.dontAsk);
    // Absent for a run over no collection (item 281(b)): the box stays hidden.
    if (dontAsk && model.dontAskAgain) {
      this.setL10n(dontAsk, model.dontAskAgain);
      dontAsk.hidden = false;
    }
    const acknowledge = document.getElementById(this.spec.acknowledge);
    if (acknowledge) {
      acknowledge.addEventListener("command", () => this.updateAccept());
    }
    this.renderTierQuestion(model.tierQuestion);
    this.renderPlan(model);
  },

  /**
   * P6-T17 (plan/00 §6 item 384): the tier question as a radio group of its
   * choices, the pre-selected one ("don't know") selected. Absent from the
   * model, the group stays hidden and no answer is sent.
   */
  renderTierQuestion(question) {
    const box = document.getElementById(this.spec.tier);
    const group = document.getElementById(this.spec.tierChoices);
    if (!box || !group || !question) {
      return;
    }
    this.setL10n(
      document.getElementById(this.spec.tierPrompt),
      question.prompt,
    );
    while (group.firstChild) {
      group.firstChild.remove();
    }
    for (const choice of question.choices || []) {
      const radio = document.createXULElement("radio");
      radio.setAttribute("value", String(choice.answer));
      this.setL10n(radio, choice.label);
      group.appendChild(radio);
    }
    group.value = question.preselected;
    box.hidden = false;
  },

  /** The plan view in force: its figures, its raise, its acknowledgement. */
  renderPlan(model) {
    const view = this.logic.viewFor(model, this.checked(this.spec.downgrade));
    this.renderLines(this.spec.plan, view.lines);
    this.renderLines(this.spec.raise, view.raise ? [view.raise.line] : []);
    const acknowledge = document.getElementById(this.spec.acknowledge);
    if (acknowledge) {
      // Switching plans never carries an acknowledgement across.
      acknowledge.checked = false;
      if (view.acknowledge) {
        this.setL10n(acknowledge, view.acknowledge);
        acknowledge.hidden = false;
      } else {
        acknowledge.hidden = true;
      }
    }
    this.updateAccept();
  },

  updateAccept() {
    const dialog = document.getElementById(this.spec.root);
    const button =
      dialog && typeof dialog.getButton === "function"
        ? dialog.getButton("accept")
        : null;
    if (button) {
      button.disabled = !this.canAccept();
    }
  },

  /** Replace a container's children with one paragraph per line. */
  renderLines(containerId, lines) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }
    while (container.firstChild) {
      container.firstChild.remove();
    }
    for (const line of lines || []) {
      const p = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
      this.setL10n(p, line);
      container.appendChild(p);
    }
  },

  setL10n(element, line) {
    if (!line || !line.id) {
      return;
    }
    if (document.l10n && typeof document.l10n.setAttributes === "function") {
      document.l10n.setAttributes(element, line.id, line.args || undefined);
    } else {
      element.setAttribute("data-l10n-id", line.id);
    }
  },

  /** Hand one answer to the privileged side; later calls do nothing. */
  report(answer) {
    if (this.state.reported) {
      return;
    }
    this.state.reported = true;
    try {
      if (this.io && typeof this.io.onAnswer === "function") {
        this.io.onAnswer(answer);
      }
    } catch (error) {
      this.debug("could not report the answer", error);
    }
  },

  registerUIRoot() {
    try {
      Zotero.UIProperties.registerRoot(document.getElementById(this.spec.root));
    } catch (error) {
      this.debug("could not register the dialog root", error);
    }
  },

  /** The window title and the two button labels, which XUL keeps in attributes. */
  applyChromeStrings(model) {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.formatMessages !== "function") {
      return undefined;
    }
    return l10n
      .formatMessages([
        { id: model.title.id },
        { id: model.accept.id },
        { id: model.cancel.id },
      ])
      .then(([title, accept, cancel]) => {
        if (title && title.value) {
          document.title = title.value;
        }
        const dialog = document.getElementById(this.spec.root);
        const acceptLabel = this.attributeOf(accept, "label");
        const cancelLabel = this.attributeOf(cancel, "label");
        if (dialog && acceptLabel !== undefined) {
          this.labelButton(dialog, "accept", acceptLabel);
        }
        if (dialog && cancelLabel !== undefined) {
          this.labelButton(dialog, "cancel", cancelLabel);
        }
      })
      .catch((error) =>
        this.debug("could not format the dialog strings", error),
      );
  },

  /**
   * `P7-T06`: label one of the `<dialog>`'s buttons. Gecko reads
   * `buttonlabel<name>` only while the dialog is constructed, so setting it
   * afterwards left the platform's "OK" and "Cancel" showing (measured
   * 2026-11-18 by `test/integration/accessibility.spec.ts`). The rendered
   * button's own label is set too; the attribute stays for anything that
   * reads it.
   */
  labelButton(dialog, name, label) {
    dialog.setAttribute(`buttonlabel${name}`, label);
    const button =
      typeof dialog.getButton === "function" ? dialog.getButton(name) : null;
    if (button) {
      button.label = label;
    }
  },

  attributeOf(message, name) {
    const attributes = (message && message.attributes) || [];
    for (const attribute of attributes) {
      if (attribute.name === name) {
        return attribute.value;
      }
    }
    return undefined;
  },

  /** One Debug Output line: the error's name only, never a value. */
  debug(what, error) {
    try {
      Zotero.debug(
        "[research-helper] cost dialog: " +
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
  window.addEventListener("load", () => RHCostDialog.init(), { once: true });
}
