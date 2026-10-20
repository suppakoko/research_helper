/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T22` — the window driving the pipeline, end to end, in a live Zotero.
 * `P1-T35` — the same path, through the host the **plugin itself** publishes.
 *
 * ## Three `describe` blocks, and why each exists
 *
 * `P2-T25`'s block runs first and opens no window: it is the one place in the
 * suite where the **real** PubMed adapter, the **real** `createHttpClient` and
 * Gecko's own `DOMParser` run over **recorded** NCBI responses inside Zotero,
 * through `test/support/fixtureReplay.ts`. See "The replay harness, and what it
 * does and does not replace here" below for why the two window blocks keep
 * their stub source.
 *
 * `P1-T35` publishes the host at startup, so there are two different things
 * worth asserting about the window and they need different fixtures:
 *
 * - **`P1-T35`'s block runs first** and drives the *published* host: the real
 *   service graph, the real source registry, the real pipeline, the real
 *   writer, and the `isExisting` / `writeProvenanceNote` bindings the
 *   composition root made. Nothing of that path comes from this file. Its stub
 *   source is swapped into the **real** registry *in place of* the real PubMed
 *   adapter through `SourceRegistry.replaceForTest` (`P2-T26`), and the real
 *   adapter is put back in `after()` — see {@link PUBLISHED_STUB}.
 * - **`P1-T22`'s block keeps its own host**, because the state machine it
 *   covers needs a stub that *is* `pubmed`: forced 429s, an injected
 *   `OfflineError`, a 40-record fetch to cancel mid-flight, and the one
 *   localized source display name any bundle declares
 *   (`research-helper-source-pubmed`). Those cannot be reached through the real
 *   registry, which already holds the real PubMed adapter under that id.
 *
 * None of the three blocks makes an HTTP request.
 *
 * ## What is real here and what is a double
 *
 * **Real:** the window document and its controller; `P1-T22`'s view model;
 * `P1-T16`'s `searchImport` pipeline, every stage of it; `P1-T15`'s
 * `CompositeProgressReporter` and its observable sink; `P1-T02`'s typed errors;
 * `P1-T12`/`P1-T14`'s `importWorks()` writing into a **real Zotero library**;
 * `P1-T13`'s library index; `P1-T17`'s provenance record, its redaction gate and
 * its note writer; `P1-T18`'s Fluent bundles, resolved through the window's own
 * `document.l10n`.
 *
 * **Doubled:** the literature sources. Every record below comes from a stub
 * `LiteratureSource` declared in this file — or, in the `P2-T25` block and
 * `P1-T22`'s `P2-T36` case, from the real PubMed adapter over **recorded**
 * responses — so **no HTTP request is made by this spec at all** — not to
 * NCBI, not to anywhere. `docs/02` §3.1's usage policy
 * makes a repeated live search the wrong way to exercise a state machine, and
 * the one failure mode a live source could add (a real 429) is injected here as
 * the typed error the adapter would have thrown.
 *
 * ## The replay harness, and what it does and does not replace here (`P2-T25`)
 *
 * **Corrected 2026-10-13.** This section used to say the replay transport "is
 * **not** usable from here: it imports `node:fs/promises` and `node:crypto`,
 * neither of which exists in the Zotero sandbox". Both imports are gone:
 * `test/support/fixtureReplay.ts` is the harness with no platform import,
 * `test/support/fixtureIo.zotero.ts` reads fixtures through `IOUtils`, and the
 * `P2-T25` block below runs the shipped adapter and the shipped HTTP client over
 * the committed `test/fixtures/pubmed/` corpus inside this very runner.
 *
 * **What the harness still cannot replace is the window's source, and the
 * reason is the corpus, not the harness.** A fixture is found only when the
 * request matches the recorded one byte for byte, and the window cannot issue a
 * request the corpus holds:
 *
 * - `toPipelineInput` in `src/ui/viewModels/searchImportViewModel.ts` renders
 *   the two year menulists as whole years (`YYYY-01-01` … `YYYY-12-31`); every
 *   recorded `esearch` carries the quarter `2023/01/01`–`2023/03/31`.
 * - `PREFS.maxResults` in `src/prefs/schema.ts` has `min: 10`, which
 *   `validate` in `searchImportPipeline.ts` enforces on `limit`; the only
 *   `esearch` + `efetch` chains on disk are the two `paginated-*` pages at
 *   `retmax=3`. `search-typical` (`retmax=20`) has no `efetch` for its ids.
 *
 * So the two window blocks keep the stub: forced 429s, an injected
 * `OfflineError`, a 40-record fetch to cancel and three present rows to re-link
 * are states a recorded corpus of seventeen files does not hold, and
 * re-recording is a network decision with an owner (`P2-T25`'s **Do NOT**).
 * The real adapter and client are exercised in the `P2-T25` block up to the
 * `LiteratureSource` boundary — the same boundary the stub stands at — and the
 * window blocks exercise everything above it.
 *
 * **Changed 2026-10-15 (`P2-T36`, owner review of 2026-10-14 row 74): the
 * window now replays the real adapter once.** The owner approved recording
 * the two fixtures the window *can* ask for — `window-esearch`, one closed
 * year (2023) at `retmax=10`, and `window-efetch`, its ten records — defined
 * once in `test/support/pubmedRecordedRequests.ts` and recorded through the
 * committed recorder. `P1-T22`'s last case swaps the real `createPubmedSource`
 * over `createReplayHttpClient` into its registry's `pubmed` slot
 * (`replaceForTest`), sets the window to that keyword, year and size, and
 * asserts the window, the pipeline and the transport end to end. **Every other
 * case in that block keeps the stub**, for the reason above, which two
 * fixtures do not change: each scripts a count (2, 3, 4, 40), an error or a
 * delay that one recorded answer of ten records cannot produce, so moving them
 * would have meant rewriting their assertions — which the card forbids.
 *
 * **Written into a real library:** one collection per import test, its items, and
 * one provenance note. All of them are erased in `after()` — the discipline
 * `test/integration/zotero/importer.spec.ts` uses — and the erase never fails
 * the run.
 *
 * ## The host
 *
 * **Corrected 2026-10-07 (`P1-T35`).** This section used to read: "Nothing
 * publishes `Zotero.<addonInstance>.api.searchWindow` in the shipped build:
 * `src/addon.ts` sets `api = {}` and `src/bootstrap/registerUI.ts` discards the
 * `ServiceGraph` on purpose. Neither file is in `P1-T22`'s `Files` list, so
 * this spec builds the host out of the same three pieces the composition root
 * would use, and **this is the only place the end-to-end path runs today**."
 *
 * Both halves of that are now false. `registerUI()` holds the graph at
 * `addon.api.services`, builds the host from `createSearchImportViewModel` with
 * every optional dependency bound, and publishes it at
 * `SEARCH_WINDOW_API_PROPERTY` through the root `Scope` — so the path runs in a
 * plain Zotero with no spec present, and the first `describe` below asserts
 * exactly that. `P1-T22`'s block still installs its own host, and
 * {@link savedApi} is now the *published* one it puts back afterwards rather
 * than `undefined`.
 *
 * See `SEARCH_WINDOW_API_PROPERTY` in `src/ui/dialogs/searchDialog.ts` — whose
 * own doc comment still says nothing publishes it. That file is outside
 * `P1-T35`'s `Files` list, so the correction is **reported with the card**
 * rather than made here (`plan/README.md` §5 rule 2).
 *
 * ## This suite flakes, and here is the measurement (2026-10-07)
 *
 * Three tests in `P1-T22`'s block below fail on most runs, on the machine this
 * was measured on, and the failure is **not** caused by anything in `P1-T35`'s
 * block. Recorded here because the natural first guess is that the newer block
 * broke the older one, and that guess was made, tested and refuted rather than
 * reasoned about.
 *
 * Twenty-eight full runs plus five matched pairs, 2026-10-07/08:
 *
 * | tree | full runs | all passed | 2 failed | 3 failed |
 * |---|---|---|---|---|
 * | before `P1-T35` (nothing published, this block absent) | 13 | 6 | 3 | **4** |
 * | `P1-T35` published, this block absent | 6 | 1 | 0 | 5 |
 * | `P1-T35` complete | 6 | 1 | 1 | 4 |
 *
 * **The tree as it stood before `P1-T35` produces the identical three
 * failures**, with the identical messages, in four of its thirteen runs, and two
 * of the three in three more. Five further runs alternated the two trees back to
 * back — a matched pair at a time, so that drift in machine state over a session
 * cannot be mistaken for a code effect — and every pair came out the same way:
 * pair 1 green on both, pairs 2 to 5 red on both.
 *
 * The three:
 *
 * - `cancels a fetch within 2 s and creates nothing (FR-10)` times out waiting
 *   for Fluent to put `"of 1"` into `#rh-search-progress-databases`.
 * - `reports linked-existing separately from created (FR-51)` times out waiting
 *   for Fluent to put `"Linked 3"` into `#rh-search-notice`. **Same cause as the
 *   first, not a cascade of it**: one run had it *pass* at 17,593 ms, under the
 *   25,000 ms cap, while the cancel test failed in that same run.
 * - `asks for the popup on completion and names the outcome once per run` is the
 *   one genuine cascade — it counts cancelled runs, and the cancel test never
 *   reached its `cancel()`.
 *
 * **The discriminator is how long Fluent takes in this window, and it is
 * bimodal per run.** The first test in `P1-T22`'s block costs about 30 ms in
 * every passing run and about 1,010 ms in nearly every failing one, and the cost
 * then roughly doubles per test — 1.0 s, 2.0 s, 4.0 s, 8.0 s — until the import
 * lands on 22.92–22.99 s against that 25,000 ms cap, in 21 of the 25 runs that
 * reached it. {@link rendered} waits on text that the run has already replaced by
 * the time the translation lands. The slow mode is necessary but not sufficient:
 * two runs took 1,008 ms on the first test and still passed everything.
 *
 * Two candidate causes were measured and **refuted**, so neither is worth
 * retrying:
 *
 * - *Background-timer clamping of the runner's window.* `Zotero.Promise.delay(25)`
 *   was timed inside a failing run and delivered 29–33 ms, six samples. The
 *   polling granularity is fine.
 * - *The application locale left on `ko-KR` by `l10n.spec.ts`.* Identical in
 *   passing and failing runs: `restored intl.locale.requested (user value
 *   false); app ["ko-KR","en-US"]` in both. Worth knowing on its own — every
 *   later spec renders through a chain that falls back to `en-US` for every id
 *   the Korean bundle lacks — but it does not discriminate.
 *
 * Fixing this means changing what `P1-T22`'s tests wait **on** — a view-state
 * tap rather than rendered text, for the states that are transient — and that is
 * its own card, not `P1-T35`'s.
 *
 * ## What `P1-T46` changed, and what it deliberately did not (2026-10-12)
 *
 * **Reproduced first, then removed by construction.** The first run of the
 * unchanged tree on this machine produced all three failures with the messages
 * quoted above, the second was green, and the discriminator was again the
 * per-test cost: `1,043 ms` on the first test of this block in the red run
 * against `31 ms` in the green one, then `940 → 2,024 → 4,002 → 8,028 ms` and
 * a `22,914 ms` import that passed by two seconds. So the slow mode is real,
 * it is not caused by anything a test does, and **the doubling is still
 * there** — `P1-T46` made the tests honest and left the window's speed as the
 * separate, still-unanswered question it is.
 *
 * What changed is only what the two primary waits **observe**:
 *
 * - The tap records the **sequence** of published states
 *   ({@link publishedStates}, bounded by {@link PUBLISHED_STATE_LIMIT}) rather
 *   than only the latest, so a fact the run has already replaced is still
 *   there to be asserted.
 * - Each rewritten surface gets **three** observations instead of one:
 *   {@link assertPublished} for what the view model decided,
 *   {@link pointedAt} for the two attributes the document set, and
 *   {@link resolved} for the text the bundle produces. None of the three can
 *   expire against a value that has gone.
 * - **The text half was kept everywhere**, deliberately: a state assertion
 *   cannot see the blank-surface defect `P1-T22` measured — an id whose
 *   resource is unlinked resolves to nothing and leaves the element alone —
 *   and converting all of these would have traded a flaky test for a blind
 *   one. `#rh-search-status` keeps a real rendered-text wait in the document,
 *   on the terminal row no later state replaces.
 * - No timeout was touched, including {@link waitUntil}'s 25,000 ms default,
 *   and no production file was changed.
 *
 * ## What `P1-T43` changed (2026-10-13)
 *
 * The owner decided on 2026-10-08 that an already-present paper is **shown,
 * marked**, and that `docs/08` §4.4's duplicate control decides what happens to
 * it. Before this card the control was collected and dropped — the window said
 * `skip` / `link` / `import`, the importer says `"skip"` / `"link-existing"` /
 * `"import-anyway"`, the window-facing member was a `string`, and no caller
 * ever supplied `ImportRequest.duplicatePolicy`. Now `SearchWindowQuery.duplicates`
 * is the three-value union `SearchWindowDuplicates`, the view model maps it
 * through `DUPLICATE_POLICY_BY_CHOICE` onto `SearchImportTarget.duplicatePolicy`,
 * and the production writer passes it to `importWorks()`.
 *
 * In `P1-T22`'s block, four tests carry that:
 *
 * - the radiogroup's values are asserted to be **exactly** the union, because
 *   the markup is an asset nothing typechecks and this is the only binding;
 * - the FR-51 re-import test switches hiding **off explicitly** rather than
 *   reading the default, asserts the three present rows render with the row
 *   class, the badge and the words (never exercised before, because a marked
 *   row was hidden by default), and imports under `link`;
 * - two new tests import the same rows under `skip` and under `import`, and the
 *   report's own counts are the assertion — `Skipped 4` with one item in the
 *   collection, then `Imported 5` with five;
 * - a host driven with the importer's word in the window's slot (what
 *   `phase1-dod.spec.ts` carried until this card) is **refused**, not defaulted.
 *
 * **What this test asserted before, for the record:** that `hideExisting`
 * starts ticked, that three of four rows were therefore gone, and that unticking
 * brought them back. The first of those is still asserted once, in `P1-T35`'s
 * `marks the imported records as already in the library`, because the shipped
 * default is still `true` — flipping it needs `addon/prefs.js`, `docs/07` §8.5
 * and two unit tests outside this card's `Files`, and is reported with the card.
 *
 * ## What this file does not check
 *
 * - **Nobody looked at the window.** Every assertion below is a computed value
 *   read out of a live document — rendered text, element visibility, a
 *   wall-clock duration — and none of it is a judgement about appearance. Light
 *   and dark were not compared; `P1-T20` did that once in a throwaway profile
 *   and it is not repeated per card.
 * - **The "New collection…" prompt is not opened.** `Services.prompt.prompt()`
 *   is modal and would block the run until Mocha's timeout, so the picker half
 *   is driven through `adoptNewCollection(name)` — the seam that exists for
 *   exactly this — and the prompt itself is **unexercised**.
 * - **The progress throttle is turned off.** The job factory here passes
 *   `throttleMs: 0`, so every snapshot reaches the view. In the product the
 *   reporter coalesces at 250 ms (`PROGRESS_REPAINT_INTERVAL_MS`), which can skip
 *   an intermediate per-database line; the authoritative list is the one built
 *   from `output.perSource` at the end, which is what the assertions read.
 */

import { config } from "../../package.json";
// The shipped artefact itself, bundled into this spec by esbuild. `docs/13`
// §1.2 and `src/core/provenance.ts`'s `PROVENANCE_SCHEMA_PATH` name this path,
// and `node:fs` does not exist in the Zotero sandbox, so the only way an
// integration spec can hold the schema is to import it.
import PROVENANCE_SCHEMA from "../../schema/provenance.schema.json";
// Type-only, so nothing of `src/addon.ts` — and nothing of the `hooks` module
// it imports — is bundled into this spec. The *values* this block reads all
// come off the live plugin instance, which is the only copy that matters:
// a spec is bundled separately from the plugin, so an imported module would be
// a second instance with none of the plugin's state.
import type { PluginApi } from "../../src/addon";
import { createScope } from "../../src/bootstrap/container";
import { createZoteroSearchImportWriter } from "../../src/bootstrap/registerPipelines";
import { createSystemClock } from "../../src/core/clock";
import { Semaphore } from "../../src/core/concurrency";
import {
  OfflineError,
  RateLimitError,
  UpstreamServerError,
} from "../../src/core/errors";
import { createCancellationTokenSource } from "../../src/core/jobQueue/cancellation";
import { createLogger } from "../../src/core/logger";
import {
  CompositeProgressReporter,
  createObservableProgressSink,
} from "../../src/core/jobQueue/progress";
import { NCBI_HOST } from "../../src/core/rateLimit/hostLimiter";
import type { CanonicalWork } from "../../src/model/canonicalWork";
import { normalizeDoi, type SourceId } from "../../src/model/ids";
import type { SourceRecord } from "../../src/model/sourceRecord";
import { createSearchImportPipeline } from "../../src/pipeline/searchImport/searchImportPipeline";
import { NETWORK_METADATA_POOL_SIZE } from "../../src/pipeline/searchImport/stages";
import type {
  SearchImportInput,
  SearchImportOutput,
  SearchImportWriter,
} from "../../src/pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../src/pipeline/types";
import { createPubmedRecordMapper } from "../../src/sources/pubmed/mapper";
import {
  DEDUP_CORPUS_PUBMED_NO_RECORDS,
  DEDUP_CORPUS_SEARCHES,
} from "../support/dedupCorpusRecordedRequests";
import {
  createPubmedSource,
  parseEsearchBody,
} from "../../src/sources/pubmed/pubmedSource";
import {
  createSourceRegistry,
  type SourceRegistry,
} from "../../src/sources/registry";
import type {
  LiteratureSource,
  SourceCallContext,
  SourcePage,
  SourceQuery,
} from "../../src/sources/types";
import {
  SEARCH_WINDOW_API_PROPERTY,
  SEARCH_WINDOW_DUPLICATES,
  SEARCH_WINDOW_URL,
  openSearchWindow,
  type SearchWindowDuplicates,
  type SearchWindowHandle,
  type SearchWindowImportRequest,
  type SearchWindowRecord,
} from "../../src/ui/dialogs/searchDialog";
import {
  DEDUP_TIER_NAME_KEYS,
  UNRENDERABLE_ERROR_ROWS,
  createSearchImportViewModel,
  message,
  type MessageRef,
  type SearchImportJobFactory,
  type SearchImportViewModelDeps,
  type SearchViewState,
  type SearchWindowHostApi,
} from "../../src/ui/viewModels/searchImportViewModel";
import { DEFAULT_CHUNK_SIZE } from "../../src/zotero/importer";
import {
  buildLibraryIndex,
  type LibraryIndex,
} from "../../src/zotero/libraryIndex";
import {
  PROVENANCE_NOTE_TITLE_PREFIX,
  writeProvenanceNote,
} from "../../src/zotero/notes";
import { qualifiedPrefName } from "../../src/zotero/prefStore";
import { notifierRegistration } from "../../src/zotero/registrations";
// The replay harness, platform-free, and its Zotero file port. Never
// `test/contract/_transport.ts` from here: that is the Node face and it imports
// `node:fs/promises`, which the scaffold's bundler cannot resolve for the
// sandbox — the bundle fails to build, which is the right failure.
import {
  repositoryFixtureDir,
  zoteroFixtureIo,
} from "../support/fixtureIo.zotero";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureKey,
  FROZEN_NOW_EPOCH_MS,
  type ReplayHttpClient,
} from "../support/fixtureReplay";
import {
  PUBMED_PAGE_SIZE,
  PUBMED_SYNTHETIC_429_QUERY,
  PUBMED_SYNTHETIC_500_QUERY,
  PUBMED_TYPICAL_QUERY,
  PUBMED_WINDOW_KEYWORD,
  PUBMED_WINDOW_MAX_RESULTS,
  PUBMED_WINDOW_YEAR,
  pubmedWindowQuery,
  recordedEsearchRequest,
} from "../support/pubmedRecordedRequests";
import { sha256Hex, toHex } from "../support/sha256";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function before(body: (this: TestContext) => Promise<void>): void;
declare function after(body: (this: TestContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T22]";
/** The second block's prefix, so the two blocks' lines are greppable apart. */
const LOG_PREFIX_T35 = "[P1-T35]";

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

function log35(line: string): void {
  debug(`${LOG_PREFIX_T35} ${line}`);
}

// ---------------------------------------------------------------------------
// 1. The stub sources
// ---------------------------------------------------------------------------

/** How one stub source behaves for the next search. */
interface StubBehaviour {
  /** Records to yield before anything else happens. */
  readonly records: number;
  /** Thrown after `records` have been yielded. */
  readonly error?: Error;
  /** Milliseconds to wait before each record — the cancellation window. */
  readonly delayMs?: number;
  /** Whether each record carries an abstract (`R-17`'s coverage figure). */
  readonly withAbstract?: boolean;
  /**
   * A DOI stem minted identically by every source given the same value, so
   * two sources return the **same work** (`P2-T31`): record `n` of each
   * carries `10.5555/<sharedWork>-<n>` instead of its own per-source DOI, and
   * the cascade's identifier tier folds the pair into one row. Keep the stem
   * distinct per test; the DOI is what the library index matches on.
   */
  readonly sharedWork?: string;
}

const IDLE: StubBehaviour = { records: 0 };

/**
 * A branded `Doi` for a stub record.
 *
 * `normalizeDoi` is the only route to the brand (`docs/07` §5.1) and it is also
 * the shape check, so a typo in the fixture fails here instead of silently
 * importing an item with no identifier and no library-duplicate match.
 */
function doiOf(nativeId: string): NonNullable<ReturnType<typeof normalizeDoi>> {
  const doi = normalizeDoi(`10.5555/${nativeId}`);
  if (doi === null) {
    assert.fail(`the stub DOI for "${nativeId}" is not DOI-shaped`);
  }
  return doi;
}

/** One stub record, shaped as `docs/07` §5.1's `SourceRecord`. */
function stubRecord(
  sourceId: SourceId,
  n: number,
  withAbstract: boolean,
  sharedWork?: string,
): SourceRecord {
  const nativeId = `p1t22-${sourceId}-${String(n)}`;
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
    work: {
      ids: {
        doi: doiOf(
          sharedWork === undefined ? nativeId : `${sharedWork}-${String(n)}`,
        ),
      },
      type: "journal-article",
      title: `Ionizable LNP delivery to hepatocytes, study ${String(n)}`,
      ...(withAbstract && {
        abstract: `A stub abstract for study ${String(n)}.`,
      }),
      authors: [{ family: "Kim", given: "J" }, { family: "Park" }],
      publishedDate: { year: 2025, iso: "2025" },
    },
  };
}

