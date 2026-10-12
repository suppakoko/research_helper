/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T23` — Phase 1's **definition-of-done run**, executed against the real
 * plugin in a real Zotero.
 *
 * `plan/02-phase-1-pubmed.md` §2 is the list this file executes. It is not a
 * card's criteria; it is the phase's:
 *
 * 1. a search for a real term imports ≥ {@link DOD_MIN_ITEMS} items into a new
 *    collection, each with a non-empty `abstractNote` where PubMed provides
 *    one;
 * 2. `NFR-1` measured: 100 pre-fetched records import in ≤ 10 s;
 * 3. cancel mid-search leaves zero items (`FR-10`);
 * 4. the provenance note is present and the JSON export validates against
 *    `schema/provenance.schema.json`;
 * 5. re-running the same search links rather than duplicates.
 *
 * Plus `NFR-10`: ≤ 200 ms added to Zotero startup, and **no network request at
 * startup**.
 *
 * ## Everything here runs through the host the plugin itself published
 *
 * Nothing below builds a service graph, a pipeline, a writer or a view model.
 * Each test reads `Zotero.<addonInstance>.api.searchWindow` — the object
 * `addon/content/searchDialog.js`'s `resolveHost()` reads — and calls
 * `runSearch`, `runImport`, `cancel` and `exportProvenance` on it. That is the
 * difference between this file and `test/integration/searchDialog-flow.spec.ts`:
 * that file drives the **window**, this one drives the **product's own host**
 * and measures it.
 *
 * **No window is opened.** `connect()` takes any `SearchWindowView`, and the one
 * below ({@link recorder}) records every published `SearchViewState` instead of
 * drawing it. That is deliberate and it is a measurement decision, not a
 * convenience: `P1-T46` measured this window's Fluent text rendering as
 * *bimodally* slow, with the cost scaling with the number of rendered-text
 * requests, and `zotero-plugin.config.ts:196`'s `devtools: true` — which this
 * card re-verified in the installed scaffold's own source, see below — attaches
 * the Browser Toolbox to every test run. A timing number taken through rendered
 * text would be a number about Fluent under a debugger. Driving the host
 * directly keeps `NFR-1`'s clock on the plugin and the Zotero database, which is
 * what `docs/10` NFR-1 says it measures ("of plugin+Zotero-DB time").
 *
 * **The debugger is still attached to these runs, and every figure below is
 * therefore an upper bound.** Measured by this card by reading
 * `node_modules/zotero-plugin-scaffold/dist/shared/scaffold-src-D5mM4ypK.mjs`:
 * `:3737` appends `--jsdebugger` when `options.binary.devtools` is set, and
 * `:3934` builds the **test** runner's `binary.devtools` from
 * `this.ctx.server.devtools` — so `server.devtools: true` reaches an integration
 * run. The scaffold CLI exposes no flag to turn it off (`--abort-on-fail`,
 * `--dev`, `--dist`, `--exit-on-finish`, `--no-watch`, `--preid`, `--yes`), so
 * the only way to measure without it is to edit `zotero-plugin.config.ts`, which
 * is outside this card's `Files` list. **Reported, not edited**
 * (`plan/README.md` §5 rule 2).
 *
 * ## The live acceptance run is opt-in, and that is a deliberate refusal
 *
 * `P1-T23`'s **Do NOT** says: "do not run a large or repeated live search to get
 * a number", and `docs/02` §3.1 quotes NCBI's warning that non-compliance "may
 * result in an IP address being blocked". A live test left permanently in the
 * suite would issue requests on **every** developer's every run, forever, which
 * is the repetition that `Do NOT` forbids written into the build.
 *
 * So {@link liveRunRequested} gates it on the environment variable
 * {@link LIVE_ENV}. With the variable unset the live test is **pending** and the
 * suite makes no network request at all. The acceptance run is one deliberate
 * invocation:
 *
 * ```powershell
 * $env:RH_DOD_LIVE = '1'; npm run test:integration -- --exit-on-finish
 * ```
 *
 * The variable reaches Zotero because the scaffold spawns it with
 * `{ ...process.env }` (same file, `startZoteroInstance`), and `Services.env` is
 * how a spec reads it — the route `test/integration/zotero/batchImport.spec.ts`
 * already uses for its `CI` check.
 *
 * **Whether that gate should stay is an owner's decision, not this card's**, and
 * it is written up in the report.
 *
 * ### What the live run costs, counted before it was run
 *
 * Two HTTP requests per search: one `esearch` and one `efetch`
 * (`EFETCH_MAX_IDS_PER_CALL` is 200, and the run asks for 100 records), so
 * **four** for the whole acceptance run, which performs the same search twice
 * because §2 criterion 5 *is* a second search. The shipped limiter paces
 * `eutils.ncbi.nlm.nih.gov` at 2.5 requests per second against NCBI's published
 * 3 (`src/core/rateLimit/hostLimiter.ts:196`); nothing here raises it, adds a
 * key, or parallelises.
 *
 * ## Where the items go
 *
 * The **scaffold test profile** (`.scaffold/test/profile`, its own data
 * directory), which is the separate practice profile `G-15` requires and the one
 * every integration spec already writes to. Nothing here can reach the owner's
 * own research library: the runner starts its own Zotero on its own profile.
 * Every collection this file creates, and every item and note inside it, is
 * erased in `after()`, and the erase never fails the run — the discipline
 * `test/integration/zotero/importer.spec.ts` set.
 *
 * ## What this file does not check
 *
 * - **Nobody looks at the window.** No window is opened at all here, so nothing
 *   below is a judgement about appearance, and light and dark are not compared.
 *   `docs/13` §8.1/§8.2's rows that need eyes are run by a human and recorded in
 *   `docs/spikes/phase-1-dod.md`.
 * - **The native save dialog is never drawn.** `P1-T45` measured that
 *   `nsIFilePicker.show()` blocks the runner until the whole suite times out, so
 *   {@link SchemaNode} validation below reads a file written through
 *   `exportProvenance(path)` with the path supplied directly. The one press of
 *   the export button, with the operating system drawing its dialog, is a manual
 *   row.
 * - **`NFR-10`'s startup delta is measured on a disable/enable cycle**, not on a
 *   cold Zotero start. See {@link NFR10_STARTUP_MS}'s block for exactly what
 *   that includes and excludes.
 */

import { config } from "../../package.json";
// The shipped artefact itself, bundled in by esbuild: `node:fs` does not exist
// in the Zotero sandbox, so importing it is the only way a spec can hold it.
import PROVENANCE_SCHEMA from "../../schema/provenance.schema.json";
// Type-only, so none of `src/addon.ts` — nor the `hooks` module it imports — is
// bundled into this spec. Every *value* comes off the live plugin instance.
import type { PluginApi } from "../../src/addon";
import { createScope } from "../../src/bootstrap/container";
import { normalizeDoi, type SourceId } from "../../src/model/ids";
import type { SourceRecord } from "../../src/model/sourceRecord";
import type {
  LiteratureSource,
  SourceCallContext,
  SourcePage,
  SourceQuery,
} from "../../src/sources/types";
import {
  SEARCH_WINDOW_API_PROPERTY,
  type SearchWindowQuery,
  type SearchWindowRecord,
} from "../../src/ui/dialogs/searchDialog";
import type {
  SearchViewState,
  SearchWindowHostApi,
} from "../../src/ui/viewModels/searchImportViewModel";
import { DEFAULT_CHUNK_SIZE } from "../../src/zotero/importer";
import { buildLibraryIndex } from "../../src/zotero/libraryIndex";
import { PROVENANCE_NOTE_TITLE_PREFIX } from "../../src/zotero/notes";
import { notifierRegistration } from "../../src/zotero/registrations";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface TestContext {
  timeout(ms: number): void;
  skip(): void;
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
  isAtLeast(value: number, floor: number, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T23]";

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

// ---------------------------------------------------------------------------
// 1. The figures the phase is judged against
// ---------------------------------------------------------------------------

/** §2 criterion 1: "imports ≥ 50 items into a new collection". */
const DOD_MIN_ITEMS = 50;
/** §2 criterion 2 and `docs/10` NFR-1: 100 records, ≤ 10 s, target 6 s. */
const NFR1_ITEM_COUNT = 100;
const NFR1_CEILING_MS = 10_000;
const NFR1_TARGET_MS = 6_000;
/** `docs/10` NFR-3: no single main-thread task over 100 ms. */
const NFR3_TASK_MS = 100;
/** `FR-10` and `docs/13` §8.2: "cancel mid-search aborts within ~2 s". */
const FR10_ABORT_MS = 2_000;
/**
 * `docs/10` NFR-10: "shall add ≤ 200 ms to Zotero startup … No network request
 * shall be issued at startup."
 *
 * **What the figure below actually measures, stated before it is read.** A cold
 * Zotero start cannot be timed from inside a spec that only exists once Zotero
 * has started, and the plugin exposes no startup timestamp (`src/hooks.ts`
 * records no clock, and that file is outside this card's `Files`). So the
 * measurement is a **disable/enable cycle** of the installed plugin, timed from
 * the call to `enable()` to `addon.data.initialized === true`.
 *
 * - **It includes** everything the plugin's own startup does: `registerUI()`,
 *   `installServices()`, `registerSources()`, `registerPipelines()`, the
 *   secret-store probe, the view-model construction and the host publication,
 *   plus `onMainWindowLoad` for every open main window.
 * - **It excludes** Zotero's own startup, and it excludes the three awaits at
 *   the top of `onStartup` — `Zotero.initializationPromise`,
 *   `unlockPromise`, `uiReadyPromise` — which are already resolved by the time a
 *   spec runs and which on a cold start are *Zotero's* wait, not the plugin's.
 * - **It is therefore the plugin's own added cost**, which is what the
 *   requirement is about, and it is an upper bound because the Browser Toolbox
 *   is attached. It is **not** a cold-start number, and the report says so.
 */
const NFR10_STARTUP_MS = 200;

/**
 * The environment variable that turns the live acceptance run on.
 *
 * See this file's header for why the default is off.
 */
const LIVE_ENV = "RH_DOD_LIVE";

/**
 * The real biomedical query §2 criterion 1 asks for.
 *
 * Chosen for a field that reliably returns thousands of records inside FR-3's
 * default three-calendar-year window, so the run does not fail for want of
 * results and tell us nothing about the plugin.
 */
const LIVE_QUERY = "lipid nanoparticle mRNA delivery";

/** The `SourceId` the offline tests stub. */
const STUB_SOURCE: SourceId = "europepmc";
/** Phase 1's one real adapter. */
const PUBMED: SourceId = "pubmed";

/**
 * Why the stub is `europepmc` and not `pubmed`.
 *
 * `SourceRegistry.register` throws on a duplicate id and the interface declares
 * no unregister (`src/sources/registry.ts`), so the real PubMed adapter cannot
 * be replaced. `searchDialog-flow.spec.ts` takes `crossref` for the same reason
 * and under the same constraint; taking a different spare id here means the two
 * files cannot collide whichever order the runner loads them in. The residue is
 * the same one that file reports: the stub stays in the application-wide
 * registry for the rest of the process, and removing it needs a test seam on
 * `SourceRegistry` that is outside this card's `Files` list.
 */
const STUB_REGISTRATION_NOTE = "europepmc, because register() throws on pubmed";

// ---------------------------------------------------------------------------
// 2. The stub source — the offline half
// ---------------------------------------------------------------------------

/** How the stub behaves for the next search. */
interface StubBehaviour {
  readonly records: number;
  /** Milliseconds to wait before each record — the cancellation window. */
  readonly delayMs?: number;
  /** Whether each record carries an abstract. */
  readonly withAbstract?: boolean;
}

const IDLE: StubBehaviour = { records: 0 };
let stubBehaviour: StubBehaviour = IDLE;

/** A branded `Doi`. `normalizeDoi` is the only route to the brand. */
function doiOf(nativeId: string): NonNullable<ReturnType<typeof normalizeDoi>> {
  const doi = normalizeDoi(`10.5555/${nativeId}`);
  if (doi === null) {
    assert.fail(`the stub DOI for "${nativeId}" is not DOI-shaped`);
  }
  return doi;
}

function stubRecord(n: number, withAbstract: boolean): SourceRecord {
  const nativeId = `p1t23-${String(n)}`;
  return {
    id: `${STUB_SOURCE}:${nativeId}`,
    sourceId: STUB_SOURCE,
    nativeId,
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
    work: {
      ids: { doi: doiOf(nativeId) },
      type: "journal-article",
      title: `Pre-fetched record ${String(n)} for NFR-1`,
      ...(withAbstract && {
        abstract: `A pre-fetched abstract for record ${String(n)}.`,
      }),
      authors: [{ family: "Kim", given: "J" }, { family: "Park" }],
      publishedDate: { year: 2025, iso: "2025" },
    },
  };
}

function stubSource(): LiteratureSource {
  return {
    id: STUB_SOURCE,
    displayNameKey: "research-helper-source-europepmc",
    rateLimitKey: `${STUB_SOURCE}.invalid`,
    capabilities: {
      keywordSearch: true,
      relatedByWork: false,
      lookupById: ["doi"],
      abstractsInSearch: true,
      citationGraph: false,
      dateFilter: false,
      maxPageSize: 200,
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
      const behaviour = stubBehaviour;
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<SourceRecord> {
          for (let n = 0; n < behaviour.records; n += 1) {
            if (behaviour.delayMs !== undefined) {
              await Zotero.Promise.delay(behaviour.delayMs);
            }
            ctx.progress?.setProgress(n + 1, behaviour.records);
            yield stubRecord(n, behaviour.withAbstract === true);
          }
        },
      };
    },
    explainQuery: (query: SourceQuery) => `stub(${String(query.limit)})`,
  };
}

// ---------------------------------------------------------------------------
// 3. Reaching the published host
// ---------------------------------------------------------------------------

/**
 * The live plugin instance, read off the `Zotero` global.
 *
 * Declared locally rather than imported as `src/addon.ts`'s default type, so
 * this file has one import from that module instead of two (`import type
 * Default, { Named }` is not legal TypeScript). Only the three members read
 * below are named, and they are read off the object the plugin published — not
 * off a second copy of the module, which is what an imported *value* would be.
 */
interface PluginInstance {
  readonly api?: PluginApi;
  readonly data: { readonly initialized: boolean; readonly alive: boolean };
}

function pluginInstance(): PluginInstance | undefined {
  return (Zotero as unknown as Record<string, PluginInstance | undefined>)[
    config.addonInstance
  ];
}

/** `addon/content/searchDialog.js`'s `resolveHost()`, without the `|| {}`. */
function publishedApi(): PluginApi {
  const instance = pluginInstance();
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

let host: SearchWindowHostApi;
let disconnect: (() => void) | undefined;
/** Every state the published view model published, most recent last. */
const states: SearchViewState[] = [];
/** The collections this file created, erased in `after()`. */
const created: string[] = [];

/**
 * Read the published host, make sure the stub is registered, and connect a
 * recording view.
 *
 * Called from `before()` **and again after the disable/enable cycle**, because
 * that cycle builds a fresh plugin instance, a fresh service graph, a fresh
 * registry and a fresh view model — the old `host` reference would then be a
 * live object nothing is published at.
 */
function setupHost(): void {
  const api = publishedApi();
  const services = api.services;
  if (!services) {
    assert.fail(
      "registerUI() published no ServiceGraph at api.services, so the graph " +
        "installServices() built is unreachable",
    );
  }
  if (services.sources.get(STUB_SOURCE) === undefined) {
    services.sources.register(stubSource());
  }
  const published = api[SEARCH_WINDOW_API_PROPERTY];
  if (!published) {
    assert.fail(
      `nothing is published at api.${SEARCH_WINDOW_API_PROPERTY}, so the ` +
        `Search & Import window would be inert`,
    );
  }
  host = published;
  disconnect?.();
  disconnect = host.connect({
    render(state: SearchViewState): void {
      states.push(state);
    },
  });
  log(
    `host connected; registry holds ` +
      `${services.sources
        .list()
        .map((source) => source.id)
        .join(",")} (stub: ${STUB_REGISTRATION_NOTE})`,
  );
}

function latest(): SearchViewState | undefined {
  return states[states.length - 1];
}

function mark(): number {
  return states.length;
}

function since(at: number): readonly SearchViewState[] {
  return states.slice(at);
}

/**
 * One `SearchWindowQuery`, as the document's `collectQuery()` would build it.
 *
 * `fromYear`/`toYear` are FR-3's shipped default window — the current calendar
 * year and the two before it (`docs/08` §4.2) — computed here the way the
 * document computes it, so the live search is the search the product makes.
 */
function queryFor(
  keyword: string,
  sources: readonly string[],
  maxResults: number,
  collectionID: string,
): SearchWindowQuery {
  const year = new Date().getFullYear();
  return {
    mode: "keyword",
    keyword,
    fromYear: year - 2,
    toYear: year,
    maxResults,
    sources,
    filter: "",
    // False on purpose: this spec decides which rows it imports, and the
    // product's hide-existing filter lives in the document, not the host.
    hideExisting: false,
    duplicates: "link-existing",
    collectionID,
  };
}

function rowsOf(
  state: SearchViewState | undefined,
): readonly SearchWindowRecord[] {
  return state?.records ?? [];
}

// ---------------------------------------------------------------------------
// 4. Reading the library back
// ---------------------------------------------------------------------------

interface CollectionHandle {
  readonly key: string;
  getChildItems(idsOnly: boolean): number[];
}

/** The user-library collection with this exact name, or `undefined`. */
function findCollection(name: string): CollectionHandle | undefined {
  const found = Zotero.Collections.getByLibrary(
    Zotero.Libraries.userLibraryID,
  ).find((collection) => collection.name === name);
  return found as unknown as CollectionHandle | undefined;
}

function requireCollection(name: string): CollectionHandle {
  const found = findCollection(name);
  if (!found) {
    assert.fail(`the import created no collection named "${name}"`);
  }
  return found;
}

interface ChildItem {
  isNote(): boolean;
  getNoteTitle(): string;
  getNote(): string;
  getField(field: string): string;
}

async function childrenOf(
  collection: CollectionHandle,
): Promise<readonly ChildItem[]> {
  return (await Zotero.Items.getAsync(
    collection.getChildItems(true),
  )) as unknown as readonly ChildItem[];
}

/** How many children a collection has, cheaply and synchronously. Notes included. */
function childCount(name: string): number {
  return findCollection(name)?.getChildItems(true).length ?? 0;
}

/** How many children a collection has that are **not** notes. */
async function regularItemCount(name: string): Promise<number> {
  const collection = findCollection(name);
  if (!collection) return 0;
  const children = await childrenOf(collection);
  return children.filter((item) => !item.isNote()).length;
}

/**
 * Put the published view model back in the state this file found it in.
 *
 * **This is not tidiness, it is a defect this card found by running into it.**
 * The view model is **application-scoped** — the composition root builds one at
 * startup — and `P1-T36` decided deliberately that `connect()` does *not* clear
 * the retained provenance record, so that reopening the window can still export
 * the run on screen. The document derives the export control's visibility from
 * `state.notices.length > 0` (`addon/content/searchDialog.js`'s
 * `logic.exportAvailable`), and nothing resets `state` between windows either.
 *
 * So an import performed anywhere in the suite leaves the export control
 * **revealed** for every window opened afterwards, and
 * `searchDialog-flow.spec.ts`'s `P1-T45: the export control is hidden before any
 * run` is therefore order-dependent: its own comment says it is "the only moment
 * in the suite when a real window has connected to the real host and no import
 * has happened yet". This file sorts before that one, so the first live
 * acceptance run made that test fail with `expected false to be true` — a real
 * failure of a real assertion, caused by shipped behaviour and test ordering
 * rather than by a bug in either file.
 *
 * `runJob` publishes `notices: []` at the **start** of every run
 * (`searchImportViewModel.ts:1318`) and a search never puts any back, so one
 * empty search restores the precondition. That is what this does. The ordering
 * fragility itself is **reported as a new card**, not fixed here:
 * `searchDialog-flow.spec.ts` is outside this card's `Files` list.
 */
async function restoreHostState(): Promise<void> {
  try {
    stubBehaviour = IDLE;
    await host.runSearch(queryFor("rh-p1t23-restore", [STUB_SOURCE], 10, ""));
    const outcome = await host.exportProvenance("");
    log(
      `host state restored for the specs that run after this file: ` +
        `${String((latest()?.notices ?? []).length)} notice(s) in the last ` +
        `published state, panel "${String(latest()?.panel)}", and ` +
        `exportProvenance("") answers "${outcome}"`,
    );
  } catch (error) {
    // An `after` hook that throws fails the whole run, and a restore that
    // failed must be visible rather than fatal.
    log(
      `host state could NOT be restored: ${error instanceof Error ? error.name : typeof error}`,
    );
  }
}

async function eraseCreated(): Promise<void> {
  let items = 0;
  let collections = 0;
  for (const key of created) {
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
      /* cleanup is best effort and never fails the run it cleans up after */
    }
  }
  log(
    `cleanup erased ${String(items)} item(s) and ` +
      `${String(collections)} collection(s)`,
  );
}

// ---------------------------------------------------------------------------
// 5. The main-thread stall monitor (`NFR-3`)
// ---------------------------------------------------------------------------

/** The monitor's interval on the Zotero main window. */
const TICK_MS = 10;
/**
 * A median idle gap above this means the main window's timers are throttled,
 * and every stall figure would be meaningless. `import-perf.spec.ts` refuses to
 * report in that case and so does this.
 */
const THROTTLE_LIMIT_MS = 25;

interface StallSummary {
  readonly samples: number;
  readonly p50: number;
  readonly max: number;
  readonly over: number;
}

function summarise(gaps: readonly number[]): StallSummary {
  if (gaps.length === 0) return { samples: 0, p50: 0, max: 0, over: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    over: sorted.filter((gap) => gap > NFR3_TASK_MS).length,
  };
}

interface StallMonitor {
  stop(): readonly number[];
}

function startStallMonitor(): StallMonitor {
  const win = Zotero.getMainWindow();
  const gaps: number[] = [];
  let last = Date.now();
  const handle = win.setInterval(() => {
    const now = Date.now();
    gaps.push(now - last);
    last = now;
  }, TICK_MS);
  return {
    stop(): readonly number[] {
      win.clearInterval(handle);
      return gaps;
    },
  };
}

// ---------------------------------------------------------------------------
// 6. The schema validator
// ---------------------------------------------------------------------------

type SchemaNode = Record<string, unknown>;

/**
 * The keywords {@link validateAgainstSchema} enforces.
 *
 * **This is the third copy of this validator in the repository**, after
 * `test/unit/core/provenance.test.ts` and
 * `test/integration/searchDialog-flow.spec.ts`. Neither can be imported from
 * here — the unit copy imports `vitest` and `node:fs`, which do not exist in the
 * Zotero sandbox, and a spec is bundled on its own so it cannot import another
 * spec's module-private helpers. Hoisting it into a shared test helper would be
 * a new file, which is outside this card's `Files` list, so the duplication is
 * **reported with the card** rather than hidden. `P1-T36` already asked for that
 * card; a third copy is the strongest argument for it yet.
 *
 * {@link unimplementedSchemaKeywords} is what keeps this copy honest: a keyword
 * the shipped schema grows and this validator ignores fails the test rather than
 * silently passing it.
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
  // Core and annotation-only: these carry no constraint.
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
  if (!ref.startsWith(prefix)) assert.fail(`unsupported $ref: ${ref}`);
  const defs = root["$defs"];
  if (!isSchemaObject(defs)) assert.fail("the shipped schema has no $defs");
  const target = defs[ref.slice(prefix.length)];
  if (!isSchemaObject(target)) assert.fail(`unresolvable $ref: ${ref}`);
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

/** Validate `value` against `schema`. An empty array means valid. */
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

// ---------------------------------------------------------------------------
// 7. Small shared utilities
// ---------------------------------------------------------------------------

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = 25_000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(25);
  }
}

/** Is the live acceptance run asked for? See this file's header. */
function liveRunRequested(): boolean {
  try {
    const value = Services.env.get(LIVE_ENV);
    return value !== "" && value !== "0";
  } catch {
    // An environment read that throws must not be read as "yes".
    return false;
  }
}

/** `Services.obs`, typed to the two members used here. */
const observerService = Services.obs as unknown as {
  addObserver(observer: unknown, topic: string): void;
  removeObserver(observer: unknown, topic: string): void;
};

/** The subset of `nsIHttpChannel` this file reads. */
interface ObservedChannel {
  readonly URI?: { readonly spec?: string };
}

/** The distinct hosts a list of URLs names, in first-seen order. */
function hostsOf(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const url of urls) {
    const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
    seen.add(match?.[1] ?? url);
  }
  return [...seen];
}

/**
 * Record the URL of every HTTP request Gecko makes while `body` runs.
 *
 * `http-on-modify-request` fires for every channel, from any consumer in the
 * process, so the list is deliberately *everything* — the plugin's requests and
 * Zotero's own. `NFR-10`'s requirement is about the plugin, so the report
 * classifies what was seen rather than asserting an empty list and hoping.
 */
async function recordingRequests<T>(
  body: () => Promise<T>,
): Promise<{ result: T; urls: readonly string[] }> {
  const urls: string[] = [];
  const observer = {
    observe(subject: unknown): void {
      try {
        const spec = (subject as ObservedChannel).URI?.spec;
        if (typeof spec === "string") urls.push(spec);
      } catch {
        // An observer that throws must not fail the measurement it serves.
      }
    },
  };
  observerService.addObserver(observer, "http-on-modify-request");
  try {
    const result = await body();
    // One turn of the event loop, so a request issued and not yet observed is
    // still counted rather than missed by a race.
    await Zotero.Promise.delay(250);
    return { result, urls };
  } finally {
    observerService.removeObserver(observer, "http-on-modify-request");
  }
}

/** The subset of an `AddonManager` add-on wrapper this spec calls. */
interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

async function researchHelperAddon(): Promise<AddonWrapper> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) assert.fail(`AddonManager does not know ${config.addonID}`);
  return wrapper;
}

/**
 * Resolve after Zotero has *finished* the plugin's bootstrap `method`.
 *
 * `AddonWrapper.disable()` resolves before the asynchronous `shutdown` has run
 * (`P0-T11`), so it cannot be the signal; `Zotero.Plugins` calls its observers
 * only after awaiting the bootstrap function's promise. Transcribed from
 * `test/integration/lifecycle.spec.ts`, which measured this.
 */
function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) return;
        clearTimeout(timer);
        Zotero.Plugins.removeObserver(observer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      Zotero.Plugins.removeObserver(observer);
      reject(new Error(`timed out waiting for bootstrap ${method}`));
    }, 30_000);
    Zotero.Plugins.addObserver(observer);
    action().catch((error: unknown) => {
      clearTimeout(timer);
      Zotero.Plugins.removeObserver(observer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

// ---------------------------------------------------------------------------
// 8. The run
// ---------------------------------------------------------------------------

describe("P1-T23: Phase 1 definition-of-done run", () => {
  before(async function () {
    this.timeout(90_000);
    log(
      `Zotero ${Zotero.version} on ${Services.appinfo.OS}, Gecko ` +
        `${Services.appinfo.platformVersion}; plugin ` +
        `${config.addonID}; live acceptance run requested: ` +
        `${String(liveRunRequested())} (${LIVE_ENV})`,
    );
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      `Zotero.${config.addonInstance}.data.initialized`,
    );
    setupHost();
  });

  after(async function () {
    this.timeout(120_000);
    await restoreHostState();
    disconnect?.();
    disconnect = undefined;
    await eraseCreated();
  });

  // =========================================================================
  // NFR-10 — startup cost and startup network silence
  //
  // **First in the block, deliberately.** It disables and re-enables the
  // plugin, which replaces the service graph, the source registry and the view
  // model, so every later test must run against the instance this one leaves
  // behind rather than the one `before()` found.
  // =========================================================================

  it("NFR-10: startup adds a measurable, bounded cost and issues no network request", async function () {
    this.timeout(120_000);
    const wrapper = await researchHelperAddon();
    assert.isTrue(wrapper.isActive, "the plugin is enabled before the cycle");

    // **The control window, and it is what makes the network claim falsifiable.**
    // `http-on-modify-request` fires for every channel in the process, Zotero's
    // own included, so an empty list is not the only honest outcome and a
    // non-empty one is not automatically the plugin's fault. The disable plus an
    // idle period of the same order is a window in which the plugin is
    // **absent**, so every host seen there is demonstrably not its.
    const { urls: baselineUrls } = await recordingRequests(async () => {
      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await waitUntil(
        () => pluginInstance() === undefined,
        `Zotero.${config.addonInstance} to be removed by onShutdown`,
      );
      await Zotero.Promise.delay(2_000);
    });

    const { result: elapsedMs, urls } = await recordingRequests(async () => {
      const startedAt = Date.now();
      await afterBootstrapCall("startup", () => wrapper.enable());
      await waitUntil(
        () => pluginInstance()?.data.initialized === true,
        "the fresh instance to finish initializing",
      );
      return Date.now() - startedAt;
    });

    // Re-read the host: this is a different plugin instance from the one
    // `before()` connected to.
    setupHost();

    log(
      `NFR-10 startup delta ${String(elapsedMs)} ms against a ` +
        `${String(NFR10_STARTUP_MS)} ms budget (disable/enable cycle, ` +
        `Browser Toolbox attached; NOT a cold Zotero start)`,
    );
    log(
      `NFR-10 control window, plugin absent: ${String(baselineUrls.length)} ` +
        `request(s)${baselineUrls.length === 0 ? "" : ` -> ${hostsOf(baselineUrls).join(",")}`}`,
    );
    log(
      `NFR-10 startup window, plugin starting: ${String(urls.length)} ` +
        `request(s)${urls.length === 0 ? "" : ` -> ${urls.join(" | ")}`}`,
    );

    // The requirement is about the plugin. Phase 1 has exactly one network
    // consumer — the PubMed adapter, on `docs/02` §3.1's NCBI host — and no
    // startup path may reach it.
    const ncbi = urls.filter((url) => url.includes("ncbi.nlm.nih.gov"));
    assert.deepEqual(
      [...ncbi],
      [],
      "NFR-10: the plugin issued a literature-API request at startup",
    );
    // Any host that appears only while the plugin is starting is a candidate
    // for being the plugin's, and there must be none.
    const baselineHosts = new Set(hostsOf(baselineUrls));
    const newHosts = hostsOf(urls).filter((host) => !baselineHosts.has(host));
    assert.deepEqual(
      newHosts,
      [],
      `NFR-10: ${String(newHosts.length)} host(s) were contacted while the ` +
        `plugin started that were not contacted while it was absent: ` +
        `${newHosts.join(",")}`,
    );
    assert.isAtMost(
      elapsedMs,
      NFR10_STARTUP_MS,
      `NFR-10: the plugin's own startup work took ${String(elapsedMs)} ms`,
    );
  });

  // =========================================================================
  // §2 criterion 2 — NFR-1, and R-16's chunk figures
  // =========================================================================

  it("§2 criterion 2 / NFR-1: 100 pre-fetched records import in <= 10 s", async function () {
    this.timeout(180_000);

    // Phase 1: pre-fetch. Mocked by construction — the stub is a source, so no
    // network request is made and the records are in memory before the clock
    // starts. `P1-T23`'s last **Do NOT** keeps this separate from the live
    // acceptance run, and it is: this test never touches PubMed.
    stubBehaviour = { records: NFR1_ITEM_COUNT, withAbstract: true };
    const searchMark = mark();
    await host.runSearch(
      queryFor(LIVE_QUERY, [STUB_SOURCE], NFR1_ITEM_COUNT, ""),
    );
    const fetched = rowsOf(latest());
    assert.strictEqual(
      fetched.length,
      NFR1_ITEM_COUNT,
      `the pre-fetch produced ${String(fetched.length)} records, so the ` +
        `measurement would not be NFR-1's`,
    );
    log(
      `pre-fetch produced ${String(fetched.length)} records in ` +
        `${String(since(searchMark).length)} published state(s), no network`,
    );

    const name = `RH P1-T23 NFR-1 ${String(Date.now())}`;

    // The idle baseline, so a throttled timer cannot be mistaken for a quiet
    // main thread.
    const baselineMonitor = startStallMonitor();
    await Zotero.Promise.delay(500);
    const baseline = summarise(baselineMonitor.stop());
    assert.isAtMost(
      baseline.p50,
      THROTTLE_LIMIT_MS,
      `the stall monitor is throttled: median idle gap ${String(baseline.p50)} ` +
        `ms for a ${String(TICK_MS)} ms interval, so no NFR-3 figure would be ` +
        `valid`,
    );

    // The clock. NFR-1 measures "from user clicks Import to collection contains
    // 100 items", so the stop is a read of the collection and not the promise:
    // `runImport` also composes the summary and writes the provenance note,
    // which are after the 100th item exists.
    const samples = new Map<number, number>();
    let hundredAtMs: number | undefined;
    const monitor = startStallMonitor();
    const startedAt = Date.now();

    const poll = (async (): Promise<void> => {
      for (;;) {
        const count = childCount(name);
        if (count > 0 && !samples.has(count)) {
          samples.set(count, Date.now() - startedAt);
        }
        if (count >= NFR1_ITEM_COUNT) {
          hundredAtMs ??= Date.now() - startedAt;
          return;
        }
        if (Date.now() - startedAt > 120_000) return;
        await Zotero.Promise.delay(10);
      }
    })();

    await host.runImport({
      ...queryFor(LIVE_QUERY, [STUB_SOURCE], NFR1_ITEM_COUNT, `new:${name}`),
      records: fetched,
    });
    const wholeRunMs = Date.now() - startedAt;
    await poll;
    const stalls = summarise(monitor.stop());

    const collection = requireCollection(name);
    created.push(collection.key);
    const children = await childrenOf(collection);
    const notes = children.filter((item) => item.isNote());
    assert.strictEqual(
      children.length - notes.length,
      NFR1_ITEM_COUNT,
      "the collection holds exactly the 100 records",
    );

    const measured = hundredAtMs ?? wholeRunMs;
    // `docs/07` §7.2's chunk size, and the per-chunk time R-16 asks for. The
    // writer's shipped chunk is DEFAULT_CHUNK_SIZE; the samples below are what
    // the collection was actually seen holding, which is the only per-chunk
    // evidence available from outside the writer.
    const chunkLines = [...samples.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([count, at]) => `${String(count)}@${String(at)}ms`)
      .join(" ");
    log(
      `NFR-1: 100 items in the collection after ${String(measured)} ms ` +
        `(ceiling ${String(NFR1_CEILING_MS)}, target ${String(NFR1_TARGET_MS)}); ` +
        `whole runImport including the provenance note ${String(wholeRunMs)} ms`,
    );
    log(
      `R-16: shipped chunk size ${String(DEFAULT_CHUNK_SIZE)}, so ` +
        `${String(Math.ceil(NFR1_ITEM_COUNT / DEFAULT_CHUNK_SIZE))} ` +
        `transaction(s); collection growth samples: ${chunkLines}`,
    );
    log(
      `NFR-3: main-thread gaps during the import — ${String(stalls.samples)} ` +
        `samples, median ${String(stalls.p50)} ms, longest ${String(stalls.max)} ` +
        `ms, ${String(stalls.over)} over ${String(NFR3_TASK_MS)} ms ` +
        `(idle baseline median ${String(baseline.p50)} ms)`,
    );

    assert.isAtMost(
      measured,
      NFR1_CEILING_MS,
      `NFR-1: 100 pre-fetched records took ${String(measured)} ms`,
    );
    assert.isAtMost(
      stalls.max,
      NFR3_TASK_MS,
      `NFR-3: the longest main-thread stall was ${String(stalls.max)} ms`,
    );
  });

  // =========================================================================
  // §2 criterion 3 — FR-10, cancel leaves zero items
  // =========================================================================

  it("§2 criterion 3 / FR-10: cancel mid-search aborts within 2 s and creates nothing", async function () {
    this.timeout(120_000);
    const scope = createScope({
      description: "P1-T23 write spy",
      onError: (messageText) => {
        log(`write spy teardown: ${messageText}`);
      },
      strict: false,
    });
    const events: string[] = [];
    try {
      await notifierRegistration("P1-T23 write spy", {
        types: ["item", "collection"],
        notify: (event: string, type: string) => {
          events.push(`${type}.${event}`);
        },
      })(scope);

      stubBehaviour = { records: 40, delayMs: 150, withAbstract: true };
      const at = mark();
      // Not awaited yet: the cancel has to land while the fetch is in flight.
      const run = host.runSearch(queryFor(LIVE_QUERY, [STUB_SOURCE], 40, ""));
      await waitUntil(
        () => (latest()?.progressPercent ?? 0) > 0,
        "the first progress report, so the cancel lands in Fetching",
        20_000,
      );
      assert.isTrue(
        latest()?.cancelVisible,
        "FR-10: Cancel is offered while a job is in flight",
      );

      const cancelledAt = Date.now();
      host.cancel();
      await run;
      const elapsed = Date.now() - cancelledAt;

      assert.isAtMost(
        elapsed,
        FR10_ABORT_MS,
        `FR-10: the run took ${String(elapsed)} ms to stop`,
      );
      assert.deepEqual(
        events,
        [],
        `FR-10: a cancelled search wrote to the database: ${events.join(", ")}`,
      );
      assert.isFalse(
        latest()?.running,
        "the run is no longer reported as in flight",
      );
      log(
        `FR-10: cancel stopped the run in ${String(elapsed)} ms, wrote ` +
          `nothing, and published ${String(since(at).length)} state(s)`,
      );
    } finally {
      await scope.unregisterAll();
    }
  });

  // =========================================================================
  // §2 criteria 1, 4 and 5 — the live acceptance run
  //
  // **One run, four HTTP requests, and it is the only network traffic in this
  // repository's test suite.** See this file's header for the gate and the
  // arithmetic. Criterion 5 requires a *second* search by construction — "re-
  // running the same search" — so the second search is part of this one
  // acceptance run and not a repetition of it.
  // =========================================================================

  it("§2 criteria 1, 4 and 5: a real PubMed search imports, writes provenance, and re-runs without duplicating", async function () {
    this.timeout(600_000);
    if (!liveRunRequested()) {
      log(
        `LIVE ACCEPTANCE RUN NOT PERFORMED: ${LIVE_ENV} is unset, so no ` +
          `network request was made. §2 criteria 1, 4 and 5 are UNMEASURED in ` +
          `this run. Set ${LIVE_ENV}=1 to perform the single acceptance run.`,
      );
      this.skip();
      return;
    }

    // The guard that keeps the validator in this file honest.
    const ignored = [
      ...unimplementedSchemaKeywords(PROVENANCE_SCHEMA as SchemaNode),
    ].filter((keyword) => !IMPLEMENTED_KEYWORDS.includes(keyword));
    assert.deepEqual(
      ignored,
      [],
      "every keyword the shipped schema uses is one this validator enforces",
    );

    const { result, urls } = await recordingRequests(async () => {
      // ----- criterion 1: the search -------------------------------------
      const searchStartedAt = Date.now();
      await host.runSearch(queryFor(LIVE_QUERY, [PUBMED], NFR1_ITEM_COUNT, ""));
      const searchMs = Date.now() - searchStartedAt;
      const fetched = rowsOf(latest());
      const state = latest();
      const perSourceOutcome = (state?.sources ?? [])
        .map((line) => `${line.sourceId}:${line.outcome}`)
        .join(",");
      log(
        `live search: ${String(fetched.length)} record(s) from PubMed in ` +
          `${String(searchMs)} ms, per-source ${perSourceOutcome}`,
      );
      assert.isAtLeast(
        fetched.length,
        DOD_MIN_ITEMS,
        `§2 criterion 1: the live search returned ${String(fetched.length)} ` +
          `records, below the ${String(DOD_MIN_ITEMS)} the phase requires`,
      );

      // ----- criterion 1: the import into a NEW collection ---------------
      const name = `RH P1-T23 live ${String(Date.now())}`;
      const importStartedAt = Date.now();
      await host.runImport({
        ...queryFor(LIVE_QUERY, [PUBMED], NFR1_ITEM_COUNT, `new:${name}`),
        records: fetched,
      });
      const importMs = Date.now() - importStartedAt;

      const collection = requireCollection(name);
      created.push(collection.key);
      const children = await childrenOf(collection);
      const notes = children.filter((item) => item.isNote());
      const items = children.filter((item) => !item.isNote());
      assert.isAtLeast(
        items.length,
        DOD_MIN_ITEMS,
        `§2 criterion 1: the collection holds ${String(items.length)} items`,
      );

      // `FR-51`'s four counters, as the window publishes them. Logged because
      // they are the run's own account of itself, and asserted on `linked`
      // because the coverage arithmetic below divides by *created* items while
      // the library count divides by every item in the collection: the two
      // denominators are the same number only when nothing was linked.
      const summary = (latest()?.notices ?? []).find(
        (notice) => notice.id === "research-helper-import-summary",
      );
      log(
        `live import summary, as published: ` +
          `${JSON.stringify(summary?.args ?? {})} in ${String(importMs)} ms ` +
          `(network included)`,
      );
      assert.strictEqual(
        summary?.args?.["linked"],
        0,
        "the practice library already held some of these papers, so the " +
          "coverage denominators below would not match; erase the test " +
          "profile's library and run the acceptance run again",
      );

      // ----- criterion 1: abstracts, and R-17's coverage figure -----------
      //
      // **Two independent counts of the same thing, and the point is that they
      // have to agree.**
      //
      // 1. The **library** count below reads `abstractNote` off each item the
      //    import created — the end of the chain, after the adapter, the
      //    mapper and the writer.
      // 2. The **plugin's own** figure is `R-17`'s published number: the
      //    writer's `abstractCoveragePercent`, carried to the window as
      //    `research-helper-import-abstract-coverage`'s `$percent`
      //    (`src/zotero/importer.ts`, `SearchImportWriteReport`). It is
      //    computed from the works, inside the write half.
      //
      // Agreement means nothing was lost between the works and the items. What
      // **cannot** be checked from here is the criterion's "where PubMed
      // provides one": `SearchWindowRecord` carries no abstract, so the
      // source-side truth is not observable outside the adapter, and no
      // assertion here can distinguish "PubMed had no abstract" from "the
      // adapter dropped it". That limit is stated in the report rather than
      // papered over with an assertion that would pass either way. The
      // adapter-side half is covered by the 28 fixture-backed contract tests.
      let withAbstractInLibrary = 0;
      for (const item of items) {
        if (item.getField("abstractNote").trim() !== "") {
          withAbstractInLibrary += 1;
        }
      }
      const coveragePercent = Math.round(
        (withAbstractInLibrary / items.length) * 100,
      );
      const coverageNotice = (latest()?.notices ?? []).find(
        (notice) => notice.id === "research-helper-import-abstract-coverage",
      );
      const reportedPercent = coverageNotice?.args?.["percent"];
      log(
        `R-17 abstract coverage on a real query: ` +
          `${String(withAbstractInLibrary)}/${String(items.length)} imported ` +
          `items carry a non-empty abstractNote = ${String(coveragePercent)} %; ` +
          `the plugin's own published figure is ${String(reportedPercent)} %`,
      );
      assert.strictEqual(
        reportedPercent,
        coveragePercent,
        `R-17: the plugin reported ${String(reportedPercent)} % coverage and ` +
          `the library holds ${String(coveragePercent)} %, so something ` +
          `between the write report and the items disagrees`,
      );

      // ----- criterion 4: the provenance note ----------------------------
      assert.strictEqual(
        notes.length,
        1,
        `§2 criterion 4 / FR-8: expected exactly one provenance note, found ` +
          `${String(notes.length)}`,
      );
      assert.include(
        notes[0]?.getNoteTitle() ?? "",
        PROVENANCE_NOTE_TITLE_PREFIX,
        "the note is the provenance note and not something else",
      );
      assert.include(
        notes[0]?.getNote() ?? "",
        Zotero.version,
        "the note carries the Zotero version the composition root supplied",
      );

      // ----- criterion 4: the JSON export --------------------------------
      const path = PathUtils.join(
        PathUtils.tempDir,
        `rh-p1t23-provenance-${String(Date.now())}.json`,
      );
      const outcome = await host.exportProvenance(path);
      assert.strictEqual(
        outcome,
        "written",
        `§2 criterion 4: exportProvenance returned "${String(outcome)}"`,
      );
      assert.isTrue(await IOUtils.exists(path), "the export wrote a file");
      const text = await IOUtils.readUTF8(path);
      const parsed: unknown = JSON.parse(text);
      const errors = validateAgainstSchema(
        PROVENANCE_SCHEMA as SchemaNode,
        parsed,
        PROVENANCE_SCHEMA as SchemaNode,
      );
      assert.deepEqual(
        errors,
        [],
        `§2 criterion 4: the exported JSON does not validate against ` +
          `schema/provenance.schema.json: ${errors.join("; ")}`,
      );
      // The owner's 2026-10-08 decision, enforced here as well as in the host:
      // the chosen path never reaches the file it names.
      assert.notInclude(
        text,
        path,
        "the export must not record the path it was written to",
      );
      log(
        `§2 criterion 4: ${String(text.length)} bytes of provenance JSON ` +
          `validated against the shipped schema, ${String(
            Object.keys(parsed as Record<string, unknown>).length,
          )} top-level fields`,
      );
      await IOUtils.remove(path, { ignoreAbsent: true });

      // ----- criterion 5: re-run the same search -------------------------
      const indexBefore = await buildLibraryIndex(
        Zotero.Libraries.userLibraryID,
      );
      await host.runSearch(queryFor(LIVE_QUERY, [PUBMED], NFR1_ITEM_COUNT, ""));
      const refetched = rowsOf(latest());
      const alreadyPresent = refetched.filter(
        (record) => record.existing,
      ).length;
      log(
        `§2 criterion 5: the second search returned ` +
          `${String(refetched.length)} record(s), of which ` +
          `${String(alreadyPresent)} are reported as already in the library`,
      );
      assert.isAtLeast(
        alreadyPresent,
        DOD_MIN_ITEMS,
        `§2 criterion 5: only ${String(alreadyPresent)} of the re-run's ` +
          `records were recognised as already in the library, so a re-run ` +
          `would duplicate them`,
      );

      const itemsBefore = await regularItemCount(name);
      await host.runImport({
        ...queryFor(LIVE_QUERY, [PUBMED], NFR1_ITEM_COUNT, `new:${name}`),
        records: refetched,
      });
      const itemsAfter = await regularItemCount(name);
      const indexAfter = await buildLibraryIndex(
        Zotero.Libraries.userLibraryID,
      );
      const notesAfter = childCount(name) - itemsAfter;

      log(
        `§2 criterion 5: the collection held ${String(itemsBefore)} regular ` +
          `item(s) before the re-import and ${String(itemsAfter)} after, with ` +
          `${String(notesAfter)} note(s); the library's DOI index went ` +
          `${String(indexBefore.byDoi.size)} -> ` +
          `${String(indexAfter.byDoi.size)} and its one search scanned ` +
          `${String(indexBefore.stats.itemsScanned)} -> ` +
          `${String(indexAfter.stats.itemsScanned)} top-level items`,
      );
      assert.strictEqual(
        itemsAfter,
        itemsBefore,
        "§2 criterion 5: re-running the same search added items to the " +
          "collection instead of linking the ones already there",
      );
      assert.strictEqual(
        indexAfter.byDoi.size,
        indexBefore.byDoi.size,
        "§2 criterion 5: re-running the same search created new items",
      );
      // The index's own count may rise by exactly one, and that is correct
      // rather than a duplicate: `buildLibraryIndex` searches with
      // `noChildren: "true"`, `FR-8`'s provenance note is a **standalone** note
      // and therefore top level, and the second import writes a second one. One
      // note per run is the shipped behaviour the note assertion above measured;
      // more than one new top-level item would be a duplicated record.
      assert.isAtMost(
        indexAfter.stats.itemsScanned - indexBefore.stats.itemsScanned,
        1,
        "§2 criterion 5: the library grew by more than the re-run's own " +
          "provenance note",
      );

      return {
        fetched: fetched.length,
        imported: items.length,
        coveragePercent,
        withAbstractInLibrary,
        searchMs,
        importMs,
        refetched: refetched.length,
        alreadyPresent,
      };
    });

    const ncbi = urls.filter((url) => url.includes("ncbi.nlm.nih.gov"));
    log(
      `live acceptance run: ${String(urls.length)} HTTP request(s) in total, ` +
        `${String(ncbi.length)} to NCBI`,
    );
    log(
      `live acceptance run summary: fetched ${String(result.fetched)}, ` +
        `imported ${String(result.imported)}, abstract coverage ` +
        `${String(result.coveragePercent)} %, search ${String(result.searchMs)} ` +
        `ms, import ${String(result.importMs)} ms (network INCLUDED, so not ` +
        `an NFR-1 figure), re-run recognised ${String(result.alreadyPresent)} ` +
        `of ${String(result.refetched)} as already present`,
    );
    assert.isAtMost(
      ncbi.length,
      6,
      `the acceptance run made ${String(ncbi.length)} NCBI requests; two per ` +
        `search was the budget and anything above it means the adapter paged ` +
        `more than expected`,
    );
  });
});
