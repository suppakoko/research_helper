/**
 * The item pane's AI summary section (`P3-T28`; `docs/08` §3.1–§3.4).
 *
 * Like `../menus/registerMenus.ts`, this file *describes* the section and
 * registers nothing. `Zotero.ItemPaneManager.registerSection` may only be
 * called from `src/zotero/registrations.ts` (`itemPaneSectionRegistration`;
 * `eslint.config.js`'s `research-helper/scoped-registration` rule), and
 * `src/ui/**` may not import `src/zotero/**` (`research-helper/layering/ui`).
 * What is left here is the section's shape, its seven states and its hooks.
 *
 * ## Callers (`plan/README.md` §5 rule 10)
 *
 * {@link summarySectionOptions} is called once, by `publishSummarySection` in
 * `src/bootstrap/registerUI.ts`, which also constructs the
 * {@link SummarySectionHost} it reads and hands both to
 * `itemPaneSectionRegistration`.
 *
 * ## The seven states (`docs/08` §3.2)
 *
 * | Situation | What the section shows |
 * |---|---|
 * | a note, an attachment or an annotation | hidden: `onItemChange` calls `setEnabled(false)` |
 * | a stored summary | its fields, the model and the time, and the derived gist in the collapsed header |
 * | no stored summary | the empty line and **Generate summary** |
 * | no LLM key | the no-key line, **Open Preferences…**, and Generate disabled |
 * | generating | **Summarizing…** and **Cancel**; the header buttons disabled |
 * | failed | the failure line, the (redacted) message, and **Retry** |
 * | several items selected | Zotero shows no section; nothing to do |
 *
 * ## Everything shown from a stored summary is model output
 *
 * It is written with `textContent` and `createElementNS` only — never
 * `innerHTML`, never a Fluent argument — so a summary holding markup shows
 * the markup as text. The collapsed header's gist reaches Zotero's
 * `collapsible-section`, whose `summary` attribute is drawn with
 * `textContent` too (read 2026-10-29 from 10.0.3's `collapsibleSection.js`).
 * An error message is passed through `redact` first: it may quote a request.
 *
 * ## No request until the user asks
 *
 * `onAsyncRender` reads the plugin's own `summary` table and nothing else.
 * Generation starts from the Generate, Retry or Regenerate button — or, only
 * when `autoSummarize` is on (it ships off, `docs/07` §8.5), after
 * {@link AUTO_SUMMARIZE_DEBOUNCE_MS} on the same item, once per item per
 * section, one run at a time (`docs/08` §3.3's warning).
 */

import { encodeTagValue } from "../../core/cache/keys";
import { redact } from "../../core/errors";
import { WORK_TAG_PREFIX } from "../../core/jobQueue/queue";
import { formatDateTime } from "../../i18n/format";
import type { MainWindowMessageId } from "../../i18n/keys";
import { deriveTldr, type StoredSummary } from "../../model/summary";
import { PREFERENCES_PANE_ID } from "../prefs/preferencesPane";

/* ------------------------------------------------------------- constants */

/** `docs/08` §0.2's pane id; Zotero namespaces it with the plugin id. */
export const SUMMARY_PANE_ID = "rh-itempane-summary";

/** The section's registration, as `liveHandles()` names it. */
export const SUMMARY_SECTION_DESCRIPTION = "item-pane AI summary section";

/** The delete/trash observer's registration, as `liveHandles()` names it. */
export const SUMMARY_NOTIFIER_DESCRIPTION =
  "item-pane summary cache invalidation (item delete/trash)";

/**
 * The observer's debug label (`docs/08` §3.3). Zotero prefixes the observer
 * handle it returns with it (`<id>_<random>`), which is how
 * `test/integration/zotero/summarySection.spec.ts` counts live observers.
 */
export const SUMMARY_NOTIFIER_ID = "research-helper-itempane";

/**
 * Both required icons (`docs/08` §3.1). Decided 2026-10-29 (`P3-T28`;
 * `docs/08` §3.3's note): the plugin's own 48 px placeholder mark, scaled by
 * Zotero's CSS to 16 px in the header and 20 px in the side navigation.
 * `docs/08` §3.3's four SVGs do not exist, and `addon/content/icons/README.md`
 * forbids a third icon size; without `darkIcon` Zotero uses `icon` in both
 * themes, and the mark is its own tile, legible on either.
 */
export const SUMMARY_SECTION_ICON =
  "chrome://research-helper/content/icons/favicon@0.5x.png";

/** `docs/08` §3.2: the collapsed header's gist, "truncated to ~60 chars". */
export const GIST_MAX_CHARS = 60;

/** `docs/08` §3.3: "debounced (300–500 ms)" when `autoSummarize` is on. */
export const AUTO_SUMMARIZE_DEBOUNCE_MS = 400;

/** The section buttons' `type`s; Zotero uses each as a CSS class. */
export const REGENERATE_BUTTON = "rh-regenerate";
export const SAVE_NOTE_BUTTON = "rh-save-note";