/** A `LiteratureSource` whose behaviour this spec rewrites between tests. */
function stubSource(
  id: SourceId,
  displayNameKey: string,
  read: () => StubBehaviour,
): LiteratureSource {
  return {
    id,
    displayNameKey,
    rateLimitKey: `${id}.invalid`,
    capabilities: {
      keywordSearch: true,
      query: {
        or: true,
        not: true,
        phrase: true,
        fields: ["title", "abstract", "author"],
      },
      relatedByWork: false,
      lookupById: ["doi"],
      abstractsInSearch: true,
      citationGraph: false,
      // False on purpose: it routes every run through FR-3's **client-side**
      // recency filter, which is the branch that records
      // `dateFilterApplied: "client"` in the provenance record.
      dateFilter: false,
      filters: { languages: false, openAccess: false },
      maxPageSize: 100,
      maxTotalResults: undefined,
      benefitsFromApiKey: false,
    },
    isConfigured: () => true,
    healthCheck: () =>
      Promise.resolve({
        ok: true,
        messageKey: "rh-error-source",
        latencyMs: 0,
      }),
    search: (): Promise<SourcePage> => {
      assert.fail("the pipeline must paginate through searchAll, not search()");
    },
    searchAll(_query: SourceQuery, ctx: SourceCallContext) {
      const behaviour = read();
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<SourceRecord> {
          for (let n = 0; n < behaviour.records; n += 1) {
            if (behaviour.delayMs !== undefined) {
              await Zotero.Promise.delay(behaviour.delayMs);
            }
            // What a real adapter reports, and the signal the view model latches
            // as "this source is at N" (`searchingLines`).
            ctx.progress?.setProgress(n + 1, behaviour.records);
            yield stubRecord(
              id,
              n,
              behaviour.withAbstract === true,
              behaviour.sharedWork,
            );
          }
          if (behaviour.error !== undefined) {
            throw behaviour.error;
          }
        },
      };
    },
    explainQuery: (query: SourceQuery) => `stub(${String(query.limit)})`,
  };
}

// ---------------------------------------------------------------------------
// 2. The window, and the controller inside it
// ---------------------------------------------------------------------------

/** The slice of `RHSearchWindow` this spec drives. */
interface FlowController {
  /** What `resolveHost()` resolved to, for `P1-T35`'s identity assertion. */
  readonly host: unknown;
  readonly state: {
    initialized?: boolean;
    panel: string;
    running: boolean;
    selectedCount: number;
    rows: { key: string }[];
    visible: { key: string }[];
    detailsOpen: boolean;
    /** `P1-T45`. Neither ever holds the chosen path. */
    exportAvailable: boolean;
    exportMessage: string | null;
  };
  readonly logic: {
    targetNamed(value: unknown): boolean;
    importEnabled(count: number): boolean;
    /** `P1-T45`. */
    exportFileName(nowEpochMs: number): string;
  };
  /** `P1-T45`: FR-8's third scenario, driven from the document. */
  exportProvenance(): Promise<string>;
  /**
   * The half that opens the save dialog, replaceable for the reason
   * `promptForCollectionName` is split out of `newCollection`: a modal in an
   * integration run blocks until the whole suite times out.
   */
  pickExportPath(): Promise<string>;
  /** `P1-T45`: Zotero's own file-picker module, as a URL. */
  readonly filePickerModule: string;
  search(): void;
  import(): void;
  /** What `import()` hands the host: the query plus the checked ∩ visible rows. */
  collectImportRequest(): SearchWindowImportRequest;
  cancel(): void;
  applyFilter(): { total: number; new: number; selected: number };
  adoptNewCollection(name: string): string;
  toggleDetails(): boolean;
  refreshSearchGate(): { enabled: boolean };
  rowCheckboxes(): { checked: boolean; dispatchEvent(event: Event): boolean }[];
  sourceBoxes(): {
    getAttribute(name: string): string | null;
    checked: boolean;
  }[];
}

/** The opened chrome window, with the members `SearchWindowHandle` omits. */
interface FlowWindow extends SearchWindowHandle {
  readonly document: Document;
  readonly RHSearchWindow?: FlowController;
  close(): void;
  Event: typeof Event;
}

let win: FlowWindow | undefined;
let doc: Document;
let controller: FlowController;
let savedApi: unknown;
/**
 * `P1-T22`'s private registry, held so `P2-T36`'s case can put the **real**
 * PubMed adapter into the `pubmed` slot for one search and put the stub back
 * (`SourceRegistry.replaceForTest`, `P2-T26`).
 */
let p1t22Sources: SourceRegistry | undefined;
/** Per-source behaviour for the next search, rewritten by each test. */
const behaviour = new Map<SourceId, StubBehaviour>();
/**
 * Every output `P1-T22`'s pipeline returned, in order — the preview's
 * `works` are otherwise unobservable from outside the view model, and
 * `P2-T31`'s criterion compares the written work against them.
 */
const pipelineOutputs: SearchImportOutput[] = [];
/** Every `CanonicalWork` `P1-T22`'s writer was handed, across batches. */
const writtenWorks: CanonicalWork[] = [];
/** The last state the view model published, for assertions about the model. */
let lastState: SearchViewState | undefined;
/**
 * **Every** state the view model published, most recent last (`P1-T46`).
 *
 * The tap below used to keep only {@link lastState}, which is enough for a fact
 * that is still true when the assertion runs and useless for one that is not.
 * Two of this block's assertions are about **transient** facts — §4.5's
 * per-database counter, which `renderSearchOutcome` sets back to `undefined` at
 * the end of every run, and the import summary, which the next run replaces —
 * and waiting for Fluent to put either of them into the document is a race the
 * test loses whenever the translation lands after the value has gone. Measured
 * three times (`P1-T22`, `P1-T35`, `P1-T36`) and reproduced once more while
 * this card was executed. A recording cannot lose a fact that was published.
 */
const publishedStates: SearchViewState[] = [];
/**
 * How many states the recording keeps, dropping the oldest beyond it.
 *
 * **500, and the bound matters rather than the number.** An unbounded array
 * would grow with the run: the throttle is off in this spec (`throttleMs: 0`,
 * see the file header), so every progress snapshot publishes, and the longest
 * fetch in this block is 40 records — one state per record plus a handful per
 * stage. **Measured rather than guessed:** the two tests that read the
 * recording log how many states they published, and across the runs this card
 * made it is **5** for the cancelled fetch and **13** for the re-import, so
 * 500 is roughly forty times the worst case observed and still a fixed
 * ceiling. Each entry is a shallow object whose arrays are the ones the view
 * model already holds, so the ceiling is cheap. {@link statesSince} **fails
 * loudly** rather than silently returning a short window if a test ever
 * outgrows it, so the bound can never turn into a wrong answer.
 */
const PUBLISHED_STATE_LIMIT = 500;
/** How many states have been published in all, including dropped ones. */
let publishedStateCount = 0;
/** The library index behind the `isExisting` port; rebuilt by `refreshIndex()`. */
let index: LibraryIndex;
/** Collection keys this spec created, erased in `after()`. */
const createdCollections: string[] = [];
/**
 * Every `openOn` the view model asked for, and every terminal `done()` call.
 *
 * This is how step 6 — "raise the completion `ProgressWindow` toast only at the
 * end, per §4.4" — is checked at all. The spec's job factory builds no popup
 * sink (that needs `installServices`, which refuses a second graph), so what is
 * observable is the *contract* the view model asks the factory for: the popup is
 * opened on completion, and `done()` is called once per run with the summary as
 * its message.
 */
const openOnAsked: (string | undefined)[] = [];
const doneCalls: { outcome: string; message: string | undefined }[] = [];
/**
 * How many runs have gone from `running` to not-`running`.
 *
 * **Counted rather than polled, and the reason is a defect this harness had.**
 * The first version waited for `running === true` and then for `running ===
 * false`. A stub source with no delay finishes a three-record run in **under 25
 * ms**, which is one poll interval, so six tests timed out waiting for a run to
 * *start* that had already finished — while the one test with a slow source
 * passed. A counter cannot miss a transition that happened between two polls.
 */
let runsFinished = 0;
let wasRunning = false;

const PUBMED: SourceId = "pubmed";
const CROSSREF: SourceId = "crossref";
const KEYWORD = "ionizable lipid nanoparticle";

function pluginApi(): Record<string, unknown> {
  const instance = (Zotero as unknown as Record<string, unknown>)[
    config.addonInstance
  ] as { api?: Record<string, unknown> } | undefined;
  if (!instance) {
    assert.fail(`Zotero.${config.addonInstance} is not installed`);
  }
  instance.api ??= {};
  return instance.api;
}

/**
 * Poll until `predicate` holds.
 *
 * **25 s, not 10 s**, and that is measured rather than cautious: with the suite
 * green every test here finishes in under 30 ms, but under load — this card's
 * mutation sweep ran nine full suites back to back — individual Fluent renders
 * took seconds and three mutants produced *extra* failures from a 10 s cap
 * rather than from the mutation. A cap that can expire on a loaded machine turns
 * a green suite into a coin toss, which is worse than a slow one.
 */
async function waitUntil(
  predicate: () => boolean,
  what: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(25);
  }
}

function el(id: string): Element {
  const found = doc.getElementById(id);
  if (!found) {
    assert.fail(`#${id} is not in the search window`);
  }
  return found;
}

function textOf(id: string): string {
  return (doc.getElementById(id)?.textContent ?? "").trim();
}

/**
 * Wait for Fluent to have put `needle` into the element at `id`.
 *
 * **Only safe on a value that is still the current one when the wait ends**
 * (`P1-T46`). The view model replaces §4.5's counter and the import summary
 * during a run, and `renderMessageList`/`clearRef` take the previous text with
 * them, so this wait on either of those loses its needle rather than waiting
 * for it. Those two now go through {@link assertPublished}, {@link pointedAt}
 * and {@link resolved} instead. What is left here is `#rh-search-status`'s
 * terminal row, which the run does not touch again.
 */
async function rendered(id: string, needle: string): Promise<string> {
  await waitUntil(
    () => textOf(id).includes(needle),
    `Fluent to render "${needle}" into #${id} (it reads "${textOf(id)}")`,
  );
  return textOf(id);
}

// ---------------------------------------------------------------------------
// 2b. The published-state recording, and the three observations it enables
//     (`P1-T46`)
// ---------------------------------------------------------------------------

/** Add one published state to {@link publishedStates}, oldest first out. */
function recordState(state: SearchViewState): void {
  publishedStateCount += 1;
  publishedStates.push(state);
  if (publishedStates.length > PUBLISHED_STATE_LIMIT) {
    publishedStates.shift();
  }
}

/**
 * A mark in the published sequence, for {@link statesSince}.
 *
 * Taken immediately before the action under test, so an assertion is about the
 * states *that action* published and never about a leftover from an earlier
 * test — which matters here, because the window and the view model are shared
 * by every test in this block.
 */
function markStates(): number {
  return publishedStateCount;
}

/** Every state published since `mark`, in order. */
function statesSince(mark: number): readonly SearchViewState[] {
  const firstHeld = publishedStateCount - publishedStates.length;
  if (mark < firstHeld) {
    assert.fail(
      `the recording keeps only the last ${String(PUBLISHED_STATE_LIMIT)} ` +
        `published state(s) and has already dropped ` +
        `${String(firstHeld - mark)} of the ones published since the mark, ` +
        `so this assertion cannot be answered: raise PUBLISHED_STATE_LIMIT`,
    );
  }
  return publishedStates.slice(mark - firstHeld);
}

/**
 * One message reference as a comparable, order-independent string.
 *
 * The arguments are sorted by name rather than compared as JSON, so a
 * reordering of an object literal in the view model is not a test failure while
 * a changed id, a changed argument name and a changed argument value all are.
 */
function refKey(
  id: string,
  args: Readonly<Record<string, string | number>> | undefined,
): string {
  if (args === undefined) return id;
  const named = Object.entries(args)
    .map(([name, value]) => `${name}=${String(value)}`)
    .sort()
    .join(",");
  return `${id}(${named})`;
}

/** The same key, read off an element's two Fluent attributes. */
function pointerKey(element: Element): string | undefined {
  const id = element.getAttribute("data-l10n-id");
  if (id === null) return undefined;
  const raw = element.getAttribute("data-l10n-args");
  if (raw === null || raw === "") return refKey(id, undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return `${id}(unparseable args ${raw})`;
  }
  if (parsed === null || typeof parsed !== "object") {
    return `${id}(non-object args ${raw})`;
  }
  return refKey(id, parsed as Readonly<Record<string, string | number>>);
}

/**
 * Assert that some state published since `mark` carried `expected`.
 *
 * This is the half of the trade `P1-T46` buys: it checks **what the view model
 * decided**, which is a stronger claim than the rendered text, because the
 * identifier and its arguments are both in it and `message()` type-checks the
 * arguments at the call site. It is also the half that stops checking that
 * Fluent resolved anything, which is why every surface below keeps a text
 * assertion as well.
 */
function assertPublished(
  mark: number,
  pick: (state: SearchViewState) => readonly (MessageRef | undefined)[],
  expected: MessageRef,
  what: string,
): void {
  const states = statesSince(mark);
  const seen: string[] = [];
  for (const state of states) {
    for (const ref of pick(state)) {
      if (ref === undefined) continue;
      const key = refKey(ref.id, ref.args);
      if (!seen.includes(key)) seen.push(key);
    }
  }
  const wanted = refKey(expected.id, expected.args);
  if (!seen.includes(wanted)) {
    assert.fail(
      `no state published since the mark carried ${what} as ${wanted}; ` +
        `the ${String(states.length)} recorded state(s) carried ` +
        `${seen.length === 0 ? "nothing there" : seen.join(" ; ")}`,
    );
  }
}

/**
 * Wait until `id`, or an element under it, is pointed at `ref`.
 *
 * **A wait on the document's own two attributes, not on Fluent's output.**
 * `applyRef` sets `data-l10n-id` and `data-l10n-args` together and
 * synchronously, inside the same `render()` call the view model publishes from,
 * so this answers "did the document point this surface at the message the model
 * decided" without depending on when the translation lands. It is the second of
 * the three observations each rewritten surface now gets.
 */
async function pointedAt(id: string, ref: MessageRef): Promise<void> {
  const wanted = refKey(ref.id, ref.args);
  const pointers = (): string[] => {
    const out: string[] = [];
    const visit = (element: Element): void => {
      const key = pointerKey(element);
      if (key !== undefined) out.push(key);
      for (const child of Array.from(element.children)) visit(child);
    };
    const root = doc.getElementById(id);
    if (root) visit(root);
    return out;
  };
  await waitUntil(
    () => pointers().includes(wanted),
    `#${id} to be pointed at ${wanted} (it carries ` +
      `${pointers().join(" ; ") || "no data-l10n-id"})`,
  );
}

/** What the window's own `DOMLocalization` exposes, typed to what is used. */
interface WindowLocalization {
  formatMessages(
    requests: readonly {
      readonly id: string;
      readonly args?: Readonly<Record<string, string | number>>;
    }[],
  ): Promise<
    (
      | {
          value?: string | null;
          attributes?: readonly { name: string; value: string }[] | null;
        }
      | null
      | undefined
    )[]
  >;
}

/**
 * Resolve an **attribute-shaped** message — one with no value and a
 * `.aria-label =` line — through the window's own `document.l10n`, and fail if
 * the attribute is blank (`P1-T43`).
 *
 * {@link resolved} cannot be used for these: Fluent returns `value: null` for a
 * message that has only attributes, and that is correct rather than blank. Same
 * no-cap property as `resolved`: it awaits the bundle's answer, so a slow
 * Fluent makes it slow rather than wrong.
 */
async function resolvedAttribute(id: string, name: string): Promise<string> {
  const l10n = (doc as unknown as { l10n?: WindowLocalization }).l10n;
  if (l10n === undefined) {
    assert.fail("the search window's document exposes no l10n");
  }
  const [first] = await l10n.formatMessages([{ id }]);
  const found = (first?.attributes ?? []).find(
    (attribute) => attribute.name === name,
  );
  if (found === undefined || found.value === "") {
    assert.fail(
      `${id} resolves to no .${name} in this window; it carries ` +
        `${JSON.stringify(first?.attributes ?? null)}`,
    );
  }
  return found.value;
}

/**
 * Resolve `ref` through the window's own `document.l10n`, and fail if it is
 * blank.
 *
 * **The text assertion that cannot expire, and the reason it is not a weaker
 * check.** `P1-T22` measured that a message whose resource is unlinked
 * "resolves to nothing and leaves the element alone" — seven surfaces once
 * shipped blank that way, and `P1-T45`'s most valuable mutation was exactly
 * this class. That is a property of the **bundle**, and this asks the bundle
 * directly, through the same `DOMLocalization` and the same resource list the
 * window renders with (`addon/content/searchDialog.js` hands
 * `document.l10n` to the view model as its `formatter`, and resolves its own
 * column labels through `formatMessages` for a related reason). Because it
 * *awaits* the answer instead of polling the document for a mutation, a slow
 * Fluent makes it slow rather than wrong: there is no cap for it to expire
 * against, and a transient value cannot have been replaced by the time the
 * answer arrives.
 *
 * What it does **not** check is that `DOMLocalization` wrote the text into that
 * particular element. {@link pointedAt} covers the document's half of that, and
 * `#rh-search-status` below still has a real rendered-text wait on a value the
 * run does not replace.
 */
