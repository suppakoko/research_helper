/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T22` — the window driving the pipeline, end to end, in a live Zotero.
 * `P1-T35` — the same path, through the host the **plugin itself** publishes.
 *
 * ## Two `describe` blocks, and why both exist
 *
 * `P1-T35` publishes the host at startup, so there are now two different things
 * worth asserting and they need different fixtures:
 *
 * - **`P1-T35`'s block runs first** and drives the *published* host: the real
 *   service graph, the real source registry, the real pipeline, the real
 *   writer, and the `isExisting` / `writeProvenanceNote` bindings the
 *   composition root made. Nothing of that path comes from this file. Its stub
 *   source is registered into the **real** registry under a `SourceId` this
 *   build ships no adapter for, because `SourceRegistry.register` throws on a
 *   duplicate and declares no unregister — see {@link PUBLISHED_STUB}.
 * - **`P1-T22`'s block keeps its own host**, because the state machine it
 *   covers needs a stub that *is* `pubmed`: forced 429s, an injected
 *   `OfflineError`, a 40-record fetch to cancel mid-flight, and the one
 *   localized source display name any bundle declares
 *   (`research-helper-source-pubmed`). Those cannot be reached through the real
 *   registry, which already holds the real PubMed adapter under that id.
 *
 * Neither block makes an HTTP request.
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
 * `LiteratureSource` declared in this file, so **no HTTP request is made by this
 * spec at all** — not to NCBI, not to anywhere. `docs/02` §3.1's usage policy
 * makes a repeated live search the wrong way to exercise a state machine, and
 * the one failure mode a live source could add (a real 429) is injected here as
 * the typed error the adapter would have thrown.
 *
 * `test/contract/_transport.ts`'s replay transport is **not** usable from here:
 * it imports `node:fs/promises` and `node:crypto`, neither of which exists in
 * the Zotero sandbox. That is why the double is a source rather than a
 * transport, and it is reported with the card.
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
// Type-only, so nothing of `src/addon.ts` — and nothing of the `hooks` module
// it imports — is bundled into this spec. The *values* this block reads all
// come off the live plugin instance, which is the only copy that matters:
// a spec is bundled separately from the plugin, so an imported module would be
// a second instance with none of the plugin's state.
import type { PluginApi } from "../../src/addon";
import { createScope } from "../../src/bootstrap/container";
import { createZoteroSearchImportWriter } from "../../src/bootstrap/registerPipelines";
import { createSystemClock } from "../../src/core/clock";
import { OfflineError, RateLimitError } from "../../src/core/errors";
import { createLogger } from "../../src/core/logger";
import {
  CompositeProgressReporter,
  createObservableProgressSink,
} from "../../src/core/jobQueue/progress";
import { normalizeDoi, type SourceId } from "../../src/model/ids";
import type { SourceRecord } from "../../src/model/sourceRecord";
import { createSearchImportPipeline } from "../../src/pipeline/searchImport/searchImportPipeline";
import type { PipelineContext } from "../../src/pipeline/types";
import type { SourceRegistry } from "../../src/sources/registry";
import type {
  LiteratureSource,
  SourceCallContext,
  SourcePage,
  SourceQuery,
} from "../../src/sources/types";
import {
  SEARCH_WINDOW_API_PROPERTY,
  SEARCH_WINDOW_URL,
  openSearchWindow,
  type SearchWindowHandle,
  type SearchWindowRecord,
} from "../../src/ui/dialogs/searchDialog";
import {
  UNRENDERABLE_ERROR_ROWS,
  createSearchImportViewModel,
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
import { notifierRegistration } from "../../src/zotero/registrations";

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
): SourceRecord {
  const nativeId = `p1t22-${sourceId}-${String(n)}`;
  return {
    id: `${sourceId}:${nativeId}`,
    sourceId,
    nativeId,
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
    work: {
      ids: { doi: doiOf(nativeId) },
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
      relatedByWork: false,
      lookupById: ["doi"],
      abstractsInSearch: true,
      citationGraph: false,
      // False on purpose: it routes every run through FR-3's **client-side**
      // recency filter, which is the branch that records
      // `dateFilterApplied: "client"` in the provenance record.
      dateFilter: false,
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
            yield stubRecord(id, n, behaviour.withAbstract === true);
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
  };
  readonly logic: {
    targetNamed(value: unknown): boolean;
    importEnabled(count: number): boolean;
  };
  search(): void;
  import(): void;
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
/** Per-source behaviour for the next search, rewritten by each test. */
const behaviour = new Map<SourceId, StubBehaviour>();
/** The last state the view model published, for assertions about the model. */
let lastState: SearchViewState | undefined;
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

/** Wait for Fluent to have put `needle` into the element at `id`. */
async function rendered(id: string, needle: string): Promise<string> {
  await waitUntil(
    () => textOf(id).includes(needle),
    `Fluent to render "${needle}" into #${id} (it reads "${textOf(id)}")`,
  );
  return textOf(id);
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