/** Every message the section names (`docs/08` §10.2; `P3-T28`). */
export const SUMMARY_SECTION_L10N = {
  header: "research-helper-itempane-header",
  sidenav: "research-helper-itempane-sidenav",
  empty: "research-helper-itempane-empty",
  generate: "research-helper-itempane-generate",
  loading: "research-helper-itempane-loading",
  cancel: "research-helper-itempane-cancel",
  failed: "research-helper-itempane-failed",
  retry: "research-helper-itempane-retry",
  noKey: "research-helper-itempane-no-key",
  openPreferences: "research-helper-itempane-open-preferences",
  researchQuestion: "research-helper-itempane-research-question",
  keyFindings: "research-helper-itempane-key-findings",
  limitations: "research-helper-itempane-limitations",
  regenerate: "research-helper-itempane-btn-regenerate",
  saveNote: "research-helper-itempane-btn-save-note",
} as const satisfies Record<string, MainWindowMessageId>;

/**
 * The section's result lines (owner, `plan/00` §6 item 303(a), (b);
 * `docs/08` §3.2's note of 2026-10-29). Each takes `$reason`, so they are
 * kept apart from {@link SUMMARY_SECTION_L10N}, whose ids take none.
 */
export const SUMMARY_RESULT_L10N = {
  /** In the failure banner: why a run stored no summary. */
  notSummarized: "research-helper-itempane-not-summarized",
  /** In a popup: why "Save as child note" wrote nothing. */
  noteNotWritten: "research-helper-itempane-note-not-written",
} as const satisfies Record<string, MainWindowMessageId>;

/**
 * Why a run of the item pane stored no summary:
 * `research-helper-itempane-not-summarized`'s `$reason`.
 */
export type NotSummarizedReason =
  | "no-text"
  | "retracted"
  | "language"
  | "existing"
  | "no-key"
  | "time-limit"
  | "other";

const NOT_SUMMARIZED_REASONS: readonly NotSummarizedReason[] = [
  "no-text",
  "retracted",
  "language",
  "existing",
  "no-key",
  "time-limit",
  "other",
];

/**
 * A run that ended without a stored summary, for a reason the banner states
 * in a message of its own rather than as an error's text.
 */
export class SummaryNotStoredError extends Error {
  readonly reason: NotSummarizedReason;

  constructor(reason: NotSummarizedReason) {
    super(`[research-helper] no summary was stored (${reason})`);
    this.name = "SummaryNotStoredError";
    this.reason = reason;
  }
}

/**
 * A run that failed, as `runItemSummary` (`src/ui/dialogs/summarizeDialog.ts`)
 * throws it: the failure's machine values and its message id, never its
 * `detail` (owner, 2026-11-17, `plan/00` §6 items 389(f) and 392(a);
 * `P7-T03` step 5). `detail` is free text built from the failing request;
 * the debug log has it, after `redact`, and the screen does not.
 */
export class SummaryFailedError extends Error {
  readonly code: string;
  readonly messageKey: string;
  readonly httpStatus: number | undefined;

  constructor(failure: {
    readonly code: string;
    readonly messageKey: string;
    readonly httpStatus?: number | undefined;
  }) {
    super(`[research-helper] summary failed (${failure.code})`);
    this.name = "SummaryFailedError";
    this.code = failure.code;
    this.messageKey = failure.messageKey;
    this.httpStatus = failure.httpStatus;
  }
}

/**
 * The error messages the banner may show by id: those whose `en-US` text
 * takes no argument, because the section has none to give (item 392(a): "with
 * its arguments, where the section has them"). A test holds each to the
 * bundle. Any other failure shows the banner's own line and its code.
 */
export const ARGUMENT_FREE_FAILURE_IDS: readonly MainWindowMessageId[] =
  Object.freeze([
    "rh-error-configuration",
    "rh-error-offline",
    "rh-error-zotero",
    "rh-error-storage",
    "rh-error-content-filter",
    "rh-error-policy",
  ] as const satisfies readonly MainWindowMessageId[]);

/**
 * A failure as the banner shows it: machine values only (`docs/07` §10.2;
 * owner, item 389(f)). Read by shape, for the reason {@link failureText}
 * gives.
 */
export interface SummaryFailure {
  /** `"LLM"`, `"LLM · HTTP 502"`, or `""` when the error carries no code. */
  readonly code: string;
  /** Set when the error's message id is on {@link ARGUMENT_FREE_FAILURE_IDS}. */
  readonly messageId?: MainWindowMessageId | undefined;
}

/** An error code's shape (`docs/07` §10.1): capitals and underscores. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;

/**
 * The banner's {@link SummaryFailure} for whatever a run rejected with. Only
 * an error code, an HTTP status and a listed message id are read; the
 * error's message is never read.
 */
export function summaryFailure(error: unknown): SummaryFailure {
  if (typeof error !== "object" || error === null) return { code: "" };
  const shape = error as {
    code?: unknown;
    httpStatus?: unknown;
    messageKey?: unknown;
  };
  const code =
    typeof shape.code === "string" && ERROR_CODE.test(shape.code)
      ? shape.code
      : "";
  const status =
    typeof shape.httpStatus === "number" &&
    Number.isInteger(shape.httpStatus) &&
    shape.httpStatus >= 100 &&
    shape.httpStatus <= 599
      ? shape.httpStatus
      : undefined;
  const line =
    code === ""
      ? ""
      : status === undefined
        ? code
        : `${code} · HTTP ${String(status)}`;
  const messageId = (ARGUMENT_FREE_FAILURE_IDS as readonly unknown[]).includes(
    shape.messageKey,
  )
    ? (shape.messageKey as MainWindowMessageId)
    : undefined;
  return messageId === undefined ? { code: line } : { code: line, messageId };
}