async function resolved(ref: MessageRef): Promise<string> {
  const l10n = (doc as unknown as { l10n?: WindowLocalization }).l10n;
  if (l10n === undefined) {
    assert.fail("the search window's document exposes no l10n");
  }
  const wanted = refKey(ref.id, ref.args);
  let value: unknown;
  try {
    const [first] = await l10n.formatMessages([
      ref.args === undefined ? { id: ref.id } : { id: ref.id, args: ref.args },
    ]);
    value = first?.value;
  } catch (error) {
    assert.fail(
      `${wanted} threw while resolving in this window: ${String(error)}`,
    );
  }
  if (typeof value !== "string" || value === "") {
    assert.fail(
      `${wanted} resolves to no text in this window — a message whose ` +
        `resource is unlinked renders as an empty string and leaves the ` +
        `element alone (P1-T22), which is how seven surfaces once shipped ` +
        `blank; it resolved to ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Every attribute value and every leaf text node under `id`. */
function stringsUnder(id: string): string[] {
  const out: string[] = [];
  const walk = (element: Element): void => {
    for (const attribute of Array.from(element.attributes)) {
      out.push(attribute.value);
    }
    if (element.children.length === 0) {
      out.push(element.textContent ?? "");
    }
    for (const child of Array.from(element.children)) {
      walk(child);
    }
  };
  const root = doc.getElementById(id);
  if (root) walk(root);
  return out;
}

function rows(): Element[] {
  return Array.from(el("rh-results-body").children);
}

/**
 * The user-library collection with this exact name.
 *
 * By name and not by key, because the *name* is what the window handed the
 * pipeline (`SearchImportTarget.collectionName`) and `importWorks()` resolving it
 * is the behaviour under test — `src/zotero/collectionOps.ts`'s
 * `findOrCreateCollection` runs the same `getByLibrary(…).find(…)` pass.
 */
function collectionNamed(name: string): {
  readonly key: string;
  getChildItems(idsOnly: boolean): number[];
} {
  const found = Zotero.Collections.getByLibrary(
    Zotero.Libraries.userLibraryID,
  ).find((collection) => collection.name === name);
  if (!found) {
    assert.fail(`the import created no collection named "${name}"`);
  }
  return found as unknown as {
    readonly key: string;
    getChildItems(idsOnly: boolean): number[];
  };
}

/** Tick exactly the sources named, leaving the rest unchecked. */
function selectSources(ids: readonly SourceId[]): void {
  for (const box of controller.sourceBoxes()) {
    box.checked = ids.includes(box.getAttribute("value") as SourceId);
  }
  controller.refreshSearchGate();
}

function setKeyword(value: string): void {
  (el("rh-search-keyword") as HTMLInputElement).value = value;
}

/** Rebuild the library index the `isExisting` port reads. */
async function refreshIndex(): Promise<void> {
  index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
}

/**
 * Run one search and wait for the whole run to finish rendering.
 *
 * The wait is on the **view model's** published `running`, not the document's:
 * `RHSearchWindow.cancel()` clears its own copy immediately so a second
 * `Escape` can close a wedged window (`docs/08` §9), which would make a
 * cancellation look instantaneous to a test that watched the document.
 */
async function search(
  plan: Partial<Record<SourceId, StubBehaviour>>,
  timeoutMs = 20_000,
): Promise<void> {
  behaviour.set(PUBMED, plan.pubmed ?? IDLE);
  behaviour.set(CROSSREF, plan.crossref ?? IDLE);
  const before = runsFinished;
  controller.search();
  await waitUntil(
    () => runsFinished > before,
    "the search to finish",
    timeoutMs,
  );
}

/** Press Import and wait for the write half to finish rendering. */
async function runImport(timeoutMs = 60_000): Promise<void> {
  const before = runsFinished;
  controller.import();
  await waitUntil(
    () => runsFinished > before,
    "the import to finish",
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// 2c. `P1-T43` — the hide-existing checkbox, the duplicate radios and one
//     import under one policy
// ---------------------------------------------------------------------------

/** Tick or untick "Hide items already in my library" and re-filter. */
function setHideExisting(checked: boolean): void {
  (el("rh-search-hide-existing") as HTMLInputElement).checked = checked;
  controller.applyFilter();
}

/** The `#rh-search-duplicates` radiogroup, typed to the one member read. */
function duplicatesGroup(): { value: string } {
  return el("rh-search-duplicates") as unknown as { value: string };
}

/** Select one of `docs/08` §4.4's three radios, as a user would. */
function setDuplicates(choice: SearchWindowDuplicates): void {
  duplicatesGroup().value = choice;
}

/** The rendered rows carrying `P1-T21`'s already-present row class. */
function markedRows(): Element[] {
  return rows().filter((row) => row.classList.contains("rh-row-existing"));
}

/**
 * One already-present row renders as `docs/08` §4.5 draws it and `NFR-13`
 * requires it: the row class, the badge, **and the words** — never the colour
 * alone. Three observations per surface, `P1-T46`'s shape: the document's
 * class and pointer attributes, then the texts the bundle produces, resolved
 * through `document.l10n` so no wait can expire under them.
 */
async function assertMarkedRow(row: Element): Promise<void> {
  const key = row.getAttribute("data-rh-row-key") ?? "";
  const record = lastState?.records?.find((r) => r.key === key);
  if (record === undefined) {
    assert.fail(`the marked row ${key} matches no published record`);
  }
  assert.isTrue(record.existing, "the view model marked this record existing");

  const titleCell = row.children[1];
  if (titleCell === undefined) assert.fail("a marked row has no title cell");
  const badge = titleCell.querySelector(".rh-existing-badge");
  if (badge === null) assert.fail("a marked row draws no badge");
  assert.strictEqual(badge.getAttribute("role"), "img");
  assert.strictEqual(
    pointerKey(badge),
    refKey("research-helper-search-row-existing-badge", undefined),
    "the badge is pointed at its Fluent id",
  );
  const text = Array.from(titleCell.children).find(
    (child) =>
      child.getAttribute("data-l10n-id") ===
      "research-helper-search-row-existing",
  );
  if (text === undefined) assert.fail("a marked row carries no words");
  const wordsRef = message("research-helper-search-row-existing", {
    title: record.title,
  });
  assert.strictEqual(
    pointerKey(text),
    refKey(wordsRef.id, wordsRef.args),
    "the words carry the paper's own title as their argument",
  );

  const words = await resolved(wordsRef);
  assert.include(words, "Already in library", "NFR-13: the words say it");
  assert.include(words, record.title, "and name the paper");
  const label = await resolvedAttribute(
    "research-helper-search-row-existing-badge",
    "aria-label",
  );
  assert.include(label, "library", "the badge has an accessible name");
}

/**
 * Import the rows the table shows as picked, under one duplicate-policy radio,
 * into a fresh collection — and assert the outcome by the report's own counts
 * (`P1-T43` step 5), three ways (`P1-T46`), plus the collection's non-note item
 * count read back off the library.
 */
async function importUnder(
  choice: SearchWindowDuplicates,
  expected: { imported: number; linked: number; skipped: number },
): Promise<{ summary: string; items: number }> {
  setDuplicates(choice);
  assert.strictEqual(duplicatesGroup().value, choice, "the radio took");
  const name = `RH P1-T43 ${choice} ${String(Date.now())}`;
  controller.adoptNewCollection(name);
  const mark = markStates();
  await runImport();
  const collection = collectionNamed(name);
  createdCollections.push(collection.key);

  const summaryRef = message("research-helper-import-summary", {
    ...expected,
    failed: 0,
  });
  assertPublished(
    mark,
    (state) => state.notices,
    summaryRef,
    `the import summary under "${choice}", in the notice region`,
  );
  assertPublished(
    mark,
    (state) => [state.status],
    summaryRef,
    `the import summary under "${choice}", in the status bar`,
  );
  await pointedAt("rh-search-notice", summaryRef);
  const summary = await resolved(summaryRef);

  const children = (await Zotero.Items.getAsync(
    collection.getChildItems(true),
  )) as { isNote(): boolean }[];
  const items = children.filter((item) => !item.isNote()).length;
  log(
    `import under "${choice}": ${summary.replace(/\s+/g, " ")}; ` +
      `${String(items)} item(s) in the collection ` +
      `(${String(statesSince(mark).length)} state(s) recorded)`,
  );
  return { summary, items };
}

// ---------------------------------------------------------------------------
// 3. The host — what the composition root would build
// ---------------------------------------------------------------------------

/**
 * A `PipelineContextFactory`, assembled here because `installServices()` refuses
 * to build a second graph.
 *
 * `src/bootstrap/registerUI.ts` already ran `installServices()` at startup, and
 * `P1-T25`'s **Do NOT** makes a second graph an error — two graphs mean two rate
 * limiters and a host paced at twice its policy. So this builds only the two
 * pieces the view model reads: one reporter tree per job, and its observable
 * sink.
 */
function jobFactory(
  sources: SourceRegistry,
  logger: ReturnType<typeof createLogger>,
): SearchImportJobFactory {
  const clock = createSystemClock();
  let sequence = 0;
  return {
    forJob(options) {
      sequence += 1;
      openOnAsked.push(options.openOn);
      const jobId = `searchImport-${String(clock.now())}-${String(sequence)}`;
      const events = createObservableProgressSink();
      const reporter = new CompositeProgressReporter({
        clock,
        sinks: [events],
        token: options.token,
        // See this file's header: the product coalesces at 250 ms.
        throttleMs: 0,
      });
      const context: PipelineContext = {
        jobId,
        token: options.token,
        progress: reporter,
        logger: logger.child({ jobId }),
        clock,
        sources,
        cache: undefined,
        budget: undefined,
        llm: undefined,
        tts: undefined,
        zotero: undefined,
        config: undefined,
        privacy: undefined,
        checkpoint: (): Promise<void> => Promise.resolve(),
        resumeState: undefined,
      };
      return {
        jobId,
        context,
        progress: {
          // `context.progress` is the real reporter, which the pipeline builds
          // its whole child tree from; only the terminal call is recorded.
          reporter: {
            done(
              outcome: "succeeded" | "failed" | "cancelled",
              messageText?: string,
            ): void {
              doneCalls.push({ outcome, message: messageText });
              reporter.done(outcome, messageText);
            },
          },
          events,
        },
        dispose(): void {
          reporter.dispose();
          events.dispose();
        },
      };
    },
  };
}

/**
 * Erase every collection in `keys`, its items included, best effort.
 *
 * Shared by the two `describe` blocks below so that one of them failing cannot
 * leave the other's fixtures in the library. A failed erase is swallowed —
 * `test/integration/zotero/importer.spec.ts`'s discipline: cleanup never fails
 * the run it is cleaning up after.
 */
async function eraseCollections(
  keys: readonly string[],
  label: string,
): Promise<void> {
  let items = 0;
  let collections = 0;
  for (const key of keys) {
    try {
      const found = Zotero.Collections.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      ) as
        | {
            getChildItems(idsOnly: boolean): number[];
            eraseTx(): Promise<unknown>;
          }
        | false;
      if (!found) continue;
      const childIDs = found.getChildItems(true);
      if (childIDs.length > 0) {
        await Zotero.Items.erase(childIDs);
        items += childIDs.length;
      }
      await found.eraseTx();
      collections += 1;
    } catch {
      /* cleanup is best effort */
    }
  }
  log(
    `${label}: cleanup erased ${String(items)} item(s) and ` +
      `${String(collections)} collection(s)`,
  );
}

/**
 * A registry whose contents this spec fixes once, in `before()`.
 *
 * The shipped factory, not a hand-rolled fake: until `P2-T26` this was a
 * `Map`-backed object literal that re-implemented the four lookup members and
 * silently overwrote on a duplicate id. A fake of an interface drifts from it
 * the day the interface gains a member, which is what happened; the real thing
 * cannot.
 */
function registryOf(adapters: readonly LiteratureSource[]): SourceRegistry {
  const registry = createSourceRegistry();
  for (const adapter of adapters) {
    registry.register(adapter);
  }
  return registry;
}

/**
 * The pipeline, with every output it returns also pushed to `into` (`P2-T31`).
 *
 * A tap, not a stub: `run` is the real `run`, and the view model sees exactly
 * what it would see without the tap. It exists because the view model keeps
 * the preview's `works` private and the criterion is about them.
 */
function recordingPipeline(
  pipeline: Pipeline<SearchImportInput, SearchImportOutput>,
  into: SearchImportOutput[],
): Pipeline<SearchImportInput, SearchImportOutput> {
  return {
    ...pipeline,
    async run(input, ctx) {
      const output = await pipeline.run(input, ctx);
      into.push(output);
      return output;
    },
  };
}

/**
 * The real Zotero writer, with every work handed to `writeBatch` also pushed
 * to `into` before the importer sees it (`P2-T31`). The session is a plain
 * object whose methods close over their own state rather than reading `this`
 * (`createZoteroSearchImportWriter` in `src/bootstrap/registerPipelines.ts`),
 * so spreading it and replacing one method is safe.
 */
function recordingWriter(
  writer: SearchImportWriter,
  into: CanonicalWork[],
): SearchImportWriter {
  return {
    async openTarget(target, token) {
      const session = await writer.openTarget(target, token);
      return {
        ...session,
        writeBatch(works, batchToken) {
          into.push(...works);
          return session.writeBatch(works, batchToken);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 4. `P1-T35` — the host the *composition root* published
// ---------------------------------------------------------------------------

/**
 * The source id this block stubs, and **why it is `pubmed`** (since `P2-T26`).
 *
 * The block below drives the host `src/bootstrap/registerUI.ts` published at
 * startup, which means the registry behind it is the **real** one — the one
 * `installServices()` filled through `registerSources()`. `SourceRegistry`
 * *throws* on a duplicate id, so the stub cannot be *added* under `pubmed`;
 * `P1-T35` therefore registered it under a spare id, `crossref`, and left it
 * in the application-wide registry for the rest of the process. That stopped
 * being safe the moment Phase 2 planned a real Crossref adapter: the day one
 * registers, the spare-id registration throws and this block fails for a
 * reason unrelated to anything it tests (`plan/00` §6 item 27).
 *
 * So `before()` now **swaps** the stub in through
 * `SourceRegistry.replaceForTest`, which puts it in the real adapter's slot and
 * hands back the adapter it displaced; `after()` swaps that adapter back. The
 * registry holds the same one id throughout, in the same order, and nothing is
 * left behind for the specs that run after this file — {@link
 * displacedByPublishedStub} is the whole of the state involved.
 *
 * Every search below ticks `pubmed` alone and reaches the stub. **No HTTP
 * request leaves this machine in this block** — the same guarantee `P1-T22`'s
 * block gives, reached a different way. The replay harness **is** usable here
 * since `P2-T25` (see the file header), but the window cannot issue a request
 * the recorded corpus holds, which is why the double is still a source rather
 * than a transport.
 *
 * Two consequences of the id, both measured before the change: the Source
 * column now shows the localized name `PubMed` rather than the fallback id,
 * which no test in this block asserted on; and the per-source status row's
 * element id is `rh-search-source-status-pubmed`, which every lookup below
 * derives from this constant rather than spelling.
 *
 * **The swap does not reach `P1-T22`'s block.** `P1-T22` publishes its own host
 * over its own `registryOf([...])`, so the window it opens renders its own two
 * checkboxes from a registry this block never touches, and the real registry's
 * state when that block runs is exactly what startup left — restored, not
 * assumed: `after()` logs the id of what it put back.
 */
const PUBLISHED_STUB: SourceId = PUBMED;

/**
 * The real PubMed adapter `before()` displaced, held so `after()` can put it
 * back. `undefined` outside the block, and after a restore.
 */
let displacedByPublishedStub: LiteratureSource | undefined;
/** The stub `before()` swapped in, held so the block can assert by identity. */
let publishedStub: LiteratureSource | undefined;
/** The real registry the swap was made in — the one `after()` restores. */
let publishedRegistry: SourceRegistry | undefined;

/** The dependency record that host was built from. */
let publishedDeps: Required<SearchImportViewModelDeps> | undefined;
/** Collections this block created, erased in its own `after()`. */
const publishedCollections: string[] = [];

// ---------------------------------------------------------------------------
// 4b. `P1-T36` — FR-8's JSON export, validated against the shipped schema
// ---------------------------------------------------------------------------

/**
 * A synthetic credential-shaped run, put into the **query** so the redactor has
 * something to remove from the exported bytes.
 *
 * **48 characters, not 32, and that distinction is the whole point.**
 * `src/core/errors.ts`'s last-resort pattern is `/\b[A-Za-z0-9_-]{40,}\b/g`, so
 * a 32-character NCBI-shaped key is *not* removed from free text — `P1-T17`
 * measured that and `P1-T22` closed three surfaces because of it. A test that
 * put a 32-character run here and watched it survive would be asserting the
 * hole rather than the gate. 48 characters is above the threshold, so its
 * absence from the file is a measurement of the redactor doing its job.
 *
 * It is not a key. It is `rh` plus a repeated hexadecimal pattern, generated
 * here, matching nothing that exists.
 */
const SYNTHETIC_KEYISH = `rh${"0123456789abcdef".repeat(2)}aaaaaaaaaaaaaa`;

/** What the redactor writes in its place. See `redactText`. */
const REDACTION_MARK = `[redacted:${String(SYNTHETIC_KEYISH.length)}]`;

type SchemaNode = Readonly<Record<string, unknown>>;

/**
 * The keywords {@link validateAgainstSchema} enforces.
 *
 * **Duplicated from `test/unit/core/provenance.test.ts`, deliberately and with
 * the cost stated.** That file holds the same subset validator and cannot be
 * imported from here: it imports `vitest` and `node:fs`, and neither exists in
 * the Zotero sandbox — the same wall `test/contract/_transport.ts` hit, recorded
 * in this file's header. Hoisting the validator into a shared test helper would
 * be a new file, which is outside `P1-T36`'s `Files` list
 * (`plan/README.md` §5 rule 2), so the duplication is reported with the card
 * rather than made invisible. {@link unimplementedSchemaKeywords} is what keeps
 * the copy honest: a keyword the shipped schema grows and this validator ignores
 * fails the test instead of silently passing it.
 */
const IMPLEMENTED_KEYWORDS: readonly string[] = [
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "oneOf",
  "minimum",
  "$ref",
  // Core and annotation-only: these carry no constraint. `format` is an
  // annotation in draft 2020-12 unless a vocabulary opts in, so the ISO shape
  // of `startedAt` / `finishedAt` is asserted separately below.
  "$schema",
  "$id",
  "$defs",
  "title",
  "description",
  "format",
];

function isSchemaObject(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveSchemaRef(root: SchemaNode, ref: string): SchemaNode {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) {
    assert.fail(`unsupported $ref: ${ref}`);
  }
  const defs = root["$defs"];
  if (!isSchemaObject(defs)) {
    assert.fail("the shipped schema has no $defs");
  }
  const target = defs[ref.slice(prefix.length)];
  if (!isSchemaObject(target)) {
    assert.fail(`unresolvable $ref: ${ref}`);
  }
  return target;
}

function matchesSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isSchemaObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return assert.fail(`unsupported type keyword: ${type}`);
  }
}

/**
 * Validate `value` against `schema`. An empty array means valid.
 *
 * Each message carries a path, so a failure names the field rather than handing
 * a human the whole document to diff.
 */
function validateAgainstSchema(
  schema: SchemaNode,
  value: unknown,
  root: SchemaNode,
  path = "$",
): string[] {
  const errors: string[] = [];

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    errors.push(
      ...validateAgainstSchema(resolveSchemaRef(root, ref), value, root, path),
    );
  }

  const type = schema["type"];
  if (typeof type === "string" && !matchesSchemaType(type, value)) {
    errors.push(`${path}: expected type ${type}, got ${typeof value}`);
    // A wrong type makes every nested assertion noise.
    return errors;
  }

  if ("const" in schema && !jsonEqual(schema["const"], value)) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema["const"])}, got ` +
        `${JSON.stringify(value)}`,
    );
  }

  const enumeration = schema["enum"];
  if (
    Array.isArray(enumeration) &&
    !enumeration.some((allowed) => jsonEqual(allowed, value))
  ) {
    errors.push(`${path}: ${JSON.stringify(value)} is not in enum`);
  }

  const minimum = schema["minimum"];
  if (
    typeof minimum === "number" &&
    typeof value === "number" &&
    value < minimum
  ) {
    errors.push(`${path}: ${String(value)} is below ${String(minimum)}`);
  }

  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const matched = oneOf.filter(
      (branch) =>
        isSchemaObject(branch) &&
        validateAgainstSchema(branch, value, root, path).length === 0,
    );
    if (matched.length !== 1) {
      errors.push(
        `${path}: matched ${String(matched.length)} oneOf branches, expected 1`,
      );
    }
  }

  const items = schema["items"];
  if (isSchemaObject(items) && Array.isArray(value)) {
    value.forEach((element, index) => {
      errors.push(
        ...validateAgainstSchema(
          items,
          element,
          root,
          `${path}[${String(index)}]`,
        ),
      );
    });
  }

  if (isSchemaObject(value)) {
    const properties = schema["properties"];
    const declared = isSchemaObject(properties) ? properties : {};

    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !(name in value)) {
          errors.push(`${path}: missing required property ${name}`);
        }
      }
    }

    for (const [name, element] of Object.entries(value)) {
      const subschema = declared[name];
      if (isSchemaObject(subschema)) {
        errors.push(
          ...validateAgainstSchema(subschema, element, root, `${path}.${name}`),
        );
        continue;
      }
      const additional = schema["additionalProperties"];
      if (additional === false) {
        errors.push(`${path}: additional property ${name} is not allowed`);
      } else if (isSchemaObject(additional)) {
        errors.push(
          ...validateAgainstSchema(
            additional,
            element,
            root,
            `${path}.${name}`,
          ),
        );
      }
    }
  }

  return errors;
}

/** Which keywords the shipped schema uses that the validator above ignores. */
function unimplementedSchemaKeywords(
  schema: SchemaNode,
  out = new Set<string>(),
): Set<string> {
  for (const key of Object.keys(schema)) out.add(key);
  const descend = (node: unknown): void => {
    if (isSchemaObject(node)) unimplementedSchemaKeywords(node, out);
  };
  for (const name of ["properties", "$defs"]) {
    const group = schema[name];
    if (isSchemaObject(group)) Object.values(group).forEach(descend);
  }
  descend(schema["items"]);
  descend(schema["additionalProperties"]);
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) oneOf.forEach(descend);
  return out;
}

/** Where this block's one exported file goes, and what it is deleted by. */
function exportPath(): string {
  return PathUtils.join(
    PathUtils.tempDir,
    `rh-p1t36-provenance-${String(Date.now())}.json`,
  );
}

/**
 * `addon/content/searchDialog.js`'s `resolveHost()`, transcribed.
 *
 * The document does `Zotero.__addonInstance__.api.searchWindow || {}` — the
 * fallback is what made every control inert before `P1-T35`. Here the fallback
 * is a **failure**: criterion 1 is about the published object existing, so a
 * missing one must not be papered over by an empty object.
 */
function publishedApi(): PluginApi {
  const instance = (Zotero as unknown as Record<string, unknown>)[
    config.addonInstance
  ] as { api?: PluginApi } | undefined;
  if (!instance) {
    assert.fail(`Zotero.${config.addonInstance} is not installed`);
  }
  const api = instance.api;
  if (!api) {
    assert.fail(
      `Zotero.${config.addonInstance}.api is absent, so the window's host ` +
        `lookup resolves to {} and every control is inert`,
    );
  }
  return api;
}

