/**
 * The Search & Import window's view model — `P1-T22`.
 *
 * **What this file is.** The window document (`addon/content/searchDialog.js`)
 * renders; this module decides. It owns the run: it builds the pipeline's input
 * from what the document collected, starts one job, subscribes to `P1-T15`'s
 * reporter, folds every snapshot and the pipeline's outcome into one
 * {@link SearchViewState}, and hands that state to whichever view is connected.
 * The document contains no decision about which of `docs/08` §8.4's five states
 * is current, and this module contains no DOM.
 *
 * ### Why the state is a description and not rendered text
 *
 * Every visible string in this window is a Fluent message id plus its
 * arguments — `P1-T20`'s **Do NOT** forbids a literal English string in the
 * document, and `docs/08` §10.3 forbids assembling a sentence from fragments.
 * So the view state carries {@link MessageRef}s, never prose, and the document
 * sets `data-l10n-id` + `data-l10n-args` exactly as it already does for the year
 * span. {@link message} is typed through `src/i18n/keys.ts`'s
 * `FluentMessageArgsMap`, so a message that declares `{ $seconds }` **cannot be
 * constructed without one** — which is how the two gaps in `docs/08` §8.3's
 * error table became compile errors instead of `{ $seconds }` painted at the
 * user. See {@link ERROR_ROWS}.
 *
 * ### §2.3's dependency rule, and the four ports it forces
 *
 * `docs/07` §2.3: `ui/` may not import `sources/`, `zotero/`, `llm/` or `tts/`,
 * and `eslint.config.js`'s `research-helper/layering/ui` enforces it. Four
 * capabilities this card needs live behind that line, so each arrives as a
 * port on {@link SearchImportViewModelDeps}:
 *
 * | capability | lives in | port |
 * |---|---|---|
 * | the source registry's `list()` | `src/sources/registry.ts` | {@link SearchImportViewModelDeps.listSources} |
 * | the library's collections | `Zotero.Collections` | {@link SearchImportViewModelDeps.listCollections} |
 * | the library-duplicate probe | `src/zotero/libraryIndex.ts` | {@link SearchImportViewModelDeps.isExisting} |
 * | `FR-8`'s provenance note | `src/zotero/notes.ts` | {@link SearchImportViewModelDeps.writeProvenanceNote} |
 * | `FR-8`'s JSON export, the file write | `src/zotero/notes.ts` | {@link SearchImportViewModelDeps.provenanceFiles} |
 *
 * Every one of them is **optional**, and the window degrades rather than
 * breaking: no `listSources` means zero database checkboxes and a disabled
 * Search button (`P1-T20`'s FR-2 gate), no `isExisting` means no row is marked
 * as already present, no `writeProvenanceNote` means the record is built,
 * redacted and logged but not written, and no `provenanceFiles` means
 * {@link SearchImportViewModel.exportProvenance} refuses instead of writing.
 * The note binding was reported with `P1-T22`: it is one line in the
 * composition root, and **no file in that card's `Files` list could make it**
 * (`plan/README.md` §5 rule 2). `P1-T35` made it, and `P1-T36` binds the file
 * writer beside it.
 *
 * ### `FR-8`'s third scenario, and why the *path* comes from outside
 *
 * The record is retained here ({@link SearchImportViewModel.exportProvenance})
 * because it is composed here. The **destination** is not: a file chooser needs
 * a `BrowsingContext` (`docs/01`:436, Firefox 128's `nsIFilePicker.init`
 * change), only a window has one, and this module is constructed once at
 * startup with no window at all. So the chooser is opened by the window
 * document and the chosen path is handed inward as this method's one argument —
 * which also keeps `nsIFilePicker` and the toolkit's `FilePickerHelper` out of
 * `src/` entirely. Measured, with the alternatives, in `P1-T36`'s report.
 *
 * ### The query is never interpolated into a visible string
 *
 * `addon/locale/en-US/research-helper-searchDialog.ftl:294` declares
 * `research-helper-search-state-empty = No papers found for “{ $query }” in
 * { $from }–{ $to }.` — the one message in the bundle that takes the user's
 * query. **This module does not use it**, and {@link EMPTY_HEADLINE_OMITTED}
 * records why in full. The short version: an NCBI key is 32 hexadecimal
 * characters and `redact()`'s last-resort pattern starts at 40 (`P1-T17`,
 * measured), so redaction *cannot* clean the shape that matters, and
 * `src/core/provenance.ts` is the project's single redaction gate — writing a
 * second rule here is forbidden. The same reasoning keeps `SerializedError`'s
 * `detail` and `stack` out of the details disclosure
 * ({@link ERROR_DETAIL_FIELDS}) and keeps the query out of the collection name
 * ({@link resolveTarget}).
 *
 * ### `FR-10`: the main window stays responsive
 *
 * Nothing here loops over records synchronously. The pipeline's awaits are the
 * only long operations, the reporter throttles snapshots to
 * `PROGRESS_REPAINT_INTERVAL_MS` (4 a second), and the work this module does per
 * snapshot is bounded by the number of *sources*, not the number of records. The
 * one per-record pass — {@link toWindowRecords} — runs once per completed fetch.
 */