/**
 * The reason a {@link SummaryNotStoredError} carries, read by shape rather
 * than `instanceof`, for the reason {@link failureText} gives.
 */
export function notStoredReason(
  error: unknown,
): NotSummarizedReason | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { name?: unknown; reason?: unknown };
  return candidate.name === "SummaryNotStoredError" &&
    NOT_SUMMARIZED_REASONS.includes(candidate.reason as NotSummarizedReason)
    ? (candidate.reason as NotSummarizedReason)
    : undefined;
}

/**
 * The class each part of the body carries. Classes, not ids: the section is
 * drawn once in the library pane and once in the reader's context pane of the
 * same document, so an id would be duplicated.
 */
export const SUMMARY_SECTION_PARTS = {
  root: "rh-summary",
  noKey: "rh-summary-no-key",
  empty: "rh-summary-empty",
  generate: "rh-summary-generate",
  openPreferences: "rh-summary-open-prefs",
  loading: "rh-summary-loading",
  cancel: "rh-summary-cancel",
  error: "rh-summary-error",
  errorText: "rh-summary-error-text",
  errorCode: "rh-summary-error-code",
  retry: "rh-summary-retry",
  content: "rh-summary-content",
  meta: "rh-summary-meta",
} as const;

const HTML_NS = "http://www.w3.org/1999/xhtml";

/* ----------------------------------------------------------------- types */

/** The item Zotero hands every hook — `zotero-types`' own declaration. */
export type SectionItem =
  _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs["item"];

/** One generation in flight. */
export interface SummaryGenerateRun {
  /**
   * Resolves once the summary is stored; rejects with the reason it was not.
   * After {@link SummaryGenerateRun.cancel} it may do either.
   */
  readonly done: Promise<void>;
  /** Stop the run. Idempotent. */
  cancel(): void;
}

/**
 * What the section reads and calls. **Every member is read on use, never
 * captured**, so the object `registerUI.ts` publishes as
 * `addon.api.summarySection` is the one the section consults on each render.
 */
export interface SummarySectionHost {
  /** The active provider can be called: a key is present (`FR-33`). */
  isConfigured(): boolean;
  /** `docs/07` §8.5's `autoSummarize`, read per render. Ships `false`. */
  autoSummarize(): boolean;
  /** The newest stored summary of the item's work, or `undefined`. No request. */
  load(item: SectionItem): Promise<StoredSummary | undefined>;
  /**
   * Summarize the item and store the result. In the product, a one-item run
   * of the summarize pipeline (`runItemSummary`; owner, `plan/00` §6 item
   * 303(a)), with `regenerate` as its `resummarize`; `bypassCache`, set by
   * Regenerate alone, asks the model again instead of serving the stored
   * result (item 305(c)). `done` rejects with a
   * {@link SummaryNotStoredError} when the run stored nothing for a reason of
   * its own, and resolves when the user declined the cost dialog. When it is
   * absent the section offers no Generate, Retry or Regenerate, rather than a
   * button that does nothing.
   */
  generate?:
    | ((
        item: SectionItem,
        options: {
          readonly regenerate: boolean;
          readonly bypassCache?: boolean;
        },
      ) => SummaryGenerateRun)
    | undefined;
  /**
   * "Save as child note" (`docs/08` §3.2): the explicit user action, never
   * automatic. In the product, `saveSummaryNoteOnce` (item 303(b)): no
   * second note, and the written note's key stored. When it is absent the
   * button is hidden.
   */
  saveAsNote?:
    ((item: SectionItem, stored: StoredSummary) => Promise<void>) | undefined;
  /** A caught failure, for the debug log. */
  onError(message: string, error: unknown): void;
  /** The application locale, for the timestamp (`docs/08` §10.3). */
  locale(): string;
}

/** What the section knows about one item. */
export type SectionState =
  | { readonly kind: "blank" }
  | { readonly kind: "content"; readonly stored: StoredSummary }
  | { readonly kind: "empty" }
  | { readonly kind: "no-key" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "error";
      /** Machine values only (item 389(f)): never the error's text. */
      readonly failure: SummaryFailure;
      /** Set when the run stored nothing: the banner's line, not `failure`'s. */
      readonly reason?: NotSummarizedReason | undefined;
    };

/** A button's status, as `setSectionButtonStatus` takes it. */
export interface ButtonStatus {
  readonly hidden: boolean;
  readonly disabled: boolean;
}

/** The text of a stored summary, as the section draws it. */
export interface SummaryView {
  readonly researchQuestion: string;
  readonly keyFindings: readonly string[];
  readonly limitations: readonly string[];
  /** `<modelId> · <localized time>` — no message: a name and a date. */
  readonly meta: string;
}