/**
 * Every key of `SearchImportViewModelDeps`, as data — **criterion 4's
 * enumeration**.
 *
 * `Record<keyof SearchImportViewModelDeps, true>` is what makes this
 * unforgettable rather than a list someone has to remember to extend: adding a
 * member to that interface leaves a key missing here and `npm run typecheck`
 * reports `TS2741`, while removing one makes this an excess property. The names
 * are therefore **derived from the type** and the only thing written by hand is
 * the `true`.
 *
 * It is the run-time half of the same check `SearchWindowDeps =
 * Required<SearchImportViewModelDeps>` makes at compile time in
 * `src/bootstrap/registerUI.ts`. Both are needed and neither replaces the
 * other: the compiler proves the composition root *declares* every member, this
 * proves the object the plugin actually published in a live Zotero *has* them.
 */
const VIEW_MODEL_DEPENDENCIES: Record<keyof SearchImportViewModelDeps, true> = {
  pipeline: true,
  jobs: true,
  logger: true,
  pluginVersion: true,
  zoteroVersion: true,
  clock: true,
  listSources: true,
  listCollections: true,
  getPrefs: true,
  // `P2-T14`: FR-2's third scenario reads the presence flag through this port.
  semanticScholarKeyStatus: true,
  saveSources: true,
  isExisting: true,
  writeProvenanceNote: true,
  provenanceFiles: true,
  // `P2-T17`: FR-12's search_provenance store and the collection lookup a
  // re-run is seeded through.
  provenanceStore: true,
  findCollection: true,
};

/**
 * Wait for a run started through the published host to finish — **all** of it.
 *
 * On `controller.state.running`, and the ordering is what makes this race-free
 * rather than lucky. `RHSearchWindow.search()` sets `state.running = true`
 * itself before it calls the host, and for an import `runJob()` publishes
 * `running: true` **synchronously**, before its first `await`, and `render()`
 * copies it straight onto the document's state — so the flag is already true
 * by the time `controller.search()` / `controller.import()` returns, and the
 * assertion below is a real check rather than a poll that can miss a fast run.
 * It goes false in the view model's `close()`.
 *
 * **The summary notice is not the signal, and that is measured.**
 * `renderImportOutcome` publishes the `Imported N · Linked M` notice *before*
 * it builds the provenance record and awaits `writeProvenanceNote`. A version
 * of the import test below that waited on the notice and then counted the
 * collection's children passed once and then failed with
 * `FR-8: exactly one provenance note … expected +0 to equal 1` — while this
 * block's own cleanup line read `erased 4 item(s)`, i.e. three items **and the
 * note**, which had landed a moment after the count. `close()` runs after that
 * await, so this is the only flag that means "the note is written too".
 *
 * `P1-T22`'s block counts `running` transitions instead, which it can do
 * because it wraps the host's `connect`; a spec driving the *published* host
 * wraps nothing, so it reads the document the way a user would.
 */
async function awaitPublishedRun(what: string): Promise<void> {
  assert.isTrue(
    controller.state.running,
    `${what} did not start: the document's host call returned without the ` +
      `view model publishing running: true`,
  );
  await waitUntil(() => !controller.state.running, `${what} to finish`, 60_000);
}

/**
 * The seven members `resolveHost()`'s own comment documents, plus `connect`
 * (`P1-T22`) and `exportProvenance` (`P1-T36`).
 */
const HOST_CONTRACT: readonly (keyof SearchWindowHostApi)[] = [
  "listSources",
  "listCollections",
  "getPrefs",
  "connect",
  "runSearch",
  "runImport",
  "cancel",
  "exportProvenance",
  // `P2-T14`: the Databases row writes the `sources` preference.
  "saveSources",
];

// ---------------------------------------------------------------------------
// 3b. `P2-T25` — the replay harness inside Zotero: the shipped adapter, the
//     shipped client and Gecko's parser over the recorded corpus
// ---------------------------------------------------------------------------

/**
 * The fixture name this block pins by hand: `paginated-page-1`, an `esearch`
 * for `PUBMED_TYPICAL_QUERY` at `retmax=3`, recorded 2026-10-07. Written out,
 * not derived, so that a changed digest, a changed redaction or a changed input
 * shape fails against a constant on disk rather than against itself
 * (`P2-T25` criterion 2). `test/contract/replayHarness.test.ts` pins the same
 * constant in Node.
 */
const PAGINATED_PAGE_1_KEY = "b68358327ce730cd";

/**
 * How many fixtures `test/fixtures/pubmed/` holds; one sidecar each. 17 until
 * `P2-T36` recorded the window's two (`window-esearch`, `window-efetch`); since
 * `P2-T13` Part B (2026-10-16) also one `esearch` and one dependent `efetch` per
 * corpus search, plus `search-typical-efetch` — derived from the support plan,
 * not typed in, so the next corpus scenario cannot strand this pin. A corpus
 * search whose `esearch` found nothing has no `efetch`
 * (`DEDUP_CORPUS_PUBMED_NO_RECORDS`, 2026-10-16).
 */
const PUBMED_FIXTURE_COUNT =
  19 +
  2 * DEDUP_CORPUS_SEARCHES.pubmed.length -
  DEDUP_CORPUS_PUBMED_NO_RECORDS.length +
  1;

/**
 * The two fixtures `P2-T36` recorded for the window, pinned by hand for the
 * reason {@link PAGINATED_PAGE_1_KEY} is: `window-esearch` is
 * `pubmedWindowQuery()` at `retmax=10`, `window-efetch` the ten ids it
 * returned. Recorded 2026-10-15 with `npm run fixtures:record -- --only
 * window-esearch`, two live requests.
 */
const WINDOW_ESEARCH_KEY = "4ca74cf52838c0c6";
const WINDOW_EFETCH_KEY = "ec1cf8564b39c3a1";

const LOG_PREFIX_T25 = "[P2-T25]";

function log25(line: string): void {
  debug(`${LOG_PREFIX_T25} ${line}`);
}

/** The slice of `SubtleCrypto` the measurement reads, typed to what is used. */
interface DigestFacility {
  readonly crypto?: {
    readonly subtle?: {
      readonly digest?: (
        algorithm: string,
        data: Uint8Array,
      ) => Promise<ArrayBuffer>;
    };
  };
}

describe("P2-T25: the replay harness inside Zotero — real adapter, real client, recorded responses", () => {
  /** `test/fixtures/pubmed`, as a native path, found from the plugin's root. */
  let fixtureDir: string;

  /** The shipped adapter, mapper and client over the Zotero file port. */
  function harness(): ReplayHttpClient & {
    readonly source: ReturnType<typeof createPubmedSource>;
  } {
    const replay = createReplayHttpClient({
      dir: fixtureDir,
      host: NCBI_HOST,
      io: zoteroFixtureIo,
    });
    // No `parseXml`: the mapper's default is `domParserXml`, Gecko's own
    // `DOMParser`, which is what the composition root uses too
    // (`src/bootstrap/container.ts`). The Node contract test has to supply a
    // parser of its own; this is the one place the shipped parser is exercised
    // over the recorded corpus.
    const mapRecords = createPubmedRecordMapper({ clock: replay.clock });
    const source = createPubmedSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords,
    });
    return { ...replay, source };
  }

  function callContext(): SourceCallContext {
    return { token: createCancellationTokenSource().token };
  }

  /** The recorded `esearch` body of one page, read off disk through the port. */
  async function recordedPageIds(retstart: number): Promise<readonly string[]> {
    const request = recordedEsearchRequest(
      PUBMED_TYPICAL_QUERY,
      PUBMED_PAGE_SIZE,
      retstart,
    );
    const text = await zoteroFixtureIo.readText(
      fixtureDir,
      `${fixtureKey(request)}.json`,
    );
    const { body } = JSON.parse(text) as { body: string };
    return parseEsearchBody(body, request.url).pmids;
  }

  before(async function () {
    this.timeout(30_000);
    fixtureDir = await repositoryFixtureDir("pubmed");
    log25(`fixture directory: ${fixtureDir}`);
  });

  // =========================================================================
  // Step 1 — the measurement everything else in the card depends on
  // =========================================================================

  it("measures the digest facility: crypto.subtle.digest is reachable and asynchronous", async function () {
    this.timeout(30_000);
    const request = recordedEsearchRequest(
      PUBMED_TYPICAL_QUERY,
      PUBMED_PAGE_SIZE,
      0,
    );
    const input = `${request.method} ${request.url} `;

    // Where specs run: the scaffold's test-runner chrome window.
    const here = globalThis as unknown as DigestFacility;
    const windowDigest = here.crypto?.subtle?.digest;
    const windowHasDigest = typeof windowDigest === "function";

    // Where the plugin runs: the sandbox `_loadScope()` built. The plugin
    // object was constructed by code inside it, so its global *is* that
    // sandbox, and `getGlobalForObject` is the one way to reach it from here.
    const instance = (Zotero as unknown as Record<string, unknown>)[
      config.addonInstance
    ];
    const sandboxGlobal = (
      Components.utils.getGlobalForObject as (object: unknown) => unknown
    )(instance) as DigestFacility | undefined;
    const sandboxDigest = sandboxGlobal?.crypto?.subtle?.digest;
    const sandboxHasDigest = typeof sandboxDigest === "function";
    const hasSyncDigest =
      typeof (here.crypto as { subtle?: Record<string, unknown> } | undefined)
        ?.subtle?.["digestSync"] === "function";

    let returnsPromise = false;
    let windowHex = "(not computed)";
    if (windowDigest !== undefined && here.crypto?.subtle !== undefined) {
      const returned: unknown = windowDigest.call(
        here.crypto.subtle,
        "SHA-256",
        new TextEncoder().encode(input),
      );
      returnsPromise = returned instanceof Promise;
      windowHex = toHex(
        new Uint8Array(await (returned as Promise<ArrayBuffer>)),
      );
    }
    let sandboxHex = "(not computed)";
    if (sandboxDigest !== undefined && sandboxGlobal?.crypto?.subtle) {
      sandboxHex = toHex(
        new Uint8Array(
          await sandboxDigest.call(
            sandboxGlobal.crypto.subtle,
            "SHA-256",
            new TextEncoder().encode(input),
          ),
        ),
      );
    }

    // A second, cheaper measurement while a live Gecko is at hand: does
    // `IOUtils` accept the `${dir}/${name}` spelling the Node side uses? This
    // is what decides whether `FixtureIo` may take one joined path. Logged, not
    // asserted — the answer is per platform.
    let slashSpelling: string;
    try {
      slashSpelling = String(
        await IOUtils.exists(`${fixtureDir}/${PAGINATED_PAGE_1_KEY}.json`),
      );
    } catch (error) {
      slashSpelling = `throws ${String(error)}`;
    }

    log25(
      `Zotero ${Zotero.version}, Gecko ${Services.appinfo.platformVersion}, ` +
        `${Services.appinfo.OS}: crypto.subtle.digest in the test-runner ` +
        `window=${String(windowHasDigest)}, in the plugin sandbox=` +
        `${String(sandboxHasDigest)}, returns a Promise=${String(returnsPromise)}, ` +
        `any synchronous digest=${String(hasSyncDigest)}; node:crypto is ` +
        `absent by construction; IOUtils.exists on a forward-slash path ` +
        `under a native directory: ${slashSpelling}`,
    );

    assert.isTrue(
      windowHasDigest,
      "crypto.subtle.digest is reachable where integration specs run",
    );
    assert.isTrue(
      returnsPromise,
      "crypto.subtle.digest is asynchronous: it returns a Promise",
    );
    assert.isFalse(hasSyncDigest, "there is no synchronous digest to prefer");
    // The platform's digest and the pure one agree on the fixture key's input,
    // inside Zotero — the second half of the proof `replayHarness.test.ts`
    // gives against node:crypto.
    assert.strictEqual(
      windowHex,
      sha256Hex(input),
      "test/support/sha256.ts agrees with crypto.subtle.digest in this window",
    );
    assert.strictEqual(
      windowHex.slice(0, 16),
      fixtureKey(request),
      "and fixtureKey is that digest's first 16 hex characters",
    );
    if (sandboxHasDigest) {
      assert.strictEqual(
        sandboxHex,
        windowHex,
        "the sandbox's digest agrees with the window's",
      );
    }
  });

  // =========================================================================
  // Criterion 2 — the key is byte-identical to what P1-T11 recorded under
  // =========================================================================

  it("names an on-disk fixture with fixtureKey, byte for byte, and misses on a one-byte drift", async function () {
    this.timeout(30_000);
    const request = recordedEsearchRequest(
      PUBMED_TYPICAL_QUERY,
      PUBMED_PAGE_SIZE,
      0,
    );
    assert.strictEqual(
      fixtureKey(request),
      PAGINATED_PAGE_1_KEY,
      "the key the recorder wrote paginated-page-1 under",
    );
    const file = PathUtils.join(fixtureDir, `${PAGINATED_PAGE_1_KEY}.json`);
    assert.isTrue(await IOUtils.exists(file), `${file} is on disk`);
    assert.isTrue(
      await IOUtils.exists(
        PathUtils.join(fixtureDir, `${PAGINATED_PAGE_1_KEY}_meta.json`),
      ),
      "and so is its sidecar",
    );

    const drifted = fixtureKey({ ...request, url: `${request.url}&` });
    assert.notStrictEqual(drifted, PAGINATED_PAGE_1_KEY);
    assert.isFalse(
      await IOUtils.exists(PathUtils.join(fixtureDir, `${drifted}.json`)),
      "a request one byte off names a file that does not exist",
    );
    log25(`paginated-page-1 → ${fixtureKey(request)} (drifted: ${drifted})`);
  });

  it("reads and ages every sidecar through IOUtils, under docs/13 §3.3's policy", async function () {
    this.timeout(30_000);
    const report = await assertFixturesFresh(
      fixtureDir,
      Date.now(),
      zoteroFixtureIo,
    );
    assert.strictEqual(report.checked, PUBMED_FIXTURE_COUNT);
    assert.strictEqual(
      report.warnings.length,
      0,
      `nothing is past the warn age: ${report.warnings.join("; ")}`,
    );
    log25(
      `${String(report.checked)} sidecars aged; oldest ${String(report.oldestDays)} day(s)`,
    );
  });

  // =========================================================================
  // Criterion 4 — the real adapter and the real client, over replay
  // =========================================================================

  it("drives the shipped adapter, client and DOMParser through two recorded pages", async function () {
    this.timeout(30_000);
    const { source, transport, clock } = harness();
    const pageOne = await recordedPageIds(0);
    const pageTwo = await recordedPageIds(PUBMED_PAGE_SIZE);
    assert.strictEqual(pageOne.length, PUBMED_PAGE_SIZE);
    assert.strictEqual(pageTwo.length, PUBMED_PAGE_SIZE);

    // Page 1 through `searchAll`, the pipeline's entry point: one esearch and
    // one efetch. **Not `limit: 6` for both pages at once** — `searchAll` sizes
    // each page as `min(limit - emitted, 200)`, so that asks NCBI for
    // `retmax=6`, and no fixture was recorded at that size. Measured on the
    // first run of this test, 2026-10-13: `Missing fixture …
    // bb0945d1b9ffb92c.json for GET …&retmax=6&retstart=0…`, which is the
    // harness refusing loudly rather than reaching the network.
    const records: SourceRecord[] = [];
    for await (const record of source.searchAll(
      { ...PUBMED_TYPICAL_QUERY, limit: PUBMED_PAGE_SIZE },
      callContext(),
    )) {
      records.push(record);
    }
    assert.deepEqual(
      records.map((record) => record.nativeId),
      [...pageOne],
      "searchAll yields page 1's recorded idlist, in NCBI's order",
    );

    // Page 2 through the adapter's own paging contract — `search()` with the
    // cursor page 1 offers — into `paginated-page-2` and its efetch.
    const first = await source.search(
      { ...PUBMED_TYPICAL_QUERY, limit: PUBMED_PAGE_SIZE },
      callContext(),
    );
    assert.strictEqual(first.nextCursor, String(PUBMED_PAGE_SIZE));
    assert.strictEqual(first.totalAvailable, 840, "the recorded count");
    const second = await source.search(
      {
        ...PUBMED_TYPICAL_QUERY,
        limit: PUBMED_PAGE_SIZE,
        cursor: first.nextCursor ?? "",
      },
      callContext(),
    );
    records.push(...second.records);

    assert.deepEqual(
      records.map((record) => record.nativeId),
      [...pageOne, ...pageTwo],
      "the records are the two recorded idlists, in NCBI's order",
    );
    assert.strictEqual(
      new Set(records.map((record) => record.nativeId)).size,
      PUBMED_PAGE_SIZE * 2,
      "six distinct records",
    );
    assert.isTrue(
      records.every((record) => record.sourceId === "pubmed"),
      "every record names the shipped adapter",
    );
    assert.isTrue(
      records.every((record) => record.retrievedAtEpochMs === clock.now()),
      "the mapper stamped the frozen clock, so the snapshot is stable",
    );
    assert.strictEqual(clock.now(), FROZEN_NOW_EPOCH_MS);
    assert.isTrue(
      records.every((record) => record.work.title.trim() !== ""),
      "Gecko's DOMParser gave the mapper a title for every record",
    );

    // The fixture names the transport resolved are the strongest request-shape
    // assertion there is: each one exists only because the adapter's URL is
    // byte-identical to the recorder's.
    const calls = transport.calls.map((call) => ({
      key: fixtureKey({
        method: call.method,
        url: call.url,
        ...(call.options.body !== undefined && { body: call.options.body }),
      }),
      endpoint: new URL(call.url).pathname.split("/").pop() ?? "",
      retstart: new URL(call.url).searchParams.get("retstart"),
    }));
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      [
        "esearch.fcgi",
        "efetch.fcgi",
        "esearch.fcgi",
        "efetch.fcgi",
        "esearch.fcgi",
        "efetch.fcgi",
      ],
      "one esearch and one efetch per page fetched",
    );
    assert.strictEqual(calls[0]?.key, PAGINATED_PAGE_1_KEY);
    assert.strictEqual(calls[2]?.key, PAGINATED_PAGE_1_KEY, "page 1 again");
    assert.strictEqual(calls[4]?.retstart, String(PUBMED_PAGE_SIZE));
    assert.strictEqual(
      new Set(calls.map((call) => call.key)).size,
      4,
      "four distinct fixtures: two esearch pages and their two efetch batches",
    );
    for (const call of calls) {
      assert.isTrue(
        await IOUtils.exists(PathUtils.join(fixtureDir, `${call.key}.json`)),
        `${call.endpoint} resolved to the committed fixture ${call.key}`,
      );
    }
    log25(
      `${String(records.length)} records through ${String(calls.length)} ` +
        `fixtures: ${calls.map((call) => call.key).join(", ")}`,
    );
  });

  it("turns the recorded 429 into RateLimitError in production code and parks the host", async function () {
    this.timeout(30_000);
    const { client, limiter, clock, transport, slept } = harness();
    const request = recordedEsearchRequest(PUBMED_SYNTHETIC_429_QUERY, 20, 0);

    let thrown: unknown;
    try {
      await client.request("GET", request.url, { responseType: "text" });
    } catch (error) {
      thrown = error;
    }
    assert.isTrue(
      thrown instanceof RateLimitError,
      `a RateLimitError, not ${String(thrown)}`,
    );
    if (thrown instanceof RateLimitError) {
      assert.strictEqual(thrown.retryAfterMs, 2000, "Retry-After: 2");
      assert.strictEqual(thrown.messageKey, "rh-error-rate-limit");
    }
    // docs/07 §7.3: "Any 429 or 503 with Retry-After calls
    // limiter.penalize(...)". The limiter is the harness's recording one; the
    // call is the shipped client's.
    //
    // Item 228 (2026-10-20): this asserted exactly one penalty, which pinned
    // the single attempt the shipped client made while `src/bootstrap/
    // container.ts` supplied no `retryFor`. The client now retries to §7.3's
    // attempt cap — 3 on the eutils row — and the harness carries the same
    // policy, so the fixture is read three times, the host is penalized once
    // per attempt, and the two waits are the Retry-After's 2 s each. The
    // waits resolve at once in the harness, so the test takes no longer.
    assert.strictEqual(transport.calls.length, 3, "§7.3's attempt cap");
    assert.deepEqual([...slept], [2000, 2000], "two waits of Retry-After");
    assert.strictEqual(limiter.penalties.length, 3);
    for (const penalty of limiter.penalties) {
      assert.strictEqual(penalty.untilEpochMs, clock.now() + 2000);
    }

    const { client: second, transport: secondTransport } = harness();
    let serverError: unknown;
    try {
      await second.request(
        "GET",
        recordedEsearchRequest(PUBMED_SYNTHETIC_500_QUERY, 20, 0).url,
        { responseType: "text" },
      );
    } catch (error) {
      serverError = error;
    }
    assert.isTrue(
      serverError instanceof UpstreamServerError,
      `an UpstreamServerError, not ${String(serverError)}`,
    );
    // Item 228: the 500 is retried to the same cap before it surfaces.
    assert.strictEqual(secondTransport.calls.length, 3, "§7.3's attempt cap");
    log25(
      `429 → ${thrown instanceof Error ? thrown.constructor.name : "?"}, ` +
        `500 → ${serverError instanceof Error ? serverError.constructor.name : "?"}`,
    );
  });
});