import type { SerializedError } from "../../core/errors";
import {
  createCancellationTokenSource,
  type CancellationToken,
  type CancellationTokenSource,
} from "../../core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../core/jobQueue/progress";
import {
  exportJson,
  redactSearchProvenance,
  type ProvenanceFileWriter,
  type SearchProvenance,
  type SourceProvenance,
} from "../../core/provenance";
import type { Logger } from "../../core/logger";
import type { Author, CanonicalWork } from "../../model/canonicalWork";
import { isSourceId, type SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import type {
  DuplicatePolicy,
  SearchImportInput,
  SearchImportOutput,
  SearchImportSourceReport,
  SearchImportTarget,
} from "../../pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../pipeline/types";
import type { FluentArgsParam, FluentMessageId } from "../../i18n/keys";
import type {
  SearchWindowDuplicates,
  SearchWindowImportRequest,
  SearchWindowQuery,
  SearchWindowRecord,
} from "../dialogs/searchDialog";
import { NEW_COLLECTION_VALUE } from "../dialogs/searchDialog";

// ---------------------------------------------------------------------------
// 1. Message references
// ---------------------------------------------------------------------------

/**
 * One Fluent lookup, as data: the id the document puts in `data-l10n-id` and
 * the arguments it puts in `data-l10n-args`.
 *
 * `args` is `undefined` for a message with no placeables, and the document then
 * sets no `data-l10n-args` at all — a stale argument object left on an element
 * is one of the two defects `P1-T20` measured in a live window.
 */
export interface MessageRef {
  readonly id: FluentMessageId;
  readonly args: Readonly<Record<string, string | number>> | undefined;
}

/**
 * Build a {@link MessageRef}, with the arguments the message declares.
 *
 * The generic signature is `src/i18n/ftl.ts`'s `formatValue` signature minus
 * the formatter: `FluentArgsParam<Id>` makes the argument object **required**
 * for a message with placeables and **absent** for one without. That is the
 * whole reason this helper exists rather than object literals — it is what
 * turned "`rh-error-rate-limit` needs a retry countdown nobody can supply" from
 * a runtime `{ $seconds }` into a compile error (see {@link ERROR_ROWS}).
 */
export function message<Id extends FluentMessageId>(
  id: Id,
  ...args: FluentArgsParam<Id>
): MessageRef {
  const [supplied] = args;
  return {
    id,
    // The cast is over the generic parameter, which TypeScript cannot relate to
    // an index signature; every member of every entry in `FluentMessageArgsMap`
    // is already a `string` or a `number`. Same cast, same reason, as
    // `src/i18n/ftl.ts`'s `formatMessage`.
    args: supplied as Readonly<Record<string, string | number>> | undefined,
  };
}

// ---------------------------------------------------------------------------
// 2. The view state — docs/08 §8.4's five states, as data
// ---------------------------------------------------------------------------

/**
 * Which panel is showing.
 *
 * These are `docs/08` §8.4's five list states mapped onto the document's
 * panels, **not** §4.6's panel list: `"results"` is both §8.4's PARTIAL and its
 * successful case, because FR-9 requires a partial run to show "results from
 * the other three … and a non-blocking banner", which is one panel plus a
 * banner rather than a panel of its own. §4.6's fifth drawn panel — Re-run,
 * pre-filled from provenance — is FR-12's and belongs to `P2-T17`.
 */
export type SearchPanel =
  "initial" | "searching" | "empty" | "error" | "results";

/** One row of `docs/08` §4.6's per-database status list. */
export interface SourceStatusLine {
  readonly sourceId: string;
  /**
   * The source's own `displayNameKey`. The document sets it as a
   * `data-l10n-id`, so the database name is never a string this module minted
   * (`docs/07` §11.1 step 11).
   */
  readonly nameId: string;
  readonly outcome: "searching" | "succeeded" | "failed";
  /** `Searching…` / `N results` / `Failed — …`, as the bundle declares them. */
  readonly detail: MessageRef;
}

/** `docs/08` §4.6's "All databases failed" panel, as data. */
export interface ErrorView {
  /** `research-helper-search-state-error`. Never a stack trace (NFR-14). */
  readonly headline: MessageRef;
  /** One line per source that failed, with §8.3's row for each. */
  readonly lines: readonly SourceStatusLine[];
  /**
   * NFR-14's details disclosure. Machine values only — see
   * {@link ERROR_DETAIL_FIELDS}.
   */
  readonly details: readonly string[];
  /** §4.6 draws `[ Retry ]` and `[ Open Preferences… ]`; §8.3 picks which. */
  readonly retry: boolean;
  readonly openPreferences: boolean;
}

/**
 * Everything the document draws, in one object.
 *
 * Handed over whole on every change, so the document never has to merge two
 * updates and a late snapshot cannot resurrect a panel the run already left.
 */
export interface SearchViewState {
  readonly panel: SearchPanel;
  /** True while a job is in flight. The document's `Escape` handling reads it. */
  readonly running: boolean;
  /** §4.6's per-database list. Empty before the first search. */
  readonly sources: readonly SourceStatusLine[];
  /** The table's rows, or `undefined` before any run completed. */
  readonly records: readonly SearchWindowRecord[] | undefined;
  /**
   * Bumped once per completed fetch.
   *
   * The document re-applies {@link records} **only** when this changes.
   * Without it, every throttled progress snapshot would re-hand the same rows
   * to `setResults()`, which rebuilds the table and resets the selection — so a
   * user who unticked five rows would watch them come back four times a second.
   */
  readonly recordsRevision: number;
  /**
   * `docs/08` §4.6's EMPTY headline. **Always `undefined`** — see
   * {@link EMPTY_HEADLINE_OMITTED}. The member exists so the decision is
   * visible in the type and so the card that mints a query-free headline id has
   * somewhere to put it.
   */
  readonly emptyHeadline: MessageRef | undefined;
  readonly error: ErrorView | undefined;
  /** FR-9's non-blocking banner lines. Never a modal. */
  readonly warnings: readonly MessageRef[];
  /** The completion summary and `R-17`'s abstract coverage (step 3). */
  readonly notices: readonly MessageRef[];
  /** The status bar's one line (`docs/08` §4.4: progress lives there). */
  readonly status: MessageRef | undefined;
  /**
   * `docs/08` §4.5's `5 of 7 databases`, beside the bar.
   *
   * `undefined` when no fetch is in flight, which is also what clears it at the
   * end of a run.
   */
  readonly databaseProgress: MessageRef | undefined;
  /** 0–100, or `undefined` for indeterminate / idle. */
  readonly progressPercent: number | undefined;
  readonly cancelVisible: boolean;
}

/**
 * Why {@link SearchViewState.emptyHeadline} is always `undefined`, and what it
 * would take to fill it.
 *
 * **The decision, and it is this card's.** `docs/08` §4.6's EMPTY panel draws
 * `No papers found for “lipid nanoparticle CRISPR delivery” in 2024–2026.`, and
 * `research-helper-search-state-empty` interpolates `{ $query }` verbatim. The
 * moment that panel is populated from the keyword box, **a credential pasted
 * into the keyword box is drawn in the window** — and a window's text is read
 * by screenshots, screen recordings and bug reports, which is the same exposure
 * `P1-T21` closed for the result table and the window title.
 *
 * **Redaction does not fix it, and that is measured rather than argued.**
 * `src/core/errors.ts`'s `KEY_PATTERNS` last-resort rule is
 * `/\b[A-Za-z0-9_-]{40,}\b/g`; an NCBI API key is 32 hexadecimal characters.
 * `P1-T17` measured exactly this and wrote it into
 * `src/core/provenance.ts`'s `redactQueryString` doc comment. So
 * "redact before interpolating" would produce a panel that still shows the key
 * while *looking* as though it had been handled — the worst of the available
 * outcomes. Truncation is the same trade in a different hat: it leaks a prefix
 * and mangles every legitimate query.
 *
 * **Writing a sharper rule here is forbidden.** `src/core/provenance.ts` is the
 * project's single redaction gate (NFR-16, `P1-T17`) and `src/core/errors.ts`
 * holds the reference implementations. A key-shape test written in this file
 * would be a second rule in a second place, diverging from the first on the day
 * one of them is updated.
 *
 * **What is lost, and why it is affordable.** The headline states two things:
 * that nothing was found, and the year range. Both are already on screen —
 * `research-helper-search-result-count` reads `0 results · 0 new` beside the
 * filter box, and the two year menulists show the range. The actionable half of
 * §8.4's EMPTY requirement ("why + concrete suggestions") is
 * `research-helper-search-state-empty-suggestions`, which takes no arguments
 * and **is** rendered.
 *
 * **What it needs to be filled properly:** one new message in `P1-T18`'s
 * bundles that takes `{ $from }` and `{ $to }` and *not* `{ $query }` — e.g.
 * `research-helper-search-state-empty-range`. Both `.ftl` bundles and
 * `src/i18n/keys.ts` are `P1-T18`'s files and none is in `P1-T22`'s `Files`
 * list, so this is reported rather than done (`plan/README.md` §5 rule 2).
 * **Needs a card**, and it needs the owner's decision on the wording.
 */
export const EMPTY_HEADLINE_OMITTED =
  "research-helper-search-state-empty interpolates the user's query; see " +
  "EMPTY_HEADLINE_OMITTED in src/ui/viewModels/searchImportViewModel.ts";

/**
 * The only two members of a `SerializedError` that reach the user's screen.
 *
 * `docs/07` §10.2's "User (detail)" row allows "Error code, HTTP status, host,
 * timestamp, affected item count. Copyable", and NFR-14 puts "provider text" in
 * a details disclosure. **`detail` and `stack` are still excluded**, for the
 * reason `src/core/provenance.ts` gives in as many words: `code`, `messageKey`,
 * `retryable` and `httpStatus` "are closed enumerations or numbers and cannot
 * carry a key", whereas `detail` is free text built from the failing request —
 * `P1-T09`'s own `efetch` failure message is built from a URL — and `redact()`
 * does not catch a 32-character key inside it.
 *
 * So the disclosure shows the machine code and the HTTP status, each on its own
 * line, with no prose between them. A richer disclosure is possible the moment
 * a redactor for free text is exported from the gate; today the gate's
 * `redactText` is module-private.
 */
export const ERROR_DETAIL_FIELDS = ["code", "httpStatus"] as const;

// ---------------------------------------------------------------------------
// 3. docs/08 §8.3's error table
// ---------------------------------------------------------------------------

/**
 * `docs/07` §10.1's `code` → `docs/08` §8.3's row, with the action that row
 * offers.
 *
 * `argsFrom` builds the message's arguments from the two things a
 * `SerializedError` actually carries — `httpStatus` — plus the failing source's
 * display name. **A row whose message needs an argument neither of those can
 * supply is absent from this table on purpose**, and
 * {@link UNRENDERABLE_ERROR_ROWS} names all three with the reason.
 */
interface ErrorRow {
  /** The §8.3 message, built from the database's display name and the status. */
  readonly ref: (database: string, status: number | undefined) => MessageRef;
  /** §8.3's "Action offered" column. */
  readonly retry: boolean;
  readonly openPreferences: boolean;
}

/**
 * The rows this build can render, keyed by `docs/07` §10.1's `code`.
 *
 * `$provider` and `$database` are the same value here: §8.3's table is written
 * in terms of `{provider}` for LLM errors, and this card's `Notes` say "for a
 * literature source substitute the source display name from its
 * `displayNameKey`".
 */
export const ERROR_ROWS: Readonly<Record<string, ErrorRow>> = {
  MISSING_CREDENTIAL: {
    ref: (database) =>
      message("rh-error-missing-credential", { provider: database }),
    retry: false,
    openPreferences: true,
  },
  CONFIGURATION: {
    ref: () => message("rh-error-configuration"),
    retry: false,
    openPreferences: true,
  },
  AUTHENTICATION: {
    ref: (database, status) =>
      message("rh-error-auth", { provider: database, status: status ?? 0 }),
    retry: false,
    openPreferences: true,
  },
  AUTHORIZATION: {
    ref: (database, status) =>
      message("rh-error-forbidden", {
        provider: database,
        status: status ?? 0,
      }),
    retry: false,
    openPreferences: true,
  },
  QUOTA_EXCEEDED: {
    ref: (database) => message("rh-error-quota", { provider: database }),
    retry: false,
    openPreferences: true,
  },
  OFFLINE: {
    ref: () => message("rh-error-offline"),
    retry: true,
    openPreferences: false,
  },
  UPSTREAM_SERVER: {
    ref: (database, status) =>
      message("rh-error-upstream", { database, status: status ?? 0 }),
    retry: true,
    openPreferences: false,
  },
  PARSE: {
    ref: (database) => message("rh-error-parse", { database }),
    retry: true,
    openPreferences: false,
  },
  ZOTERO_API: {
    ref: () => message("rh-error-zotero"),
    retry: false,
    openPreferences: false,
  },
  STORAGE: {
    ref: () => message("rh-error-storage"),
    retry: false,
    openPreferences: false,
  },
  BAD_REQUEST: {
    ref: (database) => message("rh-error-bad-request", { database }),
    retry: false,
    openPreferences: false,
  },
};

/**
 * The three `docs/08` §8.3 rows this build **cannot** render, and why.
 *
 * Each of these messages declares a placeable that `docs/07` §5.2's
 * `SerializedError` does not carry. `toSerialized()` projects exactly `code`,
 * `messageKey`, `detail`, `retryable`, `httpStatus` and `stack`; the thrower's
 * structured `context` — which is where `RateLimitError.retryAfterMs`,
 * `TimeoutError.timeoutMs` and `NetworkError`'s host live — is **dropped at
 * that boundary**. So the value is not hidden behind a cast or an awkward API;
 * it does not exist by the time a pipeline outcome reaches a view.
 *
 * | code | §8.3 message | missing |
 * |---|---|---|
 * | `RATE_LIMIT` | "{provider} rate limit reached. Retrying in {n}s." | `seconds` |
 * | `TIMEOUT` | "{host} did not respond within {n}s." | `host`, `seconds` |
 * | `NETWORK` | "Could not reach {host}." | `host` |
 *
 * **`RATE_LIMIT` has a second, independent reason**, and it matters because it
 * is the one this card's `Done when` list names. "Retrying in {n}s" asserts an
 * automatic retry. `src/bootstrap/container.ts` supplies **no `retryFor`** —
 * `P1-T04` and `P1-T05` both declined to invent a per-host attempt cap and
 * `P1-T28` owns it behind a human gate — so `src/core/http/client.ts` makes
 * exactly one attempt and nothing is retrying. Rendering that row would
 * therefore be false even with a countdown in hand.
 *
 * These codes fall through to {@link genericSourceError}, which names what
 * failed and which service (NFR-14's first two requirements) and offers Retry,
 * with the machine code in the disclosure. **This is reported, not smoothed
 * over** (`plan/README.md` §5 rule 6): the criterion "a forced 429 renders the
 * `RATE_LIMIT` row's message with its retry countdown" cannot pass as written,
 * and closing it needs `src/core/errors.ts` to carry a redacted subset of
 * `context` into `SerializedError`. **Needs a card.**
 */
export const UNRENDERABLE_ERROR_ROWS: readonly string[] = [
  "RATE_LIMIT",
  "TIMEOUT",
  "NETWORK",
];

/**
 * §8.3's fallback: name the database, offer Retry, put the code in the
 * disclosure.
 *
 * `rh-error-source = { $database } could not complete the search.` — which is
 * what failed and which service. Never "An error occurred" (NFR-14 forbids it),
 * and never the provider's own text as the primary string (`docs/07` §10.2).
 */
function genericSourceError(database: string): MessageRef {
  return message("rh-error-source", { database });
}

/**
 * One `SerializedError` as the §8.3 row the user sees plus the actions it
 * offers.
 *
 * @param error - the pipeline's serialized error
 * @param database - the failing source's localized display name
 */
export function errorView(
  error: SerializedError,
  database: string,
): {
  readonly ref: MessageRef;
  readonly retry: boolean;
  readonly prefs: boolean;
} {
  const row = ERROR_ROWS[error.code];
  if (row === undefined) {
    return {
      ref: genericSourceError(database),
      // `retryable` is the thrower's own verdict (`docs/07` §10.1), so an
      // unmapped code offers Retry exactly when the error says a retry could
      // plausibly succeed.
      retry: error.retryable,
      prefs: false,
    };
  }
  return {
    ref: row.ref(database, error.httpStatus),
    retry: row.retry,
    prefs: row.openPreferences,
  };
}

/** The disclosure's lines: machine values only. See {@link ERROR_DETAIL_FIELDS}. */
export function errorDetails(
  errors: readonly SerializedError[],
): readonly string[] {
  const lines: string[] = [];
  for (const error of errors) {
    lines.push(error.code);
    if (error.httpStatus !== undefined) {
      lines.push(String(error.httpStatus));
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 4. Ports
// ---------------------------------------------------------------------------

/** One registered source, as the document's Databases row needs it. */
export interface SourceDescriptor {
  readonly id: string;
  /** The source's `displayNameKey`; never a display string. */
  readonly displayNameKey: string;
}

/** One collection the import can target. */
export interface CollectionDescriptor {
  readonly id: number;
  readonly name: string;
}

/**
 * One job's context and surfaces, as `src/bootstrap/container.ts`'s
 * `PipelineContextFactory` hands them over.
 *
 * Declared structurally rather than imported so that `src/ui/` names no
 * composition-root type: `ServiceGraph.pipelineContext` satisfies this as it
 * stands, and a test satisfies it with three fields.
 */
export interface SearchImportJobFactory {
  forJob(options: {
    readonly pipelineId: "searchImport";
    readonly token: CancellationToken;
    readonly openOn?: "progress" | "completion";
    readonly message?: string;
  }): {
    readonly jobId: string;
    readonly context: PipelineContext;
    readonly progress: {
      readonly reporter: {
        done(
          outcome: "succeeded" | "failed" | "cancelled",
          message?: string,
        ): void;
      };
      readonly events: {
        subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
      };
    };
    dispose(): void;
  };
}

/** The one Fluent method this module needs, as `src/i18n/ftl.ts` declares it. */
export interface MessageFormatter {
  formatMessages(
    keys: readonly { id: string; args?: unknown }[],
  ): Promise<(({ value?: string | null } | null) | undefined)[]>;
}

/** What {@link createSearchImportViewModel} needs. */
export interface SearchImportViewModelDeps {
  readonly pipeline: Pipeline<SearchImportInput, SearchImportOutput>;
  readonly jobs: SearchImportJobFactory;
  readonly logger: Logger;
  /** The plugin's own version, for `SearchProvenance.pluginVersion`. */
  readonly pluginVersion: string;
  /** `Zotero.version`, passed in: `ui/` may not name the `Zotero` global. */
  readonly zoteroVersion: string;
  /** Epoch milliseconds. `src/core/clock.ts`'s `Clock`, structurally. */
  readonly clock: { now(): number };
  /** The source registry's `list()`, mapped. Absent means an empty registry. */
  readonly listSources?: () => readonly SourceDescriptor[];
  /** The target picker's contents. Absent means "New collection…" only. */
  readonly listCollections?: () => readonly CollectionDescriptor[];
  /** `docs/07` §8.5's four window seeds, through the typed accessor. */
  readonly getPrefs?: () => Readonly<Record<string, unknown>>;
  /**
   * `P1-T13`'s `LibraryIndex.findExisting`, reduced to a boolean. Absent means
   * no row is marked as already in the library and the hide-existing checkbox
   * hides nothing.
   */
  readonly isExisting?: (record: SourceRecord) => boolean;
  /**
   * `src/zotero/notes.ts`'s `writeProvenanceNote`, already bound.
   *
   * Absent in the product today — the binding is one line in the composition
   * root and no file in this card's `Files` list can make it. When absent the
   * record is still built and redacted, and the omission is logged at `warn`
   * so it is visible in a debug log rather than only in this comment.
   */
  readonly writeProvenanceNote?: (
    provenance: SearchProvenance,
  ) => Promise<string>;
  /**
   * `src/core/provenance.ts`'s file-writing port, for `FR-8`'s JSON export.
   *
   * The port rather than `src/zotero/notes.ts`'s `exportProvenanceJson`, so the
   * serialisation stays where its one redaction gate is: this module calls
   * `exportJson(path, record, files)` and the platform contributes nothing but
   * the write. `src/zotero/notes.ts`'s `provenanceFileWriter()` satisfies it in
   * the product; a unit test satisfies it with one method and reads the bytes.
   *
   * Absent means {@link SearchImportViewModel.exportProvenance} writes nothing
   * and says so, which is the same degradation shape as
   * {@link SearchImportViewModelDeps.writeProvenanceNote}.
   */
  readonly provenanceFiles?: ProvenanceFileWriter;
}

/** What the document hands over when it connects. */
export interface SearchWindowView {
  /** Draw this state. Called synchronously, from the subscription. */
  render(state: SearchViewState): void;
  /**
   * The window's `document.l10n`, for the two strings this module needs as
   * *text* rather than as an id: the database names the result table's Source
   * column draws, and the completion toast's message.
   */
  readonly formatter?: MessageFormatter;
}

// ---------------------------------------------------------------------------
// 5. Pure helpers
// ---------------------------------------------------------------------------

/** The initial state, before anything has been requested (§8.4's INITIAL). */
export function initialViewState(): SearchViewState {
  return {
    panel: "initial",
    running: false,
    sources: [],
    records: undefined,
    recordsRevision: 0,
    emptyHeadline: undefined,
    error: undefined,
    warnings: [],
    notices: [],
    status: undefined,
    databaseProgress: undefined,
    progressPercent: undefined,
    cancelVisible: false,
  };
}

/**
 * `docs/07` §5.1's `SourceRecord` as the row view model the document renders.
 *
 * `key` is the record's own `id` (`${sourceId}:${nativeId}`), which is what
 * makes the window's selection round-trip into
 * `SearchImportTarget.selectedRecordIds` without a second identity scheme.
 *
 * `typeLabel` is the `WorkType` token, **not a localized string**, because no
 * bundle declares a work-type vocabulary — `P1-T21` reported the same gap from
 * the other side, in `buildRow`'s Type column. A token is data, like a DOI;
 * minting English here would break `P1-T20`'s **Do NOT**. **Needs a card** in
 * `P1-T18`'s bundles.
 */
export function toWindowRecords(
  records: readonly SourceRecord[],
  sourceNames: ReadonlyMap<string, string>,
  isExisting: ((record: SourceRecord) => boolean) | undefined,
): readonly SearchWindowRecord[] {
  return records.map((record) => {
    const { work } = record;
    const authors: readonly Author[] = work.authors;
    // The source's own id is the fallback, never an empty cell: §4.5 draws the
    // database on every row, and a registry token is data in the way a DOI is.
    const label = sourceNames.get(record.sourceId) ?? record.sourceId;
    return {
      key: record.id,
      title: work.title,
      authors,
      ...(work.publishedDate?.year !== undefined && {
        year: work.publishedDate.year,
      }),
      sourceLabels: [label],
      typeLabel: work.type,
      doi: work.ids.doi ?? "",
      existing: isExisting === undefined ? false : isExisting(record),
    };
  });
}

/**
 * The `searchImport` input for one window query.
 *
 * `dateFilter` is built here rather than through
 * `src/sources/shared/recency.ts`'s `recencyWindow()`, because `ui/` may not
 * import `sources/` (§2.3) — and because the window's two year menulists are
 * the authority for the span once the user has touched them, which
 * `recencyWindow(years, clock)` cannot express. The shape is
 * `RecencyWindow`'s, checked structurally by `SearchImportInput`.
 *
 * `label` is `RecencyWindow`'s own display form. Nothing in the pipeline reads
 * it — `resolveDateFilterMode` and `applyClientRecencyFilter` use the four
 * bounds — and the window draws its own span through
 * `research-helper-search-years-span`, so this is not a second opinion about
 * how a year range is written for a user.
 *
 * `records` and `works` are the preview's `SearchImportOutput.records` and
 * `.works`, handed back together for the write half (`P2-T31`): the pipeline
 * then writes the works the table showed instead of re-merging each
 * representative alone, which left the written item with one source in
 * `seenIn` and without the fields the other contributors had won. `works` is
 * omitted when the caller holds none aligned with the records — a run that
 * stopped before `Merging` — and the pipeline merges the records itself, as
 * it did before `P2-T31`.
 */
export function toPipelineInput(
  query: SearchWindowQuery,
  target: SearchImportTarget | undefined,
  records: readonly SourceRecord[] | undefined,
  works?: readonly CanonicalWork[],
): SearchImportInput {
  const from = Math.min(query.fromYear, query.toYear);
  const to = Math.max(query.fromYear, query.toYear);
  const years = Number.isInteger(from) && Number.isInteger(to);
  return {
    query: query.keyword,
    sourceIds: query.sources.filter((id): id is SourceId => isSourceId(id)),
    limit: query.maxResults,
    dateFilter: years
      ? {
          fromYear: from,
          toYear: to,
          fromDate: `${String(from)}-01-01`,
          toDate: `${String(to)}-12-31`,
          label: `${String(from)} – ${String(to)}`,
        }
      : "none",
    ...(target !== undefined && { target }),
    ...(records !== undefined && { records }),
    ...(works !== undefined && { works }),
  };
}

/**
 * The window's three duplicate-policy words → the importer's three (`P1-T43`).
 *
 * **Total, and checked by the compiler.** `Record<SearchWindowDuplicates, …>`
 * requires one entry per member of `SEARCH_WINDOW_DUPLICATES`, so a fourth
 * radio added to the window without a row here is `TS2741`, and a value on the
 * right that is not a `DuplicatePolicy` is `TS2322`. Before this table existed
 * the window-facing member was a `string`, so the importer's own word
 * `"link-existing"` compiled in the window's slot — `phase1-dod.spec.ts`
 * carried exactly that — and the pipeline read `request.duplicatePolicy ??
 * DEFAULT_DUPLICATE_POLICY`, which would have silently turned every unmapped
 * choice into the default. The same three outcomes, two vocabularies, one
 * mapping, written once.
 */
export const DUPLICATE_POLICY_BY_CHOICE: Readonly<
  Record<SearchWindowDuplicates, DuplicatePolicy>
> = {
  skip: "skip",
  link: "link-existing",
  import: "import-anyway",
};

/**
 * {@link DUPLICATE_POLICY_BY_CHOICE} as a lookup that survives the untyped
 * document boundary.
 *
 * `choice` is typed as the union, but it is read off a XUL radiogroup by a
 * script nothing typechecks, so a value outside the union *can* arrive at run
 * time. For that case this returns `undefined` and the caller **refuses the
 * import** rather than falling back to the importer's default — a fall-back is
 * the failure `P1-T43` exists to end, and a refusal is the shape `runImport`
 * already uses for a target picker that names no collection. `Object.hasOwn`
 * rather than a bare index so that a prototype name such as `"toString"`
 * cannot read as a policy.
 */
export function toDuplicatePolicy(
  choice: SearchWindowDuplicates,
): DuplicatePolicy | undefined {
  return Object.hasOwn(DUPLICATE_POLICY_BY_CHOICE, choice)
    ? DUPLICATE_POLICY_BY_CHOICE[choice]
    : undefined;
}

/**
 * The §4.6 status line for one finished source report.
 *
 * `failed` carries `research-helper-search-source-failed`, whose own bundle
 * comment fixes `$reason` as "an already-localized `rh-error-*` string, never a
 * message id" — which this module cannot produce without a formatter. So the
 * failed line carries §8.3's row **as its own message**, and the document draws
 * the database name beside it from `nameId`. That keeps the row out of a
 * concatenation (`docs/08` §10.3) at the cost of not using
 * `research-helper-search-source-failed` on this surface; it *is* used where a
 * resolved string is available.
 */
export function sourceStatusLine(
  report: SearchImportSourceReport,
  descriptor: SourceDescriptor | undefined,
  databaseName: string,
): SourceStatusLine {
  const nameId = descriptor?.displayNameKey ?? "";
  if (report.error !== undefined) {
    return {
      sourceId: report.sourceId,
      nameId,
      outcome: "failed",
      detail: errorView(report.error, databaseName).ref,
    };
  }
  return {
    sourceId: report.sourceId,
    nameId,
    outcome: "succeeded",
    detail: message("research-helper-search-source-results", {
      count: report.recordsRetrieved,
    }),
  };
}

/**
 * `FR-8`'s record for one finished run.
 *
 * ### The four §5.3 fields the pipeline cannot supply
 *
 * `SearchImportSourceReport`'s own doc comment measured them:
 * `endpointBaseUrl` and `transmittedUrl` are built inside the adapter and never
 * returned, `rawHitCount` is unreachable through `searchAll`'s
 * `AsyncIterable`, and `sourceExtras` lives on a `SourcePage` that
 * `searchAll` does not yield. They are written as `""` / `undefined` here
 * rather than guessed. **Needs a card**, as `P1-T16` already said: either
 * `searchAll` grows a page-level side channel or the pipeline pages `search()`
 * itself, and §11.1's closing rule makes the first a documented change to
 * `docs/07` §4.2.
 *
 * ### `recordsImported`, per source
 *
 * §5.3 asks for it per source; the write half reports `created` /
 * `linkedExisting` **per run**, because `importWorks` batches works and does not
 * trace a created item back to the record it came from. With exactly one
 * contributing source the run total *is* that source's total and is assigned.
 * With more than one it is genuinely unknown, so every entry gets `0` and the
 * run records a warning saying so — a zero beside a non-zero run total reads as
 * "not attributed", which is the honest rendering; apportioning it by share of
 * records would be a number nobody measured. Phase 1 registers one source, so
 * the second branch is unreachable in this build. **Needs a card** with the
 * per-record write report.
 */
export function buildProvenance(
  output: SearchImportOutput,
  input: SearchImportInput,
  meta: {
    readonly runId: string;
    readonly pluginVersion: string;
    readonly zoteroVersion: string;
    readonly startedAt: string;
    readonly finishedAt: string;
  },
): SearchProvenance {
  const contributing = output.perSource.filter((r) => r.recordsRetrieved > 0);
  const imported =
    (output.write?.created ?? 0) + (output.write?.linkedExisting ?? 0);
  const attributable = contributing.length === 1;

  const perSource: readonly SourceProvenance[] = output.perSource.map(
    (report) => ({
      sourceId: report.sourceId,
      // Not available through `LiteratureSource` — see this function's doc.
      endpointBaseUrl: "",
      transmittedQuery: report.transmittedQuery,
      transmittedUrl: "",
      dateFilterApplied: report.dateFilterApplied,
      requestedLimit: report.requestedLimit,
      rawHitCount: undefined,
      recordsRetrieved: report.recordsRetrieved,
      recordsDeduplicatedAway: report.recordsDeduplicatedAway,
      recordsImported:
        attributable && report.recordsRetrieved > 0 ? imported : 0,
      error: report.error,
      sourceExtras: undefined,
    }),
  );

  return {
    schemaVersion: 1,
    runId: meta.runId,
    pluginVersion: meta.pluginVersion,
    zoteroVersion: meta.zoteroVersion,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    userQuery: input.query,
    dateFilter:
      input.dateFilter === "none"
        ? "none"
        : {
            fromIso: input.dateFilter.fromDate,
            toIso: input.dateFilter.toDate,
          },
    targetLibraryId: output.write?.libraryId ?? 0,
    targetCollectionKey: output.write?.collectionKey,
    perSource,
    totals: {
      retrieved: output.records.length,
      deduplicatedAway: 0,
      imported,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. The view model
// ---------------------------------------------------------------------------

/**
 * What {@link SearchImportViewModel.exportProvenance} did — `FR-8`'s third
 * scenario, as a value rather than as a rendered string.
 *
 * A value and not a {@link MessageRef}, deliberately: the two user-visible
 * strings `P1-T36` step 4 asks for cannot be added inside that card's `Files`
 * list (every new Fluent identifier needs `src/i18n/keys.ts` and the generated
 * `typings/i10n.d.ts`, and a user-visible string also moves `G-41`'s count), so
 * the outcome is published in the form a later card can render without changing
 * this method again. The reason is measured in `P1-T36`'s report.
 *
 * - `written` — the bytes reached the path the caller chose.
 * - `no-record` — nothing has been imported since the last run started, so
 *   there is no record. **Nothing is written** (`P1-T36` criterion 4).
 * - `no-writer` — {@link SearchImportViewModelDeps.provenanceFiles} is unbound.
 * - `no-path` — the caller supplied an empty destination.
 * - `failed` — the writer threw.
 *
 * There is no `cancelled`: a user who dismisses the chooser already knows, and
 * the window never calls this without a path.
 */
export type ProvenanceExportOutcome =
  "written" | "no-record" | "no-writer" | "no-path" | "failed";

/** What {@link createSearchImportViewModel} returns. */
export interface SearchImportViewModel {
  /** The current state. Handed to a view the moment it connects. */
  readonly state: SearchViewState;
  /** Attach the document. Returns the detach function its unload must call. */
  connect(view: SearchWindowView): () => void;
  /** The Search button. Resolves when the run has finished rendering. */
  runSearch(query: SearchWindowQuery): Promise<void>;
  /** The Import button. Resolves when the write half has finished rendering. */
  runImport(request: SearchWindowImportRequest): Promise<void>;
  /** The Cancel button, and `Escape` while a job runs (FR-10). */
  cancel(): void;
  /**
   * `FR-8`'s third scenario: write the retained record to `path`, as JSON.
   *
   * The record is the **redacted** one `redactSearchProvenance` returned when
   * the import composed it, and `exportJson` → `serializeProvenance` runs the
   * same gate again on the way out (it is idempotent). No second rule exists
   * anywhere, which is `P1-T17`'s NFR-16 requirement and `P1-T36`'s first
   * **Do NOT**.
   *
   * @param path - the destination the *window* chose; never stored, never
   *   logged, and never put into the record, the note or the file
   * @returns which of {@link ProvenanceExportOutcome} happened
   */
  exportProvenance(path: string): Promise<ProvenanceExportOutcome>;
  /** The host object the document reads off `api.searchWindow`. */
  readonly host: SearchWindowHostApi;
}

/**
 * The contract `addon/content/searchDialog.js`'s `resolveHost()` documents,
 * typed.
 *
 * Every member is one that comment names, plus {@link connect}, which is this
 * card's addition: the document could push a query at the host but had no way
 * of being *driven* by it. The document tolerates every member being absent, so
 * adding one cannot break a window running against an older host.
 */
export interface SearchWindowHostApi {
  listSources(): readonly SourceDescriptor[];
  listCollections(): readonly CollectionDescriptor[];
  getPrefs(): Readonly<Record<string, unknown>>;
  connect(view: SearchWindowView): () => void;
  runSearch(query: SearchWindowQuery): Promise<void>;
  runImport(request: SearchWindowImportRequest): Promise<void>;
  cancel(): void;
  /**
   * `FR-8`'s third scenario. Added by `P1-T36`, and the document tolerates it
   * being absent exactly as it tolerates every other member — so a window
   * running against an older host simply has nothing to press.
   */
  exportProvenance(path: string): Promise<ProvenanceExportOutcome>;
}

/** One running job: its surfaces, and the one call that closes them. */
interface RunningJob {
  readonly output: SearchImportOutput;
  /**
   * Close the job's surfaces and raise `docs/08` §4.4's completion toast.
   *
   * Separate from the run so the toast can carry the import summary: §4.4 puts
   * the toast "only on completion", and the summary is not composed until the
   * write report has been read.
   */
  finish(toast: string | undefined): void;
}

/**
 * Build the view model, and with it the host the document runs on.
 *
 * One per window. `SEARCH_WINDOW_NAME` makes the window a singleton, so in
 * practice there is one — but nothing here is module state, so a second window
 * would get its own cancellation source and its own subscription rather than
 * fighting over one.
 */
export function createSearchImportViewModel(
  deps: SearchImportViewModelDeps,
): SearchImportViewModel {
  let state = initialViewState();
  let view: SearchWindowView | undefined;
  let source: CancellationTokenSource | undefined;
  /** The fetched records the Import half writes, held between the two halves. */
  let fetched: readonly SourceRecord[] = [];
  /**
   * The preview's merged works, aligned with {@link fetched} one per row, held
   * for the Import half (`P2-T31`) so the pipeline writes what the table
   * showed rather than re-merging each representative alone. `undefined` when
   * the last run stopped before `Merging` and so published no aligned works;
   * the import then hands the records back on their own and the pipeline
   * merges them, as it did before `P2-T31`.
   */
  let previewed: readonly CanonicalWork[] | undefined;
  /** `sourceId` → localized display name, resolved once per connect. */
  let sourceNames: ReadonlyMap<string, string> = new Map();
  let revision = 0;
  /** Each source's last reported count, latched as the fetch moves on. */
  const latched = new Map<string, number>();
  let current: string | undefined;
  /** The in-flight (or settled) source-name lookup. See {@link ensureSourceNames}. */
  let namesPromise: Promise<void> | undefined;
  /**
   * The source ids the current run asked, i.e. `SearchImportInput.sourceIds`.
   *
   * The §4.6 list is drawn from this rather than from the registry, so a source
   * the user unchecked is not shown as being searched. Empty on an import run,
   * which asks nobody.
   */
  let asked: readonly string[] = [];
  /**
   * The **redacted** provenance record of the run the window is showing, or
   * `undefined` when the window is showing a run that produced none.
   *
   * `P1-T36`'s whole risk is this variable's lifetime, and all three failure
   * modes are decided here rather than left to the caller:
   *
   * - **Stale** — cleared at the *start* of every run, search or import, so a
   *   second run cannot be exported as the first. Clearing on a search matters
   *   as much as clearing on an import: after a search the window shows a
   *   result table that no import has written, and exporting the previous
   *   import's record would describe a collection that is no longer on screen.
   * - **A leak** — only {@link redactSearchProvenance}'s output is ever
   *   assigned, never the draft {@link buildProvenance} returns. Retaining the
   *   unredacted record "in case the export needs more detail" is `P1-T36`'s
   *   second **Do NOT**, and the detail is not needed: the export is a
   *   `JSON.stringify` of the whole object either way.
   * - **Absent** — which is the state the code was in before `P1-T36`: the
   *   record was composed as a local `const`, handed to the note writer and
   *   dropped. `exportProvenance` returns `no-record` rather than writing an
   *   empty file.
   *
   * **Cleared per run and deliberately not per window.** This view model is
   * application-scoped — the composition root builds one at startup — so
   * closing and reopening the window does not reset it, and `connect()` does
   * **not** clear this. That is on purpose: {@link state} is not reset either,
   * so a reopened window still shows the previous run's table, and a record
   * cleared on `connect` would refuse to export the very run the user is
   * looking at. The record and what is on screen therefore always agree. What
   * *should* happen to an application-scoped view model across a window
   * reopen is an open question `P1-T35` already recorded in `plan/00` §6; this
   * card follows the behaviour that is shipped rather than pre-empting it.
   *
   * **The lifetime is the plugin session, and `docs/07` §5.3 says it will not
   * stay that way.** §5.3's "Where it lives" (`docs/07`:2073) makes the SQLite
   * `search_provenance` row authoritative and says the export "serialises the
   * stored object"; Phase 1 ships no plugin-owned SQLite, which
   * `src/core/provenance.ts`'s own header already records, and `P2-T17` creates
   * the table. Until then this variable *is* the stored object.
   */
  let retained: SearchProvenance | undefined;

  const descriptors = (): readonly SourceDescriptor[] =>
    deps.listSources?.() ?? [];

  const nameOf = (sourceId: string): string =>
    sourceNames.get(sourceId) ?? sourceId;

  function publish(next: Partial<SearchViewState>): void {
    state = { ...state, ...next };
    try {
      view?.render(state);
    } catch {
      // A throwing view must not take the run down with it: by the time the
      // summary renders the items are already written, and the counts matter
      // more than the paint. There is no `console` in the sandbox (`docs/01`
      // §2.3), so this goes to the logger.
      deps.logger.warn("the search window's view threw while rendering", {
        panel: state.panel,
      });
    }
  }

  /**
   * Resolve every registered source's `displayNameKey` to a string, once.
   *
   * Two surfaces need the name as *text* rather than as an id: the result
   * table's Source column, which `buildRow` writes into `textContent`, and
   * `research-helper-search-status-searching`'s `{ $database }`. Without a
   * formatter each name falls back to its `sourceId` — a registry token, like a
   * DOI, rather than an English string this file minted — and the substitution
   * is logged rather than silent.
   */
  async function resolveSourceNames(): Promise<void> {
    const list = descriptors();
    const names = new Map<string, string>();
    const formatter = view?.formatter;
    deps.logger.debug("resolving source display names", {
      sources: list.length,
      formatter: formatter !== undefined,
    });
    if (formatter === undefined) {
      for (const descriptor of list) names.set(descriptor.id, descriptor.id);
      sourceNames = names;
      deps.logger.debug(
        "no Fluent formatter connected; source display names fall back to ids",
        { sources: list.length },
      );
      return;
    }
    try {
      const resolved = await formatter.formatMessages(
        list.map((descriptor) => ({ id: descriptor.displayNameKey })),
      );
      list.forEach((descriptor, at) => {
        const value = resolved[at]?.value;
        names.set(
          descriptor.id,
          value === null || value === undefined || value === ""
            ? descriptor.id
            : value,
        );
      });
    } catch {
      names.clear();
      for (const descriptor of list) names.set(descriptor.id, descriptor.id);
      deps.logger.warn(
        "the Fluent lookup of the source display names threw; using ids",
      );
    }
    sourceNames = names;
    deps.logger.debug("source display names resolved", {
      names: [...names.values()].join(","),
    });
  }

  /**
   * Resolve the source display names once, and **not later than the first run**.
   *
   * Started at `connect()` and awaited before a run hands records over.
   * Measured 2026-10-07 in a live window: starting it at connect alone is a
   * race the window loses. `document.l10n.formatMessages` has to fetch and parse
   * the bundle, a search that starts a few milliseconds later finishes first,
   * and the result table's Source column then draws from an empty map. Awaiting
   * it costs one Fluent lookup before the first search and nothing afterwards.
   *
   * Re-resolved when the registry has grown, which is how Phase 2's
   * "a source appears by registration alone" (`docs/07` §11.1 step 11) reaches
   * this cache without a window reload.
   */
  function ensureSourceNames(): Promise<void> {
    if (
      namesPromise === undefined ||
      sourceNames.size !== descriptors().length
    ) {
      namesPromise = resolveSourceNames();
    }
    return namesPromise;
  }

  /**
   * The §4.6 list while the fetch is in flight.
   *
   * `ProgressSnapshot.currentStageKey` is the label of the deepest child that
   * last reported, and `searchImportPipeline`'s fetch stage builds one child per
   * source named `source.id` — so while a source is being searched the key *is*
   * that source's id. Each source's last `completed` count is latched as the
   * run moves on, which is how a finished source can show `✓ N results` before
   * the run ends: `output.perSource` only arrives at the end.
   *
   * **Only the sources the run actually asked**, which is {@link asked} and not
   * the whole registry. Listing every registered adapter as "Searching…" would
   * claim a database was being searched that the user had unchecked — the
   * inverse of `P1-T20`'s "a checkbox that searches nothing is worse than an
   * absent one", and a line the final list (built from `output.perSource`) then
   * silently drops.
   */
  function searchingLines(): readonly SourceStatusLine[] {
    const wanted = new Set(asked);
    return descriptors()
      .filter((descriptor) => wanted.has(descriptor.id))
      .map((descriptor) => {
        const count = latched.get(descriptor.id);
        if (descriptor.id === current || count === undefined) {
          return {
            sourceId: descriptor.id,
            nameId: descriptor.displayNameKey,
            outcome: "searching" as const,
            detail: message("research-helper-search-source-searching"),
          };
        }
        return {
          sourceId: descriptor.id,
          nameId: descriptor.displayNameKey,
          outcome: "succeeded" as const,
          detail: message("research-helper-search-source-results", { count }),
        };
      });
  }

  /**
   * `docs/08` §4.5's `5 of 7 databases`, from what the fetch has latched.
   *
   * `research-helper-search-progress-databases` is in both bundles and in
   * `src/i18n/keys.ts` and, before this card, was rendered by nothing. §4.5's
   * status line draws it beside the bar and the Cancel button, so this is where
   * it belongs: `done` counts the sources that have finished, which is the
   * latched set minus whichever is in flight.
   */
  function databaseProgress(): MessageRef | undefined {
    if (asked.length === 0) return undefined;
    const finished = [...latched.keys()].filter((id) => id !== current).length;
    return message("research-helper-search-progress-databases", {
      done: finished,
      total: asked.length,
    });
  }

  /** Fold one progress snapshot into the status bar and the §4.6 list. */
  function onSnapshot(snapshot: ProgressSnapshot, writing: boolean): void {
    const stage = snapshot.currentStageKey;
    if (stage !== undefined && sourceNames.has(stage)) {
      current = stage;
      latched.set(stage, snapshot.completed);
    }
    const percent =
      snapshot.fraction === undefined
        ? undefined
        : Math.max(0, Math.min(100, Math.round(snapshot.fraction * 100)));
    const status: MessageRef | undefined = writing
      ? message("research-helper-search-status-importing", {
          done: snapshot.completed,
          total: snapshot.total ?? snapshot.completed,
        })
      : current === undefined
        ? undefined
        : message("research-helper-search-status-searching", {
            database: nameOf(current),
          });
    const databases = writing ? undefined : databaseProgress();
    publish({
      ...(percent === undefined ? {} : { progressPercent: percent }),
      ...(status === undefined ? {} : { status }),
      ...(writing
        ? {}
        : { sources: searchingLines(), databaseProgress: databases }),
    });
  }

  /** Resolve a {@link MessageRef} to text. Used for the completion toast only. */
  async function text(ref: MessageRef): Promise<string | undefined> {
    const formatter = view?.formatter;
    if (formatter === undefined) return undefined;
    try {
      const [resolved] = await formatter.formatMessages([
        ref.args === undefined
          ? { id: ref.id }
          : { id: ref.id, args: ref.args },
      ]);
      const value = resolved?.value;
      return value === null || value === undefined || value === ""
        ? undefined
        : value;
    } catch {
      return undefined;
    }
  }

  /**
   * The import target the picker's value names.
   *
   * **The collection name is never derived from the query.** A collection name
   * is written to the Zotero database and read back for the life of the
   * library, so deriving one from the keyword box would *persist* a pasted
   * credential — a strictly worse exposure than the transient one
   * {@link EMPTY_HEADLINE_OMITTED} is about, and one no redactor in this
   * project can clean at 32 characters. The name therefore comes from a
   * collection the user picked, or from a name the user typed into the
   * document's "New collection…" prompt, which arrives as
   * `${NEW_COLLECTION_VALUE}:<name>`.
   *
   * `undefined` means the picker is still on bare "New collection…" with no
   * name. The document gates the Import button on the same condition.
   */
  function resolveTarget(
    query: SearchWindowQuery,
  ): SearchImportTarget | undefined {
    const raw = query.collectionID;
    if (typeof raw !== "string" || raw === "") return undefined;
    if (raw === NEW_COLLECTION_VALUE) return undefined;
    if (raw.startsWith(`${NEW_COLLECTION_VALUE}:`)) {
      const name = raw.slice(NEW_COLLECTION_VALUE.length + 1).trim();
      return name === "" ? undefined : { collectionName: name };
    }
    const id = Number(raw);
    const found = (deps.listCollections?.() ?? []).find(
      (collection) => collection.id === id,
    );
    return found === undefined ? undefined : { collectionName: found.name };
  }

  /**
   * Start one job, run the pipeline, and hand back the output plus the call
   * that closes the job's surfaces.
   *
   * One cancellation source and one subscription per job, both released by
   * {@link RunningJob.finish}. A second concurrent run is refused rather than
   * queued: `docs/08` §4.1 makes this window a singleton and a second job would
   * write into the same table.
   */
  async function runJob(
    input: SearchImportInput,
    writing: boolean,
  ): Promise<RunningJob | undefined> {
    if (source !== undefined) {
      deps.logger.warn("a search or import is already running; ignoring", {
        panel: state.panel,
      });
      return undefined;
    }
    const tokenSource = createCancellationTokenSource();
    source = tokenSource;
    latched.clear();
    current = undefined;
    // The sources this run asks. An import run supplies `records` and asks
    // nobody, which is why the §4.6 list is left alone below while `writing`.
    asked = input.records === undefined ? input.sourceIds : [];

    const job = deps.jobs.forJob({
      pipelineId: "searchImport",
      token: tokenSource.token,
      // `docs/08` §4.4: nothing is drawn outside this window until the end,
      // because progress lives in the status bar where Cancel is. The popup is
      // §4.4's completion toast, raised by the `done()` in `finish` below.
      openOn: "completion",
    });
    const unsubscribe = job.progress.events.subscribe((snapshot) => {
      onSnapshot(snapshot, writing);
    });

    publish({
      running: true,
      cancelVisible: true,
      panel: writing ? state.panel : "searching",
      progressPercent: 0,
      error: undefined,
      warnings: [],
      notices: [],
      ...(writing ? {} : { sources: searchingLines() }),
    });

    const close = (
      outcome: "succeeded" | "failed" | "cancelled",
      toast: string | undefined,
    ): void => {
      unsubscribe();
      // §4.1's terminal call, and the only thing that raises the toast when the
      // sink was opened with `openOn: "completion"`.
      job.progress.reporter.done(outcome, toast);
      job.dispose();
      tokenSource.dispose();
      source = undefined;
      publish({ running: false, cancelVisible: false });
    };

    let output: SearchImportOutput;
    try {
      output = await deps.pipeline.run(input, job.context);
    } catch (error) {
      // `run()` is written to return a `"failed"` output rather than throw, so
      // reaching here means a defect below this line. The surfaces still have
      // to close, or the window keeps a spinner and a Cancel button for ever.
      close("failed", undefined);
      throw error;
    }

    return {
      output,
      finish(toast: string | undefined): void {
        close(
          // `"partial"` is a *completed* run (FR-9), so the job succeeded even
          // though a database did not.
          output.outcome === "partial" ? "succeeded" : output.outcome,
          toast,
        );
      },
    };
  }

  /**
   * `docs/08` §8.4's five states, chosen from one outcome.
   *
   * `"partial"` is the state §8.4 names as the one plugins forget: results
   * **plus** a non-blocking banner (FR-9), never a modal and never the error
   * panel.
   */
  function renderSearchOutcome(output: SearchImportOutput): void {
    const lines = output.perSource.map((report) =>
      sourceStatusLine(
        report,
        descriptors().find((descriptor) => descriptor.id === report.sourceId),
        nameOf(report.sourceId),
      ),
    );
    fetched = output.records;
    // `works[i]` belongs to `records[i]` only once `Merging` has run; a run
    // that stopped earlier (a cancel during `Fetching`, an all-sources
    // failure) carries the fetch output and an empty `works`, and handing
    // that pair back would be rejected as misaligned. The lengths say which
    // case this is, so the import never has to know the stage order.
    previewed =
      output.works.length === output.records.length ? output.works : undefined;
    revision += 1;
    const records = toWindowRecords(
      output.records,
      sourceNames,
      deps.isExisting,
    );

    if (output.outcome === "cancelled") {
      // §8.3's CANCELLED row, with the count of items already imported. A
      // cancelled *search* has written nothing, so the count is zero and the
      // row says so rather than the window pretending nothing happened.
      publish({
        sources: lines,
        records,
        recordsRevision: revision,
        panel: output.records.length > 0 ? "results" : "initial",
        status: message("rh-error-cancelled", {
          imported: output.write?.created ?? 0,
        }),
        databaseProgress: undefined,
        progressPercent: undefined,
      });
      return;
    }

    if (output.outcome === "failed") {
      const failedReports = output.perSource.filter(
        (report) => report.error !== undefined,
      );
      const perSourceErrors = failedReports.flatMap((report) =>
        report.error === undefined ? [] : [{ report, error: report.error }],
      );
      const actions = perSourceErrors.map(({ report, error }) =>
        errorView(error, nameOf(report.sourceId)),
      );
      const runLevel =
        output.error === undefined
          ? []
          : [
              errorView(
                output.error,
                nameOf(output.perSource[0]?.sourceId ?? ""),
              ),
            ];
      const errors = [
        ...perSourceErrors.map(({ error }) => error),
        ...(output.error === undefined ? [] : [output.error]),
      ];
      publish({
        sources: lines,
        records: [],
        recordsRevision: revision,
        panel: "error",
        error: {
          // **The headline is not unconditionally "Could not reach any
          // database".** §12.1 reaches `Failed` by two routes, and §4.6 only
          // draws the first: every *asked* source failed, or `Planning` rejected
          // the input before any source was asked. An empty keyword box takes
          // the second route — `validateSearchImportInput` returns
          // `{ field: "query" }` — and claiming a network failure for it would
          // be exactly the misleading primary text NFR-14 forbids. So a run that
          // asked nobody is headlined by its own §8.3 row.
          //
          // That row is `rh-error-configuration`, which is not the right
          // sentence either: the right one is
          // `research-helper-search-query-empty`, the id
          // `SEARCH_IMPORT_VALIDATION_KEYS` names and **no bundle declares**
          // (`P1-T16` reported all three of its validation ids as missing).
          // Reachable from a button now rather than only from a pipeline call,
          // so the gap is reported again with a higher priority. **Needs a card**
          // in `P1-T18`'s bundles.
          headline:
            output.perSource.length === 0 && runLevel[0] !== undefined
              ? runLevel[0].ref
              : message("research-helper-search-state-error"),
          lines: lines.filter((line) => line.outcome === "failed"),
          details: errorDetails(errors),
          retry: [...actions, ...runLevel].some((action) => action.retry),
          openPreferences: [...actions, ...runLevel].some(
            (action) => action.prefs,
          ),
        },
        status: undefined,
        databaseProgress: undefined,
        progressPercent: undefined,
      });
      return;
    }

    const failed = output.perSource.filter(
      (report) => report.error !== undefined,
    ).length;
    const warnings: readonly MessageRef[] =
      output.outcome === "partial"
        ? [
            message("research-helper-search-state-partial", {
              failed,
              succeeded: output.perSource.length - failed,
            }),
          ]
        : [];

    publish({
      sources: lines,
      records,
      recordsRevision: revision,
      // §8.4's EMPTY. The headline stays absent — see EMPTY_HEADLINE_OMITTED —
      // and the suggestions line is in the markup and needs no arguments.
      panel: output.records.length === 0 ? "empty" : "results",
      emptyHeadline: undefined,
      warnings,
      status: undefined,
      databaseProgress: undefined,
      progressPercent: undefined,
    });
  }

  /**
   * The completion toast's text for a *search*.
   *
   * `docs/08` §4.4 raises the toast "only on completion so the user gets feedback
   * if they have switched away from the window", and a seven-database search is
   * exactly as long as an import — so a search gets a message too rather than a
   * popup carrying only the product name. The message is
   * `research-helper-search-result-count`, which is the same `N results · M new`
   * the window shows beside the filter box, so the toast and the window cannot
   * disagree.
   *
   * A failed run gets **no** message: the actionable text is §8.3's row in the
   * error panel, and a popup is not where NFR-14's "one concrete next action"
   * can be offered.
   */
  async function searchToast(
    output: SearchImportOutput,
  ): Promise<string | undefined> {
    if (output.outcome === "failed") return undefined;
    if (output.outcome === "cancelled") {
      return text(
        message("rh-error-cancelled", { imported: output.write?.created ?? 0 }),
      );
    }
    const records = state.records ?? [];
    return text(
      message("research-helper-search-result-count", {
        total: records.length,
        new: records.filter((record) => !record.existing).length,
      }),
    );
  }

  /**
   * Step 3's summary, then `FR-8`'s note, then the toast's text.
   *
   * Order matters and is `docs/08` §4.4's: the write stages have finished by the
   * time this runs, the summary is published from the write report, and the note
   * is written **after** the import because its counts are outputs of the import
   * (`P1-T17`'s **Do NOT**, FR-8).
   *
   * @returns the toast's message, or `undefined` when no formatter is connected
   */
  async function renderImportOutcome(
    output: SearchImportOutput,
    input: SearchImportInput,
    startedAt: string,
  ): Promise<string | undefined> {
    const write = output.write;

    if (write === undefined) {
      // Nothing was written: either the run was cancelled before
      // `CreatingCollection` (FR-10's "cancel creates no items") or it failed.
      if (output.outcome === "cancelled") {
        publish({
          status: message("rh-error-cancelled", { imported: 0 }),
          progressPercent: undefined,
        });
        return undefined;
      }
      if (output.error !== undefined) {
        const action = errorView(output.error, "");
        publish({
          panel: "error",
          error: {
            headline: message("research-helper-search-state-error"),
            lines: [],
            details: errorDetails([output.error]),
            retry: action.retry,
            openPreferences: action.prefs,
          },
          progressPercent: undefined,
        });
      }
      return undefined;
    }

    // FR-51: created and linked-existing are reported separately, never summed.
    const summary = message("research-helper-import-summary", {
      imported: write.created,
      linked: write.linkedExisting,
      skipped: write.skipped,
      failed: write.failed,
    });
    // `R-17`'s measurement, as a whole-number percentage of created items.
    const coverage = message("research-helper-import-abstract-coverage", {
      percent: write.abstractCoveragePercent,
    });
    const cancelled =
      output.outcome === "cancelled"
        ? [message("rh-error-cancelled", { imported: write.created })]
        : [];
    publish({
      notices: [...cancelled, summary, coverage],
      status: summary,
      progressPercent: undefined,
    });

    const provenance = redactSearchProvenance(
      buildProvenance(output, input, {
        runId: `${String(deps.clock.now())}-${String(revision)}`,
        pluginVersion: deps.pluginVersion,
        zoteroVersion: deps.zoteroVersion,
        startedAt,
        finishedAt: new Date(deps.clock.now()).toISOString(),
      }),
    );
    // **`FR-8`'s third scenario needs this to still exist.** Before `P1-T36`
    // the next line was the last use of `provenance`: the record was handed to
    // the note writer and the handler returned. Assigned *after* the redaction
    // call and never before it, so the only thing this module can hold is the
    // record that is already safe to write.
    retained = provenance;

    const writeNote = deps.writeProvenanceNote;
    if (writeNote === undefined) {
      deps.logger.warn(
        "FR-8's provenance note was composed and redacted but not written: " +
          "no writeProvenanceNote port is bound. The binding is one line in " +
          "the composition root, which is outside P1-T22's Files list",
        { collectionKey: write.collectionKey, imported: write.created },
      );
    } else {
      try {
        const key = await writeNote(provenance);
        deps.logger.info("FR-8's provenance note written", { noteKey: key });
      } catch {
        // A failed note must not replace the summary the user is reading: the
        // items and the collection are written and kept (`docs/07` §7.4).
        deps.logger.warn("FR-8's provenance note could not be written");
      }
    }

    return text(summary);
  }

  const model: SearchImportViewModel = {
    get state(): SearchViewState {
      return state;
    },

    connect(next: SearchWindowView): () => void {
      view = next;
      // Started here and awaited by the first run — see ensureSourceNames().
      void ensureSourceNames();
      publish({});
      return (): void => {
        if (view === next) view = undefined;
      };
    },

    async runSearch(query: SearchWindowQuery): Promise<void> {
      // See {@link retained}: a search replaces what the window shows, so the
      // previous import's record stops being this window's record.
      retained = undefined;
      // Before the records are handed over, never after: the table's Source
      // column draws these as text.
      await ensureSourceNames();
      const running = await runJob(
        toPipelineInput(query, undefined, undefined),
        false,
      );
      if (running === undefined) return;
      renderSearchOutcome(running.output);
      running.finish(await searchToast(running.output));
    },

    async runImport(request: SearchWindowImportRequest): Promise<void> {
      // Cleared before the refusal below, not after it: an import the window
      // declined to start has not replaced the record, but it has also not left
      // the previous one describing what is on screen.
      retained = undefined;
      const target = resolveTarget(request);
      if (target === undefined) {
        // The document's Import gate already refuses this; a host driven
        // directly must refuse it too rather than write into a collection
        // nobody named. See `resolveTarget`.
        deps.logger.warn(
          "import refused: the target picker names no collection. The " +
            '"New collection…" path needs a name, and the document prompts ' +
            "for one",
        );
        return;
      }
      const duplicatePolicy = toDuplicatePolicy(request.duplicates);
      if (duplicatePolicy === undefined) {
        // The type forbids this and the document's three radios cannot produce
        // it, so reaching here is a programming error — a host driven directly
        // with the importer's word in the window's slot, which is exactly what
        // `phase1-dod.spec.ts` once did. Refused rather than defaulted: a
        // silent fall-back to `"link-existing"` would write something the
        // caller did not choose, and would hide the defect (`P1-T43`).
        deps.logger.warn(
          "import refused: the duplicate-policy value is not one the window " +
            "can produce, so no policy can be chosen for it",
          { duplicates: String(request.duplicates) },
        );
        return;
      }
      const startedAt = new Date(deps.clock.now()).toISOString();
      const input = toPipelineInput(
        request,
        {
          ...target,
          // This card's **Do NOT**: exactly the checked set, which the document
          // has already intersected with the *visible* rows, so a
          // hidden-but-checked row cannot vanish and a hidden row cannot be
          // written. With hiding off (`P1-T43`) an already-present row is
          // visible and checked, and `duplicatePolicy` decides what the
          // importer does with it.
          selectedRecordIds: request.records.map((record) => record.key),
          duplicatePolicy,
        },
        fetched,
        // The preview's own works, so the item written is the merged work the
        // row showed — every contributing source, every won field (`P2-T31`).
        previewed,
      );
      const running = await runJob(input, true);
      if (running === undefined) return;
      const toast = await renderImportOutcome(running.output, input, startedAt);
      running.finish(toast);
    },

    cancel(): void {
      // FR-10: the in-flight request is aborted and the main window stays
      // responsive. `cancel()` is synchronous and the token's callbacks run
      // synchronously inside it, so the 2 s budget belongs to the HTTP layer
      // alone.
      source?.cancel({ kind: "user" });
    },

    async exportProvenance(path: string): Promise<ProvenanceExportOutcome> {
      // **The path is never in a log line, and that is a question rather than a
      // rule.** `docs/09` has no statement about writing a chosen filesystem
      // path to the debug log: §2.1 is about credentials, §2.2 about the debug
      // bundle, and §3.2's egress table lists "file paths" only among what is
      // *not* sent to an LLM provider. A path can carry an account name, so
      // `P1-T36`'s **Do NOT** is followed to the letter here and the question
      // is recorded in the report instead of answered by this file.
      const files = deps.provenanceFiles;
      if (path === "") {
        deps.logger.warn("FR-8's JSON export was asked for no destination");
        return "no-path";
      }
      if (retained === undefined) {
        // Criterion 4: no record, no file. An empty or half-built file on disk
        // would be worse than a refusal, because a user would keep it.
        deps.logger.warn(
          "FR-8's JSON export was asked for, and nothing has been imported " +
            "since the current run started, so there is no record to write",
          { panel: state.panel },
        );
        return "no-record";
      }
      if (files === undefined) {
        deps.logger.warn(
          "FR-8's JSON export has a record but no file-writing port is " +
            "bound, so nothing was written",
        );
        return "no-writer";
      }
      try {
        // `exportJson` and `serializeProvenance` unchanged (`P1-T36`'s last
        // **Do NOT**): they were written for this caller, and this is the
        // caller arriving.
        await exportJson(path, retained, files);
      } catch {
        deps.logger.warn(
          "FR-8's JSON export could not be written; the destination is not " +
            "logged (see this method's comment)",
          { runId: retained.runId },
        );
        return "failed";
      }
      deps.logger.info("FR-8's provenance JSON written", {
        runId: retained.runId,
      });
      return "written";
    },

    get host(): SearchWindowHostApi {
      return {
        listSources: (): readonly SourceDescriptor[] => descriptors(),
        listCollections: (): readonly CollectionDescriptor[] =>
          deps.listCollections?.() ?? [],
        getPrefs: (): Readonly<Record<string, unknown>> =>
          deps.getPrefs?.() ?? {},
        connect: (next: SearchWindowView): (() => void) => model.connect(next),
        runSearch: (query: SearchWindowQuery): Promise<void> =>
          model.runSearch(query),
        runImport: (request: SearchWindowImportRequest): Promise<void> =>
          model.runImport(request),
        cancel: (): void => {
          model.cancel();
        },
        exportProvenance: (path: string): Promise<ProvenanceExportOutcome> =>
          model.exportProvenance(path),
      };
    },
  };

  return model;
}