/** Everything one paint needs, computed without a DOM. */
export interface SectionView {
  readonly kind: SectionState["kind"];
  readonly noKey: boolean;
  readonly empty: boolean;
  readonly loading: boolean;
  /**
   * The failure's machine values, when `kind` is `error` (item 389(f)):
   * its code line and, for an argument-free message, its id. Never text.
   */
  readonly errorFailure: SummaryFailure | undefined;
  /** Instead of the failure's message: why the run stored nothing. */
  readonly errorReason: NotSummarizedReason | undefined;
  readonly content: SummaryView | undefined;
  readonly generate: ButtonStatus;
  readonly retry: ButtonStatus;
  /** The collapsed header's line: the derived gist, or `""`. */
  readonly gist: string;
  readonly regenerate: ButtonStatus;
  readonly saveNote: ButtonStatus;
}

/* ---------------------------------------------------------- pure helpers */

/**
 * Whether the section shows for `item`: a regular item only (`docs/08`
 * §3.2's first row).
 */
export function showsFor(item: SectionItem | undefined | null): boolean {
  if (item === undefined || item === null) return false;
  try {
    return item.isRegularItem();
  } catch {
    return false;
  }
}

/**
 * `docs/08` §3.2's "truncated to ~60 chars": whitespace collapsed, then cut
 * at the last word break inside `max` with an ellipsis. Never cuts a
 * surrogate pair.
 *
 * @param text - the gist
 * @param max - the limit, in UTF-16 code units, ellipsis included
 */
export function truncateGist(text: string, max = GIST_MAX_CHARS): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  if (space >= max / 2) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

function nonEmpty(values: readonly (string | null | undefined)[]): string[] {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value !== "");
}

/**
 * The text of a stored summary. Decided 2026-10-29 (`docs/08` §3.2's note):
 * the research question, the key findings and the limitations, then the model
 * and the time — `docs/08` §3.4's populated wireframe, which draws a lead
 * paragraph, a "Key findings" list and the meta line.
 *
 * @param stored - the row
 * @param locale - for the timestamp
 */
export function summaryView(
  stored: StoredSummary,
  locale: string,
): SummaryView {
  const content = stored.content;
  const when = formatDateTime(stored.generatedAtEpochMs, locale);
  return {
    researchQuestion: content.researchQuestion?.trim() ?? "",
    keyFindings: nonEmpty(
      (content.keyFindings ?? []).map((finding) => finding?.statement),
    ),
    limitations: nonEmpty(content.limitations ?? []),
    meta: `${stored.modelId} · ${when}`,
  };
}

/** What a paint needs besides the state. */
export interface ViewCapabilities {
  readonly canGenerate: boolean;
  readonly canSaveNote: boolean;
  readonly configured: boolean;
  readonly locale: string;
}

const SHOWN: ButtonStatus = { hidden: false, disabled: false };
const GONE: ButtonStatus = { hidden: true, disabled: true };

/**
 * One state, drawn as data (`docs/08` §3.2).
 *
 * @param state - what the section knows about the item
 * @param caps - which host members are bound, and the key status
 */
export function sectionView(
  state: SectionState,
  caps: ViewCapabilities,
): SectionView {
  const busy = state.kind === "loading";
  const content =
    state.kind === "content"
      ? summaryView(state.stored, caps.locale)
      : undefined;
  const gist =
    state.kind === "content"
      ? truncateGist(deriveTldr(state.stored.content))
      : "";
  const generate: ButtonStatus =
    state.kind === "no-key"
      ? { hidden: false, disabled: true }
      : state.kind === "empty" && caps.canGenerate
        ? SHOWN
        : GONE;
  const retry: ButtonStatus =
    state.kind === "error" && caps.canGenerate
      ? { hidden: false, disabled: !caps.configured }
      : GONE;
  return {
    kind: state.kind,
    noKey: state.kind === "no-key",
    empty: state.kind === "empty",
    loading: busy,
    errorFailure: state.kind === "error" ? state.failure : undefined,
    errorReason: state.kind === "error" ? state.reason : undefined,
    content,
    generate,
    retry,
    gist,
    regenerate: caps.canGenerate
      ? {
          hidden: false,
          disabled: busy || !caps.configured || state.kind === "blank",
        }
      : GONE,
    saveNote: caps.canSaveNote
      ? { hidden: false, disabled: busy || state.kind !== "content" }
      : GONE,
  };
}

/**
 * The state an item is in, from what has been loaded and what is running.
 *
 * @param input - the facts
 */
export function deriveState(input: {
  readonly loaded: boolean;
  readonly stored: StoredSummary | undefined;
  readonly running: boolean;
  readonly error: SummaryFailure | undefined;
  /** Why the run stored nothing, when it ended that way. */
  readonly reason?: NotSummarizedReason | undefined;
  readonly configured: boolean;
}): SectionState {
  if (input.running) return { kind: "loading" };
  if (input.error !== undefined) {
    return input.reason === undefined
      ? { kind: "error", failure: input.error }
      : { kind: "error", failure: input.error, reason: input.reason };
  }
  if (!input.loaded) return { kind: "blank" };
  if (input.stored !== undefined)
    return { kind: "content", stored: input.stored };
  return input.configured ? { kind: "empty" } : { kind: "no-key" };
}