describe("P1-T35: the host the composition root published", () => {
  before(async function () {
    this.timeout(90_000);

    const api = publishedApi();
    const services = api.services;
    if (!services) {
      assert.fail(
        "registerUI() published no ServiceGraph at api.services, so the " +
          "graph installServices() built is unreachable",
      );
    }
    // Into the *real* registry, in the real adapter's slot. See PUBLISHED_STUB
    // for why a swap and not a registration, and why nothing here reaches the
    // network.
    publishedRegistry = services.sources;
    publishedStub = stubSource(
      PUBLISHED_STUB,
      "research-helper-source-pubmed",
      () => behaviour.get(PUBLISHED_STUB) ?? IDLE,
    );
    displacedByPublishedStub = services.sources.replaceForTest(publishedStub);
    // Asserted here and not only in the test below, because a swap that did
    // not take would send every search in this block to the real adapter —
    // and so to NCBI. A failing hook skips the block; a failing test does not.
    assert.strictEqual(
      services.sources.get(PUBLISHED_STUB),
      publishedStub,
      "the stub is not in the real adapter's slot, so searches would go live",
    );
    log35(
      `real registry now holds ` +
        `${services.sources
          .list()
          .map((source) => source.id)
          .join(",")}; the stub displaced "${displacedByPublishedStub.id}"`,
    );

    publishedDeps = api.searchWindowDeps;

    const opened = openSearchWindow(Zotero.getMainWindow(), {
      mode: "keyword",
    }) as FlowWindow;
    win = opened;
    await waitUntil(
      () => opened.RHSearchWindow?.state.initialized === true,
      "RHSearchWindow.init() to have run",
      30_000,
    );
    doc = opened.document;
    const found = opened.RHSearchWindow;
    if (!found) {
      assert.fail("the window loaded without RHSearchWindow");
    }
    controller = found;
    log35("window open on the published host");
  });

  after(async function () {
    this.timeout(60_000);
    win?.close();
    win = undefined;
    await eraseCollections(publishedCollections, "P1-T35");
    // Put the real adapter back where the stub sat, so the registry the rest
    // of the suite sees is the one startup built. Logged, because "restored"
    // is a claim a later spec's failure would otherwise have to take on trust.
    if (publishedRegistry && displacedByPublishedStub) {
      const stub = publishedRegistry.replaceForTest(displacedByPublishedStub);
      log35(
        `real registry restored: "${displacedByPublishedStub.id}" is back in ` +
          `place of the stub (${stub === displacedByPublishedStub ? "NOT " : ""}` +
          `a different object)`,
      );
    }
    displacedByPublishedStub = undefined;
    publishedStub = undefined;
    publishedRegistry = undefined;
    // Hand the shared behaviour map back as it was found. `P1-T22`'s `search()`
    // helper rewrites both entries on every call, so this changes nothing today;
    // it is here because the map is the one mutable thing the two blocks share
    // and a block that leaves state behind invites exactly the wrong diagnosis
    // when something else in the file flakes.
    behaviour.set(PUBLISHED_STUB, IDLE);
    // The window is a singleton (`SEARCH_WINDOW_NAME`), so the next block's
    // `openSearchWindow` must not find this one still closing.
    await Zotero.Promise.delay(250);
  });

  // =========================================================================
  // `P1-T45` criterion 1, first half — hidden before a run
  //
  // **First in the block, and that is the whole point.** This is the only
  // moment in the suite when a real window has connected to the real host and
  // no import has happened yet, so it is the only place the "hidden before a
  // run" half of the criterion can be measured rather than argued. Every later
  // test in this block leaves a record behind.
  // =========================================================================

  it("P1-T45: the export control is hidden before any run", async function () {
    this.timeout(30_000);
    const button = el("rh-search-export");
    const message = el("rh-search-export-status");
    assert.isTrue(
      (button as unknown as { hidden: boolean }).hidden,
      "FR-8's export control is revealed by view state, and the window has " +
        "published one state with no notices in it, so there is no record " +
        "to export and nothing to press",
    );
    assert.isTrue(
      (message as unknown as { hidden: boolean }).hidden,
      "and its outcome sentence is hidden too",
    );
    assert.strictEqual(
      textOf("rh-search-export-status"),
      "",
      "an element revealed empty is what P1-T45 step 5 forbids",
    );
    assert.isFalse(controller.state.exportAvailable);
    log35("export control hidden before any run");
  });

  // =========================================================================
  // `P2-T14` — owner's decision, review page row 142: the Databases row
  // **paints** each registered source's display name
  //
  // `l10n.spec.ts` proves every `displayNameKey` resolves in the bundle. This
  // proves the user sees it: the text a XUL `<checkbox>` draws is its inner
  // `.checkbox-label`, so that is what is read, not the id and not the
  // checkbox's own `textContent`. Here because this block holds the real
  // registry with every shipped id (the stub sits in PubMed's slot with the
  // real adapter's key).
  // =========================================================================

  it("P2-T14 row 142: the Databases row paints every registered source's display name", async function () {
    this.timeout(30_000);
    const expected: Readonly<Record<string, string>> = {
      pubmed: "PubMed",
      europepmc: "Europe PMC",
      crossref: "Crossref",
      semanticscholar: "Semantic Scholar",
      arxiv: "arXiv",
      biorxiv: "bioRxiv",
      medrxiv: "medRxiv",
    };
    const boxes = [
      ...(el("rh-search-databases").children as unknown as Iterable<Element>),
    ];
    assert.deepEqual(
      boxes.map((box) => box.getAttribute("value")),
      Object.keys(expected),
      "the row lists the seven registered sources, in registry order",
    );
    const painted = (box: Element): string => {
      const inner = box.querySelector(".checkbox-label");
      return (inner?.getAttribute("value") ?? inner?.textContent ?? "").trim();
    };
    // Measured on the first run of this test (2026-10-15), before the fix:
    // with a `data-l10n-id` on each checkbox, Fluent wrote "PubMed" into the
    // checkbox's `textContent`, the control lost its `.checkbox-label` and its
    // check box, and every painted name read "". `addon/content/searchDialog.js`
    // `applySourceNames` now sets the resolved name as `label`.
    await waitUntil(
      () =>
        boxes.every(
          (box) => painted(box) === expected[box.getAttribute("value") ?? ""],
        ),
      "every database checkbox to paint its display name (it reads " +
        `${JSON.stringify(boxes.map(painted))})`,
      15_000,
    );
    for (const box of boxes) {
      const id = box.getAttribute("value") ?? "";
      assert.strictEqual(painted(box), expected[id], `${id}'s checkbox`);
      // And still a checkbox: the painted name did not replace the control.
      assert.isTrue(
        box.querySelector(".checkbox-check") !== null,
        `${id}'s checkbox kept its check box`,
      );
    }
    log35(`databases painted: ${boxes.map(painted).join(", ")}`);
  });

  it("item 206: every deduplication tier name resolves in this window to words, never to its id", async function () {
    // The duplicate badge's `{ $tier }` is handed this text by the view
    // model, which resolves it through this same `document.l10n`. The window
    // runs on the `ko-KR` chain, where the names are commented stubs, so the
    // answer is the en-US fallback — asserted as "some text that is not the
    // id", never as an English literal.
    for (const [tier, id] of Object.entries(DEDUP_TIER_NAME_KEYS)) {
      const text = await resolved({ id, args: undefined });
      assert.notStrictEqual(text.trim(), tier, `${id} resolves to its id`);
      assert.notStrictEqual(text.trim(), id, `${id} resolves to itself`);
    }
  });

  it("P2-T14: bioRxiv draws its ⊕ role row on a keyword run, never a count", async function () {
    this.timeout(60_000);
    setKeyword(KEYWORD);
    // bioRxiv's adapter makes no request on a keyword run (`P2-T07`), and the
    // stub's records carry abstracts and `10.5555/` DOIs, so neither the
    // backfill nor a preprint lookup has anything to ask: no network.
    selectSources([PUBLISHED_STUB, "biorxiv"]);
    behaviour.set(PUBLISHED_STUB, { records: 2, withAbstract: true });

    controller.search();
    await awaitPublishedRun("the search with bioRxiv ticked");

    const row = el("rh-search-source-status-biorxiv");
    assert.strictEqual(row.getAttribute("data-rh-outcome"), "role");
    const detail = row.querySelector(".rh-source-role");
    if (!detail) {
      assert.fail("bioRxiv's row has no role detail");
    }
    // Locale-independent (2026-10-16): the role row's Korean is owner-reviewed
    // and live, and this window runs on the `ko-KR` chain `l10n.spec.ts`
    // leaves behind, so the expected text is the bundle's own answer rather
    // than the English literal.
    const expectedText = await resolved({
      id: "research-helper-search-source-role",
      args: undefined,
    });
    const expectedHover = await resolvedAttribute(
      "research-helper-search-source-role",
      "title",
    );
    await waitUntil(
      () => (detail.textContent ?? "").trim() === expectedText.trim(),
      `Fluent to render the role row (it reads "${detail.textContent ?? ""}")`,
    );
    const hover = detail.getAttribute("title") ?? "";
    assert.strictEqual(hover, expectedHover, "§4.2's hover sentence");
    // Query syntax is never translated, so these hold in every locale.
    assert.include(hover, "SRC:PPR");
    assert.include(hover, "type:posted-content");
    assert.isFalse(
      /\d+ results?|Searching/.test(row.textContent ?? ""),
      "never a count and never a spinner",
    );
    assert.strictEqual(
      el(`rh-search-source-status-${PUBLISHED_STUB}`).getAttribute(
        "data-rh-outcome",
      ),
      "succeeded",
    );
    log35(`bioRxiv row: ${row.textContent ?? ""} | hover: ${hover}`);
  });

  // =========================================================================
  // `P2-T26` — the stub sits in the real adapter's slot, and only there
  // =========================================================================

  it("P2-T26: the stub occupies the real PubMed adapter's slot in the real registry", async function () {
    this.timeout(10_000);
    if (!publishedRegistry || !publishedStub || !displacedByPublishedStub) {
      assert.fail("before() did not record the swap");
    }
    const held = publishedRegistry
      .list()
      .filter((source) => source.id === PUBLISHED_STUB);
    assert.strictEqual(held.length, 1, "exactly one entry under the id");
    assert.strictEqual(held[0], publishedStub, "and it is the stub");
    assert.strictEqual(
      displacedByPublishedStub.id,
      PUBLISHED_STUB,
      "what came out carries the same id",
    );
    assert.isTrue(
      displacedByPublishedStub !== publishedStub,
      "what came out is the real adapter, not the stub handed in",
    );
    // The registry behind the window's checkbox row is this one, so the row
    // the window drew is the stub's: the view model reads displayNameKey off
    // the source, and the stub carries the real adapter's key.
    assert.strictEqual(
      publishedDeps?.listSources().find((s) => s.id === PUBLISHED_STUB)
        ?.displayNameKey,
      publishedStub.displayNameKey,
      "the published listSources() sees the stub",
    );
    log35(`stub in slot "${PUBLISHED_STUB}"; displaced the real adapter`);
    await Zotero.Promise.delay(0);
  });

  // =========================================================================
  // Criterion 1 — the window's own lookup finds the whole contract
  // =========================================================================

  it("publishes a complete host at the property the document reads", async function () {
    const api = publishedApi();
    const host = api[SEARCH_WINDOW_API_PROPERTY];
    if (!host) {
      assert.fail(
        `nothing is published at api.${SEARCH_WINDOW_API_PROPERTY}, so ` +
          `resolveHost() falls back to {} and the window ships inert`,
      );
    }
    for (const member of HOST_CONTRACT) {
      assert.strictEqual(
        typeof host[member],
        "function",
        `the published host has no ${member}()`,
      );
    }
    // The document's own lookup, not a second spelling of the property.
    assert.strictEqual(
      controller.host === host,
      true,
      "the open window resolved its host to the published object",
    );
    log35(`published host has ${String(HOST_CONTRACT.length)} members`);
    await Zotero.Promise.delay(0);
  });

  // =========================================================================
  // Criterion 4 — no optional dependency is silently missing
  // =========================================================================

  it("supplies every member of SearchImportViewModelDeps", async function () {
    const deps = publishedDeps;
    if (!deps) {
      assert.fail(
        "the composition root published no dependency record, so whether " +
          "it bound every port cannot be checked from here",
      );
    }
    const expected = Object.keys(VIEW_MODEL_DEPENDENCIES).sort((a, b) =>
      a.localeCompare(b),
    );
    const supplied = Object.keys(deps)
      .filter((name) => deps[name as keyof typeof deps] !== undefined)
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      supplied,
      expected,
      "every member of SearchImportViewModelDeps must be supplied by the " +
        "composition root; the optional ones degrade silently when they are not",
    );

    // The four §8.5 window seeds, and the two version strings the provenance
    // record carries. Asserted as values because a bound port that returns
    // nothing useful is the same defect one step later.
    const prefs = deps.getPrefs();
    assert.deepEqual(
      Object.keys(prefs).sort((a, b) => a.localeCompare(b)),
      ["hideExisting", "maxResults", "searchYears", "sources"],
      "docs/07 §8.5's four window seeds",
    );
    assert.strictEqual(deps.zoteroVersion, Zotero.version);
    assert.isAbove(deps.pluginVersion.length, 0, "a plugin version is bound");
    assert.isAbove(
      deps.listSources().length,
      0,
      "the real source registry is behind listSources()",
    );
    log35(`dependencies supplied: ${supplied.join(",")}`);
    await Zotero.Promise.delay(0);
  });

  // =========================================================================
  // Criterion 2 — a search reaches P1-T16's pipeline through that host
  // =========================================================================

  it("runs a search through the published host and fills the table", async function () {
    this.timeout(60_000);
    setKeyword(KEYWORD);
    selectSources([PUBLISHED_STUB]);
    behaviour.set(PUBLISHED_STUB, { records: 3, withAbstract: true });

    controller.search();
    await awaitPublishedRun("the search");
    assert.strictEqual(rows().length, 3, "three rows reached the table");

    assert.strictEqual(controller.state.panel, "results");
    const row = el(`rh-search-source-status-${PUBLISHED_STUB}`);
    assert.strictEqual(row.getAttribute("data-rh-outcome"), "succeeded");
    // The row key is `sourceId:nativeId`, which is what the pipeline matches
    // `selectedRecordIds` against — so these rows came through the pipeline and
    // not from anything this spec handed the document.
    const first = controller.state.rows[0];
    assert.strictEqual(
      first?.key.startsWith(`${PUBLISHED_STUB}:`),
      true,
      "the rows carry the pipeline's own record ids",
    );
    log35(`${String(rows().length)} rows through the published host`);
  });

  // =========================================================================
  // `P1-T36` criterion 4 — no record, no file
  //
  // Placed **after the search and before the import**, which is what makes it
  // deterministic rather than lucky: `runSearch` clears the retained record, so
  // at this point in the block the window is showing a result table that no
  // import has written. That is exactly the state in which a user could press
  // an export control, and the one in which writing anything would be wrong.
  // =========================================================================

  it("FR-8: refuses to export when the current run produced no record", async function () {
    this.timeout(30_000);
    const host = publishedApi()[SEARCH_WINDOW_API_PROPERTY];
    if (!host) {
      assert.fail(`nothing is published at api.${SEARCH_WINDOW_API_PROPERTY}`);
    }
    const path = exportPath();
    const outcome = await host.exportProvenance(path);
    assert.strictEqual(
      outcome,
      "no-record",
      "a search clears the retained record, so there is nothing to export",
    );
    assert.isFalse(
      await IOUtils.exists(path),
      "a refused export must not leave a file behind — an empty or " +
        "half-built provenance file on disk is worse than no file, because a " +
        "user would keep it",
    );
    log35(`export with no record: ${outcome}, no file written`);
  });

  // =========================================================================
  // Criterion 3 — the import writes the collection, the items and ONE note
  // =========================================================================

  it("imports through the published host and writes exactly one provenance note", async function () {
    this.timeout(120_000);
    const name = `RH P1-T35 ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    assert.isTrue(
      controller.logic.importEnabled(controller.state.selectedCount),
    );

    controller.import();
    await awaitPublishedRun("the import");
    const summary = await rendered("rh-search-notice", "Imported");

    const collection = collectionNamed(name);
    publishedCollections.push(collection.key);
    const children = (await Zotero.Items.getAsync(
      collection.getChildItems(true),
    )) as { isNote(): boolean; getNoteTitle(): string; getNote(): string }[];
    const notes = children.filter((item) => item.isNote());
    assert.strictEqual(
      children.length - notes.length,
      3,
      "the three records became items",
    );
    // **The member most likely to be left unbound.** Nothing in this block
    // supplies `writeProvenanceNote`: it is the binding the composition root
    // made, and this is the only thing that proves it was made.
    assert.strictEqual(
      notes.length,
      1,
      "FR-8: exactly one provenance note, written through the published " +
        "writeProvenanceNote binding",
    );
    assert.include(
      notes[0]?.getNoteTitle() ?? "",
      PROVENANCE_NOTE_TITLE_PREFIX,
    );
    // The record the note renders carries the version the composition root
    // read off the platform, so `zoteroVersion` is bound and not a placeholder.
    assert.include(
      notes[0]?.getNote() ?? "",
      Zotero.version,
      "the note carries the Zotero version the composition root supplied",
    );

    // `listCollections` is bound to the real library, which the collection the
    // import just created is now in.
    const listed = publishedDeps
      ?.listCollections()
      .some((entry) => entry.name === name);
    assert.isTrue(
      listed,
      "the published listCollections() sees the collection the import created",
    );
    log35(`import summary: ${summary.replace(/\s+/g, " ")}`);
  });

  // =========================================================================
  // `P1-T36` criteria 2 and 3 — the file is written, it validates against the
  // shipped schema, and the redactor's work is in the bytes
  //
  // `docs/13`:1273 makes "the exported JSON validates against
  // `schema/provenance.schema.json`" a release-checklist item for a human. It
  // is asserted here instead, by reading the file back off disk.
  //
  // This test runs its own search and import rather than exporting the record
  // the previous test left, for one reason: the redaction criterion needs a
  // credential-shaped run **in the query**, and the query is read out of the
  // keyword box at import time. Reaching into the previous test's input would
  // make two tests share one fixture, which is the shape that turned
  // `P1-T22`'s cancel test into a cascade. The run is kept cheap — a fourth
  // record, so exactly one item is written.
  // =========================================================================

  it("FR-8: exports the retained record, and the file validates against the shipped schema", async function () {
    this.timeout(120_000);

    // The guard that keeps the validator in this file honest: a keyword the
    // shipped schema grows and this validator ignores would otherwise make the
    // assertion below look stricter than it is.
    const ignored = [...unimplementedSchemaKeywords(PROVENANCE_SCHEMA)].filter(
      (keyword) => !IMPLEMENTED_KEYWORDS.includes(keyword),
    );
    assert.deepEqual(
      ignored,
      [],
      "every keyword the shipped schema uses is one this validator enforces",
    );

    // A credential-shaped run inside an otherwise ordinary query. Synthetic:
    // see SYNTHETIC_KEYISH.
    const query = `${KEYWORD} ${SYNTHETIC_KEYISH}`;
    setKeyword(query);
    selectSources([PUBLISHED_STUB]);
    // Four, so the fourth record is one the library does not hold: the previous
    // test imported the first three, and with hiding **on** a smaller run would
    // leave nothing importable and the Import gate shut. Hiding is ticked here
    // explicitly (`P1-T43`) rather than relied on as the default, so this
    // test's claim about the export does not move when the default does.
    behaviour.set(PUBLISHED_STUB, { records: 4, withAbstract: true });

    controller.search();
    await awaitPublishedRun("the search before the export");
    setHideExisting(true);
    assert.strictEqual(
      controller.state.visible.length,
      1,
      "three of four rows are already in the library, so one is importable",
    );

    const name = `RH P1-T36 ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    controller.import();
    await awaitPublishedRun("the import before the export");
    const collection = collectionNamed(name);
    publishedCollections.push(collection.key);

    const host = publishedApi()[SEARCH_WINDOW_API_PROPERTY];
    if (!host) {
      assert.fail(`nothing is published at api.${SEARCH_WINDOW_API_PROPERTY}`);
    }
    const path = exportPath();
    const outcome = await host.exportProvenance(path);
    assert.strictEqual(
      outcome,
      "written",
      "the export action wrote the record the import retained",
    );

    try {
      assert.isTrue(await IOUtils.exists(path), "the export wrote a file");
      // `IOUtils.readUTF8` rather than `Zotero.File.getContentsAsync`: the
      // latter is typed as a six-member union including `void`, and reading the
      // bytes back is the assertion, so a cast to make the types line up would
      // be a cast over the thing under test. `Zotero.File.putContentsAsync`
      // wrote them, which is the path the product uses.
      const text = await IOUtils.readUTF8(path);

      // Criterion 3, as bytes rather than as a parsed object: the synthetic
      // credential-shaped run is **absent**, and what is in its place is the
      // single gate's own marker. Both halves matter — an export that wrote
      // nothing at all would also pass the first.
      assert.notInclude(
        text,
        SYNTHETIC_KEYISH,
        "src/core/provenance.ts's redaction gate removed the " +
          "credential-shaped run before the bytes were written",
      );
      assert.include(
        text,
        REDACTION_MARK,
        "and left its own marker, so the value was redacted rather than the " +
          "whole query dropped",
      );

      // Criterion 2. The parse is part of the assertion: FR-8 says "a JSON
      // file matching the documented schema".
      const parsed: unknown = JSON.parse(text);
      const errors = validateAgainstSchema(
        PROVENANCE_SCHEMA,
        parsed,
        PROVENANCE_SCHEMA,
      );
      assert.deepEqual(
        errors,
        [],
        `the exported file does not validate: ${errors.join("; ")}`,
      );

      // And it is this run's record, not a stale one: the collection the import
      // just created is the one named in the file.
      if (!isSchemaObject(parsed)) {
        assert.fail("the exported file is not a JSON object");
      }
      assert.strictEqual(
        parsed["targetCollectionKey"],
        collection.key,
        "the exported record describes the run the window is showing",
      );
      assert.strictEqual(
        parsed["zoteroVersion"],
        Zotero.version,
        "and carries the platform version the composition root supplied",
      );
      log35(
        `exported ${String(text.length)} byte(s), schema-valid, ` +
          `redaction marker present`,
      );
    } finally {
      // The spec leaves nothing on disk, for the same reason it erases its
      // collections: a temporary file carrying a provenance record is still a
      // record of a run.
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
    assert.isFalse(await IOUtils.exists(path), "and deleted it afterwards");
  });

  // =========================================================================
  // `P1-T45` criteria 1–4 and 6 — the control a user actually presses
  //
  // These run **after** the export test above and **before** the `isExisting`
  // test below, and the order is load-bearing in both directions: the test
  // above leaves a retained record on the application-scoped view model, and
  // the test below runs a fresh search, which clears it.
  //
  // The chooser is replaced, not opened. A real save dialog is modal and would
  // block the runner until the suite timed out; what is under test here is the
  // path being handed inward, the file arriving, and the sentence rendering —
  // not the operating system's dialog. The dialog's own wiring is asserted
  // structurally by `test/unit/ui/searchDialog.test.ts` against the module URL
  // read off the shipped Zotero binary, and
  // {@link FlowController.pickExportPath} exists as a separate method for
  // exactly this reason.
  // =========================================================================

  /** Run `body` with the chooser replaced, and put the real one back. */
  async function withChosenPath(
    chosen: string,
    body: () => Promise<void>,
  ): Promise<void> {
    const real = controller.pickExportPath;
    (controller as { pickExportPath: () => Promise<string> }).pickExportPath =
      (): Promise<string> => Promise.resolve(chosen);
    try {
      await body();
    } finally {
      (controller as { pickExportPath: () => Promise<string> }).pickExportPath =
        real;
    }
  }

  it("P1-T45: the control is visible after an import, and pressing it writes the chosen file", async function () {
    this.timeout(60_000);
    // The first half of criterion 1, from the other side of the import: the
    // test above imported and exported, so a record exists for this window.
    assert.isTrue(
      (el("rh-search-export") as unknown as { hidden: boolean }).hidden ===
        false,
      "the control is revealed once the run on screen has a record",
    );
    assert.isTrue(controller.state.exportAvailable);

    const path = exportPath();
    try {
      await withChosenPath(path, async () => {
        const outcome = await controller.exportProvenance();
        assert.strictEqual(
          outcome,
          "written",
          "the document handed the chosen path to the published host",
        );
      });
      assert.isTrue(
        await IOUtils.exists(path),
        "the file the chooser named received the record",
      );

      // Criterion 2, asserted **on the text** and not on the element being
      // present: an unresolvable `data-l10n-id` leaves an element alone
      // (`P1-T22`), so "the element exists" and "the sentence rendered" are
      // different claims and only the second one matters to a user.
      const sentence = await rendered(
        "rh-search-export-status",
        "Provenance record exported",
      );
      assert.isAbove(sentence.length, 0);
      assert.isFalse(
        (el("rh-search-export-status") as unknown as { hidden: boolean })
          .hidden,
      );

      // Criterion 6 — the chosen path is in no log line, and in nothing the
      // window shows. `docs/09` §2.2 (2026-10-08). The DOM half is asserted
      // here because a window's text is read by screenshots and bug reports the
      // same way a log is; the log half is asserted at layer 1, where
      // `Zotero.debug` can be captured.
      const shown = stringsUnder("rh-search-status-bar");
      assert.isAbove(shown.length, 4, "the status bar yielded strings to scan");
      for (const text of shown) {
        assert.notInclude(
          text,
          path,
          "the chosen path is not drawn anywhere in the status bar",
        );
      }
      // And not in the bytes it wrote either, which is the half `P1-T36`
      // already proved for the record and this re-measures now that the path
      // is a real one the user chose.
      assert.notInclude(await IOUtils.readUTF8(path), path);
      log35(`export through the control: written, sentence rendered as text`);
    } finally {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  });

  it("P1-T45: Zotero's own file picker constructs and accepts this window", async function () {
    this.timeout(30_000);
    // **Criterion 1's third clause, as far as it can be automated.** "Pressing
    // it opens a chooser" ends in a native modal, and a native modal blocks the
    // mocha runner until the whole suite times out, so `show()` is deliberately
    // **not** called. Everything up to that call is asserted here, in a real
    // Zotero, with the real window:
    //
    // - the module is at the URL the document names;
    // - it exports a `FilePicker` that constructs;
    // - `init()` accepts **this window** — which is `docs/01`:436's actual
    //   requirement, because Zotero's wrapper passes
    //   `parentWindow.browsingContext` to `nsIFilePicker.init`, and that is the
    //   measurement `P1-T36` could not make from the composition root;
    // - the save mode, the filter and the suggested filename are all accepted.
    //
    // What is left for a human is only that the operating system draws the
    // dialog, which is reported with the card rather than claimed here.
    const module = ChromeUtils.importESModule(
      controller.filePickerModule,
    ) as unknown as { FilePicker?: new () => Record<string, unknown> };
    assert.strictEqual(
      typeof module.FilePicker,
      "function",
      `${controller.filePickerModule} exports no FilePicker; the document ` +
        `would then show no sentence rather than claim a write`,
    );
    const Picker = module.FilePicker;
    if (!Picker) {
      assert.fail("unreachable: asserted above");
    }
    const picker = new Picker() as unknown as {
      modeSave: number;
      returnOK: number;
      returnCancel: number;
      returnReplace: number;
      defaultString: string;
      defaultExtension: string;
      init(parent: unknown, title: string, mode: number): void;
      appendFilter(title: string, filter: string): void;
    };

    // The three constants the document branches on, read off the shipped class
    // rather than transcribed.
    assert.strictEqual(picker.modeSave, 1, "modeSave");
    assert.strictEqual(picker.returnOK, 0, "returnOK");
    assert.strictEqual(picker.returnCancel, 1, "returnCancel");
    assert.strictEqual(picker.returnReplace, 2, "returnReplace");

    const title = (el("rh-search-export").getAttribute("label") ?? "").trim();
    assert.isAbove(
      title.length,
      0,
      "Fluent resolved the control's own label, which is the dialog's title " +
        "and the reason no fourth string was minted for it",
    );
    // The call `docs/01`:436 is about. A window with no `browsingContext`
    // throws here, which is exactly why this could not be done from the
    // composition root.
    picker.init(win, title, picker.modeSave);
    picker.appendFilter("JSON", "*.json");
    picker.defaultExtension = "json";

    // **`defaultString` can be written and not read back, measured here on
    // Windows and Zotero 10.0.3.** Reading it threw `NS_ERROR_FAILURE
    // [nsIFilePicker.defaultString]`, so this test asserts the value it is
    // about to set rather than the value the picker returns — and the product
    // code only ever sets it, which is what makes that safe. A test that read
    // it back would fail on this platform while the product worked, which is
    // the opposite of useful. Recorded rather than worked around silently: the
    // first draft of this test read it and failed against correct code.
    const suggested = controller.logic.exportFileName(Date.now());
    assert.isTrue(
      /^research-helper-provenance-\d{4}-\d{2}-\d{2}\.json$/.test(suggested),
      "the suggested filename carries the date and no user data",
    );
    picker.defaultString = suggested;
    log35(
      `file picker: constructed, init(window) accepted, suggested ` +
        `${suggested}`,
    );
  });

  it("P1-T45: a failing write renders the failure sentence", async function () {
    this.timeout(60_000);
    // **The writer is made to fail by naming a directory as the destination.**
    // The real failure path is driven: no bound dependency is replaced and
    // nothing in `src/` is touched. `provenanceFileWriter` is
    // `Zotero.File.putContentsAsync` (`src/zotero/notes.ts`), a file cannot be
    // written over a directory, so it rejects and `exportProvenance` returns
    // `failed`.
    //
    // **A file inside a missing directory was tried first and does not fail** —
    // measured on Zotero 10.0.3 in the run of 2026-10-08, where it returned
    // `written`. `putContentsAsync` hands a string to `OS.File.writeAtomic`,
    // whose Zotero 10 shim creates the parent, so "the parent does not exist"
    // is not a way to make this writer reject. Recorded here rather than left
    // as a comment on a passing test, because the first draft of this test
    // asserted the opposite and failed against unmutated code.
    const directory = PathUtils.join(
      PathUtils.tempDir,
      `rh-p1t45-is-a-directory-${String(Date.now())}`,
    );
    await IOUtils.makeDirectory(directory);
    try {
      assert.isTrue(
        await IOUtils.exists(directory),
        "the destination exists and is a directory, so no file can take its " +
          "place",
      );
      await withChosenPath(directory, async () => {
        const outcome = await controller.exportProvenance();
        assert.strictEqual(outcome, "failed", "the writer rejected");
      });

      const sentence = await rendered(
        "rh-search-export-status",
        "Could not export the provenance record",
      );
      assert.isAbove(sentence.length, 0);
      log35("failed export: failure sentence rendered as text");
    } finally {
      await IOUtils.remove(directory, { ignoreAbsent: true, recursive: true });
    }
  });

  it("P1-T45: dismissing the chooser writes nothing and shows nothing", async function () {
    this.timeout(60_000);
    // Step 4's one outcome with no message. The previous test left the failure
    // sentence on screen, so this asserts the sentence is **unchanged** rather
    // than absent: a dismissal must not say anything, and it must not erase
    // what the window was already saying either.
    const before = textOf("rh-search-export-status");
    assert.isAbove(before.length, 0, "a sentence is on screen to begin with");

    const path = exportPath();
    await withChosenPath("", async () => {
      const outcome = await controller.exportProvenance();
      assert.strictEqual(
        outcome,
        "",
        "the host was never called, so there is no outcome to render",
      );
    });
    assert.strictEqual(
      textOf("rh-search-export-status"),
      before,
      "a dismissed chooser changes nothing on screen",
    );
    assert.isFalse(
      await IOUtils.exists(path),
      "and writes no file anywhere the export would have written one",
    );
    log35("dismissed chooser: nothing written, nothing said");
  });

  // =========================================================================
  // The `isExisting` binding, which has no other witness
  // =========================================================================

  it("marks the imported records as already in the library", async function () {
    this.timeout(60_000);
    setKeyword(KEYWORD);
    selectSources([PUBLISHED_STUB]);
    // **Two, not three.** The stub mints `p1t22-pubmed-0…n-1` deterministically,
    // so a two-record run is a subset of the three that were just imported — and
    // a row count that *differs* from the previous search is what makes the wait
    // below a real transition rather than a predicate that was already true.
    behaviour.set(PUBLISHED_STUB, { records: 2, withAbstract: true });

    controller.search();
    await awaitPublishedRun("the second search");
    // On `state.rows`, the whole result set, and **not** on `rows()`, the
    // rendered table body, which is empty while hiding is on.
    assert.strictEqual(controller.state.rows.length, 2, "two records found");

    // **Which default the window honours (`P1-T43`, trap 1), measured rather
    // than reasoned.** Three places spell a default for `hideExisting` —
    // `docs/07` §8.5 transcribed into `src/prefs/schema.ts`,
    // `addon/content/searchDialog.js`'s `prefBounds`, and `addon/prefs.js` —
    // and only the last is read at run time: Zotero loads `prefs.js` onto the
    // **default branch**, the typed accessor's `Zotero.Prefs.get` returns that
    // value, and the two literals are reached only when the read yields nothing
    // or a non-boolean. So the checkbox is asserted against the default branch
    // and not against a number copied from a document: this claim stays true
    // whichever default ships, and this test does not have to change when the
    // owner's 2026-10-08 flip lands.
    const qualified = qualifiedPrefName("hideExisting");
    assert.isFalse(
      Services.prefs.prefHasUserValue(qualified),
      "the practice profile holds no user value, so what the window read " +
        "is the shipped default",
    );
    const shipped = Services.prefs.getDefaultBranch("").getBoolPref(qualified);
    const hide = el("rh-search-hide-existing") as HTMLInputElement;
    assert.strictEqual(
      hide.checked,
      shipped,
      "the checkbox starts at the value addon/prefs.js put on the default branch",
    );
    assert.strictEqual(
      controller.state.visible.length,
      shipped ? 0 : 2,
      shipped
        ? "hiding is on, so both already-imported rows are hidden"
        : "hiding is off, so both rows are shown",
    );

    // The `isExisting` binding itself, independent of the checkbox: with hiding
    // off both rows are on screen and both carry the marker, because both were
    // just imported — a bound `isExisting` marks both and an unbound one marks
    // neither, and there is no middle reading.
    setHideExisting(false);
    assert.strictEqual(
      markedRows().length,
      2,
      "the published isExisting() found both in the library, through a " +
        "library index the composition root refreshed before the search",
    );
    setHideExisting(shipped);
    log35(
      `hideExisting: default branch ${String(shipped)}, checkbox started ` +
        `${String(hide.checked)}; isExisting marked both rows`,
    );
  });
});

// ---------------------------------------------------------------------------

describe("P1-T22: the Search & Import window driving the pipeline", () => {
  before(async function () {
    this.timeout(90_000);

    const bytes: number = await Zotero.File.getContentsFromURLAsync(
      SEARCH_WINDOW_URL,
    )
      .then((text: unknown) => (typeof text === "string" ? text.length : 0))
      .catch(() => 0);
    if (bytes === 0) {
      assert.fail(
        `${SEARCH_WINDOW_URL} serves nothing — check build.assets in ` +
          `zotero-plugin.config.ts`,
      );
    }
    log(`document served: ${String(bytes)} byte(s)`);

    // The view model's own log stream, routed into the runner's terminal. It is
    // the only window onto a host that runs inside the plugin sandbox, and it is
    // how the Fluent-timing defect in this card's report was found.
    const logger = createLogger({
      sink: {
        write: (line: string) => {
          log(line);
        },
      },
      clock: createSystemClock(),
      level: "debug",
    });
    const sources = registryOf([
      stubSource(
        PUBMED,
        "research-helper-source-pubmed",
        () => behaviour.get(PUBMED) ?? IDLE,
      ),
      // No bundle declares a display name for a second source yet — Phase 2
      // brings each one with its adapter — so this id resolves in no locale and
      // the view model's documented fallback (the source id) is what the table
      // and the status bar show for it. The id can stay `crossref` here where
      // it could not in `P1-T35`'s block (`P2-T26`): this registry is private
      // to this block and starts empty, so a shipped Crossref adapter never
      // collides with it.
      stubSource(
        CROSSREF,
        "research-helper-source-crossref",
        () => behaviour.get(CROSSREF) ?? IDLE,
      ),
    ]);
    p1t22Sources = sources;
    const pipeline = createSearchImportPipeline({
      // The real writer, tapped so `P2-T31`'s case can read the works that
      // reached it; every other case here is unchanged by the tap.
      writer: recordingWriter(
        createZoteroSearchImportWriter({ logger }),
        writtenWorks,
      ),
      writeBatchSize: DEFAULT_CHUNK_SIZE,
      // This block builds its pipeline directly rather than through
      // `buildPipelineSet`, so it supplies the `network-metadata` pool the
      // composition root would (`P2-T28`; the figure is `docs/07` §7.2's).
      pool: new Semaphore(NETWORK_METADATA_POOL_SIZE),
    });
    await refreshIndex();

    const model = createSearchImportViewModel({
      pipeline: recordingPipeline(pipeline, pipelineOutputs),
      jobs: jobFactory(sources, logger),
      logger,
      pluginVersion: config.addonID,
      zoteroVersion: Zotero.version,
      clock: createSystemClock(),
      listSources: () =>
        sources.list().map((source) => ({
          id: source.id,
          displayNameKey: source.displayNameKey,
        })),
      listCollections: () => [],
      getPrefs: () => ({}),
      isExisting: (record: SourceRecord) => {
        const doi = record.work.ids.doi;
        return doi === undefined
          ? false
          : index.findExisting({ doi }) !== undefined;
      },
      writeProvenanceNote: (provenance) => writeProvenanceNote(provenance),
    });

    const api = pluginApi();
    savedApi = api[SEARCH_WINDOW_API_PROPERTY];
    api[SEARCH_WINDOW_API_PROPERTY] = {
      ...model.host,
      // A tap on the published state, so an assertion can read the model's own
      // view of a run as well as the document's.
      //
      // **`P1-T46`: the whole sequence, not only the latest.** `lastState` is
      // kept because most assertions here are about a fact that is still true
      // when they run; `recordState` is what makes a *transient* fact — §4.5's
      // counter, the import summary — observable at all. The two are written
      // together and in this order so that `runsFinished` and the recording can
      // never disagree about which states belong to which run.
      connect: (viewArg: Parameters<typeof model.connect>[0]) =>
        model.connect({
          ...viewArg,
          render: (state) => {
            if (wasRunning && !state.running) {
              runsFinished += 1;
            }
            wasRunning = state.running;
            lastState = state;
            recordState(state);
            viewArg.render(state);
          },
        }),
    };

    const opened = openSearchWindow(Zotero.getMainWindow(), {
      mode: "keyword",
    }) as FlowWindow;
    win = opened;
    await waitUntil(
      () => opened.RHSearchWindow?.state.initialized === true,
      "RHSearchWindow.init() to have run",
      30_000,
    );
    doc = opened.document;
    const found = opened.RHSearchWindow;
    if (!found) {
      assert.fail("the window loaded without RHSearchWindow");
    }
    controller = found;
    await waitUntil(
      () => lastState !== undefined,
      "the host to publish its first state",
    );
    log("window open, host connected");
  });

  after(async function () {
    this.timeout(60_000);
    win?.close();
    const api = pluginApi();
    if (savedApi === undefined) {
      delete api[SEARCH_WINDOW_API_PROPERTY];
    } else {
      api[SEARCH_WINDOW_API_PROPERTY] = savedApi;
    }

    // Fixtures are erased rather than left behind; a failed erase never fails
    // the run (`test/integration/zotero/importer.spec.ts`'s discipline).
    await eraseCollections(createdCollections, "P1-T22");
    await Zotero.Promise.delay(100);
  });

  // =========================================================================
  // 1. A search runs end to end (criterion 1)
  // =========================================================================

  it("fills the table and shows docs/08 §4.6's per-database line", async function () {
    this.timeout(40_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 3, withAbstract: true } });

    assert.strictEqual(controller.state.panel, "results");
    assert.strictEqual(rows().length, 3, "three rows reached the table");

    // §4.6's line is a name element plus a state element, each with its own
    // Fluent id, never one concatenated string (`docs/08` §10.3).
    const row = el("rh-search-source-status-pubmed");
    assert.strictEqual(row.getAttribute("data-rh-outcome"), "succeeded");
    const name = await rendered("rh-search-source-status-pubmed", "PubMed");
    assert.include(name, "3 results", "the count is on the same line");

    // The Source column draws an already-localized display name, resolved from
    // the source's own displayNameKey rather than minted anywhere.
    assert.strictEqual(
      (rows()[0]?.children[4]?.textContent ?? "").trim(),
      "PubMed",
      "the Source cell carries the localized database name",
    );
    log(`per-database line: ${name}`);
  });

  // =========================================================================
  // 2. EMPTY, and the query that must not reach the panel
  // =========================================================================

  it("shows EMPTY with its suggestions and never the pasted query", async function () {
    this.timeout(40_000);
    // 32 characters: below redact()'s 40-character catch-all, which is the whole
    // reason the EMPTY headline is left unpopulated (EMPTY_HEADLINE_OMITTED).
    const key = "0123456789abcdef0123456789abcdef";
    setKeyword(key);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 0 } });

    assert.strictEqual(controller.state.panel, "empty");
    assert.isFalse(
      (el("rh-state-empty") as HTMLElement).hidden,
      "the EMPTY panel is the visible one",
    );
    // §8.4's "why + concrete suggestions": the suggestions line takes no
    // arguments and renders.
    await waitUntil(
      () =>
        Array.from(el("rh-state-empty").children).some((child) =>
          (child.textContent ?? "").includes("broadening"),
        ),
      "the EMPTY suggestions line to render",
    );
    assert.strictEqual(
      textOf("rh-state-empty-headline"),
      "",
      "the headline carries no text, so it carries no query",
    );
    assert.strictEqual(
      lastState?.emptyHeadline,
      undefined,
      "and the view model published none",
    );

    for (const id of [
      "rh-state-empty",
      "rh-results-area",
      "rh-search-status-bar",
      "rh-search-notices",
    ]) {
      for (const text of stringsUnder(id)) {
        assert.notInclude(text, key, `#${id} carries the pasted key`);
      }
    }
    assert.notInclude(doc.title, key, "the window title carries the key");
    log("a 32-character key reaches no panel, no attribute and no title");
  });

  // =========================================================================
  // 3. PARTIAL — §8.4's forgotten state (FR-9)
  // =========================================================================

  it("shows results plus a non-blocking banner when one source fails", async function () {
    this.timeout(40_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED, CROSSREF]);
    await search({
      pubmed: { records: 2, withAbstract: true },
      crossref: { records: 0, error: new OfflineError("stub offline") },
    });

    assert.strictEqual(
      controller.state.panel,
      "results",
      "FR-9: the other database's results are still shown",
    );
    assert.strictEqual(rows().length, 2);
    const banner = el("rh-search-warnings");
    assert.isFalse((banner as HTMLElement).hidden, "the banner is showing");
    assert.strictEqual(
      banner.getAttribute("role"),
      "alert",
      "docs/08 §8.1: an inline banner with role=alert, never a modal",
    );
    const text = await rendered("rh-search-warnings", "database");
    assert.include(text, "could not be searched");
    assert.strictEqual(lastState?.warnings.length, 1);
    // The failed source keeps its own §4.6 line, which is what "do not collapse
    // per-database status into one spinner" means at the end of a run.
    assert.strictEqual(
      el("rh-search-source-status-crossref").getAttribute("data-rh-outcome"),
      "failed",
    );
    log(`PARTIAL banner: ${text}`);
  });

  // =========================================================================
  // 4. ERROR — the OFFLINE row and its Retry action (criterion 4)
  // =========================================================================

  it("renders the OFFLINE row with Retry, and no stack trace", async function () {
    this.timeout(40_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({
      pubmed: { records: 0, error: new OfflineError("stub offline") },
    });

    assert.strictEqual(controller.state.panel, "error");
    await rendered("rh-state-error-headline", "Could not reach any database");
    const line = await rendered("rh-state-error-lines", "offline");
    assert.include(
      line,
      "Zotero is offline.",
      "docs/08 §8.3's OFFLINE message",
    );
    assert.isFalse(
      (el("rh-state-error-retry") as HTMLElement).hidden,
      "§8.3's OFFLINE row offers Retry",
    );
    assert.isTrue(
      (el("rh-state-error-open-preferences") as HTMLElement).hidden,
      "and does not offer Open Preferences",
    );

    // NFR-14 and docs/07 §10.2: never a stack trace, never the provider's own
    // message as the primary text — and not in the disclosure either, because
    // `SerializedError.detail` is free text a 32-character key survives.
    controller.toggleDetails();
    const details = stringsUnder("rh-state-error-details-list").join("\n");
    assert.include(details, "OFFLINE", "the machine code is in the disclosure");
    for (const panelText of stringsUnder("rh-state-error")) {
      assert.notInclude(
        panelText,
        "stub offline",
        "the developer message leaked",
      );
      assert.notInclude(panelText, "    at ", "a stack frame leaked");
      assert.notInclude(panelText, ".ts:", "a source location leaked");
    }
    controller.toggleDetails();
    log(`OFFLINE row: ${line}`);
  });

  // =========================================================================
  // 5. A forced 429 — item 232's truthful row, never a retry countdown
  // =========================================================================

  it("renders a forced 429 as item 232's row, without inventing a retry countdown", async function () {
    this.timeout(40_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({
      pubmed: {
        records: 0,
        error: new RateLimitError(429, 30_000, "eutils.ncbi.nlm.nih.gov"),
      },
    });

    assert.strictEqual(controller.state.panel, "error");
    // docs/08 §8.3's RATE_LIMIT message is "{provider} rate limit reached.
    // Retrying in {n}s." — false since the HTTP client retries a 429 inside
    // the request (nothing is retrying when the window sees it), and the
    // seconds are not carried. Item 232 (owner, 2026-10-21): the window shows
    // "too many requests, refused · try again in a moment" with the database
    // name instead. Asserted against the window's own bundle text, which on
    // this profile's ko-KR chain is the en-US fallback until the Korean is
    // reviewed.
    assert.isFalse(
      UNRENDERABLE_ERROR_ROWS.includes("RATE_LIMIT"),
      "item 232 gave RATE_LIMIT a row",
    );
    // The database name as the window resolves it from the source's
    // `displayNameKey`, so the expected reference is the bundle's, too.
    const database = await resolved({
      id: "research-helper-source-pubmed",
      args: undefined,
    });
    const refused: MessageRef = {
      id: "research-helper-search-error-rate-limit",
      args: { database },
    };
    // The document points PubMed's line at item 232's message, not at
    // rh-error-rate-limit's countdown …
    await pointedAt("rh-state-error-lines", refused);
    // … and Fluent paints the bundle's text for it.
    const expected = await resolved(refused);
    const line = await rendered("rh-state-error-lines", expected);
    assert.include(line, database, "the database is named");
    assert.notInclude(line, "{", "no unresolved Fluent placeable is painted");
    const countdown = await resolved({
      id: "rh-error-rate-limit",
      args: { provider: "PubMed", seconds: 30 },
    });
    assert.notInclude(line, countdown, "no invented retry countdown");
    controller.toggleDetails();
    const details = stringsUnder("rh-state-error-details-list").join("\n");
    assert.include(details, "RATE_LIMIT");
    assert.include(details, "429");
    controller.toggleDetails();
    assert.isFalse(
      (el("rh-state-error-retry") as HTMLElement).hidden,
      "a rate limit is retryable, so Retry is offered",
    );
    assert.isTrue(
      (el("rh-state-error-open-preferences") as HTMLElement).hidden,
      "item 232's row offers Retry alone, never Open Preferences (item 220)",
    );
    log(`429 renders: ${line} | details: ${details.replace(/\n/g, " ")}`);
  });

  // =========================================================================
  // 6. An empty keyword must not claim a network failure (NFR-14)
  // =========================================================================

  it("does not blame the network for an empty keyword", async function () {
    this.timeout(40_000);
    setKeyword("");
    selectSources([PUBMED]);
    await search({ pubmed: { records: 3 } });

    assert.strictEqual(controller.state.panel, "error");
    const headline = await rendered(
      "rh-state-error-headline",
      "Research Helper",
    );
    assert.notInclude(
      headline,
      "Could not reach any database",
      "no source was asked, so nothing can have been unreachable (NFR-14)",
    );
    // The right sentence is `research-helper-search-query-empty`, which no
    // bundle declares — reported with the card, needs a message in P1-T18's
    // bundles.
    assert.strictEqual(
      lastState?.sources.length,
      0,
      "Planning rejected the input before any source was asked",
    );
    log(`empty keyword headline: ${headline}`);
  });

  // =========================================================================
  // 7. Cancel during fetching (criterion 3, FR-10)
  // =========================================================================

  it("cancels a fetch within 2 s and creates nothing (FR-10)", async function () {
    this.timeout(60_000);
    const scope = createScope({
      description: "P1-T22 notifier spy",
      onError: (messageText) => {
        log(`notifier spy teardown: ${messageText}`);
      },
      strict: false,
    });
    const events: string[] = [];
    try {
      await notifierRegistration("P1-T22 write spy", {
        types: ["item", "collection"],
        notify: (event: string, type: string) => {
          events.push(`${type}.${event}`);
        },
      })(scope);

      setKeyword(KEYWORD);
      selectSources([PUBMED]);
      behaviour.set(PUBMED, { records: 40, delayMs: 150 });
      behaviour.set(CROSSREF, IDLE);
      const before = runsFinished;
      const mark = markStates();
      controller.search();
      // Wait until the fetch is demonstrably under way, so the cancel lands in
      // `Fetching` rather than before `Planning`.
      await waitUntil(
        () => controller.state.panel === "searching",
        "the LOADING panel",
      );
      await waitUntil(
        () => (lastState?.progressPercent ?? 0) > 0,
        "the first progress report",
      );

      assert.isFalse(
        (el("rh-search-cancel") as HTMLElement).hidden,
        "Cancel is showing while a job runs",
      );

      // The in-flight §4.6 list names the sources the run **asked**, not every
      // registered adapter: `crossref` is unchecked here and must not be shown
      // as being searched.
      assert.deepEqual(
        (lastState?.sources ?? []).map((line) => line.sourceId),
        [PUBMED],
        "the LOADING list names only the checked database",
      );
      assert.strictEqual(
        (lastState?.sources ?? [])[0]?.outcome,
        "searching",
        "and reports it as in flight",
      );
      // §4.5's "5 of 7 databases", beside the bar — three observations of the
      // same claim, and **none of them a wait on text the run can replace**
      // (`P1-T46`). `renderSearchOutcome` publishes `databaseProgress:
      // undefined` at the end of every run and `clearRef` then empties the
      // element, so a wait for this counter's *text* in the document is lost
      // the moment Fluent takes longer than the fetch does. Reproduced on this
      // machine before the rewrite, with the element reading "".
      const counter = message("research-helper-search-progress-databases", {
        done: 0,
        total: 1,
      });
      assertPublished(
        mark,
        (state) => [state.databaseProgress],
        counter,
        "§4.5's per-database counter",
      );
      await pointedAt("rh-search-progress-databases", counter);
      const resolvedAt = Date.now();
      const databases = await resolved(counter);
      const resolveMs = Date.now() - resolvedAt;
      assert.include(databases, "0 of 1 databases");
      const startedAt = Date.now();
      controller.cancel();
      await waitUntil(() => runsFinished > before, "the run to stop", 10_000);
      const elapsed = Date.now() - startedAt;
      assert.isAtMost(elapsed, 2_000, "FR-10: aborted within 2 s");

      // §8.3's CANCELLED row, and the text assertion this test keeps in the
      // document rather than in the bundle: `renderSearchOutcome`'s cancelled
      // branch publishes it as the run's **terminal** status and nothing
      // touches it again, so the needle cannot go missing under the wait. The
      // state assertion beside it names the count the model decided, which the
      // text alone cannot distinguish from a plural-form accident.
      const cancelledRow = message("rh-error-cancelled", { imported: 0 });
      assertPublished(
        mark,
        (state) => [state.status],
        cancelledRow,
        "§8.3's CANCELLED row",
      );
      const renderedAt = Date.now();
      const status = await rendered("rh-search-status", "Cancelled");
      const renderMs = Date.now() - renderedAt;
      assert.include(status, "0 items", "§8.3's CANCELLED row with its count");
      assert.isTrue(
        (el("rh-search-progress-databases") as HTMLElement).hidden,
        "the database counter is cleared when no fetch is in flight",
      );
      assert.deepEqual(
        events,
        [],
        `a cancelled search wrote to the database: ${events.join(", ")}`,
      );
      log(
        `cancel took ${String(elapsed)} ms and wrote nothing; ` +
          `${String(statesSince(mark).length)} state(s) recorded, ` +
          `the counter resolved through document.l10n in ` +
          `${String(resolveMs)} ms, and the CANCELLED row rendered into the ` +
          `document in ${String(renderMs)} ms`,
      );
    } finally {
      await scope.unregisterAll();
    }
  });

  // =========================================================================
  // 8. Import (criterion 2) and FR-51's split (criterion 6)
  // =========================================================================

  it("imports exactly the checked set and writes one provenance note", async function () {
    this.timeout(90_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 4, withAbstract: true } });
    assert.strictEqual(rows().length, 4);

    // FR-5's arithmetic, and this card's **Do NOT**: exactly the checked set.
    const first = controller.rowCheckboxes()[0];
    if (first === undefined) {
      assert.fail("the table drew no checkboxes");
    }
    first.checked = false;
    first.dispatchEvent(new (win as FlowWindow).Event("change"));
    assert.strictEqual(controller.state.selectedCount, 3);

    const name = `RH P1-T22 first ${String(Date.now())}`;
    const value = controller.adoptNewCollection(name);
    assert.isTrue(
      controller.logic.targetNamed(value),
      "the picker now names a collection",
    );
    assert.isTrue(
      controller.logic.importEnabled(controller.state.selectedCount),
    );

    const mark = markStates();
    await runImport();

    const collection = collectionNamed(name);
    createdCollections.push(collection.key);
    const children = (await Zotero.Items.getAsync(
      collection.getChildItems(true),
    )) as { isNote(): boolean; getNoteTitle(): string }[];
    const notes = children.filter((item) => item.isNote());
    assert.strictEqual(
      children.length - notes.length,
      3,
      "exactly the three checked records became items",
    );
    assert.strictEqual(notes.length, 1, "FR-8: exactly one provenance note");
    assert.include(
      notes[0]?.getNoteTitle() ?? "",
      PROVENANCE_NOTE_TITLE_PREFIX,
      "the note is the provenance note",
    );

    // Step 3's summary, with FR-51's split and R-17's coverage figure — as
    // `P1-T46`'s three observations rather than a `rendered()` wait on
    // `#rh-search-notice`. **Converted by `P1-T43` on 2026-10-13 after it
    // failed twice in one afternoon** with `timed out after 25000 ms waiting
    // for Fluent to render "Imported" into #rh-search-notice (it reads "")`,
    // in runs whose first test of this block took 1,030 ms and whose costs then
    // doubled (915 → 2,000 → 4,019 → 8,002 → 16,024 ms) — the slow mode
    // `plan/00` §6 item 23 records. `P1-T46` left this wait alone because it
    // passed its red run by two seconds; it no longer does. The claims are
    // unchanged: what the view model decided, where the document pointed the
    // notice, and the text the bundle produces for both lines.
    const summaryRef = message("research-helper-import-summary", {
      imported: 3,
      linked: 0,
      skipped: 0,
      failed: 0,
    });
    const coverageRef = message("research-helper-import-abstract-coverage", {
      percent: 100,
    });
    assertPublished(
      mark,
      (state) => state.notices,
      summaryRef,
      "the import summary, in the notice region",
    );
    assertPublished(
      mark,
      (state) => state.notices,
      coverageRef,
      "R-17's coverage line, in the notice region",
    );
    await pointedAt("rh-search-notice", summaryRef);
    await pointedAt("rh-search-notice", coverageRef);
    const summary = await resolved(summaryRef);
    assert.include(summary, "Imported 3");
    assert.include(summary, "Linked 0");
    assert.include(summary, "0 failed");
    assert.include(
      await resolved(coverageRef),
      "Abstracts present for 100%",
      "R-17's coverage",
    );
    assert.strictEqual(lastState?.notices.length, 2);

    // The import publishes a view state on every progress snapshot. If the
    // document re-applied the same result set each time, the table would be
    // rebuilt and the unchecked row would come back selected.
    assert.strictEqual(
      controller.state.selectedCount,
      3,
      "the selection survived the import's progress snapshots",
    );
    log(`import summary: ${summary.replace(/\s+/g, " ")}`);
  });

  it("P2-T31: a two-source same-DOI preview, then its import, writes the merged work the table showed — every source in seenIn, the preview's fieldOrigin, deep-equal", async function () {
    this.timeout(90_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED, CROSSREF]);
    // Both stubs mint `10.5555/p2t31-<n>`, so the two sources return the same
    // two works and the cascade's identifier tier folds each pair (FR-50).
    const shared: StubBehaviour = {
      records: 2,
      withAbstract: true,
      sharedWork: "p2t31",
    };
    await search({ pubmed: shared, crossref: shared });
    assert.strictEqual(rows().length, 2, "one row per work, not per record");

    const preview = pipelineOutputs[pipelineOutputs.length - 1];
    if (preview === undefined) {
      assert.fail("the tap saw no preview output");
    }
    assert.strictEqual(preview.works.length, 2);
    for (const work of preview.works) {
      assert.deepEqual(
        [...work.provenance.seenIn].sort(),
        [CROSSREF, PUBMED].sort(),
        "the preview shows both contributing sources",
      );
      assert.isAbove(
        Object.keys(work.provenance.fieldOrigin).length,
        0,
        "a two-record merge contests fields and records their winners",
      );
    }
    assert.strictEqual(controller.state.selectedCount, 2);

    const name = `RH P2-T31 ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    writtenWorks.length = 0;
    await runImport();

    const imported = pipelineOutputs[pipelineOutputs.length - 1];
    assert.strictEqual(imported?.outcome, "succeeded");
    assert.strictEqual(imported?.write?.created, 2, "two new items");
    // The criterion: what reached the writer is the previewed work — deep-equal
    // as a whole, and in particular `seenIn` and `fieldOrigin`, which a
    // re-merge of the representative alone would have reduced to one source
    // and an empty record.
    assert.deepEqual(writtenWorks, [...preview.works]);
    assert.deepEqual(
      writtenWorks.map((work) => work.provenance.seenIn),
      preview.works.map((work) => work.provenance.seenIn),
    );
    assert.deepEqual(
      writtenWorks.map((work) => work.provenance.fieldOrigin),
      preview.works.map((work) => work.provenance.fieldOrigin),
    );

    const collection = collectionNamed(name);
    createdCollections.push(collection.key);
    const children = (await Zotero.Items.getAsync(
      collection.getChildItems(true),
    )) as { isNote(): boolean }[];
    assert.strictEqual(
      children.filter((item) => !item.isNote()).length,
      2,
      "the two merged works became two items, not four",
    );
    log(
      `P2-T31 written seenIn: ${writtenWorks
        .map((work) => work.provenance.seenIn.join("+"))
        .join(", ")}`,
    );
  });

  it("P2-T34: a two-source same-DOI preview, then its import, writes a provenance note whose merge decisions name the tier and confidence (FR-50 scenario 2)", async function () {
    this.timeout(90_000);
    setKeyword(KEYWORD);
    selectSources([PUBMED, CROSSREF]);
    const shared: StubBehaviour = {
      records: 2,
      withAbstract: true,
      sharedWork: "p2t34",
    };
    await search({ pubmed: shared, crossref: shared });
    assert.strictEqual(rows().length, 2, "one row per work, not per record");

    const preview = pipelineOutputs[pipelineOutputs.length - 1];
    if (preview === undefined) {
      assert.fail("the tap saw no preview output");
    }
    // `run` wrote `MergedWork.decisions` onto the output: one DOI-tier merge
    // per shared work, each naming its merged work.
    assert.deepEqual(
      preview.mergeDecisions.map((d) => [d.tier, d.confidence]),
      [
        ["doi", 1],
        ["doi", 1],
      ],
      "two DOI-tier merges at confidence 1",
    );
    assert.deepEqual(
      preview.mergeDecisions.map((d) => d.workKey),
      preview.works.map((w) => w.workKey),
      "each decision names the merged work it belongs to",
    );

    const name = `RH P2-T34 ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    await runImport();

    const imported = pipelineOutputs[pipelineOutputs.length - 1];
    assert.strictEqual(imported?.outcome, "succeeded");
    // The import ran no cascade; the window handed the preview's decisions back.
    assert.deepEqual(imported?.mergeDecisions, preview.mergeDecisions);

    const collection = collectionNamed(name);
    createdCollections.push(collection.key);
    const children = (await Zotero.Items.getAsync(
      collection.getChildItems(true),
    )) as { isNote(): boolean; getNote(): string }[];
    const notes = children.filter((item) => item.isNote());
    assert.strictEqual(notes.length, 1, "FR-8: exactly one provenance note");
    const html = notes[0]?.getNote() ?? "";
    log(
      `P2-T34 note merge section: ${html.slice(
        html.indexOf("Merge decisions"),
        html.indexOf("Merge decisions") + 400,
      )}`,
    );
    assert.include(html, "Merge decisions", "the note has the section");
    for (const decision of preview.mergeDecisions) {
      assert.include(html, decision.workKey, "the note names the merged work");
    }
    assert.include(html, "<code>doi</code>", "the note names the tier");
    assert.include(
      html,
      "<strong>Confidence</strong>: 1",
      "the note names the confidence",
    );
  });

  it("P1-T43: offers exactly the three outcomes the host maps, with 'link' pre-selected", async function () {
    // `addon/content/searchDialog.xhtml` is a plain asset nothing typechecks, so
    // the one binding between its radio values and `SearchWindowDuplicates` —
    // the union the view model's mapping is total over — is this assertion.
    const radios = Array.from(el("rh-search-duplicates").children).map(
      (radio) => radio.getAttribute("value") ?? "",
    );
    assert.deepEqual(
      radios.toSorted(),
      [...SEARCH_WINDOW_DUPLICATES].toSorted(),
      "the document's radios are the union: no more, no fewer, no other words",
    );
    // Card step 3: the pre-selection is docs/08 §4.5's wireframe's and was left
    // alone — it agrees with the importer's own default, "link-existing".
    assert.strictEqual(
      duplicatesGroup().value,
      "link",
      "docs/08 §4.5 pre-selects 'Add existing item to collection'",
    );
    await Zotero.Promise.delay(0);
  });

  it("reports linked-existing separately from created (FR-51)", async function () {
    this.timeout(90_000);
    // The index the `existing` badge reads is built once per run in the product
    // too; rebuilding it here is what makes the three just-imported records show
    // as already present.
    await refreshIndex();
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 4, withAbstract: true } });

    // **`P1-T43`, the owner's decision of 2026-10-08:** an already-present
    // paper is **shown, marked**, and §4.4's control decides what happens to
    // it. Until that card this test asserted the opposite — the box starts
    // ticked, three of four rows are gone, unticking brings them back — which
    // was the measurement that made the control unreachable from the window.
    // Hiding is switched off **explicitly** here rather than read off the
    // preference, so what this test claims about FR-51 does not depend on
    // which default ships; the preference-to-checkbox seeding is asserted
    // where the preference is read (`P1-T35`'s block, and
    // `test/unit/ui/searchDialog.test.ts`).
    setHideExisting(false);
    assert.strictEqual(
      controller.state.visible.length,
      4,
      "all four rows are shown, the three present ones included",
    );
    assert.strictEqual(
      controller.state.selectedCount,
      4,
      "and all four are checked (FR-5) — P1-T21's checked ∩ visible, unchanged",
    );

    // The marking, in a real Zotero. Never exercised before `P1-T43`: a marked
    // row was hidden by default, so `buildRow`'s badge branch had never run
    // where anything could look at it.
    const marked = markedRows();
    assert.strictEqual(
      marked.length,
      3,
      "exactly the three imported records carry the already-present row class",
    );
    assert.strictEqual(
      rows().length - marked.length,
      1,
      "and the one new record does not",
    );
    for (const row of marked) {
      await assertMarkedRow(row);
    }

    // FR-51's split under "Add existing item to collection", as three
    // observations of the same claim (`P1-T46`). The notice region is
    // **rebuilt** on every published state — `renderMessageList` clears its
    // host and makes a fresh `<description>` per line — so a wait for this
    // summary's text in the document waits on nodes the next state has already
    // thrown away. Reproduced on this machine before the rewrite, with the
    // element reading "".
    //
    // The counts are in the assertion rather than in the needle, so what is
    // checked is what the view model **decided**: `write.created` 1,
    // `write.linkedExisting` 3, and nothing skipped or failed. The old needle
    // could not tell "Linked 3" from "Linked 3" beside a wrong skipped count.
    const { summary, items } = await importUnder("link", {
      imported: 1,
      linked: 3,
      skipped: 0,
    });
    assert.include(summary, "Imported 1", "only the fourth record was new");
    assert.include(
      summary,
      "Linked 3",
      "FR-51: the three existing ones linked",
    );
    assert.strictEqual(
      items,
      4,
      "the collection holds the one new item plus the three linked ones",
    );
    setHideExisting(true);
  });

  it("P1-T43: skips the present rows when the control says so, and writes nothing for them", async function () {
    this.timeout(90_000);
    await refreshIndex();
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    // Five: the four the two imports above created, plus one the library does
    // not hold — so "skip" is told apart from "link" (which would link four)
    // and from "import anyway" (which would create five) by a single summary.
    await search({ pubmed: { records: 5, withAbstract: true } });
    setHideExisting(false);
    assert.strictEqual(controller.state.visible.length, 5);
    assert.strictEqual(controller.state.selectedCount, 5);
    assert.strictEqual(markedRows().length, 4, "four of five are marked");

    const { summary, items } = await importUnder("skip", {
      imported: 1,
      linked: 0,
      skipped: 4,
    });
    assert.include(summary, "Skipped 4 duplicates", "docs/08 §4.4: skip");
    assert.include(summary, "Linked 0", "and nothing was linked");
    assert.strictEqual(
      items,
      1,
      "only the fifth record reached the collection; the four present ones " +
        "were neither copied nor added to it",
    );
    setHideExisting(true);
  });

  it("P1-T43: creates a second item for every present row under 'import anyway'", async function () {
    this.timeout(90_000);
    await refreshIndex();
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 5, withAbstract: true } });
    setHideExisting(false);
    assert.strictEqual(controller.state.visible.length, 5);
    assert.strictEqual(
      markedRows().length,
      5,
      "all five are in the library now, and all five are marked",
    );

    // FR-51 says never to do this silently; the user's explicit radio is what
    // makes it not silent, and the summary says so in its own words.
    const { summary, items } = await importUnder("import", {
      imported: 5,
      linked: 0,
      skipped: 0,
    });
    assert.include(summary, "Imported 5", "docs/08 §4.4: import anyway");
    assert.include(summary, "Skipped 0", "nothing was dropped");
    assert.strictEqual(
      items,
      5,
      "five new items, although every one of them already had a twin",
    );
    setHideExisting(true);
  });

  it("P1-T43: refuses an import whose duplicate value the window cannot produce, rather than defaulting", async function () {
    this.timeout(20_000);
    const host = pluginApi()[SEARCH_WINDOW_API_PROPERTY] as SearchWindowHostApi;
    const name = `RH P1-T43 refused ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    setHideExisting(false);
    const request = controller.collectImportRequest();
    assert.isAbove(
      request.records.length,
      0,
      "the request carries rows and names a target, so neither is what refuses it",
    );

    const before = runsFinished;
    const mark = markStates();
    // The importer's own word in the window's slot — what `phase1-dod.spec.ts`
    // carried until `P1-T43`. The type now forbids it, so a cast is the only
    // way to write it: that is the compile-time half of the claim, and this is
    // the run-time half for a document nothing typechecks.
    await host.runImport({
      ...request,
      duplicates: "link-existing" as unknown as SearchWindowDuplicates,
    });
    assert.strictEqual(runsFinished, before, "no job was started");
    assert.strictEqual(statesSince(mark).length, 0, "nothing was published");
    const created = Zotero.Collections.getByLibrary(
      Zotero.Libraries.userLibraryID,
    ).find((collection) => collection.name === name);
    if (created !== undefined) {
      // A product that imported anyway must not leave its fixture behind in
      // the shared practice profile on top of failing this assertion.
      createdCollections.push(created.key);
    }
    assert.strictEqual(created, undefined, "no collection was created");
    setHideExisting(true);
    log("refused: a value outside the union started no job and wrote nothing");
  });

  // =========================================================================
  // 9. The structural claim about the host contract
  // =========================================================================

  it("takes every member of the document's host contract", async function () {
    const api = pluginApi()[SEARCH_WINDOW_API_PROPERTY] as Record<
      string,
      unknown
    >;
    for (const member of [
      "listSources",
      "listCollections",
      "getPrefs",
      "connect",
      "runSearch",
      "runImport",
      "cancel",
    ]) {
      assert.strictEqual(
        typeof api[member],
        "function",
        `the host has no ${member}()`,
      );
    }
    // The row keys the document hands back are what the pipeline matches
    // `selectedRecordIds` against, so they have to be `SourceRecord.id`s.
    const sample: SearchWindowRecord | undefined = lastState?.records?.[0];
    if (sample === undefined) {
      assert.fail("no result set was ever published");
    }
    assert.include(sample.key, ":", "a row key is sourceId:nativeId");
    assert.strictEqual(sample.typeLabel, "journal-article");
    await Zotero.Promise.delay(0);
  });

  // =========================================================================
  // 10. Step 6 — the completion toast, per docs/08 §4.4
  // =========================================================================

  it("asks for the popup on completion and names the outcome once per run", async function () {
    this.timeout(20_000);
    assert.isAbove(openOnAsked.length, 6, "every test above started a job");
    assert.deepEqual(
      [...new Set(openOnAsked)],
      ["completion"],
      "docs/08 §4.4: nothing is drawn outside the window until the end",
    );
    assert.strictEqual(
      doneCalls.length,
      openOnAsked.length,
      "exactly one terminal done() per job",
    );
    // The import's toast carries the summary, which is what §4.4's "so the user
    // gets feedback if they have switched away from the window" is for.
    const withSummary = doneCalls.filter((call) =>
      (call.message ?? "").includes("Imported"),
    );
    assert.isAbove(withSummary.length, 0, "no toast carried the summary");
    assert.strictEqual(withSummary[0]?.outcome, "succeeded");
    // A partial run is a *completed* run (FR-9), so no job reported "failed"
    // because one database did not answer.
    assert.strictEqual(
      doneCalls.filter((call) => call.outcome === "cancelled").length,
      1,
      "exactly one run was cancelled",
    );
    log(
      `done(): ${doneCalls
        .map(
          (call) =>
            `${call.outcome}/${call.message === undefined ? "-" : "msg"}`,
        )
        .join(" ")}`,
    );
  });

  // =========================================================================
  // 11. `P2-T36` — the window over the real PubMed adapter and two recorded
  //     responses. Last on purpose: case 10 counts every run above it, and
  //     this case moves the year and size controls, which it restores.
  // =========================================================================

  it("P2-T36: drives the real PubMed adapter over the two recorded window fixtures and fills the table", async function () {
    this.timeout(60_000);
    const registry = p1t22Sources;
    if (registry === undefined) {
      assert.fail("P1-T22's before() did not keep its registry");
    }
    const dir = await repositoryFixtureDir("pubmed");

    // What the recording holds, read off disk through the port, so the
    // assertions below compare the window against the fixture and not against
    // a number copied into this file.
    const windowRequest = recordedEsearchRequest(
      pubmedWindowQuery(),
      PUBMED_WINDOW_MAX_RESULTS,
      0,
    );
    assert.strictEqual(fixtureKey(windowRequest), WINDOW_ESEARCH_KEY);
    const recorded = JSON.parse(
      await zoteroFixtureIo.readText(dir, `${WINDOW_ESEARCH_KEY}.json`),
    ) as { body: string };
    const recordedIds = parseEsearchBody(
      recorded.body,
      windowRequest.url,
    ).pmids;
    assert.strictEqual(recordedIds.length, PUBMED_WINDOW_MAX_RESULTS);

    // The shipped adapter, mapper (Gecko's DOMParser) and HTTP client, over
    // the replay transport — the composition root's parts, minus the network.
    const replay = createReplayHttpClient({
      dir,
      host: NCBI_HOST,
      io: zoteroFixtureIo,
    });
    const real = createPubmedSource({
      http: replay.client,
      clock: replay.clock,
      mapRecords: createPubmedRecordMapper({ clock: replay.clock }),
    });

    const yearsFrom = el("rh-search-years-from") as unknown as {
      value: string;
    };
    const yearsTo = el("rh-search-years-to") as unknown as { value: string };
    const maxResults = el("rh-search-max-results") as HTMLInputElement;
    const saved = {
      from: yearsFrom.value,
      to: yearsTo.value,
      max: maxResults.value,
    };
    const displaced = registry.replaceForTest(real);
    try {
      assert.strictEqual(
        registry.get(PUBMED),
        real,
        "the real adapter occupies the pubmed slot for this search",
      );
      setKeyword(PUBMED_WINDOW_KEYWORD);
      yearsFrom.value = String(PUBMED_WINDOW_YEAR);
      yearsTo.value = String(PUBMED_WINDOW_YEAR);
      maxResults.value = String(PUBMED_WINDOW_MAX_RESULTS);
      selectSources([PUBMED]);
      const mark = markStates();
      await search({});

      assert.strictEqual(controller.state.panel, "results");
      assert.strictEqual(
        rows().length,
        PUBMED_WINDOW_MAX_RESULTS,
        "one row per recorded record",
      );

      // The request the window made is the recorded one, byte for byte: the
      // replay transport resolved exactly the two pinned fixtures, in order.
      const calls = replay.transport.calls.map((call) =>
        fixtureKey({
          method: call.method,
          url: call.url,
          ...(call.options.body !== undefined && { body: call.options.body }),
        }),
      );
      assert.deepEqual(
        calls,
        [WINDOW_ESEARCH_KEY, WINDOW_EFETCH_KEY],
        "one esearch and one efetch, both recorded",
      );
      assert.strictEqual(replay.transport.calls[0]?.url, windowRequest.url);

      const preview = pipelineOutputs[pipelineOutputs.length - 1];
      if (preview === undefined) {
        assert.fail("the tap saw no preview output");
      }
      assert.deepEqual(
        preview.records.map((record) => record.nativeId),
        [...recordedIds],
        "the records are the recorded idlist, in NCBI's order",
      );
      assert.isTrue(
        preview.records.every(
          (record) =>
            record.sourceId === PUBMED && record.work.title.trim() !== "",
        ),
        "every record is the real adapter's, with a title from the parser",
      );
      const report = preview.perSource[0];
      assert.strictEqual(report?.sourceId, PUBMED);
      assert.strictEqual(report?.error, undefined);
      assert.strictEqual(report?.recordsRetrieved, PUBMED_WINDOW_MAX_RESULTS);
      assert.strictEqual(
        report?.dateFilterApplied,
        "server",
        "the real adapter filters dates server-side, where the stub cannot",
      );
      assert.strictEqual(
        report?.transmittedQuery,
        real.explainQuery(pubmedWindowQuery()),
      );

      // docs/08 §4.6's line, as `P1-T46`'s three observations — what the
      // model decided, what the document points at, what the bundle resolves
      // — and **not** a wait on painted text. Measured on this case's first
      // red run (2026-10-15, run 5): last in this block, it lands where the
      // file header's slow mode has doubled the per-test cost to ~32 s, and a
      // `rendered()` wait on this element timed out at 25 s reading "".
      const countRef = message("research-helper-search-source-results", {
        count: PUBMED_WINDOW_MAX_RESULTS,
      });
      const nameRef = message("research-helper-source-pubmed");
      assertPublished(
        mark,
        (state) => state.sources.map((line) => line.detail),
        countRef,
        "the per-database count",
      );
      assert.strictEqual(
        el("rh-search-source-status-pubmed").getAttribute("data-rh-outcome"),
        "succeeded",
      );
      await pointedAt("rh-search-source-status-pubmed", nameRef);
      await pointedAt("rh-search-source-status-pubmed", countRef);
      const line = `${await resolved(nameRef)} ${await resolved(countRef)}`;
      assert.include(line, "PubMed");
      assert.include(line, `${String(PUBMED_WINDOW_MAX_RESULTS)} results`);
      assert.strictEqual(
        (rows()[0]?.children[4]?.textContent ?? "").trim(),
        "PubMed",
        "the Source cell names the real adapter's database",
      );
      log(
        `P2-T36 window over the real adapter: ${String(rows().length)} rows ` +
          `from ${calls.join(" + ")}; ${line}`,
      );
    } finally {
      registry.replaceForTest(displaced);
      yearsFrom.value = saved.from;
      yearsTo.value = saved.to;
      maxResults.value = saved.max;
    }
  });
});