/** A registry whose contents this spec fixes once, in `before()`. */
function registryOf(adapters: readonly LiteratureSource[]): SourceRegistry {
  const byId = new Map<SourceId, LiteratureSource>(
    adapters.map((adapter) => [adapter.id, adapter]),
  );
  return {
    register(source: LiteratureSource): void {
      byId.set(source.id, source);
    },
    get(id: SourceId): LiteratureSource | undefined {
      return byId.get(id);
    },
    list(): readonly LiteratureSource[] {
      return [...byId.values()];
    },
    listConfigured(): readonly LiteratureSource[] {
      return [...byId.values()].filter((source) => source.isConfigured());
    },
  };
}

// ---------------------------------------------------------------------------
// 4. `P1-T35` — the host the *composition root* published
// ---------------------------------------------------------------------------

/**
 * The source id this block stubs, and **why it is not `pubmed`**.
 *
 * The block below drives the host `src/bootstrap/registerUI.ts` published at
 * startup, which means the registry behind it is the **real** one — the one
 * `installServices()` filled through `registerSources()`. `SourceRegistry`
 * *throws* on a duplicate id (`src/sources/registry.ts:76`) and declares no
 * unregister, so the real PubMed adapter cannot be replaced by a stub and must
 * simply never be ticked.
 *
 * So a stub is registered under a `SourceId` this build has no adapter for, and
 * every search below ticks that one alone. **No HTTP request leaves this
 * machine in this block either** — the same guarantee `P1-T22`'s block gives,
 * reached a different way. `test/contract/_transport.ts`'s replay transport is
 * still unusable here (`node:fs/promises`, `node:crypto`), which is why the
 * double is a source rather than a transport.
 *
 * The consequence is that no bundle declares `research-helper-source-crossref`
 * — only `research-helper-source-pubmed` exists (`addon/locale/en-US/
 * research-helper-mainWindow.ftl:114`) — so this block's Source column shows the
 * documented fallback, the source id. The localized-name path stays covered by
 * `P1-T22`'s block, which drives its own registry and can call its stub
 * `pubmed`.
 *
 * ### The residue this leaves, and what it does not do
 *
 * Because there is no unregister, the stub **stays in the application-wide
 * registry for the rest of the process**. That is the one piece of lasting state
 * this block leaves behind, and it is real: a later spec asking the real registry
 * how many adapters exist would see two. It needs a `SourceRegistry` test seam to
 * remove, which is outside `P1-T35`'s `Files` list and is reported with the card.
 *
 * **It does not reach `P1-T22`'s block, and that was measured rather than
 * assumed.** `P1-T22` publishes its own host over its own `registryOf([...])`, so
 * the window it opens renders its own two checkboxes. Logged from inside the
 * failing cancel test with this block enabled: `boxes=["pubmed:true",
 * "crossref:false"]`, `asked=["pubmed"]`,
 * `l10nArgs={"done":0,"total":1}`, and the counter element read
 * `"0 of 1 databases"` — the exact text that test waits for, present and correct.
 * The counter cannot read `of 2` from a registry its host never consults.
 */