/**
 * Whether an automatic run may start for an item with no stored summary
 * (`docs/08` §3.3's warning): only with `autoSummarize` on, a key, a bound
 * Generate, nothing already running, and not tried before for this item.
 */
export function mayAutoSummarize(input: {
  readonly autoSummarize: boolean;
  readonly configured: boolean;
  readonly canGenerate: boolean;
  readonly running: boolean;
  readonly triedBefore: boolean;
}): boolean {
  return (
    input.autoSummarize &&
    input.configured &&
    input.canGenerate &&
    !input.running &&
    !input.triedBefore
  );
}

/**
 * A failure's message, redacted (`docs/09` §2.1), **for the debug log only**:
 * since 2026-11-17 the banner draws {@link summaryFailure}'s machine values
 * and never this (owner, `plan/00` §6 items 389(f), 392(a)).
 *
 * The message of any error-shaped object, never `instanceof Error`: an error
 * made in another global — a Zotero or XPCOM error, or one thrown by code
 * bundled apart from the plugin — fails that test, and its message was shown
 * as nothing (found 2026-10-29 by `summarySection.spec.ts`, 3 of 3 runs;
 * `docs/08` §3.2's note of that date).
 */
export function failureText(error: unknown): string {
  const message =
    typeof error === "object" && error !== null
      ? (error as { message?: unknown }).message
      : error;
  const raw = typeof message === "string" ? message : "";
  return redact(raw).trim();
}

/* -------------------------------------------------------------- the body */

/**
 * The static skeleton (`docs/08` §3.3). XUL is the default namespace and HTML
 * lives under `html:`; `<script>` would not run, so behaviour is attached in
 * `onInit`. The buttons are `html:button`s, so their Fluent messages carry a
 * **value**, not `.label` (`docs/08` §10.2's note of 2026-10-29).
 */
export const SUMMARY_BODY_XHTML =
  `<html:div class="${SUMMARY_SECTION_PARTS.root}">` +
  `<html:div class="${SUMMARY_SECTION_PARTS.noKey}" hidden="true">` +
  `<html:p data-l10n-id="${SUMMARY_SECTION_L10N.noKey}"/>` +
  `<html:button class="${SUMMARY_SECTION_PARTS.openPreferences}" data-l10n-id="${SUMMARY_SECTION_L10N.openPreferences}"/>` +
  `</html:div>` +
  `<html:div class="${SUMMARY_SECTION_PARTS.empty}" hidden="true">` +
  `<html:p data-l10n-id="${SUMMARY_SECTION_L10N.empty}"/>` +
  `</html:div>` +
  `<html:button class="${SUMMARY_SECTION_PARTS.generate}" hidden="true" data-l10n-id="${SUMMARY_SECTION_L10N.generate}"/>` +
  `<html:div class="${SUMMARY_SECTION_PARTS.loading}" hidden="true" role="status">` +
  `<html:span data-l10n-id="${SUMMARY_SECTION_L10N.loading}"/>` +
  `<html:button class="${SUMMARY_SECTION_PARTS.cancel}" data-l10n-id="${SUMMARY_SECTION_L10N.cancel}"/>` +
  `</html:div>` +
  `<html:div class="${SUMMARY_SECTION_PARTS.error}" hidden="true" role="alert">` +
  `<html:p data-l10n-id="${SUMMARY_SECTION_L10N.failed}"/>` +
  `<html:p class="${SUMMARY_SECTION_PARTS.errorText}"/>` +
  `<html:p class="${SUMMARY_SECTION_PARTS.errorCode}" hidden="true"/>` +
  `<html:button class="${SUMMARY_SECTION_PARTS.retry}" data-l10n-id="${SUMMARY_SECTION_L10N.retry}"/>` +
  `</html:div>` +
  `<html:div class="${SUMMARY_SECTION_PARTS.content}" hidden="true"/>` +
  `</html:div>`;

function part(body: Element, name: keyof typeof SUMMARY_SECTION_PARTS) {
  return body.querySelector<HTMLElement>(`.${SUMMARY_SECTION_PARTS[name]}`);
}

function setHidden(element: HTMLElement | null, hidden: boolean): void {
  if (element) element.hidden = hidden;
}

function applyButton(element: HTMLElement | null, status: ButtonStatus): void {
  if (!element) return;
  element.hidden = status.hidden;
  (element as HTMLButtonElement).disabled = status.disabled;
}

function htmlElement(doc: Document, tag: string): HTMLElement {
  return doc.createElementNS(HTML_NS, tag) as HTMLElement;
}

/** A heading by message id, then its text: every string through `textContent`. */
function appendBlock(
  doc: Document,
  parent: HTMLElement,
  heading: MainWindowMessageId,
  items: readonly string[],
  asList: boolean,
): void {
  if (items.length === 0) return;
  const title = htmlElement(doc, "h4");
  title.setAttribute("data-l10n-id", heading);
  parent.append(title);
  if (!asList) {
    const paragraph = htmlElement(doc, "p");
    paragraph.textContent = items[0] ?? "";
    parent.append(paragraph);
    return;
  }
  const list = htmlElement(doc, "ul");
  for (const text of items) {
    const entry = htmlElement(doc, "li");
    entry.textContent = text;
    list.append(entry);
  }
  parent.append(list);
}

