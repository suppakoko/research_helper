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
 *
 * ## The audio section (P6-T17; docs/08 §6.4's note of 2026-11-17)
 *
 * Drawn from the model's `audio` member and hidden without it. The session's
 * audio members are called the same way: `audioDescribe()` after `attach`,
 * `setAudioLanguage` and `setAudioVoice` on a choice (the session writes the
 * voice back to `tts.voice`), `startAudio`, `cancelAudio`, and the two saves,
 * each through a save dialog opened here. A larger file's folder dialog is
 * opened here when the session asks through the sink's `pickFolder`.
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
    shownRow: "rh-report-shown-row",
    shown: "rh-report-shown",
    saveNote: "rh-report-save-note",
    exportButton: "rh-report-export",
    copy: "rh-report-copy",
    // P6-T17: the audio section.
    audio: "rh-audio",
    audioNone: "rh-audio-none",
    audioChoices: "rh-audio-choices",
    audioLanguage: "rh-audio-language",
    audioVoice: "rh-audio-voice",
    audioVoicePopup: "rh-audio-voice-popup",
    audioSource: "rh-audio-source",
    audioRun: "rh-audio-run",
    audioGenerate: "rh-audio-generate",
    audioCancel: "rh-audio-cancel",
    audioStage: "rh-audio-stage",
    audioOutcome: "rh-audio-outcome",
    audioReason: "rh-audio-reason",
    audioSaveScript: "rh-audio-save-script",
    audioSaveAudio: "rh-audio-save-audio",
    audioSaved: "rh-audio-saved",
  },

  /** The audio section's languages (`tts.language` without `auto`). */
  audioLanguages: ["en", "ko"],

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
    /** P6-T17: an audio run is going (from the model's Cancel audio). */
    audioRunning: false,
    /** The voice list last drawn, so it is rebuilt only when it changes. */
    voicesKey: "",
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
    this.on(this.spec.shown, () => this.showReport());
    this.on(this.spec.audioGenerate, () => this.startAudio());
    this.on(this.spec.audioCancel, () => {
      this.answer("cancel");
      this.call("cancelAudio");
    });
    this.on(this.spec.audioLanguage, () =>
      this.callWith("setAudioLanguage", this.selectedAudioLanguage()),
    );
    this.on(this.spec.audioVoice, () => {
      const list = this.el(this.spec.audioVoice);
      if (list && list.value) {
        this.callWith("setAudioVoice", list.value);
      }
    });
    this.on(this.spec.audioSaveScript, () => this.settle(this.saveScript()));
    this.on(this.spec.audioSaveAudio, () => this.settle(this.saveAudio()));
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
          // P6-T17: the audio section reads its report and voices; it is not
          // waited for, because attach can wait on a paused job's question.
          if (typeof session.audioDescribe === "function") {
            this.settle(session.audioDescribe());
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
      pickFolder: () => this.pickFolder(),
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
    this.renderReportChoice(model.reportChoice);
    this.renderAudio(model.audio);
  },

  /**
   * P6-T17: the audio section (docs/08 §6.4's note of 2026-11-17). Hidden
   * when the model has none or says so (`audio.enabled` off).
   */
  renderAudio(audio) {
    const box = this.el(this.spec.audio);
    if (!box) {
      return;
    }
    box.hidden = !audio || audio.visible !== true;
    if (box.hidden) {
      return;
    }
    const none = Boolean(audio.none);
    this.place(this.el(this.spec.audioNone), audio.none);
    for (const id of [this.spec.audioChoices, this.spec.audioRun]) {
      const row = this.el(id);
      if (row) {
        row.hidden = none;
      }
    }
    this.renderVoices(audio.voices || [], audio.voice);
    const language = this.el(this.spec.audioLanguage);
    if (
      language &&
      this.audioLanguages.includes(audio.language) &&
      language.value !== audio.language
    ) {
      language.value = audio.language;
    }
    this.place(this.el(this.spec.audioSource), audio.source);
    this.place(this.el(this.spec.audioStage), audio.stage);
    this.place(this.el(this.spec.audioOutcome), audio.outcome);
    this.place(this.el(this.spec.audioReason), audio.reason);
    this.place(this.el(this.spec.audioSaved), audio.saved);
    const buttons = audio.buttons || {};
    const offers = audio.offers || {};
    this.state.audioRunning = buttons.cancel === true;
    this.setDisabled(this.spec.audioGenerate, buttons.generate !== true);
    this.setDisabled(this.spec.audioCancel, buttons.cancel !== true);
    this.setDisabled(this.spec.audioLanguage, buttons.choose !== true);
    this.setDisabled(this.spec.audioVoice, buttons.choose !== true);
    this.setOffer(this.spec.audioSaveScript, offers.script, buttons.saveScript);
    this.setOffer(this.spec.audioSaveAudio, offers.audio, buttons.saveAudio);
  },

  /** A save button: shown only when offered, enabled only between runs. */
  setOffer(id, offered, enabled) {
    const button = this.el(id);
    if (button) {
      button.hidden = offered !== true;
      button.disabled = enabled !== true;
    }
  },

  /** The voice list, rebuilt only when it changed; the names are data. */
  renderVoices(voices, selected) {
    const list = this.el(this.spec.audioVoice);
    const popup = this.el(this.spec.audioVoicePopup);
    if (!list || !popup) {
      return;
    }
    const key = JSON.stringify(voices);
    if (this.state.voicesKey !== key) {
      this.state.voicesKey = key;
      while (popup.firstChild) {
        popup.firstChild.remove();
      }
      for (const voice of voices) {
        const item = document.createXULElement("menuitem");
        item.setAttribute("value", String(voice.id));
        item.setAttribute("label", String(voice.label));
        popup.appendChild(item);
      }
    }
    if (selected && list.value !== selected) {
      list.value = selected;
    }
  },

  /** "Generate audio": the session runs the job; the model redraws. */
  startAudio() {
    const session = this.io.session;
    if (
      this.state.audioRunning ||
      !session ||
      typeof session.startAudio !== "function"
    ) {
      return;
    }
    const voiceList = this.el(this.spec.audioVoice);
    const voice = voiceList ? voiceList.value : "";
    if (!voice) {
      return;
    }
    this.state.audioRunning = true;
    this.setDisabled(this.spec.audioGenerate, true);
    this.settle(
      session.startAudio(
        { language: this.selectedAudioLanguage(), voice },
        this.sink(),
      ),
    );
  },

  /** The audio language chosen, one of {@link audioLanguages}. */
  selectedAudioLanguage() {
    const list = this.el(this.spec.audioLanguage);
    const value = list ? list.value : undefined;
    return this.audioLanguages.includes(value) ? value : "en";
  },

  /** FR-43: the script as a text file, to a path chosen here, passed once. */
  async saveScript() {
    const session = this.io.session;
    if (!session || typeof session.saveScript !== "function") {
      return;
    }
    const path = await this.pickSavePath({
      suggested:
        typeof session.scriptFileName === "function"
          ? session.scriptFileName()
          : undefined,
      buttonId: this.spec.audioSaveScript,
      extension: "txt",
      textFilter: true,
    });
    if (path) {
      await session.saveScript(path);
    }
  },

  /** FR-40: the held audio as a WAV file, to a path chosen here, passed once. */
  async saveAudio() {
    const session = this.io.session;
    if (!session || typeof session.saveAudio !== "function") {
      return;
    }
    const path = await this.pickSavePath({
      suggested:
        typeof session.audioFileName === "function"
          ? session.audioFileName()
          : undefined,
      buttonId: this.spec.audioSaveAudio,
      // "WAV" is a format name and is not translated (`docs/08` §10.3).
      filterName: "WAV",
      filter: "*.wav",
      extension: "wav",
    });
    if (path) {
      await session.saveAudio(path);
    }
  },

  /**
   * P6-T13 step 4: the folder for a linked audio file. Every failure and a
   * cancel are `""`; nothing is logged, because a picker's message can quote
   * the path, and the path is not kept here.
   */
  async pickFolder() {
    try {
      const Picker = this.filePickerClass();
      if (!Picker) {
        return "";
      }
      const picker = new Picker();
      const button = this.el(this.spec.audioGenerate);
      const title =
        (button && button.getAttribute("label")) || document.title || "";
      picker.init(window, title, picker.modeGetFolder);
      const result = await picker.show();
      if (result !== picker.returnOK) {
        return "";
      }
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      return "";
    }
  },

  /** "Report shown": only when a run gave two reports (docs/08 §6.3). */
  renderReportChoice(choice) {
    const row = this.el(this.spec.shownRow);
    if (row) {
      row.hidden = !choice;
    }
    const list = this.el(this.spec.shown);
    if (choice && list && list.value !== choice.shown) {
      list.value = choice.shown;
    }
  },

  /** The selector moved: the session redraws the preview and the buttons. */
  showReport() {
    const session = this.io.session;
    const list = this.el(this.spec.shown);
    if (!list || !session || typeof session.showReport !== "function") {
      return;
    }
    try {
      session.showReport(list.value);
    } catch (error) {
      this.debug("session.showReport threw", error);
    }
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
    return this.pickSavePath({
      suggested,
      buttonId: this.spec.exportButton,
      // "Markdown" is a format name and is not translated (`docs/08` §10.3).
      filterName: "Markdown",
      filter: "*.md",
      extension: "md",
    });
  },

  /** Zotero's `FilePicker` class, or `undefined` outside a chrome window. */
  filePickerClass() {
    const utils = typeof ChromeUtils === "undefined" ? undefined : ChromeUtils;
    if (!utils || typeof utils.importESModule !== "function") {
      return undefined;
    }
    const module = utils.importESModule(this.filePickerModule);
    const Picker = module ? module.FilePicker : undefined;
    return typeof Picker === "function" ? Picker : undefined;
  },

  /**
   * One save dialog (the export, and since P6-T17 the script and the audio):
   * the title is the button's label; a named filter, or the picker's own
   * text-file filter, which it labels itself. Every failure is `""`.
   */
  async pickSavePath(options) {
    try {
      const Picker = this.filePickerClass();
      if (!Picker) {
        return "";
      }
      const picker = new Picker();
      const button = this.el(options.buttonId);
      const title =
        (button && button.getAttribute("label")) || document.title || "";
      picker.init(window, title, picker.modeSave);
      if (options.textFilter === true) {
        if (typeof picker.appendFilters === "function") {
          picker.appendFilters(picker.filterText);
        }
      } else if (options.filterName && options.filter) {
        picker.appendFilter(options.filterName, options.filter);
      }
      picker.defaultExtension = options.extension;
      if (options.suggested) {
        picker.defaultString = options.suggested;
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

  /** Call a session member with one argument; a throw is logged by name. */
  callWith(name, value) {
    const session = this.io.session;
    try {
      if (session && typeof session[name] === "function") {
        session[name](value);
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