const PUBLISHED_STUB: SourceId = "crossref";

/** The dependency record that host was built from. */
let publishedDeps: Required<SearchImportViewModelDeps> | undefined;
/** Collections this block created, erased in its own `after()`. */
const publishedCollections: string[] = [];

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
  isExisting: true,
  writeProvenanceNote: true,
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

/** The seven members `resolveHost()`'s own comment documents, plus `connect`. */
const HOST_CONTRACT: readonly (keyof SearchWindowHostApi)[] = [
  "listSources",
  "listCollections",
  "getPrefs",
  "connect",
  "runSearch",
  "runImport",
  "cancel",
];

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
    // Into the *real* registry. See PUBLISHED_STUB for why this id and not
    // `pubmed`, and why nothing here reaches the network.
    services.sources.register(
      stubSource(
        PUBLISHED_STUB,
        "research-helper-source-crossref",
        () => behaviour.get(PUBLISHED_STUB) ?? IDLE,
      ),
    );
    log35(
      `real registry now holds ` +
        `${services.sources
          .list()
          .map((source) => source.id)
          .join(",")}`,
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
  // The `isExisting` binding, which has no other witness
  // =========================================================================

  it("marks the imported records as already in the library", async function () {
    this.timeout(60_000);
    setKeyword(KEYWORD);
    selectSources([PUBLISHED_STUB]);
    // **Two, not three.** The stub mints `p1t35-crossref-0…n-1` deterministically,
    // so a two-record run is a subset of the three that were just imported — and
    // a row count that *differs* from the previous search is what makes the wait
    // below a real transition rather than a predicate that was already true.
    behaviour.set(PUBLISHED_STUB, { records: 2, withAbstract: true });

    controller.search();
    await awaitPublishedRun("the second search");
    // On `state.rows`, the whole result set, and **not** on `rows()`, the
    // rendered table body: with `hideExisting` on and every row already in
    // the library the body is empty, which is the outcome under test.
    assert.strictEqual(controller.state.rows.length, 2, "two records found");

    // `hideExisting` defaults to true (`docs/07` §8.5), so every row the
    // library already holds is hidden. Both were just imported, so an
    // `isExisting` that is bound hides both and one that is not hides neither —
    // there is no middle reading.
    const hide = el("rh-search-hide-existing") as HTMLInputElement;
    assert.isTrue(hide.checked, "docs/07 §8.5 defaults hideExisting to true");
    assert.strictEqual(
      controller.state.visible.length,
      0,
      "the published isExisting() found both in the library, through a " +
        "library index the composition root refreshed before the search",
    );
    log35("isExisting hid both already-imported rows");
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
      // and the status bar show for it.
      stubSource(
        CROSSREF,
        "research-helper-source-crossref",
        () => behaviour.get(CROSSREF) ?? IDLE,
      ),
    ]);
    const pipeline = createSearchImportPipeline({
      writer: createZoteroSearchImportWriter({ logger }),
      writeBatchSize: DEFAULT_CHUNK_SIZE,
    });
    await refreshIndex();

    const model = createSearchImportViewModel({
      pipeline,
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
      connect: (viewArg: Parameters<typeof model.connect>[0]) =>
        model.connect({
          ...viewArg,
          render: (state) => {
            if (wasRunning && !state.running) {
              runsFinished += 1;
            }
            wasRunning = state.running;
            lastState = state;
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
  // 5. A forced 429 — the criterion that cannot pass as written
  // =========================================================================

  it("renders a forced 429 without inventing a retry countdown", async function () {
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
    // docs/08 §8.3's RATE_LIMIT row is "{provider} rate limit reached. Retrying
    // in {n}s." — `SerializedError` carries no `retryAfterMs`, so the countdown
    // does not exist by the time a view sees the failure, and nothing is
    // retrying anyway because the HTTP client has no retry policy. The row this
    // build renders names what failed and which service; the code goes in the
    // disclosure. Reported under plan/README.md §5 rule 6, not adjusted.
    assert.isTrue(
      UNRENDERABLE_ERROR_ROWS.includes("RATE_LIMIT"),
      "the gap is declared, not discovered at runtime",
    );
    const line = await rendered("rh-state-error-lines", "PubMed");
    assert.include(line, "could not complete the search");
    assert.notInclude(line, "{", "no unresolved Fluent placeable is painted");
    controller.toggleDetails();
    const details = stringsUnder("rh-state-error-details-list").join("\n");
    assert.include(details, "RATE_LIMIT");
    assert.include(details, "429");
    controller.toggleDetails();
    assert.isFalse(
      (el("rh-state-error-retry") as HTMLElement).hidden,
      "a rate limit is retryable, so Retry is offered",
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
      // §4.5's "5 of 7 databases", beside the bar.
      const databases = await rendered("rh-search-progress-databases", "of 1");
      assert.include(databases, "0 of 1 databases");
      const startedAt = Date.now();
      controller.cancel();
      await waitUntil(() => runsFinished > before, "the run to stop", 10_000);
      const elapsed = Date.now() - startedAt;
      assert.isAtMost(elapsed, 2_000, "FR-10: aborted within 2 s");

      const status = await rendered("rh-search-status", "Cancelled");
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
      log(`cancel took ${String(elapsed)} ms and wrote nothing`);
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

    // Step 3's summary, with FR-51's split and R-17's coverage figure.
    const summary = await rendered("rh-search-notice", "Imported");
    assert.include(summary, "Imported 3");
    assert.include(summary, "Linked 0");
    assert.include(summary, "0 failed");
    assert.include(summary, "Abstracts present for 100%", "R-17's coverage");
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

  it("reports linked-existing separately from created (FR-51)", async function () {
    this.timeout(90_000);
    // The index the `existing` badge reads is built once per run in the product
    // too; rebuilding it here is what makes the three just-imported records show
    // as already present.
    await refreshIndex();
    setKeyword(KEYWORD);
    selectSources([PUBMED]);
    await search({ pubmed: { records: 4, withAbstract: true } });

    // **A conflict in the spec, found here.** `docs/07` §8.5 defaults
    // `hideExisting` to `true`, `docs/08` §4.2 makes that checkbox hide rows
    // already in the library, and this card's **Do NOT** forbids importing a row
    // the filter hides. Together they make §4.4's duplicate policy — and FR-51's
    // "add existing item to collection" — unreachable from the window with its
    // shipped defaults: the only rows the policy is about are the hidden ones.
    // Asserted rather than described, and reported with the card.
    const hide = el("rh-search-hide-existing") as HTMLInputElement;
    assert.isTrue(hide.checked, "docs/07 §8.5 defaults hideExisting to true");
    assert.strictEqual(
      controller.state.visible.length,
      1,
      "the three imported records are hidden, so three of four rows are gone",
    );

    hide.checked = false;
    controller.applyFilter();
    assert.strictEqual(controller.state.visible.length, 4);
    assert.strictEqual(controller.state.selectedCount, 4);

    const name = `RH P1-T22 second ${String(Date.now())}`;
    controller.adoptNewCollection(name);
    await runImport();
    createdCollections.push(collectionNamed(name).key);

    const summary = await rendered("rh-search-notice", "Linked 3");
    assert.include(summary, "Imported 1", "only the fourth record was new");
    assert.include(
      summary,
      "Linked 3",
      "FR-51: the three existing ones linked",
    );
    hide.checked = true;
    controller.applyFilter();
    log(`re-import summary: ${summary.replace(/\s+/g, " ")}`);
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
});