/**
 * Draw one {@link SectionView} into a section body. Model output reaches the
 * DOM only through `textContent`.
 */
export function paintBody(body: HTMLElement, view: SectionView): void {
  const doc = body.ownerDocument;
  setHidden(part(body, "noKey"), !view.noKey);
  setHidden(part(body, "empty"), !view.empty);
  applyButton(part(body, "generate"), view.generate);
  setHidden(part(body, "loading"), !view.loading);
  setHidden(part(body, "error"), view.errorFailure === undefined);
  const errorText = part(body, "errorText");
  if (errorText) {
    // Only messages of the plugin's own, by id: Fluent fills them in. The
    // error's text is never drawn (item 389(f), 392(a)).
    errorText.textContent = "";
    if (view.errorReason !== undefined) {
      errorText.setAttribute("data-l10n-id", SUMMARY_RESULT_L10N.notSummarized);
      errorText.setAttribute(
        "data-l10n-args",
        JSON.stringify({ reason: view.errorReason }),
      );
    } else if (view.errorFailure?.messageId !== undefined) {
      errorText.setAttribute("data-l10n-id", view.errorFailure.messageId);
      errorText.removeAttribute("data-l10n-args");
    } else {
      errorText.removeAttribute("data-l10n-id");
      errorText.removeAttribute("data-l10n-args");
    }
  }
  const errorCode = part(body, "errorCode");
  if (errorCode) {
    // Machine values (an error code, an HTTP status): not language.
    const line =
      view.errorReason === undefined ? (view.errorFailure?.code ?? "") : "";
    errorCode.textContent = line;
    setHidden(errorCode, line === "");
  }
  applyButton(part(body, "retry"), view.retry);

  const content = part(body, "content");
  if (!content || !doc) return;
  content.replaceChildren();
  content.hidden = view.content === undefined;
  if (view.content === undefined) return;
  const shown = view.content;
  appendBlock(
    doc,
    content,
    SUMMARY_SECTION_L10N.researchQuestion,
    shown.researchQuestion === "" ? [] : [shown.researchQuestion],
    false,
  );
  appendBlock(
    doc,
    content,
    SUMMARY_SECTION_L10N.keyFindings,
    shown.keyFindings,
    true,
  );
  appendBlock(
    doc,
    content,
    SUMMARY_SECTION_L10N.limitations,
    shown.limitations,
    true,
  );
  const meta = htmlElement(doc, "p");
  meta.className = SUMMARY_SECTION_PARTS.meta;
  meta.textContent = shown.meta;
  content.append(meta);
}

/**
 * Open the plugin's preference pane from the window the section is drawn in:
 * `Zotero.Utilities.Internal.openPreferences(paneID)`, reached as a property
 * of that window (`addon/content/searchDialog.js` makes the same call) —
 * this file may not name the `Zotero` global.
 */
export function openPreferencesFrom(doc: Document): boolean {
  const win = doc.defaultView as unknown as {
    Zotero?: {
      Utilities?: {
        Internal?: { openPreferences?: (paneID: string) => unknown };
      };
    };
  } | null;
  const open = win?.Zotero?.Utilities?.Internal?.openPreferences;
  if (typeof open !== "function") return false;
  open.call(win?.Zotero?.Utilities?.Internal, PREFERENCES_PANE_ID);
  return true;
}

/* ------------------------------------------------- the notifier observer */

/** What {@link summaryInvalidationObserver} needs. */
export interface SummaryInvalidationDeps {
  /**
   * The work key of a still-loaded regular item, or `undefined` —
   * `workKeyOfItemID` in `src/zotero/itemMapper.ts` in the product.
   */
  workKeyOf(itemID: number): string | undefined;
  /** `Cache.invalidateByTag` (`docs/07` §4.1). */
  invalidateByTag(tag: string): Promise<number>;
  onError(message: string, error: unknown): void;
}

/**
 * `docs/08` §3.2's invalidation: on an `item` `trash` or `delete`, drop the
 * cache entries tagged `work:<workKey>` (`docs/07` §9.3 trigger 3), the key
 * escaped with `encodeTagValue` exactly as the summary cache writes it.
 *
 * Decided 2026-10-29 (`docs/07` §9.3's note): only an item Zotero can still
 * load is resolved. A `trash` always is; a permanent `delete` arrives after
 * Zotero has unloaded the item and with only its library and key, so it
 * resolves nothing — in the product a delete follows a trash, which already
 * invalidated, and an entry missed this way is evicted by `prune()`'s LRU.
 * The stored `summary` rows are not touched: the cache is.
 *
 * Registered by `publishSummarySection` (`src/bootstrap/registerUI.ts`)
 * through `notifierRegistration`, so teardown removes it.
 */
export function summaryInvalidationObserver(
  deps: SummaryInvalidationDeps,
): _ZoteroTypes.Notifier.Notify {
  return async (event, type, ids) => {
    if (type !== "item" || (event !== "trash" && event !== "delete")) return;
    const tags = new Set<string>();
    for (const id of ids as readonly (string | number)[]) {
      const itemID = typeof id === "number" ? id : Number(id);
      if (!Number.isInteger(itemID)) continue;
      const workKey = deps.workKeyOf(itemID);
      if (workKey === undefined || workKey === "") continue;
      tags.add(`${WORK_TAG_PREFIX}${encodeTagValue(workKey)}`);
    }
    for (const tag of tags) {
      try {
        await deps.invalidateByTag(tag);
      } catch (error) {
        deps.onError(
          "[research-helper] a deleted item's cached summaries could not be invalidated",
          error,
        );
      }
    }
  };
}

/* ------------------------------------------------------------- the hooks */

/** One drawn section: Zotero draws one per item pane (`docs/08` §3.1). */
interface BodyState {
  refresh: (() => Promise<void>) | undefined;
  item: SectionItem | undefined;
  /** The last load, for the item it was for. */
  loaded:
    | { readonly itemID: number; readonly stored: StoredSummary | undefined }
    | undefined;
  run:
    | {
        readonly itemID: number;
        readonly run: SummaryGenerateRun;
        cancelled: boolean;
      }
    | undefined;
  error:
    | {
        readonly itemID: number;
        readonly failure: SummaryFailure;
        readonly reason: NotSummarizedReason | undefined;
      }
    | undefined;
  autoTimer: ReturnType<typeof setTimeout> | undefined;
  readonly autoTried: Set<number>;
}

/** Timers, injectable so a unit test needs no clock. */
export interface SectionTimers {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const DEFAULT_TIMERS: SectionTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  },
};

/**
 * The section's registration options (`docs/08` §3.3), over `host`.
 *
 * @param pluginID - `config.addonID`, D9's permanent plugin id
 * @param host - read on every use, never captured member by member
 * @param timers - for the `autoSummarize` debounce
 */
export function summarySectionOptions(
  pluginID: string,
  host: SummarySectionHost,
  timers: SectionTimers = DEFAULT_TIMERS,
): _ZoteroTypes.ItemPaneManagerSection.ItemDetailsSectionOptions<
  typeof SUMMARY_PANE_ID
> {
  const states = new WeakMap<HTMLDivElement, BodyState>();

  const stateOf = (body: HTMLDivElement): BodyState => {
    let state = states.get(body);
    if (state === undefined) {
      state = {
        refresh: undefined,
        item: undefined,
        loaded: undefined,
        run: undefined,
        error: undefined,
        autoTimer: undefined,
        autoTried: new Set(),
      };
      states.set(body, state);
    }
    return state;
  };

  const repaint = (state: BodyState): void => {
    // `refresh` re-runs `onRender` and `onAsyncRender` with fresh props, which
    // is where `setSectionSummary` and `setSectionButtonStatus` live.
    void state.refresh?.().catch((error: unknown) => {
      host.onError(
        "[research-helper] the summary section did not refresh",
        error,
      );
    });
  };

  const currentState = (state: BodyState, itemID: number): SectionState => {
    const loaded = state.loaded?.itemID === itemID;
    return deriveState({
      loaded,
      stored: loaded ? state.loaded?.stored : undefined,
      running: state.run?.itemID === itemID,
      error: state.error?.itemID === itemID ? state.error.failure : undefined,
      reason: state.error?.itemID === itemID ? state.error.reason : undefined,
      configured: host.isConfigured(),
    });
  };

  const capabilities = (): ViewCapabilities => ({
    canGenerate: typeof host.generate === "function",
    canSaveNote: typeof host.saveAsNote === "function",
    configured: host.isConfigured(),
    locale: host.locale(),
  });

  const paint = (
    props: _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs,
  ) => {
    const state = stateOf(props.body);
    const view = sectionView(
      currentState(state, props.item.id),
      capabilities(),
    );
    paintBody(props.body, view);
    props.setSectionSummary(view.gist);
    props.setSectionButtonStatus(REGENERATE_BUTTON, view.regenerate);
    props.setSectionButtonStatus(SAVE_NOTE_BUTTON, view.saveNote);
  };

  const startGenerate = (
    body: HTMLDivElement,
    item: SectionItem | undefined,
    regenerate: boolean,
    // Regenerate only (item 305(c)); Retry and Generate keep the cache rule.
    bypassCache = false,
  ): void => {
    const generate = host.generate;
    const state = stateOf(body);
    if (!showsFor(item) || item === undefined) return;
    if (typeof generate !== "function" || !host.isConfigured()) return;
    if (state.run !== undefined) return;
    const itemID = item.id;
    let run: SummaryGenerateRun;
    try {
      run = generate(
        item,
        bypassCache ? { regenerate, bypassCache: true } : { regenerate },
      );
    } catch (error) {
      state.error = {
        itemID,
        failure: summaryFailure(error),
        reason: notStoredReason(error),
      };
      repaint(state);
      return;
    }
    const entry = { itemID, run, cancelled: false };
    state.run = entry;
    state.error = undefined;
    repaint(state);
    run.done.then(
      () => {
        if (state.run === entry) state.run = undefined;
        // Read again from the table: the row is the source of truth.
        state.loaded = undefined;
        repaint(state);
      },
      (error: unknown) => {
        if (state.run === entry) state.run = undefined;
        if (!entry.cancelled) {
          state.error = {
            itemID,
            failure: summaryFailure(error),
            reason: notStoredReason(error),
          };
          host.onError("[research-helper] summary generation failed", error);
        }
        repaint(state);
      },
    );
  };

  const cancelRun = (state: BodyState): void => {
    if (state.run === undefined) return;
    state.run.cancelled = true;
    state.run.run.cancel();
  };

  return {
    paneID: SUMMARY_PANE_ID,
    pluginID,
    header: {
      l10nID: SUMMARY_SECTION_L10N.header,
      icon: SUMMARY_SECTION_ICON,
    },
    sidenav: {
      l10nID: SUMMARY_SECTION_L10N.sidenav,
      icon: SUMMARY_SECTION_ICON,
    },
    bodyXHTML: SUMMARY_BODY_XHTML,
    sectionButtons: [
      {
        type: REGENERATE_BUTTON,
        icon: SUMMARY_SECTION_ICON,
        l10nID: SUMMARY_SECTION_L10N.regenerate,
        // No `refresh` in these props (`docs/08` §3.1): the captured one is
        // used, through the body's state.
        onClick: ({ body, item }) => {
          startGenerate(body, item, true, true);
        },
      },
      {
        type: SAVE_NOTE_BUTTON,
        icon: SUMMARY_SECTION_ICON,
        l10nID: SUMMARY_SECTION_L10N.saveNote,
        onClick: ({ body, item }) => {
          const save = host.saveAsNote;
          const stored = stateOf(body).loaded;
          if (typeof save !== "function" || stored?.itemID !== item.id) return;
          if (stored.stored === undefined) return;
          save(item, stored.stored).catch((error: unknown) => {
            host.onError(
              "[research-helper] saving the summary note failed",
              error,
            );
          });
        },
      },
    ],

    // `refresh` exists only here (`docs/08` §3.1). Captured per body.
    onInit: ({ body, refresh }) => {
      const state = stateOf(body);
      state.refresh = refresh;
      // `html:button`s: the event is `click`; `command` is XUL-only.
      part(body, "generate")?.addEventListener("click", () => {
        startGenerate(body, state.item, false);
      });
      part(body, "retry")?.addEventListener("click", () => {
        startGenerate(body, state.item, true);
      });
      part(body, "cancel")?.addEventListener("click", () => {
        cancelRun(state);
      });
      part(body, "openPreferences")?.addEventListener("click", () => {
        try {
          const doc = body.ownerDocument;
          if (doc === null || !openPreferencesFrom(doc)) {
            host.onError(
              "[research-helper] the preference pane could not be opened",
              undefined,
            );
          }
        } catch (error) {
          host.onError(
            "[research-helper] the preference pane could not be opened",
            error,
          );
        }
      });
    },

    // `docs/08` §3.2's first row. Zotero 10.0.3 ignores the return value and
    // hides the section through `setEnabled` (read 2026-10-29 from
    // `itemPaneCustomSection.js`); the boolean is returned as the
    // documented contract all the same.
    onItemChange: ({ item, setEnabled }) => {
      const show = showsFor(item);
      setEnabled(show);
      return show;
    },

    // Synchronous and cheap: paint what is already known, no I/O.
    onRender: (props) => {
      const state = stateOf(props.body);
      state.item = props.item;
      if (!showsFor(props.item)) return;
      // A failure belongs to the item it happened on; selecting another one
      // and coming back reads the table again.
      if (state.error !== undefined && state.error.itemID !== props.item.id) {
        state.error = undefined;
      }
      paint(props);
    },

    // The one place I/O happens: a read of the plugin's own table.
    onAsyncRender: async (props) => {
      const { body, item } = props;
      if (!showsFor(item)) return;
      const state = stateOf(body);
      const itemID = item.id;
      if (state.run?.itemID === itemID || state.error?.itemID === itemID) {
        paint(props);
        return;
      }
      let stored: StoredSummary | undefined;
      try {
        stored = await host.load(item);
      } catch (error) {
        host.onError(
          "[research-helper] the stored summary could not be read",
          error,
        );
        stored = undefined;
      }
      if (state.item?.id !== itemID) return;
      state.loaded = { itemID, stored };
      paint(props);

      if (state.autoTimer !== undefined) {
        timers.clearTimeout(state.autoTimer);
        state.autoTimer = undefined;
      }
      if (
        stored === undefined &&
        mayAutoSummarize({
          autoSummarize: host.autoSummarize(),
          configured: host.isConfigured(),
          canGenerate: typeof host.generate === "function",
          running: state.run !== undefined,
          triedBefore: state.autoTried.has(itemID),
        })
      ) {
        state.autoTimer = timers.setTimeout(() => {
          state.autoTimer = undefined;
          if (state.item?.id !== itemID || state.autoTried.has(itemID)) return;
          state.autoTried.add(itemID);
          startGenerate(body, state.item, false);
        }, AUTO_SUMMARIZE_DEBOUNCE_MS);
      }
    },

    // `{ paneID, doc, body }` only — no `item` (`docs/08` §3.1).
    onDestroy: ({ body }) => {
      const state = states.get(body);
      if (state === undefined) return;
      if (state.autoTimer !== undefined) timers.clearTimeout(state.autoTimer);
      cancelRun(state);
      state.refresh = undefined;
      states.delete(body);
    },
  };
}
